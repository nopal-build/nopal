# ADR-008 — The structure file's order serves the next stages, not a human reader.

**Status:** Accepted, 2026-08-20

**Context.** `graph-structure.md` is read by the view (deciding what to feature) and the extractor (deciding what tomorrow connects to). Optimizing its order for someone reading it directly would trade away both.

**Decision.** Order runs down the importance-and-urgency grid: `Blocking` and `Due` first, then `Blocking` alone, then `Due` alone, then accumulated weight, then settled and dormant. Readability of the file itself is not a goal.

**Known consequence, unresolved.** The extractor sees candidates in this order, so ordering influences what gets linked, which influences weight, which influences ordering. If that loop shows up in practice, the fix is a separately ordered candidate list for the extractor, not a compromise here.

**Test.** A thread carrying `Blocking` outranks a heavier thread that carries none.
