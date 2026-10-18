// app/components/TimezoneSelect.tsx
// The timezone picker for the Performance pages -- see
// `app/util/perfTimezones.ts` for why each option is a fixed offset
// rather than a real shifting IANA zone, and `useTimezonePref` for how
// the choice is persisted (client-only, `localStorage`).
import { PERF_TIMEZONE_OPTIONS, type PerfTimezoneKey } from "../util/perfTimezones";

export function TimezoneSelect({
  value,
  onChange,
}: {
  value: PerfTimezoneKey;
  onChange: (next: PerfTimezoneKey) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PerfTimezoneKey)}
      aria-label="Display timezone"
      className="text-sm font-mono rounded"
      style={{
        padding: "6px 10px",
        border: "1px solid var(--midground)",
        background: "var(--farground)",
        color: "inherit",
      }}
    >
      {PERF_TIMEZONE_OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
