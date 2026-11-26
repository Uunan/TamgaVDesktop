#!/usr/bin/env python3
"""Low-latency X11/XTest input, window resize, clipboard, and title bridge for TamgaVDesktop.
Uses ctypes directly against libX11.so.6 and libXtst.so.6 with zero external pip dependencies.
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

libX11.XOpenDisplay.argtypes = [ctypes.c_char_p]
libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XFlush.argtypes = [ctypes.c_void_p]
libX11.XStringToKeysym.argtypes = [ctypes.c_char_p]
libX11.XStringToKeysym.restype = ctypes.c_ulong
libX11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libX11.XKeysymToKeycode.restype = ctypes.c_ubyte

libXtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
libXtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
libXtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

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


def is_main_window(wid: str, env: dict) -> bool:
    try:
        prop = subprocess.check_output(
            ["xprop", "-id", wid, "WM_TRANSIENT_FOR", "_NET_WM_WINDOW_TYPE"],
            env=env, stderr=subprocess.DEVNULL, timeout=0.8
        ).decode("utf-8", errors="ignore")
        if "WM_TRANSIENT_FOR(WINDOW)" in prop:
            return False
        for skip in ("_NET_WM_WINDOW_TYPE_DIALOG", "_NET_WM_WINDOW_TYPE_MENU", "_NET_WM_WINDOW_TYPE_POPUP_MENU", "_NET_WM_WINDOW_TYPE_TOOLTIP", "_NET_WM_WINDOW_TYPE_UTILITY"):
            if skip in prop:
                return False
    except Exception:
        pass
    return True


def fit_windows(display_str: str, width: int, height: int) -> None:
    env = os.environ.copy()
    env["DISPLAY"] = display_str
    try:
        out = subprocess.check_output(
            ["wmctrl", "-l"], env=env, stderr=subprocess.DEVNULL, timeout=1.5
        ).decode("utf-8", errors="ignore")
        wids = [line.split()[0] for line in out.strip().splitlines() if line.strip()]
        for wid in wids:
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
    except Exception:
        try:
            wid = subprocess.check_output(
                ["xdotool", "getactivewindow"], env=env, stderr=subprocess.DEVNULL, timeout=1.0
            ).decode().strip()
            if wid:
                subprocess.run(
                    ["xdotool", "windowmove", "--sync", wid, "0", "0", "windowsize", "--sync", wid, str(width), str(height)],
                    env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=1.0
                )
        except Exception:
            pass


def main() -> None:
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    target_w = int(sys.argv[2]) if len(sys.argv) > 2 else 1120
    target_h = int(sys.argv[3]) if len(sys.argv) > 3 else 700

    dpy = None
    for _ in range(30):
        dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if dpy:
            break
        time.sleep(0.15)
    if not dpy:
        emit({"type": "error", "message": f"Cannot open X11 display {display_str}"})
        sys.exit(1)

    shift_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"Shift_L"))
    state = {"w": target_w, "h": target_h, "last_title": "", "seen_wids": set()}
    x11_lock = threading.Lock()
    env = os.environ.copy()
    env["DISPLAY"] = display_str

    def monitor_loop():
        while True:
            time.sleep(0.85)
            try:
                out = subprocess.check_output(
                    ["wmctrl", "-l"], env=env, stderr=subprocess.DEVNULL, timeout=1.2
                ).decode("utf-8", errors="ignore")
                lines = [l for l in out.strip().splitlines() if l.strip()]
                current_wids = set()
                active_title = ""
                for line in lines:
                    parts = line.split(None, 3)
                    if len(parts) >= 1:
                        wid = parts[0]
                        current_wids.add(wid)
                        if len(parts) == 4 and parts[3].strip():
                            active_title = parts[3].strip()
                # Whenever a brand-new top-level window appears, fit it cleanly into our viewport
                if current_wids - state["seen_wids"]:
                    fit_windows(display_str, state["w"], state["h"])
                    state["seen_wids"] = current_wids
                if active_title and active_title != state["last_title"]:
                    state["last_title"] = active_title
                    emit({"type": "title", "title": active_title})
            except Exception:
                pass

    t = threading.Thread(target=monitor_loop, daemon=True)
    t.start()
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
                        ticks = max(1, min(6, int(round(abs(dy) / 80)) or 1))
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

                # Non-ASCII printable character (e.g., Turkish ğüşiöçĞÜŞİÖÇ) typed without ctrl/alt/meta
                if is_down and len(key) == 1 and ord(key) > 127 and not ctrl and not alt and not meta:
                    subprocess.Popen(
                        ["xdotool", "type", "--delay", "0", "--clearmodifiers", key],
                        env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL
                    )
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
                    subprocess.Popen(
                        ["xdotool", "type", "--delay", "0", "--clearmodifiers", txt],
                        env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL
                    )

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
