#!/bin/bash
# ============================================================
# Claude Code CLI — LOB Brain MCP Setup
# Run this script once to register LOB Brain as an MCP server.
#
# Prerequisites:
#   - Claude Code CLI installed (https://docs.anthropic.com/en/docs/claude-code)
#   - LOB Brain server running on localhost:3020
#   - Node.js installed (for mcp-remote bridge)
#
# Docs: https://docs.anthropic.com/en/docs/claude-code/mcp
# ============================================================

LOB_BRAIN_URL="http://localhost:3020/sse"

echo "╔══════════════════════════════════════════════╗"
echo "║  LOB Brain — Claude Code MCP Setup           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Method 1: Direct SSE (simpler, may have limited support)
echo "[1/2] Registering via HTTP transport..."
claude mcp add lob-brain --transport sse "$LOB_BRAIN_URL" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "  ⚠️  Direct SSE failed. Trying stdio bridge..."
    # Method 2: stdio via mcp-remote (more reliable)
    echo "[2/2] Registering via stdio bridge (npx mcp-remote)..."
    claude mcp add lob-brain \
        --type stdio \
        -- npx -y mcp-remote "$LOB_BRAIN_URL"
fi

echo ""
echo "✅ Done! Verify with:"
echo "   claude mcp list"
echo ""
echo "To remove later:"
echo "   claude mcp remove lob-brain"
