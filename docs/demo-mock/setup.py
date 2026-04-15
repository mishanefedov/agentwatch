#!/usr/bin/env python3
"""
Build a mock HOME at /tmp/agentwatch-demo/ with fake session files for
Claude Code, Codex, Gemini CLI, and OpenClaw. The narrative is a user
invoking a /council slash-command that asks whether to ship 0.0.3;
Claude Code orchestrates, spawns Codex and Gemini as subagents, and
OpenClaw runs an unrelated research task in parallel.

Usage:
    python3 docs/demo-mock/setup.py
    HOME=/tmp/agentwatch-demo WORKSPACE_ROOT=/tmp/agentwatch-demo/workspace \
        node bin/agentwatch.js

All timestamps are anchored to "now - 30 minutes" so the timeline
shows up as Today. Regenerate by re-running the script.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

ROOT = Path("/tmp/agentwatch-demo")
WORKSPACE = ROOT / "workspace"
NOW_MS = int(time.time() * 1000) - 30 * 60_000  # 30 min ago


def iso(offset_ms: int) -> str:
    """ISO timestamp `offset_ms` after the demo's start."""
    ms = NOW_MS + offset_ms
    return (
        time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000))
        + f".{ms % 1000:03d}Z"
    )


def unix(offset_ms: int) -> int:
    return (NOW_MS + offset_ms) // 1000


def write_jsonl(path: Path, lines: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


def write_json(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2))


def reset() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    ROOT.mkdir(parents=True)
    WORKSPACE.mkdir()
    # seed a CLAUDE.md so the token-attribution view has a non-zero
    # "memory file" category to render.
    (WORKSPACE / "CLAUDE.md").write_text(
        "# agentwatch demo workspace\n\n"
        "- Prefer short, direct responses.\n"
        "- Use Bash for quick shell ops.\n"
        "- Ship 0.0.3 when the council signs off.\n"
    )
    # sibling memory files for the other agents, so the per-agent memoryFile
    # tokens light up when you press [t] on their sessions.
    (WORKSPACE / "AGENTS.md").write_text(
        "# codex memory\n\n- Codex does the adversarial review.\n"
    )
    (WORKSPACE / "GEMINI.md").write_text(
        "# gemini memory\n\n- Gemini does the independent strategic review.\n"
    )


# ─── Claude Code ──────────────────────────────────────────────────────────

CLAUDE_SESSION_ID = "demo-claude-0001"
CLAUDE_PROJECT_DIR = "-tmp-agentwatch-demo-workspace"


