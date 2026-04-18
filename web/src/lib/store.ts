import { create } from "zustand";
import { useEffect } from "react";
import { api, subscribeEvents } from "./api";
import type { AgentEvent } from "./types";

interface EventStore {
  events: AgentEvent[]; // newest-first
  initialized: boolean;
  setInitial: (events: AgentEvent[]) => void;
  push: (event: AgentEvent) => void;
}

const MAX = 2000;

export const useEventStore = create<EventStore>((set) => ({
  events: [],
  initialized: false,
  setInitial: (events) => set({ events, initialized: true }),
  push: (event) =>
    set((state) => {
      // Dedupe on id — we can receive an event twice if the initial fetch
      // races with the SSE stream.
      if (state.events.find((e) => e.id === event.id)) return {};
      const next = [event, ...state.events];
      if (next.length > MAX) next.length = MAX;
      return { events: next };
    }),
}));

/** Hook: on mount fetches initial events + subscribes to SSE stream.
 *  Safe to call from multiple components — the store is a singleton and
 *  SSE subscription count is tracked via React effect refcounting. */
let sseRefCount = 0;
let sseUnsubscribe: (() => void) | null = null;

export function useLiveEvents(): void {
  const { initialized, setInitial, push } = useEventStore();

  useEffect(() => {
    if (!initialized) {
      api
        .events({ limit: 1000 })
        .then((r) => setInitial(r.events))
        .catch(() => setInitial([]));
    }
    sseRefCount += 1;
    if (!sseUnsubscribe) {
      sseUnsubscribe = subscribeEvents((e) => push(e));
    }
    return () => {
      sseRefCount -= 1;
      if (sseRefCount <= 0 && sseUnsubscribe) {
        sseUnsubscribe();
        sseUnsubscribe = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
