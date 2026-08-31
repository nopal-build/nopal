# Architecture Decision Records

This directory holds Nopal's ADRs: short, permanent records of decisions
that look like tuning parameters or inefficiencies to a future reader —
human or AI agent — but are actually brakes on a real feedback loop.
Removing one is silent: nothing errors, the system just slowly stops doing
the thing it was built to do.

They're public and versioned with the rest of the repo on purpose. Hiding
the reasoning from contributors (human or agent) would recreate the exact
blind spot these records exist to close — someone making an "obviously
fine" cleanup because they can't see why it isn't. Code that depends on one
of these decisions points at it directly, without restating the reasoning
inline:

```rust
// brake, not a default — see ADR-002
```

## Format

Each ADR is short and follows the same five parts:

- **Status** — Proposed / Accepted / Superseded (with a pointer to the one
  that replaced it).
- **Context** — the pressure that produced the decision.
- **Decision** — what was decided, stated as a rule, not a suggestion.
- **Why it looks removable** — the reasonable-sounding argument for undoing
  it. This is the part aimed squarely at a future refactor, human or agent.
- **How you'd know** — what the slow, silent failure looks like in
  practice, since nothing errors.
- **Test** — a concrete, checkable assertion that the decision still holds.

New ADRs are numbered `NNNN-slug.md`, sequential, never renumbered.
Superseding a decision means writing a new ADR and marking the old one's
status `Superseded by ADR-0NN`, not editing or deleting it — the record is
append-only, same as the graph it protects.

## Index

| ADR | Decision |
| --- | --- |
| [0001](0001-nodes-are-permanent-and-verbatim.md) | Nodes are permanent and verbatim. Every view is disposable. |
| [0002](0002-three-link-cap-per-node.md) | A node may link to at most three others. |
| [0003](0003-rank-by-distinct-authors.md) | Rank by distinct people before raw link count. |
| [0004](0004-quiet-threads-stay-in-candidate-list.md) | Quiet threads stay in the link-candidate list. |
| [0005](0005-citations-and-counts-are-computed.md) | Citations and counts are computed. The model never writes them. |
| [0006](0006-view-stage-reads-node-text.md) | The view stage reads node text, not only glosses. |
| [0007](0007-blocking-names-a-consequence.md) | `Blocking` names a consequence. It is never a rating. |
| [0008](0008-structure-order-serves-downstream-stages.md) | The structure file's order serves the next stages, not a human reader. |
| [0009](0009-silence-drops-project-not-personal.md) | Silence drops a project thread. Only speech closes a personal claim. |
| [0010](0010-no-stage-reads-only-another-stages-output.md) | No stage may read only another stage's output. |
| [0011](0011-budget-bounds-lateness-never-what-is-kept.md) | A budget bounds how late the derived layer runs, never what is kept. |
| [0012](0012-highlight-means-a-person-wrote-this.md) | `==` means a person wrote this. Code decides it, not the model. |
| [0013](0013-turn-limit-never-the-content-limit.md) | The runaway-loop guard must never be the content limit. |
| [0014](0014-status-lives-on-the-weight-line.md) | The three judged fields live on the `Weight:` line. The line is never optional. |

All fourteen so far are GraphLog decisions (`graphlog` skill); this
directory isn't GraphLog-specific and future ADRs from other parts of
Nopal belong here too, continuing the same numbering.
