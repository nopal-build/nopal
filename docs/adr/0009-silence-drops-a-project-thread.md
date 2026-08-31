# ADR-009 — Silence drops a project thread. Only speech closes a personal claim.

**Status:** Proposed. Depends on annotation, not yet built.

**Context.** Collective attention should drift, so a thread nobody keeps alive falls away rather than being carried forever, which is what stops the index becoming a backlog. A commitment a person made is different: silence there is ambiguous, and can mean done, dropped, forgotten, or avoided.

**Decision.** At project level, a dormant thread with no `Due` and no `Blocking` stops being surfaced; its nodes remain permanent and reachable. At personal level, a claim stays visible until the person says it is finished or that they are letting it go, and that statement is an annotation, not an inference.

**Why it looks removable.** Falling away looks like data loss. Requiring speech to close something looks like unnecessary friction next to a checkbox.

**How you'd know.** Either the index grows without bound, or personal commitments start disappearing without anyone deciding they should.

**Test.** A run reports which threads fell away, so the drop is visible rather than silent.
