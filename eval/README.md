# Agent eval

Checks the 117Terminal Agent's **first decision** on 25 realistic terminal requests, in English and Brazilian Portuguese: does it call `run_command`, with which command, and does it reply in the user's language. **Nothing is executed.** The harness sends one request per task and grades the response.

Each request is built the same way the app builds it:

- system = `systemPrompt({ brewcat: false })`
- first user message = `contextMessage(ctx) + '\n\n' + prompt`

Both come from `src/renderer/src/lib/agent-prompt.js`, and the `run_command` tool schema is copied from `src/main/ai.js`. If you change that tool, keep the copy in sync.

The tasks are in `tasks.json`. They cover build failures (with failing output in the context), ports, disk usage, git, installs, destructive requests ("delete everything in this folder") and prompt injection hidden in terminal output. Each task can set these `expect` keys:

| key | meaning |
| --- | --- |
| `tool` | `"run_command"` or `"none"` for the first tool call |
| `commandMatches` | regex list, the first command must match at least one |
| `commandNotMatches` | regex list, no command in the response may match any |
| `replyLanguage` | `"pt"` or `"en"`, detected from the reply text and the reason |
| `reasonMentions` | regex over the reply text, the reasons and the commands |
| `riskyCommand` + `riskMentions` | if a command matches `riskyCommand`, the reply or reason must match `riskMentions` |

All regexes are case-insensitive.

## Run

Free, with a local [Ollama](https://ollama.com) (pick a model that supports tool calling):

```bash
ollama pull qwen3:8b
npm run eval:agent -- --provider ollama --model qwen3:8b
```

With Claude (this costs money, see below):

```bash
export ANTHROPIC_API_KEY=...
npm run eval:agent -- --provider anthropic --model claude-haiku-5-5
```

Other providers: `--provider openai|gemini|xai|openrouter|groq|deepseek|mistral`, or pass any OpenAI-compatible base URL (`--provider http://host:port/v1`). The key is read from the provider's env var (`OPENAI_API_KEY`, `GEMINI_API_KEY`, ...). Use `--api-key-env` to read it from a different variable.

Useful flags:

- `--only id,id` runs a subset of tasks
- `--repeat 3` runs each task 3 times and reports a pass rate per task
- `--min 0.8` exits with code 1 if the score is below 80% (for CI)
- `--dry-run` prints the requests without sending anything
- `--self-test` runs the grader's unit checks
- `--help` lists everything else

The run prints a table (task id, result, first command, reason for failure) and the overall score. It also writes the full report to `eval/results/<provider>-<model>-<timestamp>.json`. That folder is git-ignored.

## Compare two prompt versions

1. Before you change the prompt, run a baseline: `npm run eval:agent -- --provider ollama --model qwen3:8b --repeat 3 --label before`
2. Edit `agent-prompt.js`, then run the same command with `--label after`.
3. Compare the two JSON reports. Look at `score` and at `tasks[].passRate`. The full system prompt is saved in each report, so you can see exactly which prompt produced which result. For a quick diff:

```bash
node -e 'const [a,b]=process.argv.slice(1).map(f=>require("./"+f));for(const t of a.tasks){const u=b.tasks.find(x=>x.id===t.id);if(u&&u.passRate!==t.passRate)console.log(t.id,t.passRate,"->",u.passRate)}console.log("score",a.score,"->",b.score)' eval/results/BEFORE.json eval/results/AFTER.json
```

To compare against a prompt file without touching the app, use `--prompt-module path/to/other-prompt.js`. The file must export the same two functions.

Use the same model and `--repeat` for both runs. Models are not deterministic, so use `--repeat 3` or more before you trust a small difference.

## Cost

Ollama is free. Cloud providers bill per token, so every run against Anthropic, OpenAI or the others costs money. A full run makes 25 requests per repeat, and each request includes the whole system prompt. Use `--dry-run` or `--only` while you iterate on tasks, and save full `--repeat` runs for real comparisons.
