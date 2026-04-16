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
 *   agentwatch.callee            (set on parent agent_call spans)
 *
 * Trace structure (AUR-202):
 *   When a Claude Bash event invokes another agent (`details.agentCall`),
 *   the resulting span id is captured. When the spawned child session's
 *   first event lands (`details.parentSpawnId === <bash event id>`), we
 *   look up the parent OTel span and use the JS API's context.with()
 *   to make subsequent child events nested under it. The result in
 *   Jaeger / Tempo: a single trace with Claude as root and Codex /
 *   Gemini as child spans, just like distributed-tracing for
 *   microservices.
 */

let initialized = false;

interface SpanHandle {
  end: (endMs?: number) => void;
}

interface SpanContext {
  /** Opaque OTel span object — kept here so we can re-use it as a
   *  parent for downstream agent events. Type-erased to avoid leaking
   *  OTel types into the no-op codepath. */
  span: unknown;
  /** Parent context object (also OTel-internal). */
  ctx: unknown;
}

interface OtelImpl {
  startSpan: (
    name: string,
    attrs: Record<string, string | number | boolean>,
    parent?: SpanContext,
  ) => { handle: SpanHandle; context: SpanContext };
  attachToActive: (ctx: SpanContext, fn: () => void) => void;
}

let impl: OtelImpl | null = null;

/** AUR-202: parent-event-id → captured SpanContext, so child events
 *  whose `details.parentSpawnId` references this id can become real
 *  OTel children. Bounded to prevent leaks on long sessions. */
const parentSpansById = new Map<string, SpanContext>();
/** Session id → SpanContext to inherit. Set when we attach a span via
 *  parentSpawnId so subsequent events from the same child session
 *  also inherit the parent context (not just the very first one). */
const sessionParentSpan = new Map<string, SpanContext>();
const MAX_PARENT_SPANS = 1000;

function rememberParent(eventId: string, ctx: SpanContext): void {
  parentSpansById.set(eventId, ctx);
  if (parentSpansById.size > MAX_PARENT_SPANS) {
    const oldest = parentSpansById.keys().next().value;
    if (oldest !== undefined) parentSpansById.delete(oldest);
  }
}

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
    impl = {
      startSpan: (name, attrs, parent) => {
        // If we have a parent context, start the span inside it so the
        // OTel SDK records the parent_span_id automatically.
        const parentCtx = parent
          ? otelApi.trace.setSpan(otelApi.context.active(), parent.span as never)
          : otelApi.context.active();
        const span = apiTracer.startSpan(
          name,
          { attributes: attrs },
          parentCtx,
        );
        const ctx = otelApi.trace.setSpan(parentCtx, span);
        return {
          handle: {
            end: (endMs?: number) => {
              if (endMs != null) span.end(new Date(endMs));
              else span.end();
            },
          },
          context: { span, ctx },
        };
      },
      attachToActive: (_ctx, fn) => {
        // Reserved for a future API. We attach via parent argument for
        // now, but this hook lets callers run a synchronous block in
        // the parent's active context if we ever need to (e.g. wrap
        // multiple child spans in a single attach scope).
        fn();
      },
    };
    const shutdown = () => void sdk.shutdown();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("beforeExit", shutdown);
  } catch (err) {
    process.stderr.write(`[agentwatch/otel] init failed: ${String(err)}\n`);
    impl = null;
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
  if (!impl) return;
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
  if (d?.agentCall) {
    attrs["agentwatch.callee"] = d.agentCall.callee;
    if (d.agentCall.kind) attrs["agentwatch.call.kind"] = d.agentCall.kind;
  }

  // AUR-202: figure out which (if any) parent OTel span this event
  // should nest under.
  let parent: SpanContext | undefined;
  if (d?.parentSpawnId) {
    const explicit = parentSpansById.get(d.parentSpawnId);
    if (explicit) {
      parent = explicit;
      if (event.sessionId) sessionParentSpan.set(event.sessionId, explicit);
    }
  }
  if (!parent && event.sessionId) {
    const inherited = sessionParentSpan.get(event.sessionId);
    if (inherited) parent = inherited;
  }

  const startMs = new Date(event.ts).getTime();
  const spanName = d?.model
    ? `${operationOf(event)} ${d.model}`
    : `${operationOf(event)} ${event.agent}`;
  const { handle, context } = impl.startSpan(spanName, attrs, parent);
  const endMs =
    d?.durationMs != null ? startMs + d.durationMs : startMs + 1;
  handle.end(endMs);

  // If this event is itself an agent_call (the parent side), remember
  // its span so a later child can attach under it.
  if (d?.agentCall) {
    rememberParent(event.id, context);
  }
}

/** Test helper — wipes parent-span memory between runs. */
export function _resetOtelLinkage(): void {
  parentSpansById.clear();
  sessionParentSpan.clear();
}
