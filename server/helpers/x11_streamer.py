#!/usr/bin/env python3
"""Event-driven zero-idle X11 XDamage + XComposite + TurboJPEG SIMD frame streamer for TamgaVDesktop.

Supports two capture modes controlled by Node / x11_bridge:
- mode="root": captures a rectangle on the root window (shows all menus, dropdowns, modal dialogs).
- mode="pixmap": captures an off-screen XCompositeNameWindowPixmap for a background window
  even while occluded behind another window at (0, 0).

Also uses XDAMAGE_REPORT_NON_EMPTY with single-shot XDamageSubtract right before capture
to prevent XDamage event floods and libxcb sequence queue assertions under heavy animation.
"""
import ctypes
import json
import os
import select
import struct
import sys
import time

libX11 = ctypes.CDLL("libX11.so.6")
libXdamage = ctypes.CDLL("libXdamage.so.1")
libtj = ctypes.CDLL("libturbojpeg.so.0")
try:
    libXcomp = ctypes.CDLL("libXcomposite.so.1")
except OSError:
    libXcomp = None


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("xoffset", ctypes.c_int),
        ("format", ctypes.c_int),
        ("data", ctypes.c_void_p),
        ("byte_order", ctypes.c_int),
        ("bitmap_unit", ctypes.c_int),
        ("bitmap_bit_order", ctypes.c_int),
        ("bitmap_pad", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("bytes_per_line", ctypes.c_int),
        ("bits_per_pixel", ctypes.c_int),
        ("red_mask", ctypes.c_ulong),
        ("green_mask", ctypes.c_ulong),
        ("blue_mask", ctypes.c_ulong),
        ("obdata", ctypes.c_void_p),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("type", ctypes.c_int), ("pad", ctypes.c_long * 24)]


# X11 signatures (explicit argtypes/restypes to avoid 64-bit ctypes truncation)
libX11.XOpenDisplay.argtypes = [ctypes.c_char_p]
libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XCloseDisplay.restype = ctypes.c_int
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XConnectionNumber.argtypes = [ctypes.c_void_p]
libX11.XConnectionNumber.restype = ctypes.c_int
libX11.XPending.argtypes = [ctypes.c_void_p]
libX11.XPending.restype = ctypes.c_int
libX11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
libX11.XNextEvent.restype = ctypes.c_int
libX11.XFlush.argtypes = [ctypes.c_void_p]
libX11.XFlush.restype = ctypes.c_int
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XSync.restype = ctypes.c_int
libX11.XGetGeometry.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
    ctypes.POINTER(ctypes.c_uint),
]
libX11.XGetGeometry.restype = ctypes.c_int
libX11.XGetImage.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
    ctypes.c_uint,
    ctypes.c_ulong,
    ctypes.c_int,
]
libX11.XGetImage.restype = ctypes.POINTER(XImage)
libX11.XDestroyImage.argtypes = [ctypes.POINTER(XImage)]
libX11.XDestroyImage.restype = ctypes.c_int
libX11.XFreePixmap.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libX11.XFreePixmap.restype = ctypes.c_int
libX11.XSetErrorHandler.argtypes = [
    ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
]
libX11.XSetErrorHandler.restype = ctypes.c_void_p

# XDamage signatures
libXdamage.XDamageQueryExtension.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
libXdamage.XDamageQueryExtension.restype = ctypes.c_int
libXdamage.XDamageCreate.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
libXdamage.XDamageCreate.restype = ctypes.c_ulong
libXdamage.XDamageDestroy.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libXdamage.XDamageDestroy.restype = ctypes.c_int
libXdamage.XDamageSubtract.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
libXdamage.XDamageSubtract.restype = ctypes.c_int

if libXcomp is not None:
    libXcomp.XCompositeRedirectSubwindows.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
    libXcomp.XCompositeRedirectSubwindows.restype = ctypes.c_int
    libXcomp.XCompositeNameWindowPixmap.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    libXcomp.XCompositeNameWindowPixmap.restype = ctypes.c_ulong

