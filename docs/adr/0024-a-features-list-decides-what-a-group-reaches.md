# ADR-024 — A features list decides what each group reaches, and the server reads it.

**Status:** Accepted, 2026-09-25. Builds on ADR-023.

**Context.** ADR-023 made a client safe by leaving them out of `shared_with`, so they reached nothing on a project. Clients now need Efforts and Photos on their own project, on purpose. Adding an exception per page would repeat the seat (ADR-022): a label the screen read that the server didn't. Owner and Crafter were decided by a role name and an `is_owner` flag in the `sharing_roles` table.

**Decision.**
- Four groups on each membership: Guide, Crafter, Observer, Client (`packages/robustness-core/src/data/features.ts`). Owner folded into Guide: a README that says Owner reads as Guide (the parser, not a migration) and is written as Guide on its next save.
- One list, `GROUP_FEATURES`, says what each group gets. `getProjectRole` hands out the group's features, and `isOwner` (`edit`) and `guiding` (`people`) are read from it, so every existing check reads the list. The `sharing_roles` table is no longer read. The list changes by pull request.
- The cache still leaves Clients out. Beside it, a second path by feature: the project page shows the tabs a group is given and 404s the rest; rows are filtered (`rowsForReader`: no cost file, no cost, not the log's words, without `costs`/`logbook`); the byte routes (view, rendition, download) open a photo for `photos` by the same rule the tab shows (`canReadFile`, `isReachablePhoto`). A photo of a receipt is a cost file and stays out.
- Observer reads what a Crafter reads and marks it, and doesn't edit or write a Card to the project (Austin, 2026-09-27: it keeps their focus clear). A note is `marks`; moving an entry to another project, filing a file and confirming a cost are `edit`.
- Everyone on a project sees who is on it, by name and group, on the project page, Clients included (2026-09-27). Changing it stays the Guide's.
- Taking someone off a project scraps what they wrote on it in the last 24 hours (`removalScrap.server.ts`): their Cards touched in that window are emptied and re-synced, the attachments those Cards copied into the project's syncs go, and their notes go (not their taps, not a mark that moved an entry). They can't write to that Card again. Older days stay.
- Only an admin makes or changes a Guide, or changes an admin's group (`promotionRefusal` in `setProjectSharing`; the invite checks before creating anyone).
- Admins see everyone at `/maker/humans` and change a group there, through `setProjectSharing`.
- Revoking a relationship no longer touches a project's cache.
- A role name that isn't a group (an old one) is kept in the README as written and reaches nothing: not the cache, not a role, not a membership. Saving a list may keep it; only a new or changed unknown name is refused (2026-09-27).
- The creator comes off a project only once someone else is its Guide (Austin, 2026-09-27). Taking them off writes `creator_removed: true` beside `sharing`, so `withCreator` stops making them Guide by default; naming them again clears it.

**Why it looks removable.** The second path next to the cache looks like duplication. The cache is all-or-nothing and can't say "photos but not receipts"; putting clients back in it would reopen every file route.

**Limits.** For groups in the cache, the list hides a tab and refuses `?tab=`, but a typed file URL still opens through the cache. Taking Photos from Observers would hide the tab, not the files. Only Client's row reaches the file routes. A creator taken off loses their role, but they still own the project's folders, and `canViewFolder` lets an owner in: the project stays in their own Vault until ownership can move. The scrap reaches the Cards, the syncs and the notes, not an Efforts page a GraphLog run already wrote from them: that waits for the next run, or for redaction.

**How you'd know.** A client opens anything but their Efforts, Photos, own tap and own log; a receipt photo opens for a client; a Guide who isn't an admin makes a Guide.

**Test.** `webapp/app/tests/graphlog/features.test.ts`, `access.test.ts`, `dashboard.test.ts`, `fruits/app/tests/dashboardRender.test.tsx`, and `fruits/scripts/campbell-walk.ts` over HTTP against a running stack.
