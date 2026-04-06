@echo off
REM ============================================================
REM Claude Code CLI — LOB Brain MCP Setup (Windows)
REM Run this script once to register LOB Brain as an MCP server.
REM
REM Prerequisites:
REM   - Claude Code CLI installed
REM   - LOB Brain server running on localhost:3020
REM   - Node.js installed (for mcp-remote bridge)
REM ============================================================

set LOB_BRAIN_URL=http://localhost:3020/sse

echo ==============================================
echo   LOB Brain — Claude Code MCP Setup
echo ==============================================
echo.

echo [1/2] Registering via SSE transport...
claude mcp add lob-brain --transport sse "%LOB_BRAIN_URL%" 2>nul

if %ERRORLEVEL% neq 0 (
    echo   Warning: Direct SSE failed. Trying stdio bridge...
    echo [2/2] Registering via stdio bridge ^(npx mcp-remote^)...
    claude mcp add lob-brain --type stdio -- npx -y mcp-remote "%LOB_BRAIN_URL%"
)

echo.
echo Done! Verify with:
echo    claude mcp list
echo.
echo To remove later:
echo    claude mcp remove lob-brain