# TurboJPEG signatures
libtj.tjInitCompress.argtypes = []
libtj.tjInitCompress.restype = ctypes.c_void_p
libtj.tjCompress2.argtypes = [
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.c_void_p),
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
]
libtj.tjCompress2.restype = ctypes.c_int
libtj.tjFree.argtypes = [ctypes.c_void_p]
libtj.tjDestroy.argtypes = [ctypes.c_void_p]

ZPIXMAP = 2
ALL_PLANES = 0xFFFFFFFFFFFFFFFF
XDAMAGE_REPORT_NON_EMPTY = 1
TJPF_BGRX = 3
TJSAMP_422 = 1
TJFLAG_FASTDCT = 2048

last_x_error = 0


@ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
def track_x_error(_dpy, _err):
    global last_x_error
    last_x_error += 1
    return 0


def parse_wid(val) -> int:
    if isinstance(val, int):
        return max(0, val)
    if isinstance(val, str) and val:
        try:
            return max(0, int(val, 16) if val.startswith("0x") else int(val))
        except ValueError:
            return 0
    return 0


def query_drawable_size(dpy, drawable: int) -> tuple[int, int]:
    root_out = ctypes.c_ulong(0)
    x_out = ctypes.c_int(0)
    y_out = ctypes.c_int(0)
    w_out = ctypes.c_uint(0)
    h_out = ctypes.c_uint(0)
    bw_out = ctypes.c_uint(0)
    depth_out = ctypes.c_uint(0)
    ok = libX11.XGetGeometry(
        dpy,
        drawable,
        ctypes.byref(root_out),
        ctypes.byref(x_out),
        ctypes.byref(y_out),
        ctypes.byref(w_out),
        ctypes.byref(h_out),
        ctypes.byref(bw_out),
        ctypes.byref(depth_out),
    )
    if not ok:
        return 0, 0
    return int(w_out.value), int(h_out.value)