def claude_session() -> None:
    lines: list[dict] = []

    def msg_user(content, ts_ms):
        return {
            "type": "user",
            "timestamp": iso(ts_ms),
            "message": {"role": "user", "content": content},
            "sessionId": CLAUDE_SESSION_ID,
            "cwd": str(WORKSPACE),
        }

    def msg_assistant(content, usage, cost, model, ts_ms):
        return {
            "type": "assistant",
            "timestamp": iso(ts_ms),
            "message": {
                "role": "assistant",
                "content": content,
                "usage": usage,
                "model": model,
            },
            "sessionId": CLAUDE_SESSION_ID,
            "cwd": str(WORKSPACE),
        }

    # Turn 1: /council invocation
    lines.append(msg_user("/council should we ship 0.0.3 now?", 0))
    lines.append(
        msg_assistant(
            [
                {
                    "type": "text",
                    "text": (
                        "Framing the council: the question is whether to "
                        "publish 0.0.3 given M5/M6/M7 are in. I'll dispatch "
                        "Codex and Gemini in parallel for blinded opinions."
                    ),
                }
            ],
            {
                "input_tokens": 420,
                "cache_creation_input_tokens": 1_180,
                "cache_read_input_tokens": 0,
                "output_tokens": 85,
            },
            0.0053,
            "claude-opus-4-6",
            2_000,
        )
    )

    # Turn 2: tool_use #1 — codex exec
    lines.append(
        msg_assistant(
            [
                {
                    "type": "tool_use",
                    "id": "toolu_01cx",
                    "name": "Bash",
                    "input": {
                        "command": "codex exec 'review ship 0.0.3 decision'",
                        "description": "Ask Codex for an independent opinion",
                    },
                }
            ],
            {
                "input_tokens": 15,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 1_265,
                "output_tokens": 42,
            },
            0.0014,
            "claude-opus-4-6",
            3_500,
        )
    )
    lines.append(
        {
            "type": "user",
            "timestamp": iso(7_200),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_01cx",
                        "content": (
                            "RECOMMENDATION: No, not this minute. Release "
                            "surface has 0.0.2 version strings in 3 places "
                            "and ? still toggles help in docs. "
                            "30-min fix, then ship.\nCONFIDENCE: Medium.\n"
                        ),
                    }
                ],
            },
            "sessionId": CLAUDE_SESSION_ID,
            "cwd": str(WORKSPACE),
        }
    )

    # Turn 3: tool_use #2 — gemini -p (ran in parallel with codex)
    lines.append(
        msg_assistant(
            [
                {
                    "type": "tool_use",
                    "id": "toolu_02gem",
                    "name": "Bash",
                    "input": {
                        "command": "gemini -p 'review ship 0.0.3 decision'",
                        "description": "Ask Gemini for a strategic read",
                    },
                }
            ],
            {
                "input_tokens": 22,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 1_382,
                "output_tokens": 47,
            },
            0.0017,
            "claude-opus-4-6",
            4_100,
        )
    )
    lines.append(
        {
            "type": "user",
            "timestamp": iso(9_400),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_02gem",
                        "content": (
                            "RECOMMENDATION: YES, SHIP IMMEDIATELY. "
                            "0.0.2 is marked buggy; every day delayed is a "
                            "day users hit known issues. CONFIDENCE: High.\n"
                        ),
                    }
                ],
            },
            "sessionId": CLAUDE_SESSION_ID,
            "cwd": str(WORKSPACE),
        }
    )

    # Turn 4: synthesis
    lines.append(
        msg_assistant(
            [
                {
                    "type": "text",
                    "text": (
                        "Codex found real bugs by code inspection; Gemini "
                        "missed them. Verdict: NO ship in 5 min, YES ship "
                        "today after a ~30 min release-candidate pass. "
                        "Bump every version string, fix the ?/help "
                        "collision, regenerate CHANGELOG, then publish."
                    ),
                },
                {
                    "type": "thinking",
                    "thinking": (
                        "Gemini's argument 'ship now, 0.0.2 is broken' is "
                        "correct in spirit but wrong in tactic for a 0-star "
                        "repo whose pitch is credibility. Codex's specific "
                        "bugs are verifiable facts, not opinions."
                    ),
                },
            ],
            {
                "input_tokens": 18,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 2_810,
                "output_tokens": 212,
            },
            0.0048,
            "claude-opus-4-6",
            11_200,
        )
    )

    # Turn 5: user says "go", assistant runs npm publish
    lines.append(msg_user("alright, ship it", 20_000))
    lines.append(
        msg_assistant(
            [
                {
                    "type": "tool_use",
                    "id": "toolu_03pub",
                    "name": "Bash",
                    "input": {
                        "command": "npm run typecheck && npm run build && npm publish",
                        "description": "Run the publish gate",
                    },
                }
            ],
            {
                "input_tokens": 24,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 3_022,
                "output_tokens": 38,
            },
            0.0011,
            "claude-opus-4-6",
            22_000,
        )
    )
    lines.append(
        {
            "type": "user",
            "timestamp": iso(27_500),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_03pub",
                        "content": "+ @misha_misha/agentwatch@0.0.3\n",
                    }
                ],
            },
            "sessionId": CLAUDE_SESSION_ID,
            "cwd": str(WORKSPACE),
        }
    )
    lines.append(
        msg_assistant(
            [
                {
                    "type": "text",
                    "text": "Published 0.0.3. Tag + GH release next.",
                }
            ],
            {
                "input_tokens": 12,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 3_100,
                "output_tokens": 18,
            },
            0.0008,
            "claude-opus-4-6",
            28_100,
        )
    )

    path = (
        ROOT
        / ".claude"
        / "projects"
        / CLAUDE_PROJECT_DIR
        / f"{CLAUDE_SESSION_ID}.jsonl"
    )
    write_jsonl(path, lines)

    # Also seed a minimal Claude settings.json so the permissions view
    # has something to render.
    claude_settings = {
        "permissions": {
            "allow": ["Bash(git *)", "Read(**)"],
            "deny": ["Bash(rm -rf /**)"],
            "defaultMode": "ask",
        }
    }
    write_json(ROOT / ".claude" / "settings.json", claude_settings)


# ─── Codex ────────────────────────────────────────────────────────────────


