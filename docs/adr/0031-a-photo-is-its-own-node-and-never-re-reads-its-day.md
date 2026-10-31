# ADR-031 — A photo is its own node, linked to the words it belongs to, and never re-reads its day.

**Status:** Accepted, 2026-10-30. Builds on ADR-001 and ADR-012; supersedes neither.

**Context.** A photo was a source of its day's extraction: its description went into the sync-graph agent's prompt and its hash into the day's `sourceHash`. One new photo, one new description or one caption re-ran the agent over every source on that day. Ambika Sohal's seed (about 180 photos, most on one day) cost $17 in one run; of that, $14.90 was the two graph agents, which re-read every turn's whole conversation (14M cache-read tokens in sync-graph alone). The per-photo work, describing each photo once, was $2.62. Cost grew with the size of the day, every time anything on it changed.

**Decision.**
- **The day's text pass reads words only.** Photos and videos are not sources of sync-graph's extraction and not part of a day's `sourceHash`. Documents (PDF, Word) still are: they have words.
- **Each photo is its own node, written by code** after the day's text nodes, below a marker line (`photoNodes.server.ts`). It holds the caption, highlighted (a person's words), or the description, unhighlighted with the description-only provenance line (ADR-012, unchanged), and the photo itself.
- **It links to the text node it belongs to, if there is one.** Code links it when it sits under a Card paragraph shared by at most three photos (`CONTEXT_SHARED_LIMIT`; a Card that ends in a photo dump says nothing about each photo). Otherwise one text-only call to a small model (`photo-link` stage, Haiku 4.5, Austin's call) picks a node or none. The answer, none included, is kept in the day file's front matter (`photoLinks`) against the photo's hash and the linked node's words, and is asked again only when one of those changes.
- **graph-structure places a linked photo node in its note's thread by code**; only unlinked ones go to the model.
- **A photo already carried by a text node** (a caption mark, or a node written before this) gets no node of its own.
- **Deploy re-extracts nothing.** A day whose stored hash equals the old formula's has it moved to the new formula with no model call.

**Why it looks removable.** Feeding the photo's description to the day agent looks like the richer reading: the agent sees everything and decides. It does, every time anything on the day changes, at a cost set by the day's size rather than the change's.

**Limits.** A photo node links to one note on its own day; a photo about something written another day links to nothing until a person moves it (the `photoLinks` record is where that goes, not built). Text nodes are renumbered when a day re-extracts, so photo nodes are renumbered with them; links follow the note's words, not its number. The `photo-link` model is a value somebody maintains.

**How you'd know.** A run where a photo was added shows a `sync-graph day` LLM event for that day; a nightly after a deploy re-extracts days; `photo-link` usage events repeat for the same photo; a photo node's link points at a note its Card paragraph isn't about.

**Test.** `webapp/app/tests/graphlog/photoNodes.test.ts`. Gates 1 and 2 (a photo leaves the day's hash alone; the old hash is moved without a model call) were proved by a local run against the old and new code on This Healthy House, 2026-10-30, since `runSyncGraph` has no database-free harness.
