# Demo mock data

`setup.py` builds a synthetic `HOME` at `/tmp/agentwatch-demo/` with fake
Claude Code + Codex + Gemini CLI + OpenClaw session files. The narrative
is a user invoking a `/council` command that asks whether to ship 0.0.3;
Claude Code orchestrates, spawns Codex and Gemini as sub-tasks, and
OpenClaw runs an unrelated research task in parallel.

Nothing from your real `~/.claude`, `~/.codex`, `~/.gemini`, `~/.openclaw`
is read or touched. Record the demo GIF against this mock HOME and your
actual session history stays private.

## 1. Build the mock data

```bash
python3 docs/demo-mock/setup.py
```

This wipes and recreates `/tmp/agentwatch-demo/` from scratch. Timestamps
are anchored to "30 minutes ago" so the timeline shows up as Today. Re-run
the script any time you want a fresh state.

## 2. Smoke-check that agentwatch sees the mock agents

```bash
HOME=/tmp/agentwatch-demo \
  WORKSPACE_ROOT=/tmp/agentwatch-demo/workspace \
  node bin/agentwatch.js doctor
```

You should see Claude Code, Codex, Gemini CLI, OpenClaw all marked
`● installed (events captured)`.

## 3. Record the cast

```bash
brew install asciinema agg        # one-time
```

```bash
asciinema rec docs/demo.cast \
  --cols 110 --rows 34 \
  --title "agentwatch — one pane for every local AI agent" \
  --idle-time-limit 1.5
```

Inside the recording shell:

```bash
HOME=/tmp/agentwatch-demo \
  WORKSPACE_ROOT=/tmp/agentwatch-demo/workspace \
  node bin/agentwatch.js
```

### Demo choreography (~75 seconds)

| t    | action                          | shows                                          |
| ---- | ------------------------------- | ---------------------------------------------- |
| 0s   | launch agentwatch                | multi-agent timeline (Claude + Codex + Gemini + OpenClaw)
| 3s   | `P`                              | projects grid aggregated across agents
| 6s   | `Enter` on workspace             | sessions list grouped by date
| 10s  | `Enter` on the Claude session    | scoped timeline of the /council turn
| 15s  | `t`                              | per-turn token attribution, stacked bar w/ memoryFile
| 22s  | `esc` then `C`                   | compaction visualizer (empty in mock, prints structure)
| 28s  | `esc` then `p`                   | permissions view: Claude + Codex + Gemini + OpenClaw
| 36s  | `esc` then `/`                   | unified search overlay, live mode
| 40s  | type `rm -rf` `Enter`            | live substring match
| 45s  | `Tab` (to cross-session)         | cross-session hits
| 50s  | `Tab` (to semantic)              | first-run consent modal (don't confirm — it's mock data)
| 55s  | `esc` `esc`                      | back to main timeline
| 60s  | `f`                              | cycle agent filter (fun little polish moment)
| 68s  | `?`                              | help overlay
| 73s  | `q`                              | clean exit

Ctrl-D exits asciinema.

## 4. Convert to GIF

```bash
agg docs/demo.cast docs/demo.gif \
  --font-size 14 \
  --theme asciinema \
  --speed 1.4
```

Optional shrink:

```bash
brew install gifsicle
gifsicle -O3 --colors 128 docs/demo.gif -o docs/demo.gif
du -h docs/demo.gif     # aim ≤ 3 MB
```

## 5. Clean up

```bash
rm -rf /tmp/agentwatch-demo
```

Re-running `setup.py` does the same thing (it wipes before rebuilding).
