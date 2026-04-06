@echo off
REM ============================================================
REM LOB Brain — Windows Launcher
REM Starts the tray app (which manages the server automatically)
REM Place shortcut to this in shell:startup for auto-start
REM ============================================================

cd /d "%~dp0.."

REM Launch tray app hidden (pythonw = no console window)
start "" pythonw "%~dp0tray-icon.pyw"
