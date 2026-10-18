// app/hooks/useTimezonePref.ts
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PERF_TIMEZONE, isPerfTimezoneKey, type PerfTimezoneKey } from "../util/perfTimezones";

const STORAGE_KEY = "nopal:perf-timezone-pref";

/**
 * The viewer's own chosen display timezone for the Performance pages
 * (`maker_.performance*.tsx`) -- a pure client-side preference
 * (`localStorage`), never sent to or known by the server. SSR, and the
 * client's own FIRST render before this hook's effect runs, always use
 * `DEFAULT_PERF_TIMEZONE` ("Arizona Time") -- the same "render the safe
 * default first, read the real client-only preference in an effect, then
 * re-render" shape `useSchemePref` already uses for the same reason:
 * nothing server-side can know a `localStorage` value, so using it
 * during the FIRST render would be a hydration mismatch.
 */
export function useTimezonePref(): [PerfTimezoneKey, (next: PerfTimezoneKey) => void] {
  const [tz, setTz] = useState<PerfTimezoneKey>(DEFAULT_PERF_TIMEZONE);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isPerfTimezoneKey(stored)) setTz(stored);
  }, []);

  const update = useCallback((next: PerfTimezoneKey) => {
    setTz(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return [tz, update];
}
