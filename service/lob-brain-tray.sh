#!/bin/bash
# ============================================================
# LOB Brain — Linux/macOS Launcher
# Starts the tray app (which manages the server automatically)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check Python dependencies
python3 -c "import pystray, PIL" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing dependencies: pystray, Pillow..."
    pip3 install pystray Pillow --quiet
fi

# Launch tray app in background
nohup python3 "$SCRIPT_DIR/tray-icon.pyw" > /dev/null 2>&1 &
echo "LOB Brain tray started (PID: $!)"
