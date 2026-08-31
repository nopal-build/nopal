# ADR-007 — `Blocking` names a consequence. It is never a rating.

**Status:** Accepted, 2026-08-20

**Context.** Every judged field with a cheap default drifts to it. `Status` collapsed to `active` on nine of ten threads in the first real run, because `active` is a word anyone can type. A label costs nothing to write and cannot be checked.

**Decision.** `Blocking:` must name the thing being held up (`Blocking: client onboarding`). Never `high`, never `important`. If the thing can't be named, the field is omitted. Most threads carry no `Blocking` at all.

**Why it looks removable.** An enum is easier to parse, sort and validate than free text.

**How you'd know.** The count of threads carrying `Blocking` climbs steadily, and the values stop being checkable against the nodes.

**Test.** Log the share of threads carrying each judged field per run. A rising `Blocking` share is the alarm.
