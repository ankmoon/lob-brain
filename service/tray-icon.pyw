#!/usr/bin/env python3
"""
LOB Brain — System Tray App v3 (Cross-Platform)

This IS the application. Like Docker Desktop:
  - Launch tray → starts server as child process
  - Quit tray  → stops server + exits
  - Restart    → kill + relaunch server

Supports: Windows, Linux (with AppIndicator), macOS
Requirements: pip install pystray Pillow
"""

import sys
import os
import signal
import threading
import time
import webbrowser
import subprocess
import socket
import json
import urllib.request
from pathlib import Path

import pystray
from PIL import Image, ImageDraw, ImageFont

# ─── Platform Detection ─────────────────────────────────────
IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

# ─── Path Resolution ────────────────────────────────────────
# tray-icon.pyw lives in <project>/service/
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent

# Binary name per platform
if IS_WINDOWS:
    BINARY_NAME = "lob-brain.exe"
elif IS_MACOS:
    BINARY_NAME = "lob-brain-macos"
else:
    BINARY_NAME = "lob-brain-linux"

# Search for binary: dist/ first, then project root
BINARY_PATH = PROJECT_DIR / "dist" / BINARY_NAME
if not BINARY_PATH.exists():
    BINARY_PATH = PROJECT_DIR / BINARY_NAME

# Config file
CONFIG_PATH = PROJECT_DIR / "lob-brain.toml"

# ─── Server Configuration ───────────────────────────────────
PORT = "3020"
SERVER_URL = f"http://localhost:{PORT}"
HEALTH_ENDPOINT = f"{SERVER_URL}/health"
STATUS_ENDPOINT = f"{SERVER_URL}/api/v1/brain/status"
DASHBOARD_URL = f"{SERVER_URL}/dashboard"
POLL_INTERVAL = 15  # seconds between health checks
SINGLETON_PORT = 65432  # port used for singleton lock

# ─── Global State ───────────────────────────────────────────
server_process = None  # subprocess.Popen handle
is_healthy = False
uptime_str = "Starting..."
memory_count = 0
tray_icon = None
lock_socket = None
shutting_down = False


# ═════════════════════════════════════════════════════════════
# ICON RENDERING
# ═════════════════════════════════════════════════════════════

