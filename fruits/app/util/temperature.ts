// app/util/temperature.ts
// Celsius/Fahrenheit display conversion for temperature sensor data (the
// Sensor Data tab's BoxHardware widget today; written generically since
// any future temperature-sensor feature would want the exact same two
// conversions). The underlying data is always stored/synced in Celsius
// (`box-hardware/vault.py`'s own schema) -- this is DISPLAY-ONLY, never
// applied to what's written to or downloaded from the Vault.
//
// An absolute reading and a DELTA (difference between two readings)
// convert differently -- a delta has no "32" offset to add, only the
// "degrees are a different size" 9/5 scale factor. Converting an
// already-computed delta as if it were an absolute reading (i.e. adding
// 32) is the single most common mistake with this conversion, so these
// are kept as two separate, clearly-named functions rather than one
// function with an `isDelta` flag easy to forget to pass.
export type TemperatureUnit = "C" | "F";

export function celsiusToDisplay(c: number, unit: TemperatureUnit): number {
  return unit === "F" ? (c * 9) / 5 + 32 : c;
}

/** Converts a TEMPERATURE DIFFERENCE (e.g. "outside minus inside"), not an
 * absolute reading -- see the module doc for why this is a separate
 * function rather than a flag on `celsiusToDisplay`. */
export function celsiusDeltaToDisplay(deltaC: number, unit: TemperatureUnit): number {
  return unit === "F" ? (deltaC * 9) / 5 : deltaC;
}

export function temperatureUnitLabel(unit: TemperatureUnit): string {
  return unit === "F" ? "\u00b0F" : "\u00b0C";
}
