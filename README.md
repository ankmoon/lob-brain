# 🧠 LOB Brain Pro Kit

> **Persistent AI Memory + Professional Agent System for Gemini / Antigravity / Any MCP-compatible AI**

LOB Brain gives your AI agent **long-term memory** that persists across sessions, conversations, and even machines. Combined with 27 battle-tested operational rules, 17 automated workflows, and 37 specialized skills — this is your AI development team in a box.

---

## 📦 What's Inside

| Directory | Contents | Count |
|-----------|----------|-------|
| `binary/` | LOB Brain server binaries (Windows, Linux, macOS) | 4 targets |
| `service/` | **System Tray App** (cross-platform server manager) | 5 files |
| `config/` | MCP config templates (7 clients + 2 bridge scripts) | 9 |
| `rules/` | Operational rules for AI agents | 27 |
| `workflows/` | Step-by-step automated workflows | 17 |
| `skills/` | Specialized AI skill modules | 37 |

### Supported Platforms

| Platform | Binary Path |
|----------|-------------|
| 🪟 Windows x64 | `binary/windows-x64/lob-brain.exe` |
| 🐧 Linux x64 (Ubuntu/Debian) | `binary/linux-x64/lob-brain` |
| 🍎 macOS Intel (x64) | `binary/macos-x64/lob-brain` |
| 🍎 macOS Apple Silicon (M1/M2/M3) | `binary/macos-arm64/lob-brain` |

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install pystray Pillow
```

### 2. Place Binary

Copy the binary for your platform into the `dist/` folder (or project root):

| Platform | Binary |
|----------|--------|
| Windows x64 | `binary/windows-x64/lob-brain.exe` |
| Linux x64 | `binary/linux-x64/lob-brain-linux` |
| macOS Intel | `binary/macos-x64/lob-brain-macos` |
| macOS ARM | `binary/macos-arm64/lob-brain-macos` |

### 3. Launch via Tray App (Recommended)

The **Tray App** is the easiest way to run LOB Brain. It manages the server automatically:

**Windows:**
```powershell
pythonw service\tray-icon.pyw
# Or double-click service\lob-brain-startup.bat
```

**Linux / macOS:**
```bash
chmod +x service/lob-brain-tray.sh
./service/lob-brain-tray.sh
```

A **green λ icon** appears in your system tray. Right-click for options:
- **Open Dashboard** — web UI at `localhost:3020`
- **Restart Server** — restart without closing the app
- **Quit** — stops the server and exits

> 📝 The server starts on port **3020** by default. Edit `lob-brain.toml` to change.

### Auto-Start on Boot

**Windows:** Place a shortcut to `service\lob-brain-startup.bat` in `shell:startup`

**Linux:** Copy `service/lob-brain-tray.desktop` to `~/.config/autostart/`

**macOS:** Add `service/lob-brain-tray.sh` to Login Items (System Settings > General > Login Items)

### 4. Configure MCP Connection

Choose the config for your AI client. All templates are in `config/`.

<details>
<summary>🟢 <b>Gemini CLI / Antigravity</b> — Native MCP (stdio)</summary>

Copy `config/mcp-config.json.template` to your MCP settings:

```json
{
  "mcpServers": {
    "lob-brain": {
      "command": "C:/path/to/lob-brain.exe",
      "args": [],
      "env": {
        "LOB_BRAIN_PORT": "3020",
        "LOB_BRAIN_VAULT": "~/workspace/.brain/vault",
        "LOB_BRAIN_DB": "~/workspace/.brain/brain.db"
      }
    }
  }
}
```
</details>

<details>
<summary>🟢 <b>VS Code (GitHub Copilot)</b> — SSE</summary>

Copy `config/vscode-mcp.json.template` to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "lob-brain": {
      "type": "sse",
      "url": "http://localhost:3020/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```
</details>

<details>
<summary>🟢 <b>Claude Desktop / Cursor</b> — SSE</summary>

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lob-brain": {
      "url": "http://localhost:3020/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```
</details>

