/**
 * The Janitor catches drift: two places that state one fact and stop
 * agreeing, or something that changed without the person who should know
 * seeing it. It reports and a person decides (ADR-018). Nothing under this
 * directory has a write path, and `webapp/app/tests/janitor.test.ts` pins
 * that.
 *
 * It looks at anything it watches from three directions:
 *
 *   form       is the thing well formed for whatever loads it
 *   agreement  do two statements of the same fact still match
 *   vouching   has it changed since a person last checked it
 *
 * What has a confirmable right answer (form, agreement) is a failing test
 * in `janitor.test.ts`, green until it is wrong. This report holds only
 * what needs a person's judgment, and it prints nothing when there is
 * nothing to judge. A check that speaks on every run stops being read.
 */
export type Direction = "form" | "agreement" | "vouching";

export interface Finding {
  direction: Direction;
  /** What was looked at, as a person would name it: `GRAPH.md`, a path. */
  subject: string;
  message: string;
}

/**
 * A check is a pure function: text in, findings out. The runner does the
 * reading. A new tenant is one more of these.
 */
export type Check<Input> = (input: Input) => Finding[];
