#!/usr/bin/env python3
"""Low-latency event-driven X11/XTest input, XFixes cursor sync, window fit, and lifecycle bridge.
Uses ctypes against libX11.so.6, libXtst.so.6, and libXfixes.so.3 with zero polling subprocesses.
"""
import ctypes
import json
import os
import subprocess
import sys
import threading
import time

libX11 = ctypes.CDLL("libX11.so.6")
libXtst = ctypes.CDLL("libXtst.so.6")
libXfixes = ctypes.CDLL("libXfixes.so.3")


class XFixesCursorImage(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_short),
        ("y", ctypes.c_short),
        ("width", ctypes.c_ushort),
        ("height", ctypes.c_ushort),
        ("xhot", ctypes.c_ushort),
        ("yhot", ctypes.c_ushort),
        ("cursor_serial", ctypes.c_ulong),
        ("pixels", ctypes.c_void_p),
        ("atom", ctypes.c_ulong),
        ("name", ctypes.c_char_p),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("type", ctypes.c_int), ("pad", ctypes.c_long * 24)]


libX11.XOpenDisplay.argtypes = [ctypes.c_char_p]
libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XSelectInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_long]
libX11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
libX11.XPending.argtypes = [ctypes.c_void_p]
libX11.XPending.restype = ctypes.c_int
libX11.XFlush.argtypes = [ctypes.c_void_p]
libX11.XStringToKeysym.argtypes = [ctypes.c_char_p]
libX11.XStringToKeysym.restype = ctypes.c_ulong
libX11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libX11.XKeysymToKeycode.restype = ctypes.c_ubyte
libX11.XSetErrorHandler.argtypes = [
    ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
]

libXtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
libXtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
libXtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

libXfixes.XFixesQueryExtension.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
libXfixes.XFixesQueryExtension.restype = ctypes.c_int
libXfixes.XFixesSelectCursorInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong]
libXfixes.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
libXfixes.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesCursorImage)
libX11.XFree.argtypes = [ctypes.c_void_p]

SUBSTRUCTURE_NOTIFY_MASK = 1 << 19
PROPERTY_CHANGE_MASK = 1 << 22
MAP_NOTIFY = 19
UNMAP_NOTIFY = 18
DESTROY_NOTIFY = 17


@ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
def ignore_x_error(_dpy, _err):
    return 0


KEY_MAP = {
    "Enter": "Return",
    "Backspace": "BackSpace",
    "Tab": "Tab",
    "Escape": "Escape",
    "Delete": "Delete",
    "Insert": "Insert",
    "Home": "Home",
    "End": "End",
    "PageUp": "Page_Up",
    "PageDown": "Page_Down",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
    "Shift": "Shift_L",
    "Control": "Control_L",
    "Alt": "Alt_L",
    "Meta": "Super_L",
    "CapsLock": "Caps_Lock",
    " ": "space",
    "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4",
    "F5": "F5", "F6": "F6", "F7": "F7", "F8": "F8",
    "F9": "F9", "F10": "F10", "F11": "F11", "F12": "F12",
    "!": "exclam", "@": "at", "#": "numbersign", "$": "dollar",
    "%": "percent", "^": "asciicircum", "&": "ampersand", "*": "asterisk",
    "(": "parenleft", ")": "parenright", "-": "minus", "_": "underscore",
    "=": "equal", "+": "plus", "[": "bracketleft", "]": "bracketright",
    "{": "braceleft", "}": "braceright", "\\": "backslash", "|": "bar",
    ";": "semicolon", ":": "colon", "'": "apostrophe", '"': "quotedbl",
    ",": "comma", ".": "period", "<": "less", ">": "greater",
    "/": "slash", "?": "question", "`": "grave", "~": "asciitilde",
}

SHIFT_REQUIRED_ASCII = set('~!@#$%^&*()_+{}|:"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ')

stdout_lock = threading.Lock()


def emit(obj: dict) -> None:
    with stdout_lock:
        try:
            sys.stdout.write(json.dumps(obj) + "\n")
            sys.stdout.flush()
        except BrokenPipeError:
            os._exit(0)


def map_xcursor_to_css(raw_name: str) -> str:
    n = (raw_name or "").lower()
    if any(k in n for k in ("hand", "pointer", "pointing_hand")):
        return "pointer"
    if any(k in n for k in ("xterm", "ibeam", "text")):
        return "text"
    if any(k in n for k in ("sb_h_double", "ew-resize", "col-resize", "left_side", "right_side")):
        return "ew-resize"
    if any(k in n for k in ("sb_v_double", "ns-resize", "row-resize", "top_side", "bottom_side")):
        return "ns-resize"
    if any(k in n for k in ("fleur", "move", "grabbing")):
        return "move"
    if "watch" in n:
        return "progress"
    if "crosshair" in n:
        return "crosshair"
    return "default"


