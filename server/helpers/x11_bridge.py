#!/usr/bin/env python3
"""Event-driven X11/XTest input, XFixes cursor sync, XComposite multi-window & native-geometry manager.

Key behaviors:
- Runs inside an Xvfb sized cleanly to the user's Tamga desktop viewport (with XComposite enabled).
- Lets each Linux application determine its own initial & resized window dimensions (`view_geometry`).
- Smoothly hands off startup splash windows (_NET_WM_WINDOW_TYPE_SPLASH, e.g. GIMP Startup)
  to the main workspace window without freezing or closing the app frame.
- Keeps dialogs / transient windows centered inside their parent view.
- Supports unlimited extra top-level windows in the same X11 session: the active/focused view
  captures from `root` (including menus, dropdowns, and dialogs) while background views
  capture cleanly from their off-screen XCompositeNameWindowPixmap without overlapping bleed.
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
try:
    libXcomp = ctypes.CDLL("libXcomposite.so.1")
except OSError:
    libXcomp = None


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
libX11.XCloseDisplay.restype = ctypes.c_int
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XSelectInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_long]
libX11.XSelectInput.restype = ctypes.c_int
libX11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
libX11.XNextEvent.restype = ctypes.c_int
libX11.XPending.argtypes = [ctypes.c_void_p]
libX11.XPending.restype = ctypes.c_int
libX11.XFlush.argtypes = [ctypes.c_void_p]
libX11.XFlush.restype = ctypes.c_int
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XSync.restype = ctypes.c_int
libX11.XQueryTree.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)),
    ctypes.POINTER(ctypes.c_uint),
]
libX11.XQueryTree.restype = ctypes.c_int
libX11.XFree.argtypes = [ctypes.c_void_p]
libX11.XFree.restype = ctypes.c_int
libX11.XStringToKeysym.argtypes = [ctypes.c_char_p]
libX11.XStringToKeysym.restype = ctypes.c_ulong
libX11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libX11.XKeysymToKeycode.restype = ctypes.c_ubyte
libX11.XkbKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_int]
libX11.XkbKeycodeToKeysym.restype = ctypes.c_ulong
libX11.XDisplayKeycodes.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
libX11.XDisplayKeycodes.restype = ctypes.c_int
libX11.XChangeKeyboardMapping.argtypes = [
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.c_int,
]
libX11.XChangeKeyboardMapping.restype = ctypes.c_int
libX11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
libX11.XInternAtom.restype = ctypes.c_ulong
libX11.XSetErrorHandler.argtypes = [
    ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
]
libX11.XSetErrorHandler.restype = ctypes.c_void_p

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
libXfixes.XFixesSelectSelectionInput.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_ulong,
    ctypes.c_ulong,
]
libXfixes.XFixesSelectSelectionInput.restype = None
libXfixes.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
libXfixes.XFixesGetCursorImage.restype = ctypes.POINTER(XFixesCursorImage)

if libXcomp is not None:
    libXcomp.XCompositeRedirectSubwindows.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
    libXcomp.XCompositeRedirectSubwindows.restype = ctypes.c_int

SUBSTRUCTURE_NOTIFY_MASK = 1 << 19
PROPERTY_CHANGE_MASK = 1 << 22

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


def run_quiet(cmd: list[str], env: dict, timeout: float = 1.0) -> None:
    try:
        subprocess.run(cmd, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=timeout)
    except Exception:
        pass


def spawn_reaped(cmd: list[str], env: dict) -> None:
    p = subprocess.Popen(cmd, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    threading.Thread(target=p.wait, daemon=True).start()


def find_top_frame(dpy, root: int, client_wid_hex: str) -> str:
    """Walk parent windows up to root to get the Openbox frame window for XComposite capture."""
    if not dpy:
        return client_wid_hex
    try:
        cur = int(client_wid_hex, 16)
    except ValueError:
        return client_wid_hex
    for _ in range(12):
        r_ret = ctypes.c_ulong(0)
        p_ret = ctypes.c_ulong(0)
        ch_ret = ctypes.POINTER(ctypes.c_ulong)()
        n_ret = ctypes.c_uint(0)
        ok = libX11.XQueryTree(
            dpy, cur, ctypes.byref(r_ret), ctypes.byref(p_ret), ctypes.byref(ch_ret), ctypes.byref(n_ret)
        )
        if ch_ret:
            libX11.XFree(ch_ret)
        if not ok or p_ret.value == 0 or p_ret.value == root:
            break
        cur = p_ret.value
    return hex(cur)


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
    """Return {'main': bool, 'is_splash': bool, 'transient_for': str|None}."""
    info = {"main": True, "is_splash": False, "transient_for": None}
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
    if "_NET_WM_WINDOW_TYPE_SPLASH" in prop:
        info["main"] = False
        info["is_splash"] = True
    for skip in (
        "_NET_WM_WINDOW_TYPE_DIALOG",
        "_NET_WM_WINDOW_TYPE_MENU",
        "_NET_WM_WINDOW_TYPE_POPUP_MENU",
        "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU",
        "_NET_WM_WINDOW_TYPE_TOOLTIP",
        "_NET_WM_WINDOW_TYPE_UTILITY",
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
    def __init__(self, display_str: str, screen_w: int, screen_h: int):
        self.env = os.environ.copy()
        self.env["DISPLAY"] = display_str
        self.screen_w = max(800, min(1920, int(screen_w)))
        self.screen_h = max(600, min(1080, int(screen_h)))
        self.rec_dpy = None
        self.rec_root = 0
        self.lock = threading.RLock()
        # view id -> {wid, top_wid, w, h, cw, ch, title, is_splash, ignore_until}
        self.views: dict[str, dict] = {}
        self.dialogs: dict[str, str] = {}  # dialog_wid -> parent_vid
        self.active_view = "main"
        self.main_assigned = False
        self.splash_handoff_until = 0.0
        self.class_cache: dict[str, dict] = {}
        self.placed_dialogs: set[str] = set()
        self.had_window = False
        self.closed_announced = False
        self.last_targets_json = ""
        self.dirty = threading.Event()

    def attach_reconcile_display(self, rec_dpy, rec_root: int) -> None:
        self.rec_dpy = rec_dpy
        self.rec_root = rec_root

    def clamp_size(self, w: int, h: int) -> tuple[int, int]:
        cw = max(MIN_W, min(self.screen_w, int(w or MIN_W)))
        ch = max(MIN_H, min(self.screen_h, int(h or MIN_H)))
        return cw - (cw % 2), ch - (ch % 2)

    def _view_by_wid(self, wid: str):
        for vid, v in self.views.items():
            if same_wid(v["wid"], wid):
                return vid, v
        return None, None

    def _anchor_native(self, wid: str, win: dict, cw: int, ch: int, strip_fs: bool = True) -> None:
        """Anchor window at (0, 0) while preserving its own size unless out of screen bounds."""
        rm_atoms = (
            "remove,maximized_vert,maximized_horz,fullscreen"
            if strip_fs
            else "remove,maximized_vert,maximized_horz"
        )
        run_quiet(["wmctrl", "-i", "-r", wid, "-b", rm_atoms], self.env)
        need_resize = (
            win["w"] < MIN_W
            or win["h"] < MIN_H
            or win["w"] > self.screen_w
            or win["h"] > self.screen_h
        )
        if need_resize:
            run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,0,0,{cw},{ch}"], self.env)
        elif abs(win["x"]) > 2 or abs(win["y"]) > 2:
            # -1 keeps the app's own native width and height completely intact
            run_quiet(["wmctrl", "-i", "-r", wid, "-e", "0,0,0,-1,-1"], self.env)

    def _place_exact(self, v: dict, w: int, h: int, strip_fs: bool = True) -> None:
        v["cw"], v["ch"] = w, h
        v["w"], v["h"] = w, h
        v["ignore_until"] = time.monotonic() + 0.45
        wid = v["wid"]
        rm_atoms = (
            "remove,maximized_vert,maximized_horz,fullscreen"
            if strip_fs
            else "remove,maximized_vert,maximized_horz"
        )
        run_quiet(["wmctrl", "-i", "-r", wid, "-b", rm_atoms], self.env)
        run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,0,0,{w},{h}"], self.env)

    def _emit_targets(self) -> None:
        if not self.views:
            return
        if self.active_view not in self.views:
            self.active_view = "main" if "main" in self.views else next(iter(self.views.keys()))
        multi = len(self.views) > 1
        targets = {}
        for vid, v in self.views.items():
            if not multi or vid == self.active_view or not v.get("top_wid") or libXcomp is None:
                targets[vid] = {
                    "mode": "root",
                    "wid": 0,
                    "off_x": 0,
                    "off_y": 0,
                    "width": v["cw"],
                    "height": v["ch"],
                }
            else:
                targets[vid] = {
                    "mode": "pixmap",
                    "wid": v["top_wid"],
                    "off_x": 0,
                    "off_y": 0,
                    "width": v["cw"],
                    "height": v["ch"],
                }
        payload = json.dumps(targets, sort_keys=True)
        if payload != self.last_targets_json:
            self.last_targets_json = payload
            emit({"type": "view_targets", "targets": targets, "activeView": self.active_view})

    # ---------- commands from Node ----------
    def resize_view(self, view: str, w: int, h: int) -> None:
        with self.lock:
            cw, ch = self.clamp_size(w, h)
            v = self.views.get(view or "main")
            if not v:
                return
            if abs(v["cw"] - cw) < 6 and abs(v["ch"] - ch) < 6:
                return
            self._place_exact(v, cw, ch, strip_fs=True)
            self._emit_targets()

    def focus_view(self, view: str) -> None:
        with self.lock:
            vid = view or "main"
            v = self.views.get(vid)
            if not v:
                return
            changed = self.active_view != vid
            self.active_view = vid
            run_quiet(["wmctrl", "-i", "-a", v["wid"]], self.env)
            for dwid, pvid in self.dialogs.items():
                if pvid == vid:
                    run_quiet(["wmctrl", "-i", "-a", dwid], self.env)
            if changed:
                self._emit_targets()

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
                    was_splash = bool(v.get("is_splash"))
                    del self.views[vid]
                    if vid == "main" and was_splash:
                        # Splash closed while handing off to real main window -> hold main slot briefly
                        self.splash_handoff_until = now + 5.0
                    elif vid == "main" and not self.views:
                        # Single window vanished (could be launcher/Terms -> main transition or real exit)
                        self.splash_handoff_until = now + 1.4
                    else:
                        emit({"type": "view_closed", "view": vid})

            self.placed_dialogs = {d for d in self.placed_dialogs if any(same_wid(d, p) for p in present)}
            self.dialogs = {d: pv for d, pv in self.dialogs.items() if any(same_wid(d, p) for p in present)}

            if wins:
                self.had_window = True
                self.closed_announced = False
            elif self.had_window and not self.views and not self.closed_announced:
                self.closed_announced = True
                wait_sec = max(1.4, self.splash_handoff_until - now)
                threading.Thread(target=self._confirm_all_closed, args=(wait_sec,), daemon=True).start()
                return

            # 2. Classify & process new / existing windows
            # Sort so non-splash NORMAL windows are handled before splashes if both map simultaneously
            ordered = []
            for win in wins:
                wid = win["wid"]
                cls = self.class_cache.get(wid)
                if cls is None:
                    cls = classify_window(wid, self.env)
                    self.class_cache[wid] = cls
                ordered.append((0 if cls["main"] else (1 if cls["is_splash"] else 2), win, cls))
            ordered.sort(key=lambda item: item[0])

            for _prio, win, cls in ordered:
                wid = win["wid"]
                vid, v = self._view_by_wid(wid)

                # Promote real main window seamlessly over an active splash or splash handoff
                if v is None and cls["main"]:
                    cur_main = self.views.get("main")
                    need_main = (
                        not self.main_assigned
                        or (cur_main is None and now <= self.splash_handoff_until)
                        or (cur_main is not None and cur_main.get("is_splash"))
                    )
                    if need_main:
                        self.main_assigned = True
                        self.splash_handoff_until = 0.0
                        cw, ch = self.clamp_size(win["w"], win["h"])
                        top_wid = find_top_frame(self.rec_dpy, self.rec_root, wid)
                        v = {
                            "wid": wid,
                            "top_wid": top_wid,
                            "w": win["w"],
                            "h": win["h"],
                            "cw": cw,
                            "ch": ch,
                            "title": win["title"],
                            "is_splash": False,
                            "ignore_until": now + 0.5,
                        }
                        self.views["main"] = v
                        self.active_view = "main"
                        self._anchor_native(wid, win, cw, ch)
                        run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                        emit({"type": "view_geometry", "view": "main", "width": cw, "height": ch, "initial": True})
                        if win["title"]:
                            emit({"type": "title", "view": "main", "title": win["title"]})
                        self._emit_targets()
                        continue

                    # Additional top-level window -> open extra Tamga frame
                    cw, ch = self.clamp_size(win["w"], win["h"])
                    top_wid = find_top_frame(self.rec_dpy, self.rec_root, wid)
                    vid = wid
                    v = {
                        "wid": wid,
                        "top_wid": top_wid,
                        "w": win["w"],
                        "h": win["h"],
                        "cw": cw,
                        "ch": ch,
                        "title": win["title"],
                        "is_splash": False,
                        "ignore_until": now + 0.5,
                    }
                    self.views[vid] = v
                    self.active_view = vid
                    self._anchor_native(wid, win, cw, ch)
                    run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                    emit({
                        "type": "window_opened",
                        "view": vid,
                        "title": win["title"],
                        "width": cw,
                        "height": ch,
                    })
                    if win["title"]:
                        emit({"type": "title", "view": vid, "title": win["title"]})
                    self._emit_targets()
                    continue

                # Initial startup splash screen before any main window exists
                if v is None and cls["is_splash"] and not self.main_assigned:
                    self.main_assigned = True
                    cw, ch = self.clamp_size(win["w"], win["h"])
                    top_wid = find_top_frame(self.rec_dpy, self.rec_root, wid)
                    v = {
                        "wid": wid,
                        "top_wid": top_wid,
                        "w": win["w"],
                        "h": win["h"],
                        "cw": cw,
                        "ch": ch,
                        "title": win["title"],
                        "is_splash": True,
                        "ignore_until": now + 0.5,
                    }
                    self.views["main"] = v
                    self.active_view = "main"
                    self._anchor_native(wid, win, cw, ch)
                    run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                    emit({"type": "view_geometry", "view": "main", "width": cw, "height": ch, "initial": True})
                    if win["title"]:
                        emit({"type": "title", "view": "main", "title": win["title"]})
                    self._emit_targets()
                    continue

                if v is None and cls["is_splash"]:
                    continue

                if v is None:
                    # Transient / dialog window: anchor centered inside its parent view
                    if wid in self.placed_dialogs:
                        continue
                    parent_vid = self.active_view if self.active_view in self.views else "main"
                    if cls.get("transient_for"):
                        pv_id, _pvv = self._view_by_wid(cls["transient_for"])
                        if pv_id:
                            parent_vid = pv_id
                    pv = self.views.get(parent_vid) or next(iter(self.views.values()), None)
                    pw, ph = (pv["cw"], pv["ch"]) if pv else (min(1100, self.screen_w), min(680, self.screen_h))
                    dw, dh = min(win["w"], pw), min(win["h"], ph)
                    tx = max(0, (pw - dw) // 2)
                    ty = max(0, (ph - dh) // 3)
                    run_quiet(["wmctrl", "-i", "-r", wid, "-e", f"0,{tx},{ty},{dw},{dh}"], self.env)
                    run_quiet(["wmctrl", "-i", "-a", wid], self.env)
                    self.placed_dialogs.add(wid)
                    self.dialogs[wid] = parent_vid
                    continue

                # Tracked window: sync top_wid, title, and detect app-initiated resize/maximize
                top_now = find_top_frame(self.rec_dpy, self.rec_root, wid)
                if top_now != v.get("top_wid"):
                    v["top_wid"] = top_now
                    self._emit_targets()

                if win["title"] and win["title"] != v["title"]:
                    v["title"] = win["title"]
                    emit({"type": "title", "view": vid, "title": win["title"]})

                if now < v.get("ignore_until", 0.0):
                    continue

                if is_maximized(wid, self.env):
                    emit({"type": "view_maximize", "view": vid})
                    self._place_exact(v, v["cw"], v["ch"], strip_fs=True)
                    self._emit_targets()
                    continue

                if abs(win["w"] - v["w"]) >= 6 or abs(win["h"] - v["h"]) >= 6:
                    cw, ch = self.clamp_size(win["w"], win["h"])
                    v["w"], v["h"] = win["w"], win["h"]
                    v["cw"], v["ch"] = cw, ch
                    if win["w"] > self.screen_w or win["h"] > self.screen_h or win["w"] < MIN_W or win["h"] < MIN_H:
                        self._place_exact(v, cw, ch)
                    elif abs(win["x"]) > 2 or abs(win["y"]) > 2:
                        run_quiet(["wmctrl", "-i", "-r", wid, "-e", "0,0,0,-1,-1"], self.env)
                    emit({"type": "view_geometry", "view": vid, "width": cw, "height": ch})
                    self._emit_targets()
                    continue

                if abs(win["x"]) > 2 or abs(win["y"]) > 2:
                    v["ignore_until"] = now + 0.35
                    run_quiet(["wmctrl", "-i", "-r", wid, "-e", "0,0,0,-1,-1"], self.env)

    def _confirm_all_closed(self, wait_sec: float) -> None:
        deadline = time.monotonic() + max(1.2, min(6.0, wait_sec))
        while time.monotonic() < deadline:
            time.sleep(0.3)
            if list_windows_geom(self.env):
                with self.lock:
                    self.closed_announced = False
                self.dirty.set()
                return
        emit({"type": "all_windows_closed"})


def main() -> None:
    libX11.XSetErrorHandler(ignore_x_error)
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    screen_w = int(sys.argv[2]) if len(sys.argv) > 2 else 1440
    screen_h = int(sys.argv[3]) if len(sys.argv) > 3 else 840

    dpy = None
    for _ in range(80):
        dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if dpy:
            break
        time.sleep(0.1)
    if not dpy:
        emit({"type": "error", "message": f"Cannot open X11 display {display_str}"})
        sys.exit(1)

    if libXcomp is not None:
        root_main = libX11.XDefaultRootWindow(dpy)
        libXcomp.XCompositeRedirectSubwindows(dpy, root_main, 0)
        libX11.XSync(dpy, 0)

    shift_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"Shift_L"))
    ctrl_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"Control_L"))
    alt_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"Alt_L"))
    v_kc = libX11.XKeysymToKeycode(dpy, libX11.XStringToKeysym(b"v"))

    # Discover genuinely unused evdev XKB keycodes (preferring >=100 to skip IME-reserved 93/97),
    # pre-seed common Turkish & Euro pairs before target app launches, and reserve rotating scratch slots.
    min_kc_c = ctypes.c_int(8)
    max_kc_c = ctypes.c_int(255)
    libX11.XDisplayKeycodes(dpy, ctypes.byref(min_kc_c), ctypes.byref(max_kc_c))
    free_kcs = []
    for cand_kc in list(range(max(100, min_kc_c.value), min(246, max_kc_c.value + 1))) + list(
        range(max(90, min_kc_c.value), min(100, max_kc_c.value + 1))
    ):
        if cand_kc in (shift_kc, ctrl_kc, alt_kc, v_kc):
            continue
        ks0 = libX11.XkbKeycodeToKeysym(dpy, cand_kc, 0, 0)
        ks1 = libX11.XkbKeycodeToKeysym(dpy, cand_kc, 0, 1)
        if ks0 == 0 and ks1 == 0:
            free_kcs.append(cand_kc)

    preseed_pairs = [
        ("ş", "Ş"),
        ("ı", "İ"),
        ("ğ", "Ğ"),
        ("ü", "Ü"),
        ("ö", "Ö"),
        ("ç", "Ç"),
        ("₺", "€"),
    ]
    preseeded_count = 0
    for low_ch, up_ch in preseed_pairs:
        if len(free_kcs) <= 4 + preseeded_count:
            break
        pkc = free_kcs[preseeded_count]
        preseeded_count += 1
        ks_low = ord(low_ch) if 0x00A0 <= ord(low_ch) <= 0x00FF else (0x01000000 | ord(low_ch))
        ks_up = ord(up_ch) if 0x00A0 <= ord(up_ch) <= 0x00FF else (0x01000000 | ord(up_ch))
        syms = (ctypes.c_ulong * 2)(ks_low, ks_up)
        libX11.XChangeKeyboardMapping(dpy, pkc, 2, syms, 1)
    if preseeded_count > 0:
        libX11.XSync(dpy, 0)

    scratch_kcs = free_kcs[preseeded_count : preseeded_count + 8]
    if not scratch_kcs:
        scratch_kcs = [200, 201, 202, 203]
    scratch_idx = [0]

    x11_lock = threading.Lock()
    wm = WindowManager(display_str, screen_w, screen_h)
    wm.env["LANG"] = "C.UTF-8"
    wm.env["LC_ALL"] = "C.UTF-8"
    env = wm.env
    state = {
        "last_cursor": "default",
        "last_clip": "",
        "suppress_clip_until": 0.0,
        "held_shift": False,
        "held_ctrl": False,
        "held_alt": False,
    }

    def set_x11_clipboard(txt: str) -> None:
        state["last_clip"] = txt
        state["suppress_clip_until"] = time.monotonic() + 0.35
        data = txt.encode("utf-8")
        for sel in ("clipboard", "primary"):
            try:
                p = subprocess.Popen(
                    ["xclip", "-selection", sel, "-i"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=env,
                    close_fds=True,
                )
                if p.stdin:
                    p.stdin.write(data)
                    p.stdin.close()
                p.wait(timeout=0.8)
            except Exception:
                pass

    def read_x11_clipboard(force_emit: bool = False) -> None:
        if not force_emit and time.monotonic() < state["suppress_clip_until"]:
            return
        out = ""
        for cmd in (
            ["xclip", "-o", "-selection", "clipboard", "-t", "UTF8_STRING"],
            ["xclip", "-o", "-selection", "clipboard"],
        ):
            try:
                out = subprocess.check_output(
                    cmd, env=env, stderr=subprocess.DEVNULL, timeout=0.9
                ).decode("utf-8", errors="ignore")
                if out:
                    break
            except Exception:
                continue
        if out and (force_emit or out != state["last_clip"]):
            state["last_clip"] = out
            emit({"type": "clipboard", "text": out})

    def schedule_clipboard_read(delay_sec: float = 0.05, force_emit: bool = False) -> None:
        def _worker():
            time.sleep(delay_sec)
            read_x11_clipboard(force_emit=force_emit)
        threading.Thread(target=_worker, daemon=True).start()

    def reconcile_loop():
        rec_dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if rec_dpy:
            rec_root = libX11.XDefaultRootWindow(rec_dpy)
            wm.attach_reconcile_display(rec_dpy, rec_root)
        while True:
            wm.dirty.wait()
            time.sleep(0.12)
            wm.dirty.clear()
            try:
                wm.reconcile()
            except Exception:
                pass

    def event_monitor_loop():
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
            libXfixes.XFixesSelectCursorInput(mon_dpy, root, 1)
            clip_atom = libX11.XInternAtom(mon_dpy, b"CLIPBOARD", 0)
            if clip_atom:
                # XFixesSetSelectionOwnerNotifyMask = 1
                libXfixes.XFixesSelectSelectionInput(mon_dpy, root, clip_atom, 1)
        libX11.XFlush(mon_dpy)

        ev = XEvent()
        while True:
            libX11.XNextEvent(mon_dpy, ctypes.byref(ev))
            if has_xfixes:
                # XFixesSelectionNotify == ev_base + 0
                if ev.type == xfixes_ev_base.value:
                    schedule_clipboard_read(0.04, force_emit=False)
                    continue
                # XFixesCursorNotify == ev_base + 1
                if ev.type == xfixes_ev_base.value + 1:
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

    def char_to_keysym(ch: str) -> int:
        if ch in ("\n", "\r"):
            return libX11.XStringToKeysym(b"Return")
        if ch == "\t":
            return libX11.XStringToKeysym(b"Tab")
        if ch == " ":
            return libX11.XStringToKeysym(b"space")
        mapped = KEY_MAP.get(ch)
        if mapped:
            return libX11.XStringToKeysym(mapped.encode("utf-8"))
        cp = ord(ch)
        if 0x21 <= cp <= 0x7E:
            return libX11.XStringToKeysym(ch.encode("ascii"))
        if 0x00A0 <= cp <= 0x00FF:
            return cp
        return 0x01000000 | cp

    def type_unicode_text(txt: str) -> None:
        if not txt:
            return
        with x11_lock:
            # Temporarily clear any held modifiers so host Option/AltGr/Shift never corrupt the character
            if state["held_ctrl"] and ctrl_kc:
                libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 0, 0)
            if state["held_alt"] and alt_kc:
                libXtst.XTestFakeKeyEvent(dpy, alt_kc, 0, 0)
            if state["held_shift"] and shift_kc:
                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)

            for ch in txt:
                ks = char_to_keysym(ch)
                if not ks:
                    continue
                kc = libX11.XKeysymToKeycode(dpy, ks)
                ks0 = libX11.XkbKeycodeToKeysym(dpy, kc, 0, 0) if kc else 0
                ks1 = libX11.XkbKeycodeToKeysym(dpy, kc, 0, 1) if kc else 0

                if kc and ks0 == ks:
                    libXtst.XTestFakeKeyEvent(dpy, kc, 1, 0)
                    libXtst.XTestFakeKeyEvent(dpy, kc, 0, 0)
                elif kc and ks1 == ks and shift_kc:
                    libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
                    libXtst.XTestFakeKeyEvent(dpy, kc, 1, 0)
                    libXtst.XTestFakeKeyEvent(dpy, kc, 0, 0)
                    libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)
                else:
                    skc = scratch_kcs[scratch_idx[0] % len(scratch_kcs)]
                    scratch_idx[0] += 1
                    syms = (ctypes.c_ulong * 2)(ks, ks)
                    libX11.XChangeKeyboardMapping(dpy, skc, 2, syms, 1)
                    libX11.XSync(dpy, 0)
                    time.sleep(0.03)
                    libXtst.XTestFakeKeyEvent(dpy, skc, 1, 0)
                    libXtst.XTestFakeKeyEvent(dpy, skc, 0, 0)
                    libX11.XSync(dpy, 0)

            if state["held_shift"] and shift_kc:
                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
            if state["held_alt"] and alt_kc:
                libXtst.XTestFakeKeyEvent(dpy, alt_kc, 1, 0)
            if state["held_ctrl"] and ctrl_kc:
                libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 1, 0)
            libX11.XFlush(dpy)

    def tap_shortcut(key_name: str, want_ctrl: bool, want_shift: bool, want_alt: bool) -> None:
        xname = KEY_MAP.get(key_name)
        if not xname and len(key_name) == 1:
            # Map letter shortcuts case-insensitively to US base keysym so Ctrl+C / Ctrl+V / Ctrl+Z always hit exact X11 keycodes
            lower = key_name.lower()
            if "a" <= lower <= "z" or "0" <= lower <= "9":
                xname = lower
            else:
                xname = KEY_MAP.get(lower, lower)
        if not xname:
            return
        ks = libX11.XStringToKeysym(xname.encode("utf-8", errors="ignore"))
        if not ks:
            return
        kc = libX11.XKeysymToKeycode(dpy, ks)
        if not kc:
            return
        with x11_lock:
            if want_ctrl and ctrl_kc:
                libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 1, 0)
            if want_shift and shift_kc:
                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
            if want_alt and alt_kc:
                libXtst.XTestFakeKeyEvent(dpy, alt_kc, 1, 0)
            libXtst.XTestFakeKeyEvent(dpy, kc, 1, 0)
            libXtst.XTestFakeKeyEvent(dpy, kc, 0, 0)
            if want_alt and alt_kc:
                libXtst.XTestFakeKeyEvent(dpy, alt_kc, 0, 0)
            if want_shift and shift_kc:
                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)
            if want_ctrl and ctrl_kc:
                libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 0, 0)
            state["held_ctrl"] = False
            state["held_shift"] = False
            state["held_alt"] = False
            libX11.XFlush(dpy)

    def press_keysym(ks: int, down: bool):
        kc = libX11.XKeysymToKeycode(dpy, ks)
        if kc:
            libXtst.XTestFakeKeyEvent(dpy, kc, 1 if down else 0, 0)
            libX11.XFlush(dpy)
            return True
        return False

    in_fd = sys.stdin.fileno()
    in_buf = b""

    def next_messages():
        nonlocal in_buf
        while True:
            if b"\n" not in in_buf:
                chunk = os.read(in_fd, 8192)
                if not chunk:
                    return
                in_buf += chunk
                continue
            lines = in_buf.split(b"\n")
            in_buf = lines.pop()
            parsed = []
            for raw_line in lines:
                s = raw_line.strip()
                if not s:
                    continue
                try:
                    parsed.append(json.loads(s.decode("utf-8")))
                except Exception:
                    continue
            # Coalesce consecutive mousemove events in the same read burst -> zero cursor rubber-band lag
            coalesced = []
            for m in parsed:
                if m.get("type") == "mousemove" and coalesced and coalesced[-1].get("type") == "mousemove":
                    coalesced[-1] = m
                else:
                    coalesced.append(m)
            for m in coalesced:
                yield m

    for msg in next_messages():
        mtype = msg.get("type")
        view = str(msg.get("view") or "main")
        try:
            if mtype in ("mousemove", "mousedown", "mouseup", "wheel"):
                x = max(0, min(wm.screen_w - 1, int(msg.get("x", 0))))
                y = max(0, min(wm.screen_h - 1, int(msg.get("y", 0))))

                if mtype == "mousemove":
                    with x11_lock:
                        libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                        libX11.XFlush(dpy)

                elif mtype in ("mousedown", "mouseup"):
                    if mtype == "mousedown" and len(wm.views) > 1 and view != wm.active_view:
                        wm.focus_view(view)
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
                    raw_ticks_y = msg.get("ticksY")
                    raw_ticks_x = msg.get("ticksX")
                    want_ctrl = bool(msg.get("ctrlKey") or msg.get("metaKey"))
                    want_shift = bool(msg.get("shiftKey"))
                    want_alt = bool(msg.get("altKey"))
                    with x11_lock:
                        libXtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
                        if want_ctrl and ctrl_kc:
                            libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 1, 0)
                        if want_shift and shift_kc:
                            libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
                        if want_alt and alt_kc:
                            libXtst.XTestFakeKeyEvent(dpy, alt_kc, 1, 0)
                        if raw_ticks_y is not None:
                            ticks_y = max(0, min(6, abs(int(raw_ticks_y))))
                        elif abs(dy) > 0:
                            ticks_y = 1 if want_ctrl else max(0, min(6, int(round(abs(dy) / 100))))
                        else:
                            ticks_y = 0
                        if ticks_y > 0 and abs(dy) > 0:
                            btn = 5 if dy > 0 else 4
                            for _ in range(ticks_y):
                                libXtst.XTestFakeButtonEvent(dpy, btn, 1, 0)
                                libXtst.XTestFakeButtonEvent(dpy, btn, 0, 0)
                        if raw_ticks_x is not None:
                            ticks_x = max(0, min(4, abs(int(raw_ticks_x))))
                        elif abs(dx) >= 48:
                            ticks_x = max(0, min(4, int(round(abs(dx) / 105))))
                        else:
                            ticks_x = 0
                        if ticks_x > 0 and abs(dx) > 0:
                            btn = 7 if dx > 0 else 6
                            for _ in range(ticks_x):
                                libXtst.XTestFakeButtonEvent(dpy, btn, 1, 0)
                                libXtst.XTestFakeButtonEvent(dpy, btn, 0, 0)
                        if want_alt and alt_kc:
                            libXtst.XTestFakeKeyEvent(dpy, alt_kc, 0, 0)
                        if want_shift and shift_kc:
                            libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)
                        if want_ctrl and ctrl_kc:
                            libXtst.XTestFakeKeyEvent(dpy, ctrl_kc, 0, 0)
                        libX11.XFlush(dpy)

            elif mtype == "text":
                txt = str(msg.get("text", ""))
                if txt:
                    # Use fast clipboard paste for large multi-char blocks (>32 chars); direct XKB keystrokes for typing
                    if len(txt) > 32:
                        set_x11_clipboard(txt)
                        tap_shortcut("v", True, False, False)
                    else:
                        type_unicode_text(txt)

            elif mtype == "shortcut":
                k = str(msg.get("key", ""))
                want_ctrl = bool(msg.get("ctrlKey"))
                want_shift = bool(msg.get("shiftKey"))
                want_alt = bool(msg.get("altKey"))
                tap_shortcut(k, want_ctrl, want_shift, want_alt)
                if want_ctrl and k.lower() in ("c", "x"):
                    schedule_clipboard_read(0.07, force_emit=True)

            elif mtype == "paste_text":
                txt = str(msg.get("text", ""))
                want_shift = bool(msg.get("shiftKey"))
                if txt and txt != state["last_clip"]:
                    set_x11_clipboard(txt)
                tap_shortcut("v", True, want_shift, False)

            elif mtype in ("keydown", "keyup"):
                key = str(msg.get("key", ""))
                is_down = mtype == "keydown"
                ctrl = bool(msg.get("ctrlKey"))
                alt = bool(msg.get("altKey"))
                meta = bool(msg.get("metaKey"))
                shift = bool(msg.get("shiftKey"))

                if key == "Shift":
                    state["held_shift"] = is_down
                elif key == "Control":
                    state["held_ctrl"] = is_down
                elif key == "Alt":
                    state["held_alt"] = is_down

                if len(key) == 1 and not ctrl and not alt and not meta:
                    if is_down:
                        type_unicode_text(key)
                    continue

                xname = KEY_MAP.get(key)
                if not xname and len(key) == 1 and 32 <= ord(key) <= 126:
                    xname = key.lower() if (ctrl or alt or meta) else key
                if xname:
                    ks = libX11.XStringToKeysym(xname.encode("utf-8"))
                    if ks:
                        with x11_lock:
                            if is_down and shift and key not in ("Shift",) and not state["held_shift"] and shift_kc:
                                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 1, 0)
                            press_keysym(ks, is_down)
                            if is_down and shift and key not in ("Shift",) and not state["held_shift"] and shift_kc:
                                libXtst.XTestFakeKeyEvent(dpy, shift_kc, 0, 0)
                            libX11.XFlush(dpy)

            elif mtype == "resize":
                wm.resize_view(view, int(msg.get("width", 0) or 0), int(msg.get("height", 0) or 0))

            elif mtype == "focus_view":
                wm.focus_view(view)

            elif mtype == "close_view":
                wm.close_view(view)

            elif mtype == "clipboard_set":
                txt = str(msg.get("text", ""))
                if txt:
                    set_x11_clipboard(txt)

            elif mtype == "clipboard_get":
                read_x11_clipboard(force_emit=True)

        except Exception:
            pass

    libX11.XCloseDisplay(dpy)


if __name__ == "__main__":
    main()
