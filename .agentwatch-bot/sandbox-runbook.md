# Sandbox Runbook for agentwatch-daily

The `agentwatch-daily` agent runs autonomously and executes commands against this repository. To minimize blast radius, it is meant to run inside a Docker sandbox via OpenClaw's `sandbox.mode`. 

However, the default OpenClaw sandbox image lacks Node.js and the GitHub CLI (`gh`), both of which are required for `agentwatch-daily`'s testing and PR workflow.

## Building the Custom Image

Run this from the repository root to build and tag the custom sandbox image:

```bash
docker build -t agentwatch-sandbox -f .agentwatch-bot/Dockerfile .
```

## Configuring OpenClaw

Update your `~/.openclaw/openclaw.json` (or the specific agent configuration for `agentwatch-daily`) to use this new image and mount the necessary volumes:

```json
{
  "sandbox": {
    "mode": "non-main",
    "image": "agentwatch-sandbox",
    "mounts": [
      {
        "source": "/Users/mishanefedov/IdeaProjects/agentwatch",
        "target": "/workspace",
        "readOnly": false
      },
      {
        "source": "/Users/mishanefedov/.agentwatch-bot",
        "target": "/home/agentwatch/.agentwatch-bot",
        "readOnly": true
      }
    ],
    "env": {
      "GH_TOKEN": "${GH_TOKEN}",
      "LINEAR_API_KEY": "${LINEAR_API_KEY}"
    }
  }
}
```

## Updating

When OpenClaw updates its base sandbox requirements (e.g., needing new system packages), update `.agentwatch-bot/Dockerfile` to include them and run the `docker build` command again.
