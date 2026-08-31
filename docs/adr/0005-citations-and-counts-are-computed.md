# ADR-005 — Citations and counts are computed. The model never writes them.

**Status:** Accepted, 2026-08-20

**Context.** A citation the model composes is a guess wearing a citation's clothes, and it reads as verified for as long as it survives. The same applies to any arithmetic the model is shown.

**Decision.** `:ref{...}` directives, inbound counts, author sets and date spans are built in code and handed over. The model copies them and never constructs one. Weight lines it writes are ignored and recomputed.

**Why it looks removable.** Asking the model to fill these in is fewer moving parts, and it usually gets them right.

**How you'd know.** A citation points at the wrong log, or a count is plausible and wrong. Both are nearly undetectable by reading.

**Test.** Every citation in output matches one the code generated, character for character.
