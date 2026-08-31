# ADR-004 — Quiet threads stay in the link-candidate list.

**Status:** Accepted, 2026-08-20

**Context.** A thread that goes quiet drops out of the README. It must still be reachable by the extractor, because someone writing something adjacent months later is how a set-down idea comes back. That resurfacing is the mechanism that makes it safe to drop things at all.

**Decision.** `sync-graph`'s candidate list includes threads that no longer appear in any view.

**Why it looks removable.** The candidate list is the largest thing in a cached prompt and grows forever. Trimming quiet threads is the obvious saving.

**How you'd know.** Never directly. A quiet thread becomes invisible to humans, so nobody writes about it, so nothing links to it, so it can never return. It looks identical to an idea that simply stopped mattering.

**Test.** A thread absent from the README still appears among the candidates handed to the next extraction run.
