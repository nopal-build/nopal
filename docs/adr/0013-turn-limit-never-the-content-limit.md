# ADR-013 — The runaway-loop guard must never be the content limit.

**Status:** Accepted, 2026-08-27

**Context.** `MAX_TURNS` exists to stop an agent loop that never terminates. That is a genuine hazard and every stage should have one. In `sync-graph` it became something else: with one node added per turn, the loop guard and the number of nodes a day could hold became the same number, so a safety rail silently turned into a data ceiling at about twenty-nine nodes, and exceeding it discarded the day.

**Decision.** A turn limit bounds a bounded unit of work: one pass, one batch. It never bounds how much content a day, a project, or an import may contain. Where content can exceed a unit, the unit repeats and commits as it goes, the way `graph-structure`'s batching already does. Raising the limit is not a fix, it relocates the cliff.

**Why it looks removable.** The coupling is invisible: nothing in the code says "this number also caps node count," and raising a constant looks like the whole fix.

**How you'd know.** An error that recurs on the same day every run and never clears, described in the log as retryable.

**Test.** A day whose node count exceeds any single pass's turn limit still ends with every node written.
