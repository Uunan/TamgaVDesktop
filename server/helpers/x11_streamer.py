#!/usr/bin/env python3
"""Ultra-fast zero-idle X11 MIT-SHM + XDamage/XFixes Dirty-Rect + TurboJPEG SIMD streamer for TamgaVDesktop.

Key performance optimizations:
1. MIT-SHM (XShmGetImage): zero Unix-socket pixel transfer and zero per-frame malloc/free (~0.5ms grab vs ~14ms).
   IPC_RMID is invoked immediately after XShmAttach so the kernel always reclaims shared memory even on SIGKILL.
2. XDamage + XFixes Dirty-Rectangle Delta Tiles (0x03): when <55% of the viewport changed (typing, menus, hover,
   video box, GIMP brush strokes), encodes ONLY the exact dirty bounding box directly in-place from the SHM stride
   buffer with zero copy — 5x-30x smaller payloads & faster decode.
3. Smart Settle Sharpening: encodes rapid motion with TJSAMP_420 (35% faster & smaller) and sharpens ONLY the
   changed region with TJSAMP_422 once motion settles.
4. Wire packets emitted on stdout are pre-prefixed with WebSocket packet type bytes (0x01 full / 0x03 delta rect)
   so Node.js forwards frames with zero extra Buffer copy.
5. Sliding window of up to 3 in-flight frames so 100ms-RTT internet links sustain 25-30 FPS smoothly.
"""
import ctypes
import json
import math
import os
import select
import struct
import sys
import time

libX11 = ctypes.CDLL("libX11.so.6")
libXdamage = ctypes.CDLL("libXdamage.so.1")
libtj = ctypes.CDLL("libturbojpeg.so.0")
libc = ctypes.CDLL("libc.so.6")

try:
    libXext = ctypes.CDLL("libXext.so.6")
except OSError:
    libXext = None

try:
    libXfixes = ctypes.CDLL("libXfixes.so.3")
except OSError:
    libXfixes = None

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


class XShmSegmentInfo(ctypes.Structure):
    _fields_ = [
        ("shmseg", ctypes.c_ulong),
        ("shmid", ctypes.c_int),
        ("shmaddr", ctypes.c_void_p),
        ("readOnly", ctypes.c_int),
    ]


class XRectangle(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_short),
        ("y", ctypes.c_short),
        ("width", ctypes.c_ushort),
        ("height", ctypes.c_ushort),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("type", ctypes.c_int), ("pad", ctypes.c_long * 24)]


# X11 signatures
libX11.XOpenDisplay.argtypes = [ctypes.c_char_p]
libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XCloseDisplay.restype = ctypes.c_int
libX11.XDefaultScreen.argtypes = [ctypes.c_void_p]
libX11.XDefaultScreen.restype = ctypes.c_int
libX11.XDefaultVisual.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XDefaultVisual.restype = ctypes.c_void_p
libX11.XDefaultDepth.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XDefaultDepth.restype = ctypes.c_int
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
libX11.XFree.argtypes = [ctypes.c_void_p]
libX11.XFree.restype = ctypes.c_int
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

# libc SysV SHM signatures
libc.shmget.argtypes = [ctypes.c_int, ctypes.c_size_t, ctypes.c_int]
libc.shmget.restype = ctypes.c_int
libc.shmat.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
libc.shmat.restype = ctypes.c_void_p
libc.shmdt.argtypes = [ctypes.c_void_p]
libc.shmdt.restype = ctypes.c_int
libc.shmctl.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
libc.shmctl.restype = ctypes.c_int

IPC_PRIVATE = 0
IPC_CREAT = 0o1000
IPC_RMID = 0

libc.memcmp.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
libc.memcmp.restype = ctypes.c_int

# MIT-SHM signatures
if libXext is not None:
    libXext.XShmQueryExtension.argtypes = [ctypes.c_void_p]
    libXext.XShmQueryExtension.restype = ctypes.c_int
    libXext.XShmCreateImage.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.POINTER(XShmSegmentInfo),
        ctypes.c_uint,
        ctypes.c_uint,
    ]
    libXext.XShmCreateImage.restype = ctypes.POINTER(XImage)
    libXext.XShmAttach.argtypes = [ctypes.c_void_p, ctypes.POINTER(XShmSegmentInfo)]
    libXext.XShmAttach.restype = ctypes.c_int
    libXext.XShmDetach.argtypes = [ctypes.c_void_p, ctypes.POINTER(XShmSegmentInfo)]
    libXext.XShmDetach.restype = ctypes.c_int
    libXext.XShmGetImage.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(XImage),
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    libXext.XShmGetImage.restype = ctypes.c_int

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

# XFixes signatures (for exact dirty-rectangle bounds)
if libXfixes is not None:
    libXfixes.XFixesCreateRegion.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
    libXfixes.XFixesCreateRegion.restype = ctypes.c_ulong
    libXfixes.XFixesDestroyRegion.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    libXfixes.XFixesDestroyRegion.restype = ctypes.c_int
    libXfixes.XFixesFetchRegionAndBounds.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(XRectangle),
    ]
    libXfixes.XFixesFetchRegionAndBounds.restype = ctypes.c_void_p

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
TJSAMP_444 = 0
TJSAMP_422 = 1
TJSAMP_420 = 2
TJFLAG_FASTDCT = 2048

PACKET_FULL_JPEG = 0x01
PACKET_RECT_JPEG = 0x03
PACKET_MULTI_RECT = 0x04

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


