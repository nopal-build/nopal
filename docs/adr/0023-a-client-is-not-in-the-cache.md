# ADR-023 — A role on the project is the only answer, and a Client is not in the cache.

**Status:** Accepted, 2026-09-24. Supersedes ADR-022.

**Context.** Before clients could log in, every member of a project was in its `shared_with` cache, and that cache is what every Vault, file and project-page check reads (`canViewFolder`, `canViewFileRef`). So "on the project" meant "reaches everything", and a client could open Costs, every Card and every file. ADR-022 added a seat to change what two pages showed, and said itself it was not a permission. The person already had a field (the app role) and the membership already had one (the sharing role). What was missing was a role that reaches nothing, and a cache that honours it.

**Decision.**
- A `Client` sharing role. `setProjectSharing` (through `writeProjectSharing`, the cache's only writer) cascades everyone but a Client into `shared_with`, so every existing check refuses a client with a 404 without a route changing.
- Inside a project, owning the folder decides nothing. The creator is written into the README as Owner when the project is made (and by the `migrate-creators-as-owners` admin script for existing ones). So an admin can hold Observer, or Client, on a project they created.
- Owner runs the project's people side, its name, status and deletion, and sees other people's Steep readings. Crafter keeps `is_owner` (writing content) and nothing else: it is the level that does the work.
- A project keeps at least one Owner. An admin can open any project's people list, which is how an admin gives themselves a role or comes back after setting themselves to Client.
- Someone whose every role is Client gets today's log and the Steep-o-meter, no Vault.
- The seat is gone.

**Why it looks removable.** Leaving the creator implicit looks simpler. It is what made "Super, but Observer on most projects" impossible, and it let a creator stepped down to client still read everything through ownership.

**How you'd know.** A client gets anything but a 404 from a project page, a file, a Vault folder or a people list. A creator can't reach a project they made (the admin script didn't run). A Crafter can change who is on a project.

**Test.** `webapp/app/tests/graphlog/access.test.ts`, `dashboard.test.ts`, `fruits/app/tests/dashboardRender.test.tsx`, and `fruits/scripts/campbell-walk.ts` over HTTP against a running stack.
