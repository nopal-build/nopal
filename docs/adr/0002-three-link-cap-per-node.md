# ADR-002 — A node may link to at most three others.

**Status:** Accepted, 2026-08-20

**Context.** Links create weight, weight creates visibility, visibility creates writing, and writing creates links. Without a ceiling that loop has no damping, and whatever gets mentioned accumulates faster the more it accumulates.

**Decision.** Three links per node, hard. Extra links are dropped and reported.

**Why it looks removable.** `3` reads as a tuning parameter. Raising it looks like richer connections at no cost.

**How you'd know.** Months later. The top of every project's index stops changing, early threads dominate permanently, and new work never surfaces.

**Test.** No node ends up with four links. Name the constant for what it damps, not what it counts.
