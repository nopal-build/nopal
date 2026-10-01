/**
 * The Steep-o-meter's scale: how steep this stretch of the trail feels,
 * about one project, from one person, on one day.
 *
 * PLACEHOLDER until Gerald's names from the sketch land. The names are
 * about the trail, never the person (ask how steep the stretch is, not
 * how you are doing), and funny enough that the steep end is safe to tap.
 * No smiley at the top. A reading stores the key, never a bare number.
 *
 * Client-safe on purpose: the dashboard renders these buttons.
 */

export type SteepPosition = "flat" | "rolling" | "uphill" | "steep" | "oh-crap";

export const STEEP_SCALE: readonly { key: SteepPosition; label: string }[] = [
  { key: "flat", label: "Flat" },
  { key: "rolling", label: "Rolling" },
  { key: "uphill", label: "Uphill" },
  { key: "steep", label: "Steep" },
  { key: "oh-crap", label: "Oh crap" },
];

export const STEEP_QUESTION = "How steep is this stretch?";

export function isSteepPosition(value: unknown): value is SteepPosition {
  return typeof value === "string" && STEEP_SCALE.some((s) => s.key === value);
}

export function steepLabel(position: SteepPosition): string {
  return STEEP_SCALE.find((s) => s.key === position)?.label ?? position;
}
