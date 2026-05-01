export {
  openStore,
  DEFAULT_DB_PATH,
  type EventStore,
  type SessionSummary,
  type ProjectSummary,
  type FtsHit,
  type ListSessionsOptions,
  type PruneResult,
  type StoreStats,
} from "./sqlite.js";
export { wrapSinkWithStore } from "./wire.js";
