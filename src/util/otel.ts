import type { AgentEvent } from "../schema.js";
import { contextWindow } from "./compaction.js";

/**
 * Optional OTel exporter. Enabled when AGENTWATCH_OTLP_ENDPOINT is set
 * (e.g. http://localhost:4318/v1/traces). Emits one span per AgentEvent
 * with OpenTelemetry GenAI semantic conventions
 * (https://opentelemetry.io/docs/specs/semconv/gen-ai/), so any OTel
 * consumer (Jaeger, Tempo, Honeycomb, Grafana) can interpret the data
 * without custom dashboards.
 *
 * Conventions emitted:
 *   gen_ai.system               anthropic | openai | google | …
 *   gen_ai.operation.name       chat | tool_use | file_op | …
 *   gen_ai.request.model        claude-3-5-sonnet-…
 *   gen_ai.usage.input_tokens
 *   gen_ai.usage.output_tokens
 *   gen_ai.tool.name            (tool_use operations)
 *   gen_ai.tool.call.id
 *   error.type                  on tool errors
 *
 * Plus a small agentwatch extension namespace for things GenAI semconv
 * doesn't cover yet:
 *   agentwatch.session.id
 *   agentwatch.cost_usd
 *   agentwatch.cache_read_tokens
 *   agentwatch.cache_create_tokens
 *   agentwatch.cache_hit_ratio
 *   agentwatch.context.fill_pct
 *   agentwatch.risk_score
 *
 * If the env var is not set, every function here is a no-op — no OTel
 * dependencies are imported, no bundle overhead at runtime.
 */

let initialized = false;
let tracer:
  | {
      startSpan: (
        name: string,
        attrs: Record<string, string | number | boolean>,
      ) => { end: (endMs?: number) => void };
    }
  | null = null;

export function otelEnabled(): boolean {
  return Boolean(process.env.AGENTWATCH_OTLP_ENDPOINT);
}

export async function initOtel(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const endpoint = process.env.AGENTWATCH_OTLP_ENDPOINT;
  if (!endpoint) return;
  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { resourceFromAttributes }, otelApi] =
      await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/api"),
      ]);
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": "agentwatch",
        "service.version": "0.0.3",
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
    });
    sdk.start();
    const apiTracer = otelApi.trace.getTracer("agentwatch");
    tracer = {
      startSpan: (name, attrs) => {
        const span = apiTracer.startSpan(name, { attributes: attrs });
        return {
          end: (endMs?: number) => {
            if (endMs != null) span.end(new Date(endMs));
            else span.end();
          },
        };
      },
    };
    const shutdown = () => void sdk.shutdown();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("beforeExit", shutdown);
  } catch (err) {
    process.stderr.write(`[agentwatch/otel] init failed: ${String(err)}\n`);
    tracer = null;
  }
}

/** Map an agentwatch agent name to a gen_ai.system value. */
export function systemOf(agent: string): string {
  switch (agent) {
    case "claude-code":
      return "anthropic";
    case "codex":
    case "aider":
      return "openai";
    case "gemini":
      return "google";
    case "cursor":
      return "cursor";
    default:
      return agent;
  }
}

/** Map an AgentEvent type to a gen_ai.operation.name value. */
export function operationOf(event: AgentEvent): string {
  switch (event.type) {
    case "prompt":
    case "response":
      return "chat";
    case "tool_call":
    case "shell_exec":
    case "file_read":
    case "file_write":
    case "file_change":
      return "tool_use";
    case "compaction":
      return "context_compaction";
    case "session_start":
    case "session_end":
      return event.type;
    default:
      return event.type;
  }
}

/** Emit a span for a single AgentEvent. No-op when OTel isn't initialized. */
export function emitEventSpan(event: AgentEvent): void {
  if (!tracer) return;
  const attrs: Record<string, string | number | boolean> = {
    "gen_ai.system": systemOf(event.agent),
    "gen_ai.operation.name": operationOf(event),
    "agentwatch.risk_score": event.riskScore,
  };
  if (event.sessionId) attrs["agentwatch.session.id"] = event.sessionId;
  if (event.tool) attrs["gen_ai.tool.name"] = event.tool;
  if (event.path) attrs["agentwatch.path"] = event.path;
  if (event.cmd) attrs["agentwatch.cmd"] = event.cmd.slice(0, 500);

  const d = event.details;
  if (d?.model) {
    attrs["gen_ai.request.model"] = d.model;
    attrs["gen_ai.response.model"] = d.model;
  }
  if (d?.toolUseId) attrs["gen_ai.tool.call.id"] = d.toolUseId;
  if (d?.cost != null) attrs["agentwatch.cost_usd"] = d.cost;
  if (d?.durationMs != null) attrs["agentwatch.duration_ms"] = d.durationMs;
  if (d?.toolError) {
    attrs["error.type"] = "tool_error";
  }
  if (d?.usage) {
    const u = d.usage;
    attrs["gen_ai.usage.input_tokens"] = u.input;
    attrs["gen_ai.usage.output_tokens"] = u.output;
    attrs["agentwatch.cache_read_tokens"] = u.cacheRead;
    attrs["agentwatch.cache_create_tokens"] = u.cacheCreate;
    const totalIn = u.input + u.cacheRead + u.cacheCreate;
    if (totalIn > 0) {
      attrs["agentwatch.cache_hit_ratio"] = u.cacheRead / totalIn;
      attrs["agentwatch.context.fill_pct"] = Math.min(
        1,
        totalIn / contextWindow(),
      );
    }
  }

  const startMs = new Date(event.ts).getTime();
  const spanName = d?.model
    ? `${operationOf(event)} ${d.model}`
    : `${operationOf(event)} ${event.agent}`;
  const span = tracer.startSpan(spanName, attrs);
  const endMs =
    d?.durationMs != null ? startMs + d.durationMs : startMs + 1;
  span.end(endMs);
}
