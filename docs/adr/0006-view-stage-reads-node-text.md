# ADR-006 — The view stage reads node text, not only glosses.

**Status:** Accepted, 2026-08-20

**Context.** The first production run produced a 4,473-character README with zero citations, zero highlights and four quotation marks. Not a prompt failure: the stage was handed only `graph-structure.md`, which contains twelve-word glosses, so there was nothing to quote. The architecture guaranteed a summary of a summary.

**Decision.** The view is handed full node text for the threads at the top of the ordering, bounded by node count rather than thread count, and has `get_node` for anything else. Both, deliberately: pre-fetch is a floor nobody can forget, the tool is the ceiling.

**Why it looks removable.** Sending node text costs tokens, and the index alone looks sufficient because the output still reads fine.

**How you'd know.** Citation count in the README drops toward zero while the prose stays fluent.

**Test.** A README run produces at least one citation per featured thread.
