# ADR-003 — Rank by distinct people before raw link count.

**Status:** Accepted, 2026-08-20

**Context.** Two people arriving at the same thing in different words is the strongest signal this system can produce, and the only one that justifies a multi-person tool over a private journal. One person circling their own idea produces an identical link count.

**Decision.** Ordering uses the union of distinct linking authors first, then total count, then span. `fromAuthors` already exists on `BacklinkInfo`.

**Why it looks removable.** A union is slower than a sum, and the two usually agree, so replacing it looks like an optimization with no behavior change.

**How you'd know.** Convergence stops appearing in outputs. Whoever writes most wins every ranking.

**Test.** Given three links from one author and two links from two authors, the two-author thread ranks higher.
