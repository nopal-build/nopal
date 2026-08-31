# ADR-014 — The three judged fields live on the `Weight:` line. The line is never optional.

**Status:** Accepted, 2026-08-28

**Context.** `graph-structure` asks the model for one line per thread holding four things: `Weight:`, `Status:`, `Due:` and `Blocking:`. Only the first is computed. The other three are the whole of that stage's judgment, and everything downstream ranks on them.

`Weight:` is recomputed from live backlink data after every run regardless of what the model wrote, so the skill tells it to write `Weight: (recomputed)` and spend nothing there. That reads like a pure waste: output tokens spent on a value guaranteed to be discarded, and removing the instruction looks like an obvious cleanup.

It is not a waste, because `parseClusterFields` finds the line with `/^Weight:/i` and then reads Status, Due and Blocking off *that same line*. A cluster with no `Weight:` line has no status, no deadline and no blocking claim as far as any consumer can tell, whatever the model wrote elsewhere in the thread. `hasFallenAway` reads the same parse, so such a thread also cannot fall away, and `rankCluster` sorts it as though it carried nothing.

The coupling is invisible from either side. The skill's instruction says nothing about Status. The parser's name says nothing about Weight being load-bearing for anything but weight.

**Decision.** The `Weight:` line is the carrier for a thread's three judged fields, not a display of its weight. The model always writes it, and the skill says why rather than only that. Where a cluster is missing one, code writes it in rather than skipping the cluster, so a thread can never silently lose its judgment because of a formatting slip.

Anything the model is told to write onto that line other than the four fields will be destroyed: `refreshClusterWeight` preserves only the `· Status:` suffix and replaces everything before it. Instructions that want durable per-thread annotation put it on a node's own gloss instead.

**Why it looks removable.** Deleting an instruction whose output is unconditionally overwritten is the most obviously safe cleanup available in that skill file, and it saves real tokens on every `update_cluster` call on every run. Nothing at the deletion site mentions Status.

**How you'd know.** Threads begin reporting no status rather than a wrong one, so `summarizeClusterFields`'s per-run counter reads `active 0, dormant 0, settled 0, superseded 0` while the file plainly contains threads. Downstream, nothing falls away and ranking flattens, both of which look like a quiet graph rather than a parse failure.

**Test.** A cluster whose content lacks a `Weight:` line still ends a run with one, and its Status, Due and Blocking parse. A cluster that has one keeps its `· Status:` text verbatim while its numbers are replaced.
