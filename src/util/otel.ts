import type { AgentEvent } from "../schema.js";

/**
 * Optional OTel exporter. Enabled when AGENTWATCH_OTLP_ENDPOINT is set
 * (e.g. http://localhost:4318/v1/traces). Emits one span per AgentEvent
 * with agentwatch-specific semantic conventions:
 *
 *   agentwatch.agent       = claude-code|codex|cursor|gemini|openclaw
 *   agentwatch.session.id
 *   agentwatch.event.type  = tool_call|file_write|shell_exec|...
 *   agentwatch.tool.name   (when present)
 *   agentwatch.risk_score  0-10
 *   agentwatch.cost_usd    (assistant turns)
 *   agentwatch.cache_hit_ratio (if usage)
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
        "service.version": "0.0.2",
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

/** Emit a span for a single AgentEvent. No-op when OTel isn't initialized. */
export function emitEventSpan(event: AgentEvent): void {
  if (!tracer) return;
  const attrs: Record<string, string | number | boolean> = {
    "agentwatch.agent": event.agent,
    "agentwatch.event.type": event.type,
    "agentwatch.risk_score": event.riskScore,
  };
  if (event.sessionId) attrs["agentwatch.session.id"] = event.sessionId;
  if (event.tool) attrs["agentwatch.tool.name"] = event.tool;
  if (event.path) attrs["agentwatch.path"] = event.path;
  if (event.cmd) attrs["agentwatch.cmd"] = event.cmd.slice(0, 500);
  const d = event.details;
  if (d?.cost != null) attrs["agentwatch.cost_usd"] = d.cost;
  if (d?.model) attrs["agentwatch.model"] = d.model;
  if (d?.durationMs != null) attrs["agentwatch.duration_ms"] = d.durationMs;
  if (d?.toolError) attrs["agentwatch.tool_error"] = true;
  if (d?.usage) {
    const total = d.usage.input + d.usage.cacheRead + d.usage.cacheCreate;
    attrs["agentwatch.tokens.input"] = d.usage.input;
    attrs["agentwatch.tokens.cache_read"] = d.usage.cacheRead;
    attrs["agentwatch.tokens.cache_create"] = d.usage.cacheCreate;
    attrs["agentwatch.tokens.output"] = d.usage.output;
    if (total > 0) {
      attrs["agentwatch.cache_hit_ratio"] = d.usage.cacheRead / total;
    }
  }
  const startMs = new Date(event.ts).getTime();
  const span = tracer.startSpan(`${event.agent}.${event.type}`, attrs);
  const endMs =
    d?.durationMs != null ? startMs + d.durationMs : startMs + 1;
  span.end(endMs);
}
