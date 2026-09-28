# ADR-025 — Observers suggest and Guides decide; a website is not a GraphLog project.

**Status:** Accepted, 2026-09-28. Builds on ADR-024.

**Context.** Observers read a project and had no way to add to it without their words going straight into the graph and the Efforts page. Website folders (`folder_type: "website"`) sat under the projects root beside GraphLog projects, so every list, the daily log and the GraphLog routes treated them as projects.

**Decision.**
- Two features on the list: `feeds` (what you write goes in as written: Guide, Crafter, Client) and `suggestions` (take or pass what others suggest: Guide). Observer gets `dailyLog` and `marks` but not `feeds`.
- What someone without `feeds` writes is a suggestion (`suggestions.server.ts`). A Card is marked `suggestion` when made or saved by them, and feeds the project only its `taken_content`: the words a Guide last took. Words written after a take or a pass wait again. A note carries `suggestion: pending | taken | passed`; every read that reaches the page run, the margin, the files view or the syncs goes through `FEEDS` and leaves out anything not taken.
- A Guide takes or passes from the Suggestions tab. Taken, it goes in as written, credited to its writer, with the Guide recorded (`decided_by`). Before that, only the writer and Guides see it (the tab, and the margin labelled as a suggestion).
- A website (`isWebsiteFolder`) is not on My Projects, the nav, the daily log's Cards or move targets; takes no Card, runs no GraphLog, and gets no syncs or graph folder; its project page redirects to the Vault. It stays on `/maker/humans` so people can be given access.
- A Card's attachment opens for the project the moment it's posted (`attachedReach` in `featureAccess.server.ts`), before a sync copies it in, for anyone whose group reaches that row.

**Why it looks removable.** `taken_content` next to `content` looks like duplication; it is what keeps "as written" true when an Observer keeps typing after a take.

**Limits.** A person changed to Observer keeps what their Card fed so far (it counts as taken). A suggestion is decided by a person; nothing proposes which to take.

**How you'd know.** An Observer's words appear in the Logbook, Files, the syncs or the Efforts page before a Guide takes them; a Crafter or Client sees a pending suggestion; a website shows on My Projects or grows a Syncs folder.

**Test.** `webapp/app/tests/graphlog/suggestions.test.ts`, `features.test.ts`, and `fruits/scripts/campbell-walk.ts` (an Observer's Card taken and note passed) against a running stack.
