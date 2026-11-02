# Changelog

All notable changes to 117Terminal. Versions follow [SemVer](https://semver.org); dates are UTC.

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
