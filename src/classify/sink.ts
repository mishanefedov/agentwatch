import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import { classifyEvent } from "./activity.js";

/** Wraps an EventSink so every emitted event has `details.category`
 *  attached before it propagates further. Idempotent — if a category
 *  is already present we leave it (some upstream might have set a
 *  better one).
 *
 *  Place this BEFORE the store wrapper so the categorization is
 *  persisted alongside the event. */
export function withClassifier(inner: EventSink): EventSink {
  return {
    emit: (event: AgentEvent) => {
      if (!event.details) event.details = {};
      if (!event.details.category) {
        event.details.category = classifyEvent(event);
      }
      inner.emit(event);
    },
    enrich: (eventId: string, patch: Partial<EventDetails>) => {
      inner.enrich(eventId, patch);
    },
  };
}