def is_main_window(wid: str, env: dict) -> bool:
    try:
        prop = subprocess.check_output(
            ["xprop", "-id", wid, "WM_TRANSIENT_FOR", "_NET_WM_WINDOW_TYPE"],
            env=env, stderr=subprocess.DEVNULL, timeout=0.8
        ).decode("utf-8", errors="ignore")
        if "WM_TRANSIENT_FOR(WINDOW)" in prop:
            return False
        for skip in (
            "_NET_WM_WINDOW_TYPE_DIALOG",
            "_NET_WM_WINDOW_TYPE_MENU",
            "_NET_WM_WINDOW_TYPE_POPUP_MENU",
            "_NET_WM_WINDOW_TYPE_TOOLTIP",
            "_NET_WM_WINDOW_TYPE_UTILITY",
        ):
            if skip in prop:
                return False
    except Exception:
        pass
    return True


def list_wmctrl_windows(env: dict) -> list[tuple[str, str]]:
    try:
        out = subprocess.check_output(
            ["wmctrl", "-l"], env=env, stderr=subprocess.DEVNULL, timeout=1.2
        ).decode("utf-8", errors="ignore")
        res = []
        for line in out.strip().splitlines():
            parts = line.split(None, 3)
            if parts:
                wid = parts[0]
                title = parts[3].strip() if len(parts) == 4 else ""
                res.append((wid, title))
        return res
    except Exception:
        return []


def fit_windows(display_str: str, width: int, height: int) -> str:
    env = os.environ.copy()
    env["DISPLAY"] = display_str
    wins = list_wmctrl_windows(env)
    last_title = ""
    for wid, title in wins:
        if title:
            last_title = title
        if not is_main_window(wid, env):
            continue
        subprocess.run(
            ["wmctrl", "-i", "-r", wid, "-b", "remove,maximized_vert,maximized_horz"],
            env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=1.0
        )
        subprocess.run(
            ["wmctrl", "-i", "-r", wid, "-e", f"0,0,0,{width},{height}"],
            env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=1.0
        )
        subprocess.run(
            ["wmctrl", "-i", "-a", wid],
            env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=1.0
        )
    return last_title


