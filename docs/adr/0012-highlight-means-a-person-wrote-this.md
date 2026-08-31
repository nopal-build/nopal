# ADR-012 — `==` means a person wrote this. Code decides it, not the model.

**Status:** Accepted, 2026-08-27

**Context.** Attachments made a file a first-class source. A node can now be grounded in a human-written caption or in a machine-written description of a photo nobody has read. `add_node` applies `==...==` to whatever the model puts in `blocks`, identically in both cases, so a description-grounded node is AI prose wearing the mark that means verbatim human words. Downstream, nothing tells the view stage that some node text is not anybody's words, so it can be quoted and attributed to a person who never said it.

Not captioning a photo must not cost somebody their content, so the answer is not to refuse the node.

**Decision.** The highlight is a code decision, made from whether the source is human-authored text or a human caption, and never a rule the model is asked to remember. A description-grounded node is written unhighlighted and carries a code-written provenance marker in its own permanent text, so the fact travels with the node rather than living in an instruction. View stages may cite such a node and may never quote it or attribute it to a person.

**Why it looks removable.** Applying the mark uniformly is one branch simpler, and the output reads the same either way.

**How you'd know.** A reader eventually finds a quotation attributed to a colleague who never wrote it, and from then on doubts every other quotation on the page. This is the failure that costs trust rather than accuracy, and it does not recover.

**Test.** No node whose only source is a file description contains `==`. No README line puts a description-grounded node's text in quotation marks.
