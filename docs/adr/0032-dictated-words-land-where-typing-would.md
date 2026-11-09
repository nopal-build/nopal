# ADR-032 — Dictated words land where typing would. The button draws nothing but itself.

**Status:** Accepted, 2026-11-06.

**Context.** Dictation (record-in-daily-log seed) streams two kinds of words: settled ones the engine has committed to, and a running guess for the ones still being heard. The settled words go into the text. The guess has to be shown somewhere, or the person speaks into silence for a sentence at a time and cannot tell whether they are being heard.

The first build put the guess on a line under the dictate button. On 2026-11-02 the daily log's editor moved it into the entry, greyed, after the settled words, because the editor can grey part of itself. The plain text boxes (a letter's talk-through, a reader's talk-through of a letter) kept the line under the button, with the reason that a textarea cannot grey part of its text. Austin, trying the reading box on 2026-11-06: "The dictated words should only show up in the type box, not down by the mic."

**Decision.** Every word dictation produces, settled or not, appears where typing would put it: in the entry or the box, at the point the next settled words will go. The dictate button draws its own label and state, and a short note when dictation stops on its own, and nothing else. Where the surface can mark the unsettled words (the editor greys them), it does; where it cannot (a textarea), they show plain and are replaced as they settle. In neither place are unsettled words ever saved: the editor's sync skips them, and the text box keeps them out of its caller's value until they settle.

This is a rule of behaviour, not of look. `packages/stamps` says what a control is and how it is drawn; this says what happens to a person's words when they use one. The two are kept apart on purpose, and `fruits/AGENTS.md` has a section for rules of this kind.

**Why it looks removable.** A line under the button is the easiest place to show text a control cannot style, and a textarea with unstyled guesses in it looks, for a second, like it has accepted words it has not. A future build of a new dictated box will reach for the line under the button again, because the component that draws the button is right there and the box is somebody else's.

**How you'd know.** Someone dictating looks at the mic instead of at their words, and reads their sentence twice: once as a guess under the button, once as the text. Or the opposite slip: a draft autosaves with the engine's guess in it, and a reader sees words the speaker never settled on.

**Test.** `fruits/app/tests/dictation.test.ts`: the box composes unsettled words into what it shows at the insertion point, and only settled words reach its `onChange`; the button's props require a handler for unsettled words and the button renders no element for them.
