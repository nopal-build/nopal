// A YYYY-MM-DD day as "Oct 28, 2026", the same on the server and in any
// browser: the day is the sender's own (`markDate`), not an instant, so
// it is never shifted by a timezone. For the letter's sent day and the
// like; an instant goes through a `longDate` with `timeZone: "UTC"`.
export function dayLabel(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
