// app/util/perfTimezones.ts
// Display-timezone handling for the Performance pages
// (`maker_.performance*.tsx`) -- deliberately simple, per request: each
// option is a FIXED UTC offset, not a real IANA zone that shifts for DST
// on its own calendar. Picking "MST" always means UTC-7, even in months
// when the real US Mountain zone is actually in MDT -- useful for
// debugging specifically because it's deterministic, not because it's
// how time zones "really" work. "Arizona Time" is kept as its own
// labeled option (not folded into "MST") because it's the team's own
// default, even though Arizona's real offset (America/Phoenix, no DST
// ever) happens to be numerically identical to MST year-round.
export type PerfTimezoneKey =
  | "az"
  | "mst"
  | "mdt"
  | "pst"
  | "pdt"
  | "cst"
  | "cdt"
  | "est"
  | "edt"
  | "utc";

export const DEFAULT_PERF_TIMEZONE: PerfTimezoneKey = "az";

export const PERF_TIMEZONE_OPTIONS: {
  key: PerfTimezoneKey;
  label: string;
  /** Short suffix appended to a formatted timestamp, e.g. "Oct 18 14:32:07 AZ". */
  short: string;
  offsetMinutes: number;
}[] = [
  { key: "az", label: "Arizona Time", short: "AZ", offsetMinutes: -7 * 60 },
  { key: "mst", label: "MST", short: "MST", offsetMinutes: -7 * 60 },
  { key: "mdt", label: "MDT", short: "MDT", offsetMinutes: -6 * 60 },
  { key: "pst", label: "PST", short: "PST", offsetMinutes: -8 * 60 },
  { key: "pdt", label: "PDT", short: "PDT", offsetMinutes: -7 * 60 },
  { key: "cst", label: "CST", short: "CST", offsetMinutes: -6 * 60 },
  { key: "cdt", label: "CDT", short: "CDT", offsetMinutes: -5 * 60 },
  { key: "est", label: "EST", short: "EST", offsetMinutes: -5 * 60 },
  { key: "edt", label: "EDT", short: "EDT", offsetMinutes: -4 * 60 },
  { key: "utc", label: "UTC", short: "UTC", offsetMinutes: 0 },
];

const OPTION_BY_KEY = new Map(PERF_TIMEZONE_OPTIONS.map((o) => [o.key, o]));

export function isPerfTimezoneKey(value: string): value is PerfTimezoneKey {
  return OPTION_BY_KEY.has(value as PerfTimezoneKey);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * "Oct 18 14:32:07 AZ" -- military time, zero-padded, in the shape asked
 * for ("Jan DD HH:MM:SS"), with the chosen zone's short label appended
 * so it's never ambiguous which offset is being shown. Deliberately NOT
 * `toLocaleString` (unlike the GraphLog pages' own date formatters) --
 * this applies a fixed numeric offset via plain UTC getters, so the
 * result is identical regardless of the server's or viewer's own
 * machine locale/timezone; only the EXPLICIT dropdown choice matters.
 */
export function formatPerfAbsolute(iso: string, tz: PerfTimezoneKey): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const option = OPTION_BY_KEY.get(tz) ?? OPTION_BY_KEY.get(DEFAULT_PERF_TIMEZONE)!;
  const shifted = new Date(d.getTime() + option.offsetMinutes * 60_000);
  const month = MONTH_ABBR[shifted.getUTCMonth()];
  const day = pad2(shifted.getUTCDate());
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());
  const ss = pad2(shifted.getUTCSeconds());
  return `${month} ${day} ${hh}:${mm}:${ss} ${option.short}`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "3 minutes ago" / "2 hours ago" / "5 days ago" -- `null` once `iso` is
 * 7+ days old, so the caller falls back to `formatPerfAbsolute`. `nowMs`
 * is a parameter (not read internally) so a caller that already pinned
 * "now" once for a whole list doesn't recompute it per row. */
export function formatPerfRelative(iso: string, nowMs: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = nowMs - d.getTime();
  if (diffMs >= WEEK_MS) return null;
  if (diffMs < 5_000) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** The one function the Performance pages actually call: relative
 * ("3 minutes ago") within the first week, the fixed-offset absolute
 * timestamp ("Oct 18 14:32:07 AZ") after that. */
export function formatPerfTimestamp(iso: string, tz: PerfTimezoneKey, nowMs: number = Date.now()): string {
  return formatPerfRelative(iso, nowMs) ?? formatPerfAbsolute(iso, tz);
}