def create_icon(healthy: bool) -> Image.Image:
    """Generate a 64x64 tray icon with lambda symbol."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Green = running, Red = stopped/error
    bg_color = (34, 197, 94) if healthy else (239, 68, 68)
    draw.ellipse([4, 4, size - 4, size - 4], fill=bg_color)

    # Lambda symbol in center
    try:
        if IS_WINDOWS:
            font = ImageFont.truetype("arial.ttf", 32)
        elif IS_MACOS:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 32)
        else:
            # Linux: try common font paths
            for fpath in [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            ]:
                if os.path.exists(fpath):
                    font = ImageFont.truetype(fpath, 32)
                    break
            else:
                font = ImageFont.load_default()
    except (OSError, IOError):
        font = ImageFont.load_default()

    text = "\u03bb"  # λ
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) // 2
    y = (size - text_h) // 2 - 2
    draw.text((x, y), text, fill=(255, 255, 255), font=font)

    return img


# ═════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ═════════════════════════════════════════════════════════════

def notify(title: str, message: str):
    """Show a system notification from the tray icon."""
    if tray_icon is not None:
        try:
            tray_icon.notify(title=title, message=message)
        except Exception:
            pass


# ═════════════════════════════════════════════════════════════
# SERVER LIFECYCLE
# ═════════════════════════════════════════════════════════════

def start_server():
    """Start the LOB Brain server as a child process."""
    global server_process, is_healthy

    if server_process and server_process.poll() is None:
        # Already running
        return True

    if not BINARY_PATH.exists():
        notify("LOB Brain", f"Binary not found: {BINARY_PATH}")
        return False

    cmd = [str(BINARY_PATH)]
    if CONFIG_PATH.exists():
        cmd += ["--config", str(CONFIG_PATH)]
    cmd += ["--port", PORT]

    kwargs = {
        "cwd": str(PROJECT_DIR),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }

    if IS_WINDOWS:
        kwargs["creationflags"] = (
            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        )
    else:
        kwargs["preexec_fn"] = os.setsid

    try:
        server_process = subprocess.Popen(cmd, **kwargs)
        return True
    except Exception as e:
        notify("LOB Brain", f"Failed to start: {e}")
        return False


def stop_server():
    """Stop the server child process gracefully."""
    global server_process, is_healthy

    if server_process is None:
        return

    try:
        if IS_WINDOWS:
            # Terminate process tree on Windows
            subprocess.run(
                ["taskkill", "/PID", str(server_process.pid), "/T", "/F"],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        else:
            # Send SIGTERM to process group on Unix
            os.killpg(os.getpgid(server_process.pid), signal.SIGTERM)

        # Wait up to 5 seconds for graceful shutdown
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()
    except (ProcessLookupError, OSError):
        pass  # Process already gone

    server_process = None
    is_healthy = False


def restart_server():
    """Restart the server (stop then start)."""
    stop_server()
    time.sleep(1)
    return start_server()


# ═════════════════════════════════════════════════════════════
# HEALTH MONITORING
# ═════════════════════════════════════════════════════════════

def check_health():
    """Poll the server health endpoint."""
    global is_healthy, uptime_str, memory_count
    try:
        req = urllib.request.Request(HEALTH_ENDPOINT, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            is_healthy = data.get("status") == "ok"

        if is_healthy:
            req2 = urllib.request.Request(STATUS_ENDPOINT, method="GET")
            with urllib.request.urlopen(req2, timeout=5) as resp2:
                status = json.loads(resp2.read())
                secs = status.get("uptime_secs", 0)
                hours = int(secs // 3600)
                mins = int((secs % 3600) // 60)
                uptime_str = f"{hours}h {mins}m"
                memory_count = status.get("total_memories", 0)
    except Exception:
        is_healthy = False
        uptime_str = "Offline"
        memory_count = 0


def health_monitor(icon: pystray.Icon):
    """Background thread: poll health, update icon, auto-restart crashed server."""
    global server_process
    prev_healthy = None

    while not shutting_down:
        # Check if child process crashed unexpectedly
        if server_process and server_process.poll() is not None:
            # Process exited — try to restart once
            notify("LOB Brain", "Server crashed. Restarting...")
            start_server()
            time.sleep(5)

        check_health()
        try:
            icon.icon = create_icon(is_healthy)
        except Exception:
            pass

        if is_healthy:
            icon.title = (
                f"LOB Brain \u2014 Running\n"
                f"Uptime: {uptime_str}\n"
                f"Memories: {memory_count}"
            )
        else:
            icon.title = "LOB Brain \u2014 OFFLINE"

        # Notify on status transitions (skip first check)
        if prev_healthy is not None and prev_healthy != is_healthy:
            if is_healthy:
                notify("LOB Brain", f"Server online! ({memory_count} memories)")
            else:
                notify("LOB Brain", "Server went offline")
        prev_healthy = is_healthy

        time.sleep(POLL_INTERVAL)


# ═════════════════════════════════════════════════════════════
# MENU ACTIONS
# ═════════════════════════════════════════════════════════════

def on_open_dashboard(_icon=None, _item=None):
    """Open the dashboard in the default browser."""
    webbrowser.open(DASHBOARD_URL)


def on_restart(_icon=None, _item=None):
    """Restart the server."""
    notify("LOB Brain", "Restarting server...")

    def do_restart():
        restart_server()
        time.sleep(5)
        check_health()
        if is_healthy:
            notify("LOB Brain", f"Server restarted! ({memory_count} memories)")
        else:
            notify("LOB Brain", "Restart failed. Check binary path.")

    threading.Thread(target=do_restart, daemon=True).start()


def on_quit(icon: pystray.Icon, _item=None):
    """Quit the app: stop server + exit tray."""
    global shutting_down
    shutting_down = True

    notify("LOB Brain", "Shutting down...")
    time.sleep(0.5)

    # Stop server
    stop_server()

    # Release singleton lock
    if lock_socket:
        try:
            lock_socket.close()
        except Exception:
            pass

    # Exit tray
    icon.stop()


def get_status_text(_item=None):
    """Dynamic menu item showing current status."""
    if is_healthy:
        return f"Online \u2014 {uptime_str} \u2014 {memory_count} memories"
    return "Offline"


# ═════════════════════════════════════════════════════════════
# SINGLETON CHECK
# ═════════════════════════════════════════════════════════════

def acquire_singleton():
    """Ensure only one instance of the tray app runs."""
    global lock_socket
    try:
        lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        lock_socket.bind(("127.0.0.1", SINGLETON_PORT))
        lock_socket.listen(1)
        return True
    except socket.error:
        return False


# ═════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════

def main():
    global tray_icon

    # --- Singleton ---
    if not acquire_singleton():
        # Another instance is already running
        print("LOB Brain tray is already running.")
        return

    # --- Start server ---
    if start_server():
        print(f"LOB Brain server starting on port {PORT}...")
    else:
        print("WARNING: Could not start server. Tray will show offline.")

    # --- Wait for server to initialize (model loading ~3-10s) ---
    for _ in range(12):
        time.sleep(2)
        check_health()
        if is_healthy:
            break

    # --- Create tray icon ---
    tray_icon = pystray.Icon(
        name="lob-brain",
        icon=create_icon(is_healthy),
        title="LOB Brain \u2014 Starting...",
        menu=pystray.Menu(
            pystray.MenuItem(get_status_text, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Dashboard", on_open_dashboard, default=True),
            pystray.MenuItem("Restart Server", on_restart),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", on_quit),
        ),
    )

    # --- Health monitor thread ---
    monitor = threading.Thread(target=health_monitor, args=(tray_icon,), daemon=True)
    monitor.start()

    if is_healthy:
        notify("LOB Brain", f"Server ready! ({memory_count} memories)")

    # --- Run (blocks until quit) ---
    tray_icon.run()


if __name__ == "__main__":
    main()