def codex_session() -> None:
    session_id = "demo-codex-0001"
    ts = time.gmtime(NOW_MS / 1000)
    rollout_path = (
        ROOT
        / ".codex"
        / "sessions"
        / time.strftime("%Y", ts)
        / time.strftime("%m", ts)
        / time.strftime("%d", ts)
        / f"rollout-{time.strftime('%Y-%m-%dT%H-%M-%S', ts)}-{session_id}.jsonl"
    )

    lines: list[dict] = []
    lines.append(
        {
            "timestamp": iso(0),
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "timestamp": iso(0),
                "cwd": str(WORKSPACE),
                "cli_version": "0.120.0",
                "source": "cli",
                "model_provider": "openai",
                "model": "gpt-5",
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(50),
            "type": "turn_context",
            "payload": {
                "model": "gpt-5",
                "cwd": str(WORKSPACE),
                "approval_policy": "on-request",
                "sandbox_policy": {
                    "type": "workspace-write",
                    "writable_roots": [str(WORKSPACE)],
                    "network_access": False,
                },
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(400),
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "review ship 0.0.3 decision"}],
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(1_600),
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "call_cx1",
                "arguments": json.dumps(
                    {"cmd": "grep -n version package.json", "workdir": str(WORKSPACE)}
                ),
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(1_840),
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call_cx1",
                "output": '3:  "version": "0.0.2",',
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(2_400),
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "call_cx2",
                "arguments": json.dumps(
                    {
                        "cmd": "grep -n '0.0.2' src/mcp/server.ts src/util/otel.ts",
                        "workdir": str(WORKSPACE),
                    }
                ),
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(2_680),
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call_cx2",
                "output": (
                    'src/mcp/server.ts:39:    version: "0.0.2",\n'
                    'src/util/otel.ts:66:        "service.version": "0.0.2",'
                ),
            },
        }
    )
    lines.append(
        {
            "timestamp": iso(3_800),
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": (
                            "Three version strings still say 0.0.2 "
                            "(package.json, mcp server, otel). Fix those "
                            "first. Recommendation: hold 30 min, then ship."
                        ),
                    }
                ],
            },
        }
    )
    # token_count enriches the assistant message above
    lines.append(
        {
            "timestamp": iso(3_900),
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 4_220,
                        "cached_input_tokens": 1_100,
                        "output_tokens": 172,
                        "reasoning_output_tokens": 34,
                        "total_tokens": 4_426,
                    },
                    "last_token_usage": {
                        "input_tokens": 4_220,
                        "cached_input_tokens": 1_100,
                        "output_tokens": 172,
                        "reasoning_output_tokens": 34,
                        "total_tokens": 4_426,
                    },
                    "model_context_window": 258_400,
                },
            },
        }
    )
    write_jsonl(rollout_path, lines)
    # Seed codex config so the permission view renders
    (ROOT / ".codex").mkdir(exist_ok=True)
    (ROOT / ".codex" / "config.toml").write_text(
        '[projects."/tmp/agentwatch-demo/workspace"]\n'
        'trust_level = "trusted"\n'
    )


# ─── Gemini CLI ───────────────────────────────────────────────────────────


def gemini_session() -> None:
    session_id = "demo-gemini-0001"
    project = "workspace"
    path = (
        ROOT
        / ".gemini"
        / "tmp"
        / project
        / "chats"
        / f"session-{time.strftime('%Y-%m-%dT%H-%M', time.gmtime(NOW_MS / 1000))}-{session_id[-8:]}.json"
    )
    doc = {
        "sessionId": session_id,
        "projectHash": "demohash",
        "startTime": iso(0),
        "lastUpdated": iso(5_200),
        "kind": "main",
        "messages": [
            {
                "id": "m1",
                "timestamp": iso(300),
                "type": "user",
                "content": [{"text": "review ship 0.0.3 decision"}],
            },
            {
                "id": "m2",
                "timestamp": iso(1_100),
                "type": "gemini",
                "content": "",
                "thoughts": [],
                "model": "gemini-2.5-pro",
                "tokens": {
                    "input": 1_820,
                    "output": 18,
                    "cached": 0,
                    "thoughts": 64,
                    "tool": 0,
                    "total": 1_902,
                },
                "toolCalls": [
                    {
                        "id": "tc1",
                        "name": "read_file",
                        "args": {"file_path": "CHANGELOG.md"},
                        "result": [
                            {
                                "functionResponse": {
                                    "id": "tc1",
                                    "name": "read_file",
                                    "response": {
                                        "output": "# Changelog\n\n## [Unreleased]\n## [0.0.2] — …",
                                    },
                                }
                            }
                        ],
                    }
                ],
            },
            {
                "id": "m3",
                "timestamp": iso(2_400),
                "type": "gemini",
                "content": (
                    "Ship 0.0.3 immediately. 0.0.2 is flagged buggy. "
                    "Every day delayed is a day users hit known issues."
                ),
                "thoughts": [],
                "model": "gemini-2.5-pro",
                "tokens": {
                    "input": 3_100,
                    "output": 142,
                    "cached": 1_820,
                    "thoughts": 220,
                    "tool": 0,
                    "total": 3_462,
                },
            },
        ],
    }
    write_json(path, doc)
    # settings.json so permission view renders
    write_json(
        ROOT / ".gemini" / "settings.json",
        {
            "security": {"auth": {"selectedType": "oauth"}},
            "selectedModel": "gemini-2.5-pro",
            "tools": {"allow": ["read_file", "write_file"], "block": []},
        },
    )


