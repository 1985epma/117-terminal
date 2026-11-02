# Changelog

All notable changes to 117Terminal. Versions follow [SemVer](https://semver.org); dates are UTC.

## [Unreleased]

### Security (Agent)
- **"Auto-run safe commands" now allows only known read-only forms.** It used to let through `git branch -D`,
  `git remote set-url`, `sort -o <file>`, `find -fprint` and `git diff --output`. Anything without a rule, any glob,
  `$` expansion or redirection now asks first.
- **Secrets always ask**: commands that mention `~/.ssh`, `~/.aws`, `.env`, `*.pem`, `id_ed25519`, `credentials` and
  similar never run on their own. The same applies to recursive `grep` and `rg --hidden`/`-u`.
- **No silent read-then-send**: after a command reads outside the working folder on its own, trusted MCP tools need a
  click for the rest of that task.
- **Terminal output is treated as data**: it now goes to the model inside `<terminal_context>` in the conversation, not
  in the system prompt, and the model is told it never contains instructions.
- **MCP tool changes are caught**: each server's tools are fingerprinted. If they change after an update, the server
  stops being trusted until you accept the change. Tool descriptions are listed in full, and suspicious ones are
  flagged. The popular-server presets are pinned to exact versions. MCP calls time out after 60 s.

### Added (Agent)
- **Token usage on every agent step** (input, output, cached), with a task total and an optional **token limit per
  task** in Settings › AI Agent.
- **Decline with a reason**: "Decline…" on a command or MCP card tells the agent why.
- **Where your data goes**: each agent turn shows "local" or "cloud · <provider>".
- **Agent eval harness** (`npm run eval:agent`, see `eval/README.md`): 25 tasks in English and Portuguese, including
  prompt-injection cases. It grades the agent's first decision without running anything.

### Changed (Agent)
- **Prompt caching with Claude**: the system prompt is stable, and tools, system and history are cached, so later steps
  in a task reuse the earlier ones instead of paying for them again. MCP tools are sent in a fixed order to keep the
  cache valid.
- **Adaptive thinking** on Claude models that support it.
- **Long sessions no longer overflow**: above ~120k context tokens, older command output is replaced with a short note.
- **OpenAI-compatible providers**: a reply cut off in the middle of a tool call is no longer run. Voice-to-command with
  Claude now has a 30 s timeout.

### Added
- **A real command line**: `117terminal --help` and `--version`; subcommands `open`, `run "<cmd>"` (new tab running it),
  `theme <name>`, `serve`, `doctor` (libraries, shell, agent, MCP, web port) and `completions bash|zsh|fish`. Unknown
  options and values are errors with a suggestion (`--serv` → `--serve`), exit codes are documented (0/1/2, 3 = port in
  use), and colors follow `NO_COLOR`/`--no-color`.
- From a terminal the app opens in the background and returns the prompt; `--wait` keeps it attached. With the app
  open, a second `117terminal …` hands its folders, `run`, `theme`, `--new-tab` or `--settings` to it.
- Web mode for scripts: stdout is only the URL (or `--json`), messages go to stderr; `--token-file` and `T117_TOKEN`
  keep the token out of `ps`; the running link is also in `web.json` (for Windows, where a GUI app has no console).
- Slash commands: `/help <command>` with examples, short forms (`/s` settings, `/a` agent, `/m` music, `/v` voice,
  `/t` theme), and `/word` that is neither a command nor a real path suggests the closest command instead of failing in
  the shell.
- `install.sh`: `--uninstall`, `--force`, built-in `--help` (works through `curl | bash`), no colors outside a terminal,
  and nothing happens when that version is already installed. It ships with each release (in `SHA256SUMS.txt`), and a
  new CI workflow installs every release on Ubuntu 22.04/24.04, Debian 12 and Fedora 41 (x86_64 and arm64).
- **One-line Linux installer** (`install.sh`): installs the required libraries first, then the `.deb` or `.rpm` for the
  machine's CPU after checking it against `SHA256SUMS.txt`. Picks the right package names on old and new releases
  (`libgtk-3-0`/`libgtk-3-0t64`, `libasound2`/`libasound2t64`). `--user` installs the portable build in `~/.local`
  without sudo; `--dry-run` only prints the steps. Works with already published releases, including 0.1.3.
- **Open folders in 117Terminal**: Finder's *Open With › 117Terminal*, dropping a folder or file on the Dock icon, or
  `117terminal <dir>` opens a new tab there. With the app already running, `117terminal <dir>` adds a tab to it.
- The window reopens where you left it, at the same size (or maximized). If that spot is on a display that is gone, it
  opens centred instead.
- **Linux desktop integration**: 117Terminal is listed as a terminal (`TerminalEmulator`), file managers offer
  *Open With › 117Terminal* for folders, and the launcher icon has *New Tab*, *Settings* and *Open in Browser* actions.
- **Secure Keyboard Entry** (app menu, like Terminal.app): stops other apps from reading your keystrokes while
  117Terminal is in front. It stays on across restarts.

### Changed
- macOS permissions: the Apple Events prompt now says why (controlling Spotify and Apple Music), and the unused camera,
  Bluetooth and audio-capture permission strings that Electron adds by default are removed.
- **API keys no longer use the macOS Keychain by default**, so macOS stops asking for your password. Keys are encrypted
  with AES-256-GCM using a random key in the app's data folder (`.keystore`, readable only by your user). Keys already in
  the Keychain move over the first time each one is used (one last prompt), or paste them again to skip it. Turn the
  Keychain back on in Settings › AI Agent.

### Fixed
- **Memory**: a finished command keeps only its rendered output and frees its terminal emulator. 300 commands now
  use 10 MB of JS heap instead of 55 MB, and five 100,000-line outputs 12 MB instead of 83 MB. See `PERF.md`.
- **Music player polling**: one `osascript` per poll for Spotify and Apple Music together, no polling while the window
  is hidden, and every 15 s when no player is open: 14 → 6 calls per 30 s visible, 14 → 1 hidden. A control click during
  a poll could also start a second polling loop.
- **Linux x86_64 packages did not run on current distros.** CI built them on `ubuntu-latest`, now Ubuntu 26.04, so the
  terminal's native module required glibc 2.42 and failed on Ubuntu 22.04/24.04, Debian 12 and Fedora 41
  (`GLIBC_2.42 not found`). Linux packages are now built on Ubuntu 22.04 (glibc 2.35), and the release fails if a native
  module needs anything newer. Found by the new install test; arm64 was not affected.
- Web mode with its port already taken hung instead of exiting: the WebSocket server re-emitted the error as an
  uncaught exception. It now exits with code 3 (and the Settings button shows the error).
- **Linux: the `.deb` now depends on `libgbm1`** (and the `.rpm` on `mesa-libgbm`). On a minimal Ubuntu 24.04 install the
  app could not start without it. `libasound2t64` is now listed first: with `libasound2 | libasound2t64`, apt could pick
  `liboss4-salsa-asound2`, which crashes the app with "undefined symbol: snd_device_name_get_hint". The unused `libxss1`/`libXScrnSaver` dependency is gone and `xdg-utils` (for opening
  links) is added.
- **Linux: `117terminal --serve` without a display** (servers, containers, the HarmonyOS PC Linux environment) failed with
  "Missing X server". It now restarts itself in headless mode, and serve mode no longer starts the GPU.
- The app no longer reads saved keys at launch: the provider list shows a stored 4-character hint instead.

## [0.1.3] — 2026-11-02

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