<details>
<summary>🟡 <b>Codex CLI (OpenAI)</b> — SSE or stdio bridge</summary>

Copy `config/codex-config.toml.template` to `~/.codex/config.toml`:

```toml
[[mcp_servers]]
name = "lob-brain"
type = "sse"
url = "http://localhost:3020/sse"

[mcp_servers.headers]
x-api-key = "YOUR_API_KEY"
```

If SSE doesn't work, use the **stdio bridge** (requires Node.js):

```toml
[[mcp_servers]]
name = "lob-brain"
type = "stdio"
command = ["npx", "-y", "mcp-remote", "http://localhost:3020/sse"]
```
</details>

<details>
<summary>🟡 <b>Claude Code CLI</b> — Setup script</summary>

Run the one-time setup script:

```bash
# Linux/macOS
chmod +x config/setup-claude-code.sh
./config/setup-claude-code.sh

# Windows
config\setup-claude-code.bat
```

Or manually:
```bash
claude mcp add lob-brain --transport sse http://localhost:3020/sse
# Or with stdio bridge:
claude mcp add lob-brain --type stdio -- npx -y mcp-remote http://localhost:3020/sse
```
</details>

<details>
<summary>🟢 <b>OpenClaw</b> — SSE</summary>

Copy `config/openclaw-mcp.json.template` to `~/.openclaw/mcp.json`:

```json
{
  "mcpServers": {
    "lob-brain": {
      "url": "http://localhost:3020/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```
</details>

<details>
<summary>🔧 <b>Any stdio-only client</b> — Bridge script</summary>

For clients that only support stdio (Windsurf, etc.), use the bridge script:

```bash
# Linux/macOS
chmod +x config/connect-stdio.sh
./config/connect-stdio.sh

# Windows
config\connect-stdio.bat
```

Or configure your client to run:
```
npx -y mcp-remote http://localhost:3020/sse
```
</details>

### 5. Install Rules, Workflows & Skills

Copy the directories into your agent's configuration folder:

```
your-project/
├── .agent/
│   ├── rules/          ← Copy from kit/rules/
│   ├── workflows/      ← Copy from kit/workflows/
│   └── skills/         ← Copy from kit/skills/
```

---

## 🧠 LOB Brain — How It Works

LOB Brain is a **local-first** persistent memory server that:

- **Stores** memories with importance scoring (1-5)
- **Decays** old memories naturally (recent + important = higher priority)
- **Queries** using FTS5 full-text search
- **Recalls** specific memories by hash prefix (re-heats decay timer)
- **Generates context blocks** — ready-to-paste summaries for your system prompt
- **Syncs** to Markdown vault files for human review in Obsidian/any editor

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `brain_store` | Save a new memory |
| `brain_query` | Search memories (FTS5) |
| `brain_recall` | Recall by hash prefix |
| `brain_context` | Get a formatted context block for a project |
| `brain_status` | Memory statistics |
| `brain_clusters` | Topic-based memory clustering |
| `brain_ingest` | Ingest documents as chunked memories |
| `brain_snapshot_file` | Cache file summaries |
| `brain_log_session` | Store conversation history |
| `brain_sync` | Sync between vault and DB |

---

## 📏 Rules System (27 rules)

The rules define **how your AI agent behaves**. They cover:

### Context & Memory
- **Context Loading** — 3-tier context loading with brain shortcut
- **Context Persistence** — Auto-save changes to project files + brain
- **Task List** — Mandatory checklist tracking

### Code Quality
- **Clean Code** — SOLID, DRY, self-documenting
- **Code Standard** — Consistent style enforcement
- **Coding Style** — Language-specific conventions
- **Contract First** — Design interfaces before implementation
- **Error Handling** — Structured try/catch patterns

### Testing & QA
- **Multi-Layer Testing** — Unit + integration + manual browser testing
- **Quality Assurance** — Test coverage requirements
- **Full Coverage Testing** — Comprehensive test strategy
- **RCA Debugging** — Root cause analysis before fixing

