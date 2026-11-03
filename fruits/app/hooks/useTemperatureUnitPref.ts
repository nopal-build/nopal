// app/hooks/useTemperatureUnitPref.ts
import { useCallback, useEffect, useState } from "react";
import type { TemperatureUnit } from "../util/temperature";

const STORAGE_KEY = "nopal:temperature-unit-pref";

function isTemperatureUnit(v: string | null): v is TemperatureUnit {
  return v === "C" || v === "F";
}

/**
 * The viewer's own chosen display unit (Celsius/Fahrenheit) for
 * temperature sensor data -- a pure client-side preference
 * (`localStorage`), never sent to or known by the server, same shape as
 * `useTimezonePref`. Defaults to Fahrenheit (the project's existing
 * convention elsewhere -- load-cell results are lbs/inches, not kg/cm --
 * "some folks don't understand Celsius well," Gerald 2026-11-03). SSR, and
 * the client's own FIRST render before this hook's effect runs, always use
 * that same hardcoded default -- the "render the safe default first, read
 * the real client-only preference in an effect, then re-render" shape
 * `useSchemePref`/`useTimezonePref` both already use, since nothing
 * server-side can know a `localStorage` value and using it during the
 * FIRST render would be a hydration mismatch.
 */
export function useTemperatureUnitPref(): [TemperatureUnit, (next: TemperatureUnit) => void] {
  const [unit, setUnit] = useState<TemperatureUnit>("F");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isTemperatureUnit(stored)) setUnit(stored);
  }, []);

  const update = useCallback((next: TemperatureUnit) => {
    setUnit(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return [unit, update];
}
