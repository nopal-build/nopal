# ADR-030 — The graph is nightly; the Efforts page is printed.

**Status:** Accepted, 2026-10-01. Builds on ADR-016, ADR-024 and ADR-029.

**Context.** Spend per run (PR #82) put a number on each stage. Over the thirty days to 2026-10-01, an ordinary night (one to eighteen new nodes) cost $0.08 to $0.63 to file and $0.48 to $1.89 to rewrite the Efforts page: the page was 60 to 90% of every night that had anything new. About half of each rewrite is loading the prompt (the thread index plus up to 60 nodes, ADR-006), paid again every time because nothing stays cached between nights. A project logging daily would spend $30 to $45 a month, almost all of it on a page nobody asked to see that day. Efforts don't change daily.

**Decision.**
- **The graph builds nightly, on by default.** Every `project-n02` root that already has a graph runs at midnight unless an Admin/Super turned it off (`graphlog_scheduled = false`). A project that never ran does not pay its whole backlog on its first night: it joins after its first run, a seed round or a guide's print. A quiet night makes no model call.
- **The nightly holds the page.** The `"run"` job (the nightly, the Vault's Run, `nopal graphlog run`) builds the graph and runs graph-project-view only to decide: it records `held-for-print` and what is waiting (graph changed, notes, marks) and leaves README.md alone, banner included. `decideEffortsRebuild` is the rule.
- **One exception: another project's name.** If the page names another project, the nightly still rebuilds it to take the name out. That guard cannot wait a week for somebody to press a button (ADR-024's privacy rule; the 2026-09-21 Coronado leak).
- **The page is printed on purpose.** "Print an update" on the Efforts tab enqueues a `"print"` job: the graph, then the page, so a mark made a minute ago is on the page it prints. The tab shows the date it was last printed (`efforts_printed_at`, stamped by graph-project-view on a clean rebuild; for older projects, the last run that wrote the README).
- **A week between prints, except for a guide.** Every group holds `print` (features.ts). A Guide (`people`) and Nopal staff print any time: a seeding round and an urgent correction are what that is for. Everyone else prints once the last print, by anyone, is `PRINT_INTERVAL_DAYS` (7) old. A print that finds nothing new makes no model call, stamps nothing and spends nobody's week. A share from before roles reads the page and never prints.

**Why it looks removable.** A nightly that rebuilds only when something changed already sounds frugal, and it was: unchanged nights cost nothing. The cost is that "something changed" is almost every night on an active project, and a one-line change costs a whole rewrite.

**Limits.** Reader notes and marks no longer reach the page overnight; they wait for a print. A guide who forgets to print leaves a stale page, and the date on it is the only signal. The interval and which groups print are values somebody maintains. The model writing the page (Fable 5.1) is a separate cost question: on the same tokens it costs about 1.6x Opus 5, and Opus 5.5 was never compared; a month of steady use decides it.

**How you'd know.** A nightly run's graph-project-view spend is not zero on a page that names no other project; README.md's `updated_at` moves on a night nobody printed; a Client prints twice in a week; a guide's print leaves a mark made before it off the page; the date on the tab doesn't move after a print that rewrote the page.

**Test.** `webapp/app/tests/graphlog/print.test.ts` (`printAllowance`, `isNightly`, `decideEffortsRebuild`), `features.test.ts`, and the run page's Efforts line on a held night.
