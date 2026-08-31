# ADR-011 — A budget bounds how late the derived layer runs, never what is kept.

**Status:** Accepted, 2026-08-27

**Context.** Processing cost scales with content, and a first import or an unusually busy day can run far past any monthly allowance. Something has to bound it. The obvious bound, stopping when the money runs out, would discard writing, and the current `sync-graph` ceiling already does exactly that by throwing away any day past roughly twenty-nine nodes.

The thing that makes this tractable: sync writes a person's content into the vault before any model runs. The graph, the structure file and every view are derived. Nothing that has been written is at risk from a spending limit; only the currency of the derived layer is.

**Decision.** A budget limits how far behind the graph may fall, and never what is kept. A run spends to its budget, records where it stopped, and the next run resumes there. The distance behind is always visible to the person: the project says which date the graph is current through and how much is pending. Backfill is its own lane with its own pacing, never sharing a budget with the daily cadence.

**Why it looks removable.** Discarding is simpler than resuming, and a partial write feels dirtier than no write. Showing a backlog feels like admitting a fault, so it gets quietly dropped from the UI.

**How you'd know.** Either somebody's busy week never appears in their graph and the run report calls it a retryable error, or the graph silently runs weeks behind and the first anyone hears of it is a complaint that the README is stale.

**Test.** A run interrupted by budget writes everything it captured before stopping, and its recorded stopping point is enough for the next run to resume without reprocessing what already landed.
