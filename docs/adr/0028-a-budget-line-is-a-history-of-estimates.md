# ADR-028 — A budget line is a history of estimates, and it is the guides'.

**Status:** Accepted, 2026-09-29. Builds on ADR-020 and ADR-024.

**Context.** Campbell's first build estimate (2026-04-22) is a Notion table: 17 lines, each an estimate and a confidence from 0.3 to 0.9, with low and high worked out from the two. Where it is headed (Austin): consistent line items, an estimate and a confidence for each, and a slider back through time to see whether a number moved because we were wrong or because the scope changed. The slider is later; what this round owes it is that every change to a line is kept with its date, starting from the April numbers dated 4/22.

**Decision.**
- **One table, append-only.** `budget_changes` holds a row per line per change: `kind: start` for the first values, dated the estimate's own day, and `kind: change` after, each with the author and the day. A line's current value is its latest row; its history is all of them; nothing is rewritten (`budget.server.ts`).
- **Low and high are arithmetic, by code.** Low is the estimate times the confidence, high the estimate times two minus the confidence: HVAC at $75,000 and 0.8 runs $60,000 to $90,000. Totals sum each column. The screen computes the same numbers from what is typed before anything is saved, so it behaves like the sheet (`budgetLines.ts`).
- **The line names are a shared list, in code.** Seventeen names, the 4/22 table's, keyed by slug. The first budget copies that table once, pasted into the start form and matched to the list by name; an unknown name is refused and named, never invented. Adding, renaming and removing lines have no screen yet; the next project's lines get fitted to the list when it arrives.
- **Only the `budget` feature reads or writes it.** On the Guide row (ADR-024); admins through their group like any view. The Budget is a view under Costs (`?tab=costs&view=budget`), not a tab, refused by the page loader without the feature and by `/api/budget` with a 404 for anyone off the project and a 403 for a member without it. Clients are already off Costs. A project shows the link only once a budget has been started on it.
- **Estimates are not costs.** `confirmedCosts` (ADR-020) is unread and untouched; a receipt confirmed in Costs does not move a budget line, and an estimate document filed in Costs is a file, not a budget. A real number arriving updates a line by hand, for now.
- **Nothing else touches it.** A seed wipe (ADR-027) deletes vault files and graph days; the Budget lives in its own table and never on a page the pipeline writes.

**Why it looks removable.** A budget could be the 4/22 document filed in Costs, read by eye. The document holds the April numbers only, and a change to it is an edit, not a history; the slider would have nothing to slide through.

**Limits.** No actuals against the lines; no slider; no line management; confidence is any number from 0 to 1 and the sheet's values are a starting point, not a scale. The start form is a paste, once.

**How you'd know.** A Crafter, Observer or Client reaches the view or the API; a change overwrites a row instead of adding one; low and high disagree with the arithmetic above; a project with no rows shows the link; a seed wipe or a cost confirmation changes a line.

**Test.** `webapp/app/tests/graphlog/budget.test.ts`, `features.test.ts`, and `fruits/scripts/campbell-walk.ts` (the Budget section) against a running stack.