def write_all(fd: int, data: bytes | bytearray | memoryview) -> None:
    mv = memoryview(data)
    total = len(mv)
    sent = 0
    while sent < total:
        n = os.write(fd, mv[sent:])
        if n <= 0:
            raise OSError("short write")
        sent += n


class ShmGrabber:
    """Zero-copy MIT-SHM grabber with automatic safe cleanup."""

    def __init__(self, dpy) -> None:
        self.dpy = dpy
        self.available = bool(libXext is not None and libXext.XShmQueryExtension(dpy))
        self.screen = libX11.XDefaultScreen(dpy)
        self.visual = libX11.XDefaultVisual(dpy, self.screen)
        self.depth = libX11.XDefaultDepth(dpy, self.screen)
        self.img_ptr = None
        self.shminfo = XShmSegmentInfo()
        self.w = 0
        self.h = 0
        self.attached = False

    def ensure(self, w: int, h: int) -> bool:
        global last_x_error
        if not self.available:
            return False
        if self.attached and self.w == w and self.h == h and self.img_ptr:
            return True
        self.destroy()
        self.shminfo = XShmSegmentInfo()
        img_ptr = libXext.XShmCreateImage(
            self.dpy,
            self.visual,
            self.depth,
            ZPIXMAP,
            None,
            ctypes.byref(self.shminfo),
            w,
            h,
        )
        if not img_ptr:
            self.available = False
            return False
        img = img_ptr.contents
        size = int(img.bytes_per_line) * int(img.height)
        shmid = libc.shmget(IPC_PRIVATE, size, IPC_CREAT | 0o600)
        if shmid < 0:
            libX11.XDestroyImage(img_ptr)
            self.available = False
            return False
        addr = libc.shmat(shmid, None, 0)
        if not addr or addr == ctypes.c_void_p(-1).value:
            libc.shmctl(shmid, IPC_RMID, None)
            libX11.XDestroyImage(img_ptr)
            self.available = False
            return False

        self.shminfo.shmid = shmid
        self.shminfo.shmaddr = addr
        self.shminfo.readOnly = 0
        img.data = addr

        before = last_x_error
        ok = libXext.XShmAttach(self.dpy, ctypes.byref(self.shminfo))
        libX11.XSync(self.dpy, 0)
        # Immediately mark for kernel auto-reclaim once detached or exited
        libc.shmctl(shmid, IPC_RMID, None)

        if not ok or last_x_error != before:
            libc.shmdt(addr)
            img.data = None
            libX11.XDestroyImage(img_ptr)
            self.available = False
            return False

        self.img_ptr = img_ptr
        self.w = w
        self.h = h
        self.attached = True
        return True

    def grab(self, drawable: int, x: int, y: int, w: int, h: int):
        global last_x_error
        if not self.ensure(w, h):
            return None
        before = last_x_error
        ok = libXext.XShmGetImage(self.dpy, drawable, self.img_ptr, x, y, ALL_PLANES)
        if not ok or last_x_error != before:
            return None
        return self.img_ptr

    def destroy(self) -> None:
        if self.attached and libXext is not None:
            try:
                libXext.XShmDetach(self.dpy, ctypes.byref(self.shminfo))
                libX11.XSync(self.dpy, 0)
            except Exception:
                pass
        if self.img_ptr:
            try:
                self.img_ptr.contents.data = None
                libX11.XDestroyImage(self.img_ptr)
            except Exception:
                pass
            self.img_ptr = None
        if self.shminfo.shmaddr:
            try:
                libc.shmdt(self.shminfo.shmaddr)
            except Exception:
                pass
            self.shminfo.shmaddr = None
        self.attached = False
        self.w = 0
        self.h = 0


def clamp_align_rect(
    x: int, y: int, w: int, h: int, max_w: int, max_h: int
) -> tuple[int, int, int, int] | None:
    if w <= 0 or h <= 0 or max_w < 8 or max_h < 8:
        return None
    # Pad by 4px and snap to 8px JPEG MCU grid for optimal DCT compression
    x0 = max(0, ((x - 4) // 8) * 8)
    y0 = max(0, ((y - 4) // 8) * 8)
    x1 = min(max_w, ((x + w + 11) // 8) * 8)
    y1 = min(max_h, ((y + h + 11) // 8) * 8)
    rw = x1 - x0
    rh = y1 - y0
    if rw < 8 or rh < 8:
        return None
    return x0, y0, rw, rh


def union_rects(
    a: tuple[int, int, int, int] | None, b: tuple[int, int, int, int] | None
) -> tuple[int, int, int, int] | None:
    if a is None:
        return b
    if b is None:
        return a
    x0 = min(a[0], b[0])
    y0 = min(a[1], b[1])
    x1 = max(a[0] + a[2], b[0] + b[2])
    y1 = max(a[1] + a[3], b[1] + b[3])
    return x0, y0, x1 - x0, y1 - y0


def cluster_dirty_rects(
    raw_rects: list[tuple[int, int, int, int]], max_clusters: int = 4
) -> list[tuple[int, int, int, int]]:
    """Coalesce nearby XDamage rects greedily so sparse multi-corner UI changes avoid full-frame re-encodes."""
    if len(raw_rects) <= 1:
        return raw_rects
    clusters = list(raw_rects)
    changed = True
    while changed and len(clusters) > 1:
        changed = False
        best_i = -1
        best_j = -1
        best_waste = 1 << 60
        for i in range(len(clusters)):
            ax, ay, aw, ah = clusters[i]
            aa = aw * ah
            for j in range(i + 1, len(clusters)):
                bx, by, bw, bh = clusters[j]
                ux0 = min(ax, bx)
                uy0 = min(ay, by)
                ux1 = max(ax + aw, bx + bw)
                uy1 = max(ay + ah, by + bh)
                uw = ux1 - ux0
                uh = uy1 - uy0
                ua = uw * uh
                gap_x = max(0, max(ax, bx) - min(ax + aw, bx + bw))
                gap_y = max(0, max(ay, by) - min(ay + ah, by + bh))
                area_sum = aa + bw * bh
                # Merge overlapping / close rects, or force-merge lowest-waste pair if over max_clusters
                if (gap_x <= 24 and gap_y <= 24) or ua <= int(area_sum * 1.35) + 4096:
                    waste = ua - area_sum
                    if waste < best_waste:
                        best_waste = waste
                        best_i, best_j = i, j
        if best_i >= 0:
            merged = union_rects(clusters[best_i], clusters[best_j])
            clusters.pop(best_j)
            clusters[best_i] = merged  # type: ignore[assignment]
            changed = True
        elif len(clusters) > max_clusters:
            # Force-merge minimum-area-overhead pair to stay strictly within max_clusters
            for i in range(len(clusters)):
                ax, ay, aw, ah = clusters[i]
                aa = aw * ah
                for j in range(i + 1, len(clusters)):
                    bx, by, bw, bh = clusters[j]
                    ua = (max(ax + aw, bx + bw) - min(ax, bx)) * (
                        max(ay + ah, by + bh) - min(ay, by)
                    )
                    waste = ua - (aa + bw * bh)
                    if waste < best_waste:
                        best_waste = waste
                        best_i, best_j = i, j
            if best_i >= 0:
                merged = union_rects(clusters[best_i], clusters[best_j])
                clusters.pop(best_j)
                clusters[best_i] = merged  # type: ignore[assignment]
                changed = True
    return clusters


class PrevFrameCache:
    """Keeps the last transmitted BGRA frame to skip identical repaints and shrink oversized XDamage rects."""

    def __init__(self) -> None:
        self.buf: bytearray | None = None
        self.ctype_arr = None
        self.ptr: int = 0
        self.w: int = 0
        self.h: int = 0
        self.stride: int = 0

    def reset(self) -> None:
        self.buf = None
        self.ctype_arr = None
        self.ptr = 0
        self.w = 0
        self.h = 0
        self.stride = 0

    def ensure_ready(self, w: int, h: int, stride: int) -> bool:
        """Ensure buffer matches current dimensions. Returns True if newly allocated/resized."""
        total = stride * h
        if (
            self.buf is not None
            and self.w == w
            and self.h == h
            and self.stride == stride
            and len(self.buf) == total
        ):
            return False
        self.buf = bytearray(total)
        self.ctype_arr = (ctypes.c_ubyte * total).from_buffer(self.buf)
        self.ptr = ctypes.addressof(self.ctype_arr)
        self.w = w
        self.h = h
        self.stride = stride
        return True

    def sync_full(self, base_data: int, w: int, h: int, stride: int) -> None:
        self.ensure_ready(w, h, stride)
        if self.ptr and base_data:
            ctypes.memmove(self.ptr, base_data, stride * h)

    def sync_rects(
        self, base_data: int, w: int, h: int, stride: int, bpp: int, rects: list[tuple[int, int, int, int]]
    ) -> None:
        if not self.ptr or not base_data or self.w != w or self.h != h or self.stride != stride:
            return
        for rx, ry, rw, rh in rects:
            row_bytes = rw * bpp
            x_off = rx * bpp
            for y in range(ry, ry + rh):
                off = y * stride + x_off
                ctypes.memmove(self.ptr + off, base_data + off, row_bytes)

    def _tighten_rect(
        self, base_data: int, full_w: int, full_h: int, stride: int, bpp: int, rect: tuple[int, int, int, int]
    ) -> list[tuple[int, int, int, int]]:
        rx, ry, rw, rh = rect
        x_off = rx * bpp
        row_bytes = rw * bpp
        # Split tall vertical gaps (>24px unchanged rows) inside a single XDamage bbox
        bands: list[tuple[int, int]] = []
        in_band = False
        band_y0 = ry
        clean_streak = 0
        y_end = ry + rh
        for y in range(ry, y_end):
            off = y * stride + x_off
            if libc.memcmp(base_data + off, self.ptr + off, row_bytes) != 0:
                if not in_band:
                    band_y0 = y
                    in_band = True
                clean_streak = 0
            elif in_band:
                clean_streak += 1
                if clean_streak >= 24:
                    bands.append((band_y0, y - clean_streak + 1))
                    in_band = False
                    clean_streak = 0
        if in_band:
            bands.append((band_y0, y_end - clean_streak))
        if not bands:
            return []

        out: list[tuple[int, int, int, int]] = []
        blk = 64  # 16px BGRA chunks
        for by0, by1 in bands:
            min_bx = row_bytes
            max_bx = 0
            for y in range(by0, by1):
                off = y * stride + x_off
                if libc.memcmp(base_data + off, self.ptr + off, row_bytes) == 0:
                    continue
                for bx in range(0, row_bytes, blk):
                    seg = min(blk, row_bytes - bx)
                    if libc.memcmp(base_data + off + bx, self.ptr + off + bx, seg) != 0:
                        if bx < min_bx:
                            min_bx = bx
                        break
                last_bx = ((row_bytes - 1) // blk) * blk
                for bx in range(last_bx, min_bx - 1, -blk):
                    seg = min(blk, row_bytes - bx)
                    if libc.memcmp(base_data + off + bx, self.ptr + off + bx, seg) != 0:
                        if bx + seg > max_bx:
                            max_bx = bx + seg
                        break
            if max_bx > min_bx:
                ax = rx + (min_bx // bpp)
                aw = (max_bx - min_bx + bpp - 1) // bpp
                aligned = clamp_align_rect(ax, by0, aw, by1 - by0, full_w, full_h)
                if aligned:
                    out.append(aligned)
        return out

    def diff_frame(
        self,
        base_data: int,
        full_w: int,
        full_h: int,
        stride: int,
        bpp: int,
        candidate_rects: list[tuple[int, int, int, int]] | None,
    ) -> tuple[bool, list[tuple[int, int, int, int]] | None]:
        """Returns (has_changes, refined_rects_or_None_for_full)."""
        if bpp != 4 or stride < full_w * 4 or not base_data:
            return True, candidate_rects

        if self.ensure_ready(full_w, full_h, stride):
            return True, None

        total_bytes = stride * full_h
        if libc.memcmp(base_data, self.ptr, total_bytes) == 0:
            return False, None

        if candidate_rects is None:
            # Fast 8px-strip whole-screen diff (~0.3ms): catches cursor/status/dual-corner changes even on full repaints
            bands: list[tuple[int, int]] = []
            in_band = False
            band_y0 = 0
            last_dirty_y1 = 0
            clean_bands = 0
            for y in range(0, full_h, 8):
                rows = min(8, full_h - y)
                off = y * stride
                if libc.memcmp(base_data + off, self.ptr + off, rows * stride) != 0:
                    if not in_band:
                        band_y0 = y
                        in_band = True
                    last_dirty_y1 = y + rows
                    clean_bands = 0
                elif in_band:
                    clean_bands += 1
                    if clean_bands >= 3:
                        bands.append((band_y0, last_dirty_y1))
                        in_band = False
                        clean_bands = 0
            if in_band:
                bands.append((band_y0, last_dirty_y1))
            if not bands:
                return False, None

            raw: list[tuple[int, int, int, int]] = []
            for by0, by1 in bands:
                raw.extend(self._tighten_rect(base_data, full_w, full_h, stride, bpp, (0, by0, full_w, max(1, by1 - by0))))
            if not raw:
                return False, None
            clusters = cluster_dirty_rects(raw, max_clusters=4) if len(raw) > 1 else raw
            area = sum(rw * rh for _rx, _ry, rw, rh in clusters)
            if area < int(full_w * full_h * 0.60):
                return True, clusters
            return True, None

        # Refine candidate XDamage rects against cached frame pixels
        refined: list[tuple[int, int, int, int]] = []
        for r in candidate_rects:
            refined.extend(self._tighten_rect(base_data, full_w, full_h, stride, bpp, r))
        if not refined:
            return False, None
        clusters = cluster_dirty_rects(refined, max_clusters=4) if len(refined) > 1 else refined
        area = sum(rw * rh for _rx, _ry, rw, rh in clusters)
        if area >= int(full_w * full_h * 0.65):
            return True, None
        return True, clusters


def main() -> None:
    global last_x_error
    libX11.XSetErrorHandler(track_x_error)
    display_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DISPLAY", ":100")
    width = max(240, min(1920, int(sys.argv[2]) if len(sys.argv) > 2 else 1100))
    height = max(180, min(1080, int(sys.argv[3]) if len(sys.argv) > 3 else 680))
    max_fps = max(8, min(60, int(sys.argv[4]) if len(sys.argv) > 4 else 45))
    quality = max(45, min(95, int(sys.argv[5]) if len(sys.argv) > 5 else 86))
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
        libXcomp.XCompositeRedirectSubwindows(dpy, root, 0)
        libX11.XSync(dpy, 0)

    dmg_ev_base = ctypes.c_int(0)
    dmg_err_base = ctypes.c_int(0)
    if not libXdamage.XDamageQueryExtension(dpy, ctypes.byref(dmg_ev_base), ctypes.byref(dmg_err_base)):
        sys.exit(2)

    damage_region = libXfixes.XFixesCreateRegion(dpy, None, 0) if libXfixes is not None else 0
    shm = ShmGrabber(dpy)

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
    micro_interval = min(min_interval, 1.0 / 60.0)
    max_in_flight = 4
    dirty = True
    force_full = True
    has_sent_full = False
    in_flight = 0
    in_flight_since = 0.0
    use_client_ack = False
    last_sent = 0.0
    stdin_buf = b""
    ev = XEvent()

    # Cached root size to avoid extra XGetGeometry roundtrip on every single frame
    root_w, root_h = query_drawable_size(dpy, root)
    last_geom_check = time.monotonic()
    prev_cache = PrevFrameCache()

    def compress_and_pack_rect(
        base_data: int,
        stride: int,
        bpp: int,
        rx: int,
        ry: int,
        rw: int,
        rh: int,
        subsamp: int,
        qual: int,
    ) -> bytes | None:
        src_ptr = ctypes.c_void_p(base_data + ry * stride + rx * bpp)
        jpeg_ptr = ctypes.c_void_p()
        jpeg_len = ctypes.c_ulong(0)
        rc = libtj.tjCompress2(
            tj,
            src_ptr,
            rw,
            stride,
            rh,
            TJPF_BGRX,
            ctypes.byref(jpeg_ptr),
            ctypes.byref(jpeg_len),
            subsamp,
            qual,
            TJFLAG_FASTDCT,
        )
        if rc != 0 or not jpeg_ptr.value or jpeg_len.value == 0:
            return None
        try:
            return ctypes.string_at(jpeg_ptr.value, int(jpeg_len.value))
        finally:
            libtj.tjFree(jpeg_ptr)

    def encode_and_emit(
        img_ptr,
        full_w: int,
        full_h: int,
        qual: int,
        subsamp: int,
        rects: list[tuple[int, int, int, int]] | None,
        destroy_img: bool,
        allow_diff: bool = False,
        bypass_dedup: bool = False,
    ) -> tuple[str, tuple[int, int, int, int] | None]:
        try:
            img = img_ptr.contents
            bpp = max(1, int(img.bits_per_pixel) // 8)
            stride = int(img.bytes_per_line)
            base_data = int(img.data)

            if allow_diff and has_sent_full and not bypass_dedup:
                has_changes, refined = prev_cache.diff_frame(
                    base_data, full_w, full_h, stride, bpp, rects
                )
                if not has_changes:
                    return "unchanged", None
                rects = refined

            if rects and len(rects) == 1:
                rx, ry, rw, rh = rects[0]
                jb = compress_and_pack_rect(base_data, stride, bpp, rx, ry, rw, rh, subsamp, qual)
                if not jb:
                    return "error", None
                jlen = len(jb)
                pkt = bytearray(17 + jlen)
                struct.pack_into(">IBHHHHHH", pkt, 0, 13 + jlen, PACKET_RECT_JPEG, rx, ry, rw, rh, full_w, full_h)
                pkt[17 : 17 + jlen] = jb
                write_all(out_fd, pkt)
                prev_cache.sync_rects(base_data, full_w, full_h, stride, bpp, rects)
                return "sent", rects[0]

            if rects and len(rects) > 1:
                # Pack multiple sparse dirty rectangles atomically into ONE 0x04 packet
                encoded_items: list[tuple[int, int, int, int, bytes]] = []
                total_payload = 7  # u8 type + u16 count + u16 fullW + u16 fullH
                for rx, ry, rw, rh in rects:
                    jb = compress_and_pack_rect(base_data, stride, bpp, rx, ry, rw, rh, subsamp, qual)
                    if jb:
                        encoded_items.append((rx, ry, rw, rh, jb))
                        total_payload += 12 + len(jb)
                if not encoded_items:
                    return "error", None
                pkt = bytearray(4 + total_payload)
                struct.pack_into(
                    ">IBHHH", pkt, 0, total_payload, PACKET_MULTI_RECT, len(encoded_items), full_w, full_h
                )
                pos = 11
                sent_bbox: tuple[int, int, int, int] | None = None
                synced: list[tuple[int, int, int, int]] = []
                for rx, ry, rw, rh, jb in encoded_items:
                    jlen = len(jb)
                    struct.pack_into(">HHHHI", pkt, pos, rx, ry, rw, rh, jlen)
                    pos += 12
                    pkt[pos : pos + jlen] = jb
                    pos += jlen
                    synced.append((rx, ry, rw, rh))
                    sent_bbox = union_rects(sent_bbox, (rx, ry, rw, rh))
                write_all(out_fd, pkt)
                prev_cache.sync_rects(base_data, full_w, full_h, stride, bpp, synced)
                return "sent", sent_bbox

            jpeg_ptr = ctypes.c_void_p()
            jpeg_len = ctypes.c_ulong(0)
            rc = libtj.tjCompress2(
                tj,
                img.data,
                full_w,
                stride,
                full_h,
                TJPF_BGRX,
                ctypes.byref(jpeg_ptr),
                ctypes.byref(jpeg_len),
                subsamp,
                qual,
                TJFLAG_FASTDCT,
            )
            if rc != 0 or not jpeg_ptr.value or jpeg_len.value == 0:
                return "error", None
            try:
                jlen = int(jpeg_len.value)
                pkt = bytearray(5 + jlen)
                struct.pack_into(">IB", pkt, 0, 1 + jlen, PACKET_FULL_JPEG)
                ctypes.memmove((ctypes.c_char * jlen).from_buffer(pkt, 5), jpeg_ptr.value, jlen)
                write_all(out_fd, pkt)
                prev_cache.sync_full(base_data, full_w, full_h, stride)
                return "sent", (0, 0, full_w, full_h)
            finally:
                libtj.tjFree(jpeg_ptr)
        finally:
            if destroy_img:
                libX11.XDestroyImage(img_ptr)

    def fetch_damage_clusters(
        grab_w: int, grab_h: int
    ) -> tuple[tuple[int, int, int, int] | None, list[tuple[int, int, int, int]] | None]:
        if not damage:
            return None, None
        if not damage_region or libXfixes is None:
            libXdamage.XDamageSubtract(dpy, damage, 0, 0)
            return None, None
        libXdamage.XDamageSubtract(dpy, damage, 0, damage_region)
        nrects = ctypes.c_int(0)
        bounds = XRectangle()
        rects_ptr = libXfixes.XFixesFetchRegionAndBounds(
            dpy, damage_region, ctypes.byref(nrects), ctypes.byref(bounds)
        )
        raw_list: list[tuple[int, int, int, int]] = []
        try:
            cnt = int(nrects.value)
            if rects_ptr and 1 < cnt <= 48:
                arr_ptr = ctypes.cast(rects_ptr, ctypes.POINTER(XRectangle))
                for idx in range(cnt):
                    r = arr_ptr[idx]
                    lx = int(r.x) - off_x
                    ly = int(r.y) - off_y
                    lw = int(r.width)
                    lh = int(r.height)
                    if lx < 0:
                        lw += lx
                        lx = 0
                    if ly < 0:
                        lh += ly
                        ly = 0
                    aligned = clamp_align_rect(lx, ly, lw, lh, grab_w, grab_h)
                    if aligned:
                        raw_list.append(aligned)
        finally:
            if rects_ptr:
                libX11.XFree(rects_ptr)

        if nrects.value <= 0 or bounds.width == 0 or bounds.height == 0:
            return None, None
        lx = int(bounds.x) - off_x
        ly = int(bounds.y) - off_y
        lw = int(bounds.width)
        lh = int(bounds.height)
        if lx < 0:
            lw += lx
            lx = 0
        if ly < 0:
            lh += ly
            ly = 0
        bbox = clamp_align_rect(lx, ly, lw, lh, grab_w, grab_h)
        clusters = cluster_dirty_rects(raw_list, max_clusters=4) if len(raw_list) > 1 else None
        return bbox, clusters

    def grab_and_send(
        qual: int,
        subsamp: int,
        explicit_rect: tuple[int, int, int, int] | None,
        allow_partial: bool,
        prefetched: tuple[tuple[int, int, int, int] | None, list[tuple[int, int, int, int]] | None] | None = None,
        bypass_dedup: bool = False,
    ) -> tuple[str, tuple[int, int, int, int] | None]:
        nonlocal root_w, root_h, last_geom_check, has_sent_full
        global last_x_error

        if capture_mode == "pixmap" and target_wid and libXcomp is not None:
            if damage:
                libXdamage.XDamageSubtract(dpy, damage, 0, 0)
            before = last_x_error
            pix = libXcomp.XCompositeNameWindowPixmap(dpy, target_wid)
            libX11.XFlush(dpy)
            if pix and last_x_error == before:
                try:
                    pw, ph = query_drawable_size(dpy, pix)
                    grab_w = min(width, pw) if pw > 0 else 0
                    grab_h = min(height, ph) if ph > 0 else 0
                    if grab_w >= 2 and grab_h >= 2:
                        exp_rects = [explicit_rect] if explicit_rect is not None else None
                        allow_diff = allow_partial and has_sent_full
                        # Use fast zero-copy MIT-SHM on XComposite off-screen pixmaps (~0.5ms vs ~14ms XGetImage)
                        shm_pix = shm.grab(pix, 0, 0, grab_w, grab_h)
                        if shm_pix is not None:
                            status, srect = encode_and_emit(
                                shm_pix, grab_w, grab_h, qual, subsamp, exp_rects, False, allow_diff=allow_diff, bypass_dedup=bypass_dedup
                            )
                            if status == "sent":
                                has_sent_full = True
                            return status, srect
                        img_ptr = libX11.XGetImage(
                            dpy, pix, 0, 0, grab_w, grab_h, ALL_PLANES, ZPIXMAP
                        )
                        if img_ptr:
                            status, srect = encode_and_emit(
                                img_ptr, grab_w, grab_h, qual, subsamp, exp_rects, True, allow_diff=allow_diff, bypass_dedup=bypass_dedup
                            )
                            if status == "sent":
                                has_sent_full = True
                            return status, srect
                finally:
                    libX11.XFreePixmap(dpy, pix)
            return "error", None

        now_g = time.monotonic()
        if root_w == 0 or root_h == 0 or (now_g - last_geom_check) > 3.0:
            root_w, root_h = query_drawable_size(dpy, root)
            last_geom_check = now_g

        if root_w <= off_x or root_h <= off_y:
            return "error", None
        grab_w = min(width, root_w - off_x)
        grab_h = min(height, root_h - off_y)
        if grab_w < 2 or grab_h < 2:
            return "error", None

        if explicit_rect is not None:
            dirty_bbox = explicit_rect
            clusters = None
        elif prefetched is not None:
            dirty_bbox, clusters = prefetched
        else:
            dirty_bbox, clusters = fetch_damage_clusters(grab_w, grab_h)

        viewport_area = grab_w * grab_h
        selected_rects: list[tuple[int, int, int, int]] | None = None
        if allow_partial and has_sent_full and dirty_bbox is not None:
            bx, by, bw, bh = dirty_bbox
            bbox_area = bw * bh
            if clusters and len(clusters) > 1:
                cluster_area = sum(rw * rh for _rx, _ry, rw, rh in clusters)
                if cluster_area < bbox_area * 0.60 and cluster_area < viewport_area * 0.50:
                    selected_rects = clusters
            if selected_rects is None and bbox_area < viewport_area * 0.55:
                selected_rects = [dirty_bbox]

        # Zero-copy MIT-SHM grab (~0.5ms) with seamless fallback to XGetImage
        shm_ptr = shm.grab(root, off_x, off_y, grab_w, grab_h)
        if shm_ptr is not None:
            status, srect = encode_and_emit(
                shm_ptr,
                grab_w,
                grab_h,
                qual,
                subsamp,
                selected_rects,
                False,
                allow_diff=allow_partial and has_sent_full,
                bypass_dedup=bypass_dedup,
            )
            if status == "sent":
                has_sent_full = True
            return status, srect

        # Fallback: XGetImage (grab only dirty sub-rect when single partial)
        if selected_rects is not None and len(selected_rects) == 1:
            rx, ry, rw, rh = selected_rects[0]
            img_ptr = libX11.XGetImage(
                dpy, root, off_x + rx, off_y + ry, rw, rh, ALL_PLANES, ZPIXMAP
            )
            if not img_ptr:
                return "error", None
            img = img_ptr.contents
            jpeg_ptr = ctypes.c_void_p()
            jpeg_len = ctypes.c_ulong(0)
            try:
                rc = libtj.tjCompress2(
                    tj,
                    img.data,
                    rw,
                    img.bytes_per_line,
                    rh,
                    TJPF_BGRX,
                    ctypes.byref(jpeg_ptr),
                    ctypes.byref(jpeg_len),
                    subsamp,
                    qual,
                    TJFLAG_FASTDCT,
                )
                if rc != 0 or not jpeg_ptr.value or jpeg_len.value == 0:
                    return "error", None
                try:
                    jlen = int(jpeg_len.value)
                    pkt = bytearray(17 + jlen)
                    struct.pack_into(
                        ">IBHHHHHH", pkt, 0, 13 + jlen, PACKET_RECT_JPEG, rx, ry, rw, rh, grab_w, grab_h
                    )
                    ctypes.memmove((ctypes.c_char * jlen).from_buffer(pkt, 17), jpeg_ptr.value, jlen)
                    write_all(out_fd, pkt)
                    prev_cache.reset()
                    return "sent", selected_rects[0]
                finally:
                    libtj.tjFree(jpeg_ptr)
            finally:
                libX11.XDestroyImage(img_ptr)

        img_ptr = libX11.XGetImage(
            dpy, root, off_x, off_y, grab_w, grab_h, ALL_PLANES, ZPIXMAP
        )
        if not img_ptr:
            return "error", None
        status, srect = encode_and_emit(
            img_ptr, grab_w, grab_h, qual, subsamp, None, True, allow_diff=False, bypass_dedup=bypass_dedup
        )
        if status == "sent":
            has_sent_full = True
        return status, srect

    # Adaptive quality state (GeForce NOW-style motion drop + crisp TJSAMP_444 settle)
    max_quality = quality
    motion_quality = max(30, min(max_quality, max_quality - 24))
    dynamic_drop = True
    smooth_buffer = False
    client_rtt_sec = 0.04
    settle_sec = 0.18
    needs_settle = False
    settle_rect: tuple[int, int, int, int] | None = None
    last_motion_at = 0.0
    pending_damage: tuple[tuple[int, int, int, int] | None, list[tuple[int, int, int, int]] | None] | None = None

    def recompute_pipeline_window() -> None:
        nonlocal max_in_flight
        if smooth_buffer:
            buffer_sec = min(0.24, max(0.08, client_rtt_sec * 0.75 + 0.05))
            bdp_frames = int(math.ceil(max_fps * (client_rtt_sec + buffer_sec))) + 2
            max_in_flight = max(6, min(18, bdp_frames))
        else:
            bdp_frames = int(math.ceil(max_fps * client_rtt_sec)) + 2
            max_in_flight = max(4, min(8, bdp_frames))

    recompute_pipeline_window()

    # Gentle initial settle window while the X11 app first paints its window
    startup_until = time.monotonic() + 2.4

    while True:
        now = time.monotonic()
        # Prevent permanent deadlock if a client browser tab goes backgrounded without acking
        inflight_timeout = max(0.45, client_rtt_sec * 2.6 + (0.28 if smooth_buffer else 0.0))
        if in_flight > 0 and (now - in_flight_since) > inflight_timeout:
            in_flight = max(0, in_flight - 1)
            in_flight_since = now

        active_interval = min_interval
        if pending_damage and has_sent_full and not force_full:
            pb = pending_damage[0]
            if pb is not None and (pb[2] * pb[3]) <= int(width * height * 0.22):
                active_interval = micro_interval

        wait_timeout = 1.5
        if dirty and in_flight < max_in_flight:
            elapsed = now - last_sent
            wait_timeout = max(0.0, active_interval - elapsed)
        elif needs_settle and in_flight < max_in_flight:
            rem = settle_sec - (now - last_motion_at)
            wait_timeout = max(0.0, rem)
        elif now < startup_until:
            wait_timeout = 0.20

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
                    if s == b"k" or s.startswith(b"k "):
                        use_client_ack = True
                        ack_n = 1
                        if len(s) > 2:
                            try:
                                ack_n = max(1, min(32, int(s[2:].strip())))
                            except ValueError:
                                ack_n = 1
                        in_flight = max(0, in_flight - ack_n)
                        in_flight_since = time.monotonic()
                    elif s == b"a":
                        if not use_client_ack:
                            in_flight = max(0, in_flight - 1)
                            in_flight_since = time.monotonic()
                    elif s.startswith(b"{"):
                        try:
                            cmd = json.loads(s.decode("utf-8"))
                            ctype = cmd.get("type")
                            if ctype == "resize":
                                width = max(240, min(1920, int(cmd.get("width", width))))
                                height = max(180, min(1080, int(cmd.get("height", height))))
                                prev_cache.reset()
                                force_full = True
                                pending_damage = None
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
                                prev_cache.reset()
                                force_full = True
                                pending_damage = None
                                dirty = True
                            elif ctype == "net_stats":
                                if "rtt_ms" in cmd:
                                    rtt_ms = max(2.0, min(1200.0, float(cmd["rtt_ms"])))
                                    client_rtt_sec = client_rtt_sec * 0.65 + (rtt_ms / 1000.0) * 0.35
                                    recompute_pipeline_window()
                            elif ctype == "stream_config":
                                if "fps" in cmd and cmd["fps"]:
                                    max_fps = max(8, min(60, int(cmd["fps"])))
                                    min_interval = 1.0 / float(max_fps)
                                    micro_interval = min(min_interval, 1.0 / 60.0)
                                if "max_quality" in cmd and cmd["max_quality"]:
                                    max_quality = max(45, min(95, int(cmd["max_quality"])))
                                if "motion_quality" in cmd and cmd["motion_quality"]:
                                    motion_quality = max(30, min(max_quality, int(cmd["motion_quality"])))
                                if "dynamic_drop" in cmd:
                                    dynamic_drop = bool(cmd["dynamic_drop"])
                                if "smooth_buffer" in cmd:
                                    smooth_buffer = bool(cmd["smooth_buffer"])
                                if "rtt_ms" in cmd and cmd["rtt_ms"]:
                                    rtt_ms = max(2.0, min(1200.0, float(cmd["rtt_ms"])))
                                    client_rtt_sec = rtt_ms / 1000.0
                                if "settle_ms" in cmd and cmd["settle_ms"]:
                                    settle_sec = max(0.10, min(1.2, float(cmd["settle_ms"]) / 1000.0))
                                recompute_pipeline_window()
                                prev_cache.reset()
                                force_full = True
                                pending_damage = None
                                needs_settle = False
                                settle_rect = None
                                dirty = True
                            elif ctype == "refresh":
                                prev_cache.reset()
                                force_full = True
                                pending_damage = None
                                dirty = True
                        except Exception:
                            pass
            except OSError:
                break

        got_new_damage = False
        while libX11.XPending(dpy) > 0:
            libX11.XNextEvent(dpy, ctypes.byref(ev))
            if ev.type == dmg_ev_base.value:
                dirty = True
                got_new_damage = True

        # Accumulate damage bounds while throttled so micro_interval knows exact dirty area before next tick
        if got_new_damage and capture_mode == "root" and has_sent_full and not force_full:
            grab_w = min(width, max(2, root_w - off_x))
            grab_h = min(height, max(2, root_h - off_y))
            b2, c2 = fetch_damage_clusters(grab_w, grab_h)
            if b2 is not None:
                if pending_damage is None:
                    pending_damage = (b2, c2)
                else:
                    prev_b, prev_c = pending_damage
                    merged_b = union_rects(prev_b, b2)
                    merged_list: list[tuple[int, int, int, int]] = []
                    if prev_c:
                        merged_list.extend(prev_c)
                    elif prev_b:
                        merged_list.append(prev_b)
                    if c2:
                        merged_list.extend(c2)
                    else:
                        merged_list.append(b2)
                    pending_damage = (
                        merged_b,
                        cluster_dirty_rects(merged_list, max_clusters=4) if len(merged_list) > 1 else None,
                    )

        now = time.monotonic()
        if now < startup_until and (now - last_sent) > 0.25:
            if not has_sent_full:
                force_full = True
            pending_damage = None
            dirty = True

        active_interval = min_interval
        if pending_damage and has_sent_full and not force_full:
            pb = pending_damage[0]
            if pb is not None and (pb[2] * pb[3]) <= int(width * height * 0.22):
                active_interval = micro_interval

        if dirty and in_flight < max_in_flight and (now - last_sent) >= active_interval:
            effective_dynamic_drop = dynamic_drop and (not smooth_buffer)
            is_rapid_motion = (
                effective_dynamic_drop and not force_full and (now - last_sent) < max(0.20, min_interval * 3.0)
            )
            congestion_drop = 0 if smooth_buffer else (8 if in_flight >= (max_in_flight - 1) else 0)
            send_qual = (
                max(30, motion_quality - congestion_drop)
                if is_rapid_motion
                else max(45, max_quality)
            )
            subsamp = TJSAMP_420 if is_rapid_motion else (TJSAMP_444 if not force_full else TJSAMP_422)
            status, sent_rect = grab_and_send(
                send_qual,
                subsamp,
                None,
                allow_partial=not force_full,
                prefetched=pending_damage,
                bypass_dedup=False,
            )
            pending_damage = None
            if status == "sent":
                dirty = False
                force_full = False
                in_flight += 1
                in_flight_since = time.monotonic()
                last_sent = in_flight_since
                if is_rapid_motion and send_qual < max_quality:
                    needs_settle = True
                    settle_rect = union_rects(settle_rect, sent_rect)
                    last_motion_at = last_sent
                else:
                    needs_settle = False
                    settle_rect = None
            elif status == "unchanged":
                dirty = False
                force_full = False
        elif (
            needs_settle
            and not dirty
            and in_flight < max_in_flight
            and (now - last_motion_at) >= settle_sec
        ):
            # Sharpen ONLY the region that actually moved using lossless-chroma 4:4:4!
            status, _ = grab_and_send(
                max_quality, TJSAMP_444, settle_rect, allow_partial=True, bypass_dedup=True
            )
            if status in ("sent", "unchanged"):
                if status == "sent":
                    in_flight += 1
                    in_flight_since = time.monotonic()
                    last_sent = in_flight_since
                needs_settle = False
                settle_rect = None

    shm.destroy()
    if damage_region and libXfixes is not None:
        libXfixes.XFixesDestroyRegion(dpy, damage_region)
    if damage:
        libXdamage.XDamageDestroy(dpy, damage)
    libtj.tjDestroy(tj)
    libX11.XCloseDisplay(dpy)


if __name__ == "__main__":
    main()
