# ADR-020 — Nothing reaches a budget unconfirmed.

**Status:** Accepted, 2026-09-22

**Context.** The Costs folder is the start of the path the guide describes: a receipt goes up with a log, the budget and billing follow. The model reads a cost document out (vendor, amount, date, the lines each came from) and it is right most of the time, which is exactly the danger: a budget built from a reading nobody checked is a budget nobody can trust, and billing reaches clients. The guide's split holds here as everywhere: the machine reads, a person judges. Three judgments, and only the first is arithmetic: is this reading correct, do we accept that we owe it, and which line item does it belong to. The third waits for line items after October 1.

**Decision.** A cost is unconfirmed until a person confirms it, and a confirmation names the reading it confirms: `filingValuesHash` of kind, vendor, amount, currency and date. A later re-read that changes any of those no longer matches, and the cost is unconfirmed again; a re-read that changes only the reason or the quoted lines keeps the confirmation. The confirmation is an entry in the person's name (a `confirm-cost` act on the file's mark), so it has an author and a date and reaches the graph. `confirmedCosts` in `fileFolders.server.ts` is the only exported list of costs, and a budget, when there is one, reads that function and nothing else. A wrong amount is not edited: the person writes a correction, the same pen as anywhere, and the next read is what gets confirmed.

**Why it looks removable.** Nearly every reading will be right, so the confirmation step looks like friction, and the first budget built will be tempted to read the filing records directly because they already hold the numbers.

**How you'd know.** A budget line whose amount nobody can trace to a tap. A cost that stayed confirmed after the model re-read it with a different total. A client invoice built from an unconfirmed bid.

**Test.** `fileFolders.test.ts`, ADR-020 block: `confirmedCosts` drops every row whose latest act is not a confirmation of the current values; a confirmation with a stale hash reads unconfirmed.
