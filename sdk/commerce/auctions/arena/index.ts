/**
 * The arena 1440-series **pure parse** — the seed of `notes/PLAN-modularization-migration.md`
 * §4 B1: the 1440-create decode and the chain's 1449/1450 state half, placed in
 * `sdk/commerce/auctions/arena/` so the web read and the ContextVM live-activity
 * worker share one parse instead of each re-implementing it (`sdk/AGENTS.md`,
 * "Place a module by what it _is_"). No transport, no React, no relay.
 */
export * from './arenaCreate'
export * from './arenaLotState'