def main() -> None:
    global last_x_error
    libX11.XSetErrorHandler(track_x_error)
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    width = max(240, min(1920, int(sys.argv[2]) if len(sys.argv) > 2 else 1100))
    height = max(180, min(1080, int(sys.argv[3]) if len(sys.argv) > 3 else 680))
    max_fps = max(8, min(35, int(sys.argv[4]) if len(sys.argv) > 4 else 30))
    quality = max(45, min(92, int(sys.argv[5]) if len(sys.argv) > 5 else 78))
    off_x = max(0, int(sys.argv[6]) if len(sys.argv) > 6 else 0)
    off_y = max(0, int(sys.argv[7]) if len(sys.argv) > 7 else 0)
    target_wid = parse_wid(sys.argv[8]) if len(sys.argv) > 8 else 0
    capture_mode = "pixmap" if (target_wid and libXcomp is not None) else "root"

    dpy = None
    for _ in range(80):
        dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if dpy:
            break
        time.sleep(0.1)
    if not dpy:
        sys.exit(1)

    root = libX11.XDefaultRootWindow(dpy)
    if libXcomp is not None:
        # CompositeRedirectAutomatic keeps off-screen backing storage updated for occluded windows
        libXcomp.XCompositeRedirectSubwindows(dpy, root, 0)
        libX11.XSync(dpy, 0)

    dmg_ev_base = ctypes.c_int(0)
    dmg_err_base = ctypes.c_int(0)
    if not libXdamage.XDamageQueryExtension(dpy, ctypes.byref(dmg_ev_base), ctypes.byref(dmg_err_base)):
        sys.exit(2)

    damage = 0
    damage_drawable = 0

    def bind_damage(drawable: int) -> None:
        nonlocal damage, damage_drawable
        if drawable == damage_drawable and damage:
            return
        if damage:
            libXdamage.XDamageDestroy(dpy, damage)
            damage = 0
            damage_drawable = 0
        before = last_x_error
        dmg = libXdamage.XDamageCreate(dpy, drawable, XDAMAGE_REPORT_NON_EMPTY)
        libX11.XSync(dpy, 0)
        if last_x_error == before and dmg:
            damage = dmg
            damage_drawable = drawable
        elif drawable != root:
            # Target window may not exist anymore; attach damage to root safely
            damage = libXdamage.XDamageCreate(dpy, root, XDAMAGE_REPORT_NON_EMPTY)
            damage_drawable = root
            libX11.XSync(dpy, 0)

    bind_damage(target_wid if (capture_mode == "pixmap" and target_wid) else root)

    tj = libtj.tjInitCompress()
    if not tj:
        sys.exit(3)

    x_fd = libX11.XConnectionNumber(dpy)
    in_fd = sys.stdin.fileno()
    out_fd = sys.stdout.fileno()

    min_interval = 1.0 / float(max_fps)
    dirty = True
    in_flight = 0
    last_sent = 0.0
    stdin_buf = b""
    ev = XEvent()

    def compress_and_send(img_ptr, grab_w: int, grab_h: int, qual: int) -> bool:
        try:
            img = img_ptr.contents
            jpeg_ptr = ctypes.c_void_p()
            jpeg_len = ctypes.c_ulong(0)
            rc = libtj.tjCompress2(
                tj,
                img.data,
                grab_w,
                img.bytes_per_line,
                grab_h,
                TJPF_BGRX,
                ctypes.byref(jpeg_ptr),
                ctypes.byref(jpeg_len),
                TJSAMP_422,
                qual,
                TJFLAG_FASTDCT,
            )
            if rc != 0 or not jpeg_ptr.value or jpeg_len.value == 0:
                return False
            try:
                payload = ctypes.string_at(jpeg_ptr.value, jpeg_len.value)
                header = struct.pack(">I", len(payload))
                os.write(out_fd, header + payload)
                return True
            finally:
                libtj.tjFree(jpeg_ptr)
        finally:
            libX11.XDestroyImage(img_ptr)

    def grab_and_send(qual: int) -> bool:
        global last_x_error
        if capture_mode == "pixmap" and target_wid and libXcomp is not None:
            before = last_x_error
            pix = libXcomp.XCompositeNameWindowPixmap(dpy, target_wid)
            libX11.XSync(dpy, 0)
            if pix and last_x_error == before:
                try:
                    pw, ph = query_drawable_size(dpy, pix)
                    grab_w = min(width, pw) if pw > 0 else 0
                    grab_h = min(height, ph) if ph > 0 else 0
                    if grab_w >= 2 and grab_h >= 2:
                        img_ptr = libX11.XGetImage(
                            dpy, pix, 0, 0, grab_w, grab_h, ALL_PLANES, ZPIXMAP
                        )
                        if img_ptr:
                            return compress_and_send(img_ptr, grab_w, grab_h, qual)
                finally:
                    libX11.XFreePixmap(dpy, pix)
            return False

        rw, rh = query_drawable_size(dpy, root)
        if rw <= off_x or rh <= off_y:
            return False
        grab_w = min(width, rw - off_x)
        grab_h = min(height, rh - off_y)
        if grab_w < 2 or grab_h < 2:
            return False
        img_ptr = libX11.XGetImage(
            dpy, root, off_x, off_y, grab_w, grab_h, ALL_PLANES, ZPIXMAP
        )
        if not img_ptr:
            return False
        return compress_and_send(img_ptr, grab_w, grab_h, qual)

    # Adaptive quality state (GeForce NOW-style motion drop + crisp settle frame)
    max_quality = quality
    motion_quality = max(30, min(max_quality, max_quality - 22))
    dynamic_drop = True
    settle_sec = 0.30
    needs_settle = False
    last_motion_at = 0.0

    # Gentle initial settle window while the X11 app first paints its window
    startup_until = time.monotonic() + 3.0

    while True:
        now = time.monotonic()
        wait_timeout = 1.5
        if dirty and in_flight < 2:
            elapsed = now - last_sent
            wait_timeout = max(0.0, min_interval - elapsed)
        elif needs_settle and in_flight < 2:
            rem = settle_sec - (now - last_motion_at)
            wait_timeout = max(0.0, rem)
        elif now < startup_until:
            wait_timeout = 0.25

        if libX11.XPending(dpy) == 0 and wait_timeout > 0:
            try:
                rlist, _, _ = select.select([x_fd, in_fd], [], [], wait_timeout)
            except (OSError, ValueError):
                break
        else:
            rlist = [x_fd]
            try:
                r2, _, _ = select.select([in_fd], [], [], 0)
                if r2:
                    rlist.append(in_fd)
            except (OSError, ValueError):
                break

        if in_fd in rlist:
            try:
                chunk = os.read(in_fd, 4096)
                if not chunk:
                    break
                stdin_buf += chunk
                while b"\n" in stdin_buf:
                    line, stdin_buf = stdin_buf.split(b"\n", 1)
                    s = line.strip()
                    if not s:
                        continue
                    if s == b"a":
                        in_flight = max(0, in_flight - 1)
                    elif s.startswith(b"{"):
                        try:
                            cmd = json.loads(s.decode("utf-8"))
                            ctype = cmd.get("type")
                            if ctype == "resize":
                                width = max(240, min(1920, int(cmd.get("width", width))))
                                height = max(180, min(1080, int(cmd.get("height", height))))
                                dirty = True
                            elif ctype == "target":
                                req_mode = cmd.get("mode", capture_mode)
                                req_wid = parse_wid(cmd.get("wid", target_wid))
                                target_wid = req_wid
                                capture_mode = (
                                    "pixmap"
                                    if (req_mode == "pixmap" and target_wid and libXcomp is not None)
                                    else "root"
                                )
                                if "width" in cmd and cmd["width"]:
                                    width = max(240, min(1920, int(cmd["width"])))
                                if "height" in cmd and cmd["height"]:
                                    height = max(180, min(1080, int(cmd["height"])))
                                if "off_x" in cmd:
                                    off_x = max(0, int(cmd["off_x"]))
                                if "off_y" in cmd:
                                    off_y = max(0, int(cmd["off_y"]))
                                bind_damage(
                                    target_wid if (capture_mode == "pixmap" and target_wid) else root
                                )
                                dirty = True
                            elif ctype == "stream_config":
                                if "fps" in cmd and cmd["fps"]:
                                    max_fps = max(8, min(35, int(cmd["fps"])))
                                    min_interval = 1.0 / float(max_fps)
                                if "max_quality" in cmd and cmd["max_quality"]:
                                    max_quality = max(45, min(95, int(cmd["max_quality"])))
                                if "motion_quality" in cmd and cmd["motion_quality"]:
                                    motion_quality = max(30, min(max_quality, int(cmd["motion_quality"])))
                                if "dynamic_drop" in cmd:
                                    dynamic_drop = bool(cmd["dynamic_drop"])
                                if "settle_ms" in cmd and cmd["settle_ms"]:
                                    settle_sec = max(0.12, min(1.2, float(cmd["settle_ms"]) / 1000.0))
                                needs_settle = True
                                last_motion_at = 0.0
                                dirty = True
                            elif ctype == "refresh":
                                dirty = True
                        except Exception:
                            pass
            except OSError:
                break

        while libX11.XPending(dpy) > 0:
            libX11.XNextEvent(dpy, ctypes.byref(ev))
            if ev.type == dmg_ev_base.value:
                # Non-empty damage stays latched until XDamageSubtract before capture -> zero X11 flood
                dirty = True

        now = time.monotonic()
        if now < startup_until and (now - last_sent) > 0.35:
            dirty = True

        if dirty and in_flight < 2 and (now - last_sent) >= min_interval:
            if damage:
                libXdamage.XDamageSubtract(dpy, damage, 0, 0)
            libX11.XSync(dpy, 0)
            is_rapid_motion = dynamic_drop and (now - last_sent) < max(0.28, min_interval * 3.0)
            send_qual = motion_quality if is_rapid_motion else max_quality
            if grab_and_send(send_qual):
                dirty = False
                in_flight += 1
                last_sent = time.monotonic()
                if is_rapid_motion and motion_quality < max_quality:
                    needs_settle = True
                    last_motion_at = last_sent
                else:
                    needs_settle = False
        elif needs_settle and not dirty and in_flight < 2 and (now - last_motion_at) >= settle_sec:
            if grab_and_send(max_quality):
                in_flight += 1
                last_sent = time.monotonic()
                needs_settle = False

    if damage:
        libXdamage.XDamageDestroy(dpy, damage)
    libtj.tjDestroy(tj)
    libX11.XCloseDisplay(dpy)


if __name__ == "__main__":
    main()
