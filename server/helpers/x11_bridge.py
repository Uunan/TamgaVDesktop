#!/usr/bin/env python3
"""Low-latency event-driven X11/XTest input, XFixes cursor sync, multi-window slot manager and lifecycle bridge.

Multi-window model:
- The Xvfb screen is a large virtual canvas split into 1920x1080 "slots".
- The first main application window lives in slot 0 (view "main").
- Every additional top-level application window gets its own free slot and is announced to Node
  as a separate view ({"type": "window_opened", "view": "<wid>", ...}) so the web shell can open it
  inside its own desktop window frame.
- Dialogs / transient windows are kept centered inside their parent's slot.
- When an application resizes or maximizes its own window, the new geometry is reported
  ({"type": "view_geometry"} / {"type": "view_maximize"}) so the web window frame follows the app.
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

SLOT_W = 1920
SLOT_H = 1080
SLOT_COLS = 2
SLOT_COUNT = 4
MIN_W = 240
MIN_H = 180


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


def slot_origin(slot: int) -> tuple[int, int]:
    return (slot % SLOT_COLS) * SLOT_W, (slot // SLOT_COLS) * SLOT_H


def clamp_size(w: int, h: int) -> tuple[int, int]:
    return max(MIN_W, min(SLOT_W, int(w))), max(MIN_H, min(SLOT_H, int(h)))


def run_quiet(cmd: list[str], env: dict, timeout: float = 1.0) -> None:
    try:
        subprocess.run(cmd, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=timeout)
    except Exception:
        pass


def spawn_reaped(cmd: list[str], env: dict) -> None:
    p = subprocess.Popen(cmd, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    threading.Thread(target=p.wait, daemon=True).start()


def list_windows_geom(env: dict) -> list[dict]:
    """Returns managed top-level windows: [{wid, x, y, w, h, title}] via `wmctrl -lG`."""
    try:
        out = subprocess.check_output(
            ["wmctrl", "-lG"], env=env, stderr=subprocess.DEVNULL, timeout=1.2
        ).decode("utf-8", errors="ignore")
    except Exception:
        return []
    res = []
    for line in out.strip().splitlines():
        parts = line.split(None, 7)
        if len(parts) < 6:
            continue
        try:
            res.append({
                "wid": parts[0].lower(),
                "x": int(parts[2]),
                "y": int(parts[3]),
                "w": int(parts[4]),
                "h": int(parts[5]),
                "title": parts[7].strip() if len(parts) == 8 else "",
            })
        except ValueError:
            continue
    return res


def classify_window(wid: str, env: dict) -> dict:
    """Return {'main': bool, 'transient_for': str|None} for a top-level window."""
    info = {"main": True, "transient_for": None}
    try:
        prop = subprocess.check_output(
            ["xprop", "-id", wid, "WM_TRANSIENT_FOR", "_NET_WM_WINDOW_TYPE"],
            env=env, stderr=subprocess.DEVNULL, timeout=0.8
        ).decode("utf-8", errors="ignore")
    except Exception:
        return info
    for line in prop.splitlines():
        if line.startswith("WM_TRANSIENT_FOR(WINDOW)"):
            info["main"] = False
            tail = line.split("#")[-1].strip()
            if tail.startswith("0x"):
                info["transient_for"] = tail.lower()
    for skip in (
        "_NET_WM_WINDOW_TYPE_DIALOG",
        "_NET_WM_WINDOW_TYPE_MENU",
        "_NET_WM_WINDOW_TYPE_POPUP_MENU",
        "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU",
        "_NET_WM_WINDOW_TYPE_TOOLTIP",
        "_NET_WM_WINDOW_TYPE_UTILITY",
        "_NET_WM_WINDOW_TYPE_SPLASH",
        "_NET_WM_WINDOW_TYPE_NOTIFICATION",
    ):
        if skip in prop:
            info["main"] = False
    return info


def is_maximized(wid: str, env: dict) -> bool:
    try:
        prop = subprocess.check_output(
            ["xprop", "-id", wid, "_NET_WM_STATE"], env=env, stderr=subprocess.DEVNULL, timeout=0.8
        ).decode("utf-8", errors="ignore")
    except Exception:
        return False
    return "_NET_WM_STATE_MAXIMIZED" in prop or "_NET_WM_STATE_FULLSCREEN" in prop


def same_wid(a: str, b: str) -> bool:
    try:
        return int(a, 16) == int(b, 16)
    except Exception:
        return a == b


class WindowManager:
    def __init__(self, display_str: str, main_w: int, main_h: int):
        self.env = os.environ.copy()
        self.env["DISPLAY"] = display_str
        self.lock = threading.RLock()
        # view id -> {wid, slot, w, h, title, ignore_until}
        self.views: dict[str, dict] = {}
        self.main_assigned = False
        self.main_req = clamp_size(main_w, main_h)
        self.class_cache: dict[str, dict] = {}
        self.placed_dialogs: set[str] = set()
        self.had_window = False
        self.closed_announced = False
        self.dirty = threading.Event()

    # ---------- helpers ----------
    def _view_by_wid(self, wid: str):
        for vid, v in self.views.items():
            if same_wid(v["wid"], wid):
                return vid, v
        return None, None

    def _free_slot(self):
        used = {v["slot"] for v in self.views.values()}
        for s in range(0, SLOT_COUNT):
            if s not in used:
                return s
        return None

    def _place(self, v: dict, w: int, h: int, strip_fs: bool = True) -> None:
        ox, oy = slot_origin(v["slot"])
        v["w"], v["h"] = w, h
        v["ignore_until"] = time.monotonic() + 0.35
        wid = v["wid"]
        rm_atoms = "remove,maximized_vert,maximized_horz,fullscreen" if strip_fs else "remove,maximized_vert,maximized_horz"
        run_quiet(["wmctrl", "-i", "-r", wid, "-b", rm_atoms], self.env)
        run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,{ox},{oy},{w},{h}"], self.env)

    def view_offset(self, view: str) -> tuple[int, int]:
        with self.lock:
            v = self.views.get(view or "main")
            if not v:
                v = self.views.get("main") or (next(iter(self.views.values()), None))
            if not v:
                return 0, 0
            return slot_origin(v["slot"])

    # ---------- commands from Node ----------
    def resize_view(self, view: str, w: int, h: int) -> None:
        with self.lock:
            cw, ch = clamp_size(w, h)
            if (view or "main") == "main":
                self.main_req = (cw, ch)
            v = self.views.get(view or "main")
            if not v:
                return
            if abs(v["w"] - cw) < 6 and abs(v["h"] - ch) < 6:
                return
            self._place(v, cw, ch, strip_fs=True)

    def focus_view(self, view: str) -> None:
        with self.lock:
            v = self.views.get(view or "main")
            if v:
                run_quiet(["wmctrl", "-i", "-a", v["wid"]], self.env)

    def close_view(self, view: str) -> None:
        with self.lock:
            v = self.views.get(view or "main")
            if v:
                run_quiet(["wmctrl", "-i", "-c", v["wid"]], self.env)

    # ---------- reconciliation ----------
    def reconcile(self) -> None:
        wins = list_windows_geom(self.env)
        now = time.monotonic()
        with self.lock:
            present = {w["wid"] for w in wins}

            # 1. Removed windows
            for vid in list(self.views.keys()):
                v = self.views[vid]
                if not any(same_wid(v["wid"], p) for p in present):
                    del self.views[vid]
                    emit({"type": "view_closed", "view": vid})
            self.placed_dialogs = {d for d in self.placed_dialogs if any(same_wid(d, p) for p in present)}

            if wins:
                self.had_window = True
                self.closed_announced = False
            elif self.had_window and not self.closed_announced:
                self.closed_announced = True
                threading.Thread(target=self._confirm_all_closed, daemon=True).start()
                return

            # 2. New / existing windows
            for win in wins:
                wid = win["wid"]
                cls = self.class_cache.get(wid)
                if cls is None:
                    cls = classify_window(wid, self.env)
                    self.class_cache[wid] = cls

                vid, v = self._view_by_wid(wid)

                if v is None and cls["main"]:
                    if not self.main_assigned:
                        self.main_assigned = True
                        v = {"wid": wid, "slot": 0, "w": 0, "h": 0, "title": "", "ignore_until": 0.0}
                        self.views["main"] = v
                        vid = "main"
                        mw, mh = self.main_req
                        self._place(v, mw, mh)
                        run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                    else:
                        slot = self._free_slot()
                        if slot is None:
                            mv = next(iter(self.views.values()), None)
                            if mv:
                                cw, ch = clamp_size(min(win["w"], mv["w"]), min(win["h"], mv["h"]))
                                ox, oy = slot_origin(mv["slot"])
                                run_quiet(["wmctrl", "-i", "-r", wid, "-e",
                                           f"0,{ox + max(0, (mv['w'] - cw) // 2)},{oy + max(0, (mv['h'] - ch) // 2)},{cw},{ch}"], self.env)
                            continue
                        cw, ch = clamp_size(win["w"] if win["w"] > 40 else 900, win["h"] if win["h"] > 40 else 640)
                        vid = wid
                        v = {"wid": wid, "slot": slot, "w": 0, "h": 0, "title": win["title"], "ignore_until": 0.0}
                        self.views[vid] = v
                        self._place(v, cw, ch)
                        run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                        emit({
                            "type": "window_opened",
                            "view": vid,
                            "slot": slot,
                            "title": win["title"],
                            "width": cw,
                            "height": ch,
                        })
                    if win["title"]:
                        v["title"] = win["title"]
                        emit({"type": "title", "view": vid, "title": win["title"]})
                    continue

                if v is None:
                    # Dialog / transient: keep it centered inside its parent's slot
                    if wid in self.placed_dialogs:
                        continue
                    parent_slot = 0
                    if cls.get("transient_for"):
                        _pv, pvv = self._view_by_wid(cls["transient_for"])
                        if pvv:
                            parent_slot = pvv["slot"]
                    elif "main" in self.views:
                        parent_slot = self.views["main"]["slot"]
                    elif self.views:
                        parent_slot = next(iter(self.views.values()))["slot"]
                    pv = next((x for x in self.views.values() if x["slot"] == parent_slot), None)
                    pw, ph = (pv["w"], pv["h"]) if pv else self.main_req
                    ox, oy = slot_origin(parent_slot)
                    dw, dh = min(win["w"], pw), min(win["h"], ph)
                    tx = ox + max(0, (pw - dw) // 2)
                    ty = oy + max(0, (ph - dh) // 3)
                    run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,{tx},{ty},{dw},{dh}"], self.env)
                    run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                    self.placed_dialogs.add(wid)
                    continue

                # Tracked main / extra window: title sync + self-resize / maximize detection
                if win["title"] and win["title"] != v["title"]:
                    v["title"] = win["title"]
                    emit({"type": "title", "view": vid, "title": win["title"]})

                if now < v.get("ignore_until", 0.0):
                    continue

                ox, oy = slot_origin(v["slot"])
                too_big = win["w"] > SLOT_W + 2 or win["h"] > SLOT_H + 2
                if too_big or is_maximized(wid, self.env):
                    # App asked to maximize / fullscreen itself -> maximize the web window frame
                    emit({"type": "view_maximize", "view": vid})
                    mw, mh = clamp_size(v["w"] or self.main_req[0], v["h"] or self.main_req[1])
                    self._place(v, mw, mh, strip_fs=True)
                    continue

                if abs(win["w"] - v["w"]) >= 6 or abs(win["h"] - v["h"]) >= 6:
                    # App resized its own window -> web window frame follows the app
                    cw, ch = clamp_size(win["w"], win["h"])
                    v["w"], v["h"] = cw, ch
                    emit({"type": "view_geometry", "view": vid, "width": cw, "height": ch})
                    if cw != win["w"] or ch != win["h"] or abs(win["x"] - ox) > 2 or abs(win["y"] - oy) > 2:
                        self._place(v, cw, ch)
                    continue

                if abs(win["x"] - ox) > 2 or abs(win["y"] - oy) > 2:
                    # Keep window anchored in its slot (app moved itself)
                    v["ignore_until"] = now + 0.35
                    run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,{ox},{oy},{v['w']},{v['h']}"], self.env)

    def _confirm_all_closed(self) -> None:
        time.sleep(1.2)
        if not list_windows_geom(self.env):
            emit({"type": "all_windows_closed"})
        else:
            with self.lock:
                self.closed_announced = False
            self.dirty.set()


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
    x11_lock = threading.Lock()
    wm = WindowManager(display_str, target_w, target_h)
    env = wm.env
    state = {"last_cursor": "default"}

    def reconcile_loop():
        """Debounced window reconciliation: runs at most every ~120ms only after X11 window events."""
        while True:
            wm.dirty.wait()
            time.sleep(0.12)
            wm.dirty.clear()
            try:
                wm.reconcile()
            except Exception:
                pass

    def event_monitor_loop():
        """Zero-polling X11 event thread: window map/unmap/configure + XFixes cursor shape changes."""
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
            if has_xfixes and ev.type == xfixes_ev_base.value:
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
            wm.dirty.set()

    threading.Thread(target=reconcile_loop, daemon=True).start()
    threading.Thread(target=event_monitor_loop, daemon=True).start()
    wm.dirty.set()
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
        view = str(msg.get("view") or "main")
        try:
            if mtype in ("mousemove", "mousedown", "mouseup", "wheel"):
                ox, oy = wm.view_offset(view)
                x = ox + max(0, min(SLOT_W - 1, int(msg.get("x", 0))))
                y = oy + max(0, min(SLOT_H - 1, int(msg.get("y", 0))))

                if mtype == "mousemove":
                    with x11_lock:
                        libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                        libX11.XFlush(dpy)

                elif mtype in ("mousedown", "mouseup"):
                    btn_in = msg.get("button", "left")
                    btn = 1 if btn_in in ("left", 0, 1) else (2 if btn_in in ("middle", 2) else 3)
                    is_down = 1 if mtype == "mousedown" else 0
                    with x11_lock:
                        libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                        libXtst.XTestFakeButtonEvent(dpy, btn, is_down, 0)
                        libX11.XFlush(dpy)

                else:
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
                wm.resize_view(view, int(msg.get("width", 0) or 0), int(msg.get("height", 0) or 0))

            elif mtype == "focus_view":
                wm.focus_view(view)

            elif mtype == "close_view":
                wm.close_view(view)

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
