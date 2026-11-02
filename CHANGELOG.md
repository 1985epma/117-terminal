# Changelog

All notable changes to 117Terminal. Versions follow [SemVer](https://semver.org); dates are UTC.

## [Unreleased]

### Added
- **Web mode for HarmonyOS and any browser**: `117terminal --serve [--host] [--port] [--token] [--open]` runs headless
  and serves the full UI over HTTP + WebSocket, protected by a random token (HttpOnly cookie) and Host/Origin checks.
  Responsive layout for phones and tablets.
- **Linux arm64** packages (`.deb`, `.rpm`, `.tar.gz`), built natively on GitHub's ARM runners — for the HarmonyOS PC
  Linux environment, Raspberry Pi and ARM servers.
- Social preview card (`docs/social-preview.png`, 1280×640) so shared links show 117Terminal instead of GitHub's
  default card. It is centred so WhatsApp's square crop still shows the icon and name.

- **Settings** (`⌘,`, `/settings`): one panel with General, Appearance, AI Agent, Voice, MCP, Zsh & Prompt,
  Integrations, Web & HarmonyOS and Shortcuts. Replaces the separate Agent, Themes and Extensions panels.
- **Start web mode from the app**: Settings › Web & HarmonyOS starts and stops the browser UI, with copyable links for
  this computer and the local network.

### Changed
- Menus reorganized: *Settings…* in the app menu, new **Agent**, **Music** and **Help** menus, a slimmer **Shell** menu,
  and Reload/DevTools moved under *View › Developer*. Old shortcuts (`⌥⌘T`, `⌘⇧X`) and slash commands open the matching
  Settings section.
- Shorter repository description and GitHub topics.

## [0.1.2] — 2026-11-02

### Added
- **Voice commands** (`⌘⇧Space` or the 🎙 button at the top right) in English (US), Brazilian Portuguese and Spanish,
  or auto-detect. In the shell, speech becomes a command typed into the editor for review; in Agent Mode it becomes
  the prompt. Engines: Gemini, OpenAI, Groq or offline whisper.cpp. Settings in `/voice`.

### Fixed
- Local `npm run dist*` left node-pty built for the last packaged arch (x64 on Apple Silicon), which broke the dev app's
  shell; the scripts now rebuild it for the host afterwards.

## [0.1.1] — 2026-11-02

First public release.

### Added
- **Packages for every OS**, built by GitHub Actions on each `v*` tag: macOS `.dmg`/`.zip` (arm64, x64), Windows `.msi`,
  Linux `.deb`, `.rpm` and `.tar.gz`, plus `SHA256SUMS.txt`.
- **Homebrew tap** `1985epma/117terminal`: cask for macOS, formula for Linux.
- **winget** manifest `1985epma.117Terminal` (submitted to `microsoft/winget-pkgs`).
- **Windows support**: PowerShell block integration (prefers `pwsh`), native window frame.
- **fish** block integration.
- Cyberpunk README with real screenshots.

### Changed
- The app reads its version from `package.json` instead of hard-coding it.

### Fixed
- Linux packages no longer ship world-writable files (Electron's Linux zip stores 0666/0777 modes).
- MCP client crashed on connect because `app` wasn't imported (caught before release).

## [0.1.0] — 2026-11-02

Tagged but never released: the build was cancelled to add the `.rpm` package. Its features ship in 0.1.1:

- Block-based terminal over a real PTY (zsh, bash) with xterm.js parsing, full-screen apps and interactive mode.
- Editor with syntax highlighting, history suggestions, Tab completion and history search.
- Agent Mode with Anthropic, OpenAI, Gemini, Grok, Ollama, LM Studio and other OpenAI-compatible providers; API keys in
  the macOS Keychain; MCP servers as agent tools.
- Extensions: zsh plugins, prompt themes (Powerlevel10k, Starship, Pure, Spaceship), MCP servers, brewcat catalog.
- Slash commands, command palette, tabs, themes with transparency and blur.
- Music deck for Spotify and Apple Music.
- 117-Labs branding: app icon, wordmark, Space Grotesk + JetBrains Mono.
