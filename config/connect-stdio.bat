@echo off
REM ============================================================
REM LOB Brain — stdio Bridge (Windows)
REM
REM Wraps the LOB Brain SSE server as a stdio MCP server
REM using mcp-remote. This allows stdio-only clients
REM (Codex CLI, Claude Code, Windsurf, etc.) to connect.
REM
REM Prerequisites: Node.js 18+ installed
REM Usage: Add this script as the MCP server command
REM ============================================================

set LOB_BRAIN_URL=http://localhost:3020/sse

REM Check if Node.js is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is required but not found.
    echo Install from https://nodejs.org
    exit /b 1
)

REM Launch mcp-remote bridge (stdin/stdout passthrough)
npx -y mcp-remote "%LOB_BRAIN_URL%"