def spawn_reaped(cmd: list[str], env: dict) -> None:
    p = subprocess.Popen(cmd, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    threading.Thread(target=p.wait, daemon=True).start()


def main() -> None:
    libX11.XSetErrorHandler(ignore_x_error)
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    target_w = int(sys.argv[2]) if len(sys.argv) > 2 else 1100
    target_h = int(sys.argv[3]) if len(sys.argv) > 3 else 680

    dpy = None
    for _ in range(30):
        dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if dpy:
            break
        time.sleep(0.1)
    if not dpy:
        emit({"type": "error", "message": f"Cannot open X11 display {display_str}"})
        sys.exit(1)

    shift_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"Shift_L"))
    state = {"w": target_w, "h": target_h, "last_title": "", "last_cursor": "default", "had_window": False}
    x11_lock = threading.Lock()
    env = os.environ.copy()
    env["DISPLAY"] = display_str

    def event_monitor_loop():
        """Zero-polling X11 event thread: reacts instantly to window map/unmap & cursor shape changes."""
        mon_dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if not mon_dpy:
            return
        root = libX11.XDefaultRootWindow(mon_dpy)
        libX11.XSelectInput(mon_dpy, root, SUBSTRUCTURE_NOTIFY_MASK | PROPERTY_CHANGE_MASK)

        xfixes_ev_base = ctypes.c_int(0)
        xfixes_err_base = ctypes.c_int(0)
        has_xfixes = bool(
            libXfixes.XFixesQueryExtension(mon_dpy, ctypes.byref(xfixes_ev_base), ctypes.byref(xfixes_err_base))
        )
        if has_xfixes:
            libXfixes.XFixesSelectCursorInput(mon_dpy, root, 1)  # XFixesDisplayCursorNotifyMask
        libX11.XFlush(mon_dpy)

        ev = XEvent()
        while True:
            libX11.XNextEvent(mon_dpy, ctypes.byref(ev))
            etype = ev.type

            if has_xfixes and etype == xfixes_ev_base.value:
                cimg_ptr = libXfixes.XFixesGetCursorImage(mon_dpy)
                if cimg_ptr:
                    try:
                        cname = cimg_ptr.contents.name.decode("utf-8", errors="ignore") if cimg_ptr.contents.name else ""
                        css_cur = map_xcursor_to_css(cname)
                        if css_cur != state["last_cursor"]:
                            state["last_cursor"] = css_cur
                            emit({"type": "cursor", "cursor": css_cur})
                    finally:
                        libX11.XFree(cimg_ptr)
                continue

            if etype == MAP_NOTIFY:
                # Drain burst of events first
                while libX11.XPending(mon_dpy) > 0:
                    libX11.XNextEvent(mon_dpy, ctypes.byref(ev))
                title = fit_windows(display_str, state["w"], state["h"])
                if title:
                    state["had_window"] = True
                    if title != state["last_title"]:
                        state["last_title"] = title
                        emit({"type": "title", "title": title})

            elif etype in (UNMAP_NOTIFY, DESTROY_NOTIFY) and state["had_window"]:
                # Check after short delay if all application windows were closed by user
                def check_closed():
                    time.sleep(1.2)
                    wins = list_wmctrl_windows(env)
                    if not wins and state["had_window"]:
                        emit({"type": "all_windows_closed"})
                threading.Thread(target=check_closed, daemon=True).start()

            else:
                # Occasional title sync on root _NET_ACTIVE_WINDOW / property change
                wins = list_wmctrl_windows(env)
                if wins:
                    state["had_window"] = True
                    t = wins[-1][1]
                    if t and t != state["last_title"]:
                        state["last_title"] = t
                        emit({"type": "title", "title": t})

    threading.Thread(target=event_monitor_loop, daemon=True).start()
    emit({"type": "ready"})

    def press_keysym(ks: int, down: bool):
        kc = libX11.XKeysymToKeycode(dpy, ks)
        if kc:
            libXtst.XTestFakeKeyEvent(dpy, kc, 1 if down else 0, 0)
            libX11.XFlush(dpy)
            return True
        return False

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue

        mtype = msg.get("type")
        try:
            if mtype == "mousemove":
                x = max(0, int(msg.get("x", 0)))
                y = max(0, int(msg.get("y", 0)))
                with x11_lock:
                    libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                    libX11.XFlush(dpy)

            elif mtype in ("mousedown", "mouseup"):
                x = max(0, int(msg.get("x", 0)))
                y = max(0, int(msg.get("y", 0)))
                btn_in = msg.get("button", "left")
                btn = 1 if btn_in in ("left", 0, 1) else (2 if btn_in in ("middle", 2) else 3)
                is_down = 1 if mtype == "mousedown" else 0
                with x11_lock:
                    libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                    libXtst.XTestFakeButtonEvent(dpy, btn, is_down, 0)
                    libX11.XFlush(dpy)

            elif mtype == "wheel":
                x = max(0, int(msg.get("x", 0)))
                y = max(0, int(msg.get("y", 0)))
                dy = float(msg.get("deltaY", 0))
                dx = float(msg.get("deltaX", 0))
                with x11_lock:
                    libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                    if abs(dy) > 0:
                        btn = 5 if dy > 0 else 4
                        ticks = max(1, min(4, int(round(abs(dy) / 90)) or 1))
                        for _ in range(ticks):
                            libXtst.XTestFakeButtonEvent(dpy, btn, 1, 0)
                            libXtst.XTestFakeButtonEvent(dpy, btn, 0, 0)
                    if abs(dx) > 0:
                        btn = 7 if dx > 0 else 6
                        libXtst.XTestFakeButtonEvent(dpy, btn, 1, 0)
                        libXtst.XTestFakeButtonEvent(dpy, btn, 0, 0)
                    libX11.XFlush(dpy)

            elif mtype in ("keydown", "keyup"):
                key = str(msg.get("key", ""))
                is_down = mtype == "keydown"
                ctrl = bool(msg.get("ctrlKey"))
                alt = bool(msg.get("altKey"))
                meta = bool(msg.get("metaKey"))

                if is_down and len(key) == 1 and ord(key) > 127 and not ctrl and not alt and not meta:
                    spawn_reaped(["xdotool", "type", "--delay", "0", "--clearmodifiers", key], env)
                    continue
                if not is_down and len(key) == 1 and ord(key) > 127:
                    continue

                xname = KEY_MAP.get(key)
                if not xname and len(key) == 1 and 32 <= ord(key) <= 126:
                    xname = key
                if xname:
                    ks = libX11.XStringToKeysym(xname.encode("utf-8"))
                    if ks:
                        with x11_lock:
                            need_shift = len(key) == 1 and key in SHIFT_REQUIRED_ASCII and not msg.get("shiftKey")
                            if is_down and need_shift and shift_kc:
                                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
                            press_keysym(ks, is_down)
                            if is_down and need_shift and shift_kc:
                                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)
                            libX11.XFlush(dpy)

            elif mtype == "text":
                txt = str(msg.get("text", ""))
                if txt:
                    spawn_reaped(["xdotool", "type", "--delay", "0", "--clearmodifiers", txt], env)

            elif mtype == "resize":
                w = max(320, min(1920, int(msg.get("width", state["w"]))))
                h = max(240, min(1080, int(msg.get("height", state["h"]))))
                state["w"] = w
                state["h"] = h
                fit_windows(display_str, w, h)

            elif mtype == "clipboard_set":
                txt = str(msg.get("text", ""))
                p = subprocess.Popen(
                    ["xclip", "-selection", "clipboard"],
                    stdin=subprocess.PIPE, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL
                )
                p.communicate(txt.encode("utf-8"), timeout=1.5)

            elif mtype == "clipboard_get":
                out = subprocess.check_output(
                    ["xclip", "-o", "-selection", "clipboard"],
                    env=env, stderr=subprocess.DEVNULL, timeout=1.5
                ).decode("utf-8", errors="ignore")
                emit({"type": "clipboard", "text": out})

        except Exception:
            pass

    libX11.XCloseDisplay(dpy)


if __name__ == "__main__":
    main()