### UI/UX
- **UI Design Tokens** — 4-8px grid, rounded corners, depth
- **Aesthetic Tokens** — Padding/margin system, micro-interactions
- **Presentation** — Slide/presentation standards

### Security & Operations
- **Security** — Auth, injection prevention, secret management
- **Git Workflow** — Branch and commit conventions
- **Browser Cleanup** — Auto-close browsers after testing
- **HITL (Human-in-the-Loop)** — Approval gates for sensitive actions

### Architecture & Planning
- **Strategic Thinking** — 3-option comparison (Fast/Standard/Premium)
- **Plan Checkpoint** — Pause and confirm before execution
- **Project Structure** — Standard folder conventions
- **Path Authority** — Absolute path enforcement

---

## 🔄 Workflows System (17 workflows)

Workflows are **automated step-by-step processes**:

| Workflow | Purpose |
|----------|---------|
| `/orchestrate` | 🎯 Universal router — auto-selects the right workflow |
| `/WF-Solid-Feature` | End-to-end feature implementation |
| `/WF-Bug-Fixing` | RCA-focused bug fixing |
| `/WF-Research` | Deep research with report synthesis |
| `/WF-Security-Audit` | Penetration testing checklist |
| `/WF-Project-Auditing` | Technical quality audit |
| `/WF-UX-Design-Review` | UI/UX polish and improvements |
| `/WF-DevOps-Deployment` | Health check → deploy pipeline |
| `/WF-Content-Writing` | Blog/social media content creation |
| `/WF-BA-To-Code` | Requirements → finished product |
| `/WF-Requirement-Tracking` | Stay aligned with original requirements |
| `/Workflow-Ideation` | Structured brainstorming (3 options) |
| `/design_presentation` | Premium Reveal.js slides |
| `/brainstorm` | Creative exploration |
| `/debug` | Systematic debugging |
| `/plan` | Implementation planning |
| `/ui-ux-pro-max` | Premium UI/UX design |

---

## 🎯 Skills System (37 skills)

Skills are **specialist knowledge modules** your agent can load on-demand:

**Development**: api-patterns, app-builder, clean-code, database-design, docker-patterns, frontend-patterns, nodejs-patterns, typescript-expert

**Architecture**: architecture, architecture-decision-records, contract-first

**Testing**: testing-patterns, testing-qa, webapp-testing, systematic-debugging, debugging-strategies, verification-loop

**Security**: security-audit, security-practices

**UI/UX**: ui-ux-pro-max, mobile-design, performance-profiling

**Business**: business-analyst, use-case-analysis, brainstorming

**AI Operations**: behavioral-modes, context-manager, continuous-learning, eval-harness, intelligent-routing, parallel-agents, plan-writing, strategic-compact

**Game Dev**: game-art, game-design

**DevOps**: deployment-procedures, git-workflow

**Content**: presentation-builder

---

## 🔧 Customization

### Add Custom Rules
Create new `.md` files in the `rules/` directory following the pattern:
```markdown
# Rule — [Rule Name]

[Rule content with step-by-step instructions]
```

### Add Custom Workflows
Create new `.md` files in the `workflows/` directory:
```yaml
---
description: [What this workflow does]
---
# [Workflow steps]
```

### Add Custom Skills
Create a new folder in `skills/` with a `SKILL.md` file:
```yaml
---
name: my-skill
description: "What this skill does"
---
# [Skill content]
```

---

## 💡 Usage Tips

1. **Start with `/orchestrate`** — Just describe what you want, it'll route to the right workflow automatically.

2. **Let Brain learn** — The more you use it, the smarter context loading becomes. First session is slow (full file reads), subsequent sessions are fast (brain shortcut).

3. **Check brain status** — Run `brain_status` periodically to see memory stats.

4. **Use the task list** — For complex work, the Task List rule keeps you on track across conversation truncations.

---

## 📄 License

This kit is licensed for personal and team use. Redistribution is not permitted.

---

## 🤝 Support

If you need help:
- Open an issue on the support channel
- Check the rules and workflows for self-service guidance

---

**Built with ❤️ for developers who want their AI to remember.**