#!/usr/bin/env python3
"""Event-driven zero-idle X11 XDamage + TurboJPEG SIMD frame streamer for TamgaVDesktop.
- 0.0% CPU when window is static (blocks on X11 XDamage socket in kernel select()).
- Zero remote/double cursor (reads window backing pixels without cursor overlay).
- Backpressure-aware (max 2 frames in flight until Node ACKs) so frames never queue or lag.
- Outputs [4-byte uint32 BE length][JPEG bytes] on stdout.
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


class XDamageNotifyEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("drawable", ctypes.c_ulong),
        ("damage", ctypes.c_ulong),
        ("level", ctypes.c_int),
        ("more", ctypes.c_int),
        ("timestamp", ctypes.c_ulong),
        ("area_x", ctypes.c_short),
        ("area_y", ctypes.c_short),
        ("area_w", ctypes.c_ushort),
        ("area_h", ctypes.c_ushort),
        ("geo_x", ctypes.c_short),
        ("geo_y", ctypes.c_short),
        ("geo_w", ctypes.c_ushort),
        ("geo_h", ctypes.c_ushort),
    ]


# X11 signatures
libX11.XOpenDisplay.argtypes = [ctypes.c_char_p]
libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XConnectionNumber.argtypes = [ctypes.c_void_p]
libX11.XConnectionNumber.restype = ctypes.c_int
libX11.XPending.argtypes = [ctypes.c_void_p]
libX11.XPending.restype = ctypes.c_int
libX11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
libX11.XFlush.argtypes = [ctypes.c_void_p]
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
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
libX11.XSetErrorHandler.argtypes = [
    ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
]

# XDamage signatures
libXdamage.XDamageQueryExtension.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
libXdamage.XDamageQueryExtension.restype = ctypes.c_int
libXdamage.XDamageCreate.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
libXdamage.XDamageCreate.restype = ctypes.c_ulong
libXdamage.XDamageSubtract.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]

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
XDAMAGE_REPORT_BOUNDING_BOX = 2
TJPF_BGRX = 3
TJSAMP_422 = 1
TJFLAG_FASTDCT = 2048


@ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
def ignore_x_error(_dpy, _err):
    return 0


def main() -> None:
    libX11.XSetErrorHandler(ignore_x_error)
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    width = max(320, min(1920, int(sys.argv[2]) if len(sys.argv) > 2 else 1100))
    height = max(240, min(1080, int(sys.argv[3]) if len(sys.argv) > 3 else 680))
    max_fps = max(8, min(35, int(sys.argv[4]) if len(sys.argv) > 4 else 24))
    quality = max(45, min(92, int(sys.argv[5]) if len(sys.argv) > 5 else 78))
    off_x = max(0, int(sys.argv[6]) if len(sys.argv) > 6 else 0)
    off_y = max(0, int(sys.argv[7]) if len(sys.argv) > 7 else 0)

    dpy = None
    for _ in range(30):
        dpy = libX11.XOpenDisplay(display_str.encode("utf-8"))
        if dpy:
            break
        time.sleep(0.1)
    if not dpy:
        sys.exit(1)

    root = libX11.XDefaultRootWindow(dpy)
    dmg_ev_base = ctypes.c_int(0)
    dmg_err_base = ctypes.c_int(0)
    if not libXdamage.XDamageQueryExtension(dpy, ctypes.byref(dmg_ev_base), ctypes.byref(dmg_err_base)):
        sys.exit(2)

    # Bounding-box reports carry the damaged area, so each view only re-encodes when ITS slot changed
    damage = libXdamage.XDamageCreate(dpy, root, XDAMAGE_REPORT_BOUNDING_BOX)
    libX11.XFlush(dpy)

    tj = libtj.tjInitCompress()
    if not tj:
        sys.exit(3)

    x_fd = libX11.XConnectionNumber(dpy)
    in_fd = sys.stdin.fileno()
    out_fd = sys.stdout.fileno()

    min_interval = 1.0 / float(max_fps)
    dirty = True  # Capture initial frame right away
    in_flight = 0
    last_sent = 0.0
    stdin_buf = b""
    ev = XEvent()

    def grab_and_send(qual: int) -> bool:
        img_ptr = libX11.XGetImage(dpy, root, off_x, off_y, width, height, ALL_PLANES, ZPIXMAP)
        if not img_ptr:
            return False
        try:
            img = img_ptr.contents
            jpeg_ptr = ctypes.c_void_p()
            jpeg_len = ctypes.c_ulong(0)
            rc = libtj.tjCompress2(
                tj,
                img.data,
                width,
                img.bytes_per_line,
                height,
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

    # Periodic gentle keyframe refresh (only if a window just mapped before damage settled)
    startup_until = time.monotonic() + 3.0

    while True:
        now = time.monotonic()
        wait_timeout = 1.5
        if dirty and in_flight < 2:
            elapsed = now - last_sent
            wait_timeout = max(0.0, min_interval - elapsed)
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
                            if cmd.get("type") == "resize":
                                width = max(320, min(1920, int(cmd.get("width", width))))
                                height = max(240, min(1080, int(cmd.get("height", height))))
                                dirty = True
                            elif cmd.get("type") == "refresh":
                                dirty = True
                        except Exception:
                            pass
            except OSError:
                break

        while libX11.XPending(dpy) > 0:
            libX11.XNextEvent(dpy, ctypes.byref(ev))
            if ev.type == dmg_ev_base.value:
                dn = ctypes.cast(ctypes.byref(ev), ctypes.POINTER(XDamageNotifyEvent)).contents
                # Always reset the accumulated box so later damage keeps generating events
                libXdamage.XDamageSubtract(dpy, damage, 0, 0)
                ax, ay, aw, ah = dn.area_x, dn.area_y, dn.area_w, dn.area_h
                if (
                    aw == 0 or ah == 0
                    or (ax < off_x + width and ax + aw > off_x and ay < off_y + height and ay + ah > off_y)
                ):
                    dirty = True

        now = time.monotonic()
        if now < startup_until and (now - last_sent) > 0.35:
            dirty = True

        if dirty and in_flight < 2 and (now - last_sent) >= min_interval:
            # Clear any accumulated damage right before capture so new damage during capture isn't missed
            libXdamage.XDamageSubtract(dpy, damage, 0, 0)
            libX11.XSync(dpy, 0)
            if grab_and_send(quality):
                dirty = False
                in_flight += 1
                last_sent = time.monotonic()

    libtj.tjDestroy(tj)


if __name__ == "__main__":
    main()
