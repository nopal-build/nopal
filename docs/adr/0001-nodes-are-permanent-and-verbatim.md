# ADR-001 — Nodes are permanent and verbatim. Every view is disposable.

**Status:** Accepted, 2026-08-20

**Context.** The system's whole promise is that precedence goes to what people actually said rather than to a summary of it. Summaries of summaries are the failure mode, and they look like good editing while they happen.

**Decision.** A node holds a person's words, unedited except for obvious typos, with a computed citation. It is never rewritten or deleted. Everything downstream (graph-structure, README, future newspapers and workshop) is regenerated freely and holds no unique information.

**Why it looks removable.** Storing nodes forever looks wasteful once a project has thousands. Rewriting a node to "clean it up" looks like maintenance.

**How you'd know.** Output starts sounding smooth and reads like the AI wrote it. Quote counts fall. Nobody can trace a claim back to a person.

**Test.** A node's text is byte-identical across a full replay of the same sources.
