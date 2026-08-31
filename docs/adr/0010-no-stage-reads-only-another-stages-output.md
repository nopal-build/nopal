# ADR-010 — No stage may read only another stage's output.

**Status:** Accepted, 2026-08-27

**Context.** The first production README was 4,473 characters with zero citations, because `graph-project-view` was handed only `graph-structure.md`, which holds twelve-word glosses. The architecture guaranteed a summary of a summary, and nobody caught it by reading the skill, because the skill was fine. It was the wiring.

Reading prose to detect this does not work. The output of a summary of a summary reads well. That is the whole problem with it.

**Decision.** Every stage that produces human-facing output must take at least one input that traces to a person's own words: node text, a human caption, or a reader comment. A stage whose only input is another stage's output is forbidden. If one is ever genuinely wanted, it is written down as a deliberate exception with a reason, never arrived at by accident.

This binds on every view added later. The newspaper and the workshop read from the graph for exactly this reason, not from the README.

**Why it looks removable.** Passing the index alone is cheaper, simpler, and the output still reads fine. That is precisely how this happened the first time.

**How you'd know.** Citation count falls toward zero while the prose stays fluent. Nobody can trace a claim back to a person. By the time a human notices, months of output are affected.

**Test.** Checkable at the wiring, not by reading. For each stage that writes human-facing output, assert its prompt builder receives node text or human-authored source. `graph-project-view`'s pre-fetch plus `get_node` satisfies this; a future view that takes only `graph-structure.md` fails it at construction.
