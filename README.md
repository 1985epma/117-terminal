# 117Terminal

A modern, block-based terminal inspired by Warp — built with **React + Electron**.

## Features

- **Blocks** — every command and its output is a block with cwd, git branch, duration and exit status. Failed blocks are highlighted. Copy command/output, rerun, collapse; `⌘↑ / ⌘↓` to select, `⌘C` copies a selected block.
- **Real shell** — your own zsh (or bash) with your `.zshrc`, via `node-pty`. A small shell-integration shim emits private OSC markers so the UI knows where each command starts and ends.
- **Full terminal emulation** — output is parsed by xterm.js, so colors, `\r` progress bars and cursor movement render correctly. Full-screen apps (`vim`, `less`, `htop`) switch to a full xterm view automatically.
- **Modern editor** — syntax highlighting, multi-line (`⇧↵`), history ghost suggestions (`→`), `Tab` completion for files/folders/commands, history search (`⌃R`).
- **Agent Mode** (`⌘I`, or start a line with `#`) — ask in plain language; the agent proposes commands, you approve (`↵`), skip (`esc`) or edit, and it reads the output and keeps going. Commands run as normal blocks.
- **Any AI provider** (`⌘,`) — Anthropic Claude, OpenAI, Google Gemini, xAI Grok, Ollama (local), OpenRouter, Groq, DeepSeek, Mistral, LM Studio, or any OpenAI-compatible server. Paste a key, click **Connect & use**. Keys are encrypted with the macOS Keychain and never reach the UI. Keys in env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, …) are picked up automatically.
- **Slash commands** — type `/` for a menu: `/agent`, `/new`, `/shell`, `/model`, `/plugins`, `/prompt`, `/mcp`, `/brewcat`, `/theme`, `/clear`, `/help`.
- **Extensions** (`⌘⇧X`):
  - **Zsh plugins** — one-click autosuggestions, syntax highlighting, zsh-completions, fzf-tab, zsh-z, Oh My Zsh plugins (git, docker, kubectl…), zoxide, fzf, atuin, direnv, mise… Plugins live in `~/.117terminal/zsh/` and load from one generated file; your `~/.zshrc` is untouched unless you opt in.
  - **Prompt** — Powerlevel10k (with presets), Starship, Pure, Spaceship. Turn on *Show my zsh prompt* to see it above the editor.
  - **MCP servers** — give the agent tools: presets (filesystem, memory, fetch, git, GitHub, Playwright, Context7…), custom servers, and one-click import from Claude Code, Claude Desktop, Kiro, VS Code and Cursor. Config: `~/.117terminal/mcp.json`.
  - **brewcat** — search the [brewcat](https://github.com/1985epma/homebrew-brewcat) Homebrew catalog by profile, install packages and kits as terminal blocks, run `brewcat doctor`.
- **Interactive mode** — open any running command in a full terminal (`⤢ Interactive`); `ssh` and `p10k configure` open there automatically.
- **Themes & transparency** (`/theme`, `⌥⌘T`) — Black Ninja Dark (pure black, default), Midnight, Aurora, Ember, Daylight; window transparency slider and blur.
- Tabs (`⌘T`, `⌘W`, `⌘1…9`), command palette (`⌘P`), font size (`⌘= / ⌘-`).

## Run

```bash
npm install
npm run build && npm start
```

Development with hot reload: `npm run dev`. Package a macOS app (`dist/117Terminal.app`, `.dmg`): `npm run dist`.

## Layout

| Path | What |
| --- | --- |
| `src/main/index.js` | Electron main: window, menu, PTYs, completion, history |
| `src/main/shell-integration.js` | zsh/bash shims emitting block markers |
| `src/main/ai.js` | Provider catalog, key storage, streaming chat with tool calls |
| `src/main/mcp.js` | MCP client: servers, presets, imports, tool calls |
| `src/main/zsh-plugins.js` | Zsh plugin/prompt catalog and generated `plugins.zsh` |
| `src/main/brewcat.js` | brewcat CLI bridge |
| `src/main/migrate.js` | One-time move of data and keys from the old ETerm name |
| `src/renderer/src/lib/session.js` | Parses PTY output into blocks |
| `src/renderer/src/lib/agent.js` | Agent loop: approve → run → feed output back |
| `src/renderer/src/components/` | UI: blocks, editor, agent turns, settings, palette |
