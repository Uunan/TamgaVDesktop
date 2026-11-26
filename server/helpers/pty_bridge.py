#!/usr/bin/env python3
"""Zero-dependency Linux/macOS PTY bridge for TamgaVDesktop Terminal.
Reads newline-delimited JSON commands from stdin and streams base64 output over stdout.
"""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd: int, cols: int, rows: int) -> None:
    cols = max(20, min(400, int(cols)))
    rows = max(5, min(160, int(rows)))
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        os._exit(0)


def main() -> None:
    cwd = sys.argv[1] if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]) else os.path.expanduser("~")
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    shell = os.environ.get("SHELL") or ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh")

    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except OSError:
            pass
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        os.environ.setdefault("LANG", "C.UTF-8")
        try:
            os.execvp(shell, [shell, "-i"])
        except OSError:
            os.execvp("/bin/sh", ["/bin/sh"])
        os._exit(1)

    set_winsize(master_fd, cols, rows)

    def cleanup(_sig=None, _frame=None):
        try:
            os.kill(pid, signal.SIGHUP)
        except OSError:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    stdin_fd = sys.stdin.fileno()
    stdin_buf = b""

    while True:
        try:
            rlist, _, _ = select.select([master_fd, stdin_fd], [], [], 0.25)
        except (OSError, ValueError):
            break

        if master_fd in rlist:
            try:
                chunk = os.read(master_fd, 16384)
                if not chunk:
                    break
                emit({"type": "output", "data": base64.b64encode(chunk).decode("ascii")})
            except OSError:
                break

        if stdin_fd in rlist:
            try:
                raw = os.read(stdin_fd, 16384)
                if not raw:
                    break
                stdin_buf += raw
                while b"\n" in stdin_buf:
                    line, stdin_buf = stdin_buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line.decode("utf-8"))
                    except Exception:
                        continue
                    mtype = msg.get("type")
                    if mtype == "input":
                        payload = base64.b64decode(msg.get("data", ""))
                        if payload:
                            os.write(master_fd, payload)
                    elif mtype == "resize":
                        set_winsize(master_fd, msg.get("cols", 100), msg.get("rows", 30))
                        try:
                            os.kill(pid, signal.SIGWINCH)
                        except OSError:
                            pass
            except OSError:
                break

        # Check if child exited
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 0
                emit({"type": "exit", "code": code})
                break
        except ChildProcessError:
            emit({"type": "exit", "code": 0})
            break

    try:
        os.close(master_fd)
    except OSError:
        pass
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass


if __name__ == "__main__":
    main()
