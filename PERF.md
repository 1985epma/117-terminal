# Performance log

Every performance experiment, kept or reverted, with how it was measured. Read this before
trying an idea again.

## How to measure

Dev build (`npm run build`), Apple Silicon Mac, a **separate user data folder** so the
installed app does not share the profile:

```bash
node_modules/.bin/electron . --remote-debugging-port=9339 --user-data-dir=/tmp/117-perf
```

- **Memory**: Chrome DevTools Protocol `Performance.getMetrics` (`JSHeapUsedSize`, `Nodes`)
  after a GC, at: start · after 300 × `echo line N` · after 5 × `seq 1 100000` · after `clear`.
  `HeapProfiler.collectGarbage` is not a full Blink GC: the `Nodes` count lags until one runs
  (a heap snapshot forces it). Compare `Nodes` only after a snapshot.
- **Startup**: `domContentLoadedEventEnd` and first paint from the Performance API.
- **Music polling**: an `osascript` shim first on `PATH` that logs every call, counted over 30 s.
- Repeat each measurement at least twice; run-to-run variance was ±0.4 MB for memory.

## Ledger

| Date | Idea | Baseline → Result | Verdict | Why |
|---|---|---|---|---|
| 2026-11-02 | Freeze finished blocks: keep HTML + text, dispose the xterm instance | Heap after 300 blocks 54.8 → **10.0 MB**; after 5 × 100k-line outputs 83.4 → **12.0 MB** | **kept** | Each finished block held a full xterm (20,000-line scrollback) forever. Far outside the ±0.4 MB variance. |
| 2026-11-02 | Fix a "leak" after `clear` (9,864 DOM nodes kept) | After a full GC: 246 nodes, 9.9 MB | **no change needed** | Not a leak: the node count lags until a full Blink GC. Measurement artefact. |
| 2026-11-02 | Music: one `osascript` for both players, pause while the window is hidden, 15 s interval with no player open | `osascript` calls per 30 s: visible 14 → **6**, hidden 14 → **1** | **kept** | Two processes per poll became one; a hidden window stops polling and resumes when shown. Also fixes a second polling loop that a control click during a poll could start. |
| 2026-11-02 | Window transparency / vibrancy as the cause of a 4 s startup | DOMContentLoaded 4.0 s with and without | **reverted** | Not the cause. The 4 s came from the dev app and the installed app sharing one profile: the first `localStorage` read waited for the other process's lock. Separate profile: first paint 0.24 s. |
| 2026-11-02 | Remove `crossorigin` from the built HTML | 4.0 s → 4.0 s | **reverted** | No effect (same cause as above). |
| 2026-11-02 | Cache block HTML differently | Full re-serialization of a 20,000-line block: 1 ms | **not tried** | Not a bottleneck. |

## Open ideas (measured, not done yet)

| Idea | Measurement | Why it may help |
|---|---|---|
| `content-visibility: auto` or a virtual list for blocks | 300 blocks = 9,700 DOM nodes, all rendered | Long sessions: scrolling and resizing |
| Feed big outputs to xterm in slices | 20,000-line streaming output: worst long task 122 ms (budget 50 ms) | Typing stays responsive while output streams |
| Lazy-load Settings, MCP, music panel, Markdown | Renderer JS is 253 KB gzip in one chunk (budget 200 KB) | Smaller initial load |
| Separate dev profile (`117Terminal-dev`) | Dev + installed app sharing one profile: 4.0 s startup | Faster dev startup; dev stops touching real settings |
| Say when output was cut | `seq 1 200000` keeps the last 20,000 lines without notice | No silent loss of output |