# ─── OpenClaw ─────────────────────────────────────────────────────────────


def openclaw_session() -> None:
    session_id = "demo-openclaw-0001"
    sub_agent = "research"
    path = (
        ROOT / ".openclaw" / "agents" / sub_agent / "sessions" / f"{session_id}.jsonl"
    )
    lines: list[dict] = [
        {
            "type": "session",
            "version": "1",
            "id": session_id,
            "timestamp": iso(0),
            "cwd": str(WORKSPACE),
        },
        {
            "type": "model_change",
            "id": "mc1",
            "parentId": session_id,
            "timestamp": iso(200),
            "provider": "google",
            "modelId": "gemini-2.5-pro",
        },
        {
            "type": "message",
            "id": "om1",
            "parentId": session_id,
            "timestamp": iso(1_200),
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "[auraqu] research: map competitive positioning for agent observability tools",
                    }
                ],
                "timestamp": iso(1_200),
            },
        },
        {
            "type": "message",
            "id": "om2",
            "parentId": session_id,
            "timestamp": iso(5_800),
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "[auraqu] Competitors: claude-devtools (Electron, "
                            "Claude-only), Claudex (web UI, Claude-only), "
                            "ccflare (proxy). agentwatch wins on multi-agent "
                            "+ OTel + MCP + anomaly."
                        ),
                    }
                ],
                "api": "google",
                "provider": "google",
                "model": "gemini-2.5-pro",
                "usage": {
                    "input": 2_480,
                    "output": 312,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "totalTokens": 2_792,
                    "cost": {
                        "input": 0.0031,
                        "output": 0.00312,
                        "cacheRead": 0,
                        "cacheWrite": 0,
                        "total": 0.00622,
                    },
                },
                "stopReason": "end_turn",
                "timestamp": iso(5_800),
                "responseId": "rsp-1",
            },
        },
        {
            "type": "message",
            "id": "om3",
            "parentId": session_id,
            "timestamp": iso(8_100),
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "toolCall",
                        "id": "ow1",
                        "name": "write",
                        "arguments": {
                            "file": "research/competitive-map.md",
                            "content": "# Competitive map\n\n...",
                        },
                        "thoughtSignature": "demo",
                    }
                ],
                "api": "google",
                "provider": "google",
                "model": "gemini-2.5-pro",
                "usage": {
                    "input": 1_120,
                    "output": 88,
                    "cacheRead": 2_480,
                    "cacheWrite": 0,
                    "totalTokens": 3_688,
                    "cost": {
                        "input": 0.0014,
                        "output": 0.00088,
                        "cacheRead": 0.00077,
                        "cacheWrite": 0,
                        "total": 0.00305,
                    },
                },
                "stopReason": "end_turn",
                "timestamp": iso(8_100),
                "responseId": "rsp-2",
            },
        },
    ]
    write_jsonl(path, lines)
    # minimal roster file so permission view renders
    write_json(
        ROOT / ".openclaw" / "openclaw.json",
        {
            "defaultWorkspace": str(WORKSPACE),
            "agents": {
                "research": {
                    "name": "research",
                    "emoji": "🔬",
                    "model": "gemini-2.5-pro",
                    "workspace": str(WORKSPACE),
                },
                "main": {
                    "name": "main",
                    "emoji": "🤖",
                    "model": "claude-opus-4-6",
                    "workspace": str(WORKSPACE),
                },
            },
        },
    )


# ─── Main ────────────────────────────────────────────────────────────────


def main() -> None:
    reset()
    claude_session()
    codex_session()
    gemini_session()
    openclaw_session()
    print(f"✓ Mock HOME built at {ROOT}")
    print()
    print("Launch agentwatch against it:")
    print(f"  HOME={ROOT} WORKSPACE_ROOT={WORKSPACE} node bin/agentwatch.js")
    print()
    print("Asciinema session:")
    print(f"  asciinema rec docs/demo.cast --cols 110 --rows 34 --idle-time-limit 1.5")
    print(f"  # then inside: HOME={ROOT} WORKSPACE_ROOT={WORKSPACE} \\")
    print(f"    node bin/agentwatch.js")


if __name__ == "__main__":
    main()
