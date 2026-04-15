import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../schema.js";

/**
 * Per-session and per-day cost ceilings. Spec lives in
 * ~/.agentwatch/budgets.json:
 *
 *   { "perSessionUsd": 5, "perDayUsd": 20 }
 *
 * When crossed, the header shows a red banner and the notifier fires
 * once per crossing. We never kill agents — just shout.
 */

export interface Budgets {
  perSessionUsd?: number;
  perDayUsd?: number;
}

export const BUDGETS_PATH = path.join(os.homedir(), ".agentwatch", "budgets.json");

let cached: Budgets | null = null;

export function loadBudgets(): Budgets {
  if (cached !== null) return cached;
  try {
    const raw = fs.readFileSync(BUDGETS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cached = {
      perSessionUsd:
        typeof parsed.perSessionUsd === "number" ? parsed.perSessionUsd : undefined,
      perDayUsd:
        typeof parsed.perDayUsd === "number" ? parsed.perDayUsd : undefined,
    };
  } catch {
    cached = {};
  }
  return cached;
}

export function _resetBudgetsCache(): void {
  cached = null;
}

export interface BudgetStatus {
  sessionCost: number;
  dayCost: number;
  perSessionUsd?: number;
  perDayUsd?: number;
  /** Highest session id breaching its cap. */
  breachedSession?: string;
  dayBreach: boolean;
}

/** Compute per-session and per-day aggregate costs across the event
 *  buffer and flag the first breaching session (if any). */
export function computeBudgetStatus(
  events: AgentEvent[],
  budgets: Budgets = loadBudgets(),
  now: Date = new Date(),
): BudgetStatus {
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  let dayCost = 0;
  let maxSession = { id: "", cost: 0 };
  const perSession = new Map<string, number>();

  for (const e of events) {
    const c = e.details?.cost ?? 0;
    if (c <= 0) continue;
    const sid = e.sessionId ?? "";
    const sCost = (perSession.get(sid) ?? 0) + c;
    perSession.set(sid, sCost);
    if (sCost > maxSession.cost) maxSession = { id: sid, cost: sCost };
    const t = new Date(e.ts).getTime();
    if (t >= todayMs) dayCost += c;
  }

  const status: BudgetStatus = {
    sessionCost: maxSession.cost,
    dayCost,
    perSessionUsd: budgets.perSessionUsd,
    perDayUsd: budgets.perDayUsd,
    dayBreach:
      budgets.perDayUsd != null && dayCost > budgets.perDayUsd,
  };
  if (
    budgets.perSessionUsd != null &&
    maxSession.cost > budgets.perSessionUsd
  ) {
    status.breachedSession = maxSession.id || "(unknown)";
  }
  return status;
}
