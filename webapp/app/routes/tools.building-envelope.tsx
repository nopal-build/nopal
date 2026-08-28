import { useState, useCallback, useMemo } from "react";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import type { MetaFunction } from "react-router";
import { surfaceBase, surfaceBorderOnly } from "stamps/surface.css";

export const meta: MetaFunction = () => [
  { title: "Building Envelope | Nopal" },
  {
    name: "description",
    content:
      "Evaluate your building envelope — air tightness, ventilation, and fresh air strategy — and see where your home lands on the health vs efficiency quadrant.",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AirTightness = "old-and-leaky" | "code" | "passive-house" | null;

type Ventilation = "exhaust-only" | "supply-only" | "balanced" | null;

type WindowsFreshAir = "yes" | "no" | null;

interface SettingsState {
  airTightness: AirTightness;
  ventilation: Ventilation;
  windowsFreshAir: WindowsFreshAir;
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

const INITIAL_STATE: SettingsState = {
  airTightness: null,
  ventilation: null,
  windowsFreshAir: "no",
};

// ---------------------------------------------------------------------------
// Scoring — Each selection nudges the home on two axes
//   Health:     positive = healthier indoor environment
//   Efficiency: positive = more energy efficient
// ---------------------------------------------------------------------------

interface Score {
  health: number;
  efficiency: number;
}

function computeScore(state: SettingsState): Score {
  let health = 0;
  let efficiency = 0;

  // Air tightness
  switch (state.airTightness) {
    case "old-and-leaky":
      health -= 25;
      efficiency -= 30;
      break;
    case "code":
      health -= 10;
      efficiency -= 10;
      break;
    case "passive-house":
      health += 15;
      efficiency += 30;
      break;
  }

  // Ventilation
  switch (state.ventilation) {
    case "exhaust-only":
      health += 10;
      efficiency -= 8;
      break;
    case "supply-only":
      health += 15;
      efficiency -= 8;
      break;
    case "balanced":
      health += 25;
      efficiency += 15;
      break;
  }

  // Sick building syndrome: passive house without balanced ventilation
  if (
    state.airTightness === "passive-house" &&
    state.ventilation !== "balanced"
  ) {
    // Severity depends on ventilation type
    if (state.ventilation === null) health -= 65;
    else if (state.ventilation === "exhaust-only") health -= 45;
    else if (state.ventilation === "supply-only") health -= 40;
  }

  // Windows for fresh air — effect depends on ventilation type
  if (state.windowsFreshAir === "yes") {
    if (state.ventilation === "balanced") {
      // With balanced ventilation, open windows introduce unfiltered air
      // and waste the energy your ERV/HRV is recovering
      health -= 20;
      efficiency -= 10;
    } else {
      // Without balanced ventilation, windows are your best fresh air source
      health += 20;
      efficiency -= 10;
    }
  }

  // Clamp to [-50, 50]
  health = Math.max(-50, Math.min(50, health));
  efficiency = Math.max(-50, Math.min(50, efficiency));

  return { health, efficiency };
}

function hasAnySelection(state: SettingsState) {
  return (
    state.airTightness !== null ||
    state.ventilation !== null ||
    state.windowsFreshAir !== null
  );
}

function getQuadrantColor(score: Score, hasSelection: boolean): string {
  if (!hasSelection) return "var(--text-subtle)";
  const { health, efficiency } = score;
  if (health >= 0 && efficiency >= 0) return "var(--green)";
  if (health >= 0 && efficiency < 0) return "var(--green-light)";
  if (health < 0 && efficiency >= 0) return "var(--red-light)";
  return "var(--red)";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold mb-1">{children}</h3>;
}

function SectionDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-xs purple-light-text mb-2">{children}</p>;
}

interface SliderOption {
  value: string;
  label: string;
  description?: string;
}

function SliderSelect({
  options,
  selectedValue,
  onChange,
}: {
  options: SliderOption[];
  selectedValue: string | null;
  onChange: (value: string) => void;
}) {
  const selectedIndex = options.findIndex((o) => o.value === selectedValue);
  const selectedDesc =
    selectedIndex >= 0 ? options[selectedIndex].description : undefined;

  return (
    <div>
      {/* Track + stops */}
      <div className="relative" style={{ padding: "8px 0" }}>
        {/* Track line */}
        <div
          className="absolute midground-bg"
          style={{
            top: "50%",
            left: `${100 / (options.length * 2)}%`,
            right: `${100 / (options.length * 2)}%`,
            height: 3,
            transform: "translateY(-50%)",
            borderRadius: 2,
          }}
        />
        {/* Active portion of track */}
        {selectedIndex >= 0 && (
          <div
            className="absolute"
            style={{
              top: "50%",
              left: `${100 / (options.length * 2)}%`,
              width: `${
                (selectedIndex / (options.length - 1)) *
                (100 - 100 / options.length)
              }%`,
              height: 3,
              transform: "translateY(-50%)",
              borderRadius: 2,
              transition: "width 0.2s ease",
            }}
          />
        )}
        {/* Stops */}
        <div className="relative flex justify-between items-center">
          {options.map((opt, i) => {
            const isSelected = opt.value === selectedValue;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                title={opt.description}
                className="flex flex-col items-center"
                style={{
                  flex: "1 1 0%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {/* Dot */}
                <div
                  className="midground-bg slider-dog"
                  style={{
                    width: isSelected ? 18 : 12,
                    height: isSelected ? 18 : 12,
                    borderRadius: "50%",
                    backgroundColor: isSelected ? "var(--purple-light)" : "",
                    border: isSelected ? "3px solid var(--purple-light)" : "",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? "0 0 0 3px var(--pink)" : "none",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      {/* Labels row */}
      <div className="flex justify-between mt-1">
        {options.map((opt) => {
          const isSelected = opt.value === selectedValue;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              title={opt.description}
              className={
                "text-center " +
                (isSelected ? "purple-light-text" : "purple-text")
              }
              style={{
                flex: "1 1 0%",
                background: "none",
                border: "none",
                padding: "2px 0",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: isSelected ? 700 : 400,
                transition: "all 0.15s ease",
                lineHeight: 1.2,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home marker SVG (simple house icon)
// ---------------------------------------------------------------------------

function HomeIcon({ color }: { color: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Quadrant Chart
// ---------------------------------------------------------------------------

function QuadrantChart({
  score,
  hasSelection,
}: {
  score: Score;
  hasSelection: boolean;
}) {
  // Map score from [-50, 50] to [5%, 95%] of the chart area
  // When no selection, position at center (50%, 50%)
  const xPercent = hasSelection ? 50 + (score.efficiency / 50) * 45 : 50;
  const yPercent = hasSelection ? 50 - (score.health / 50) * 45 : 50;
  const quadrantColor = getQuadrantColor(score, hasSelection);

  return (
    <div className="flex flex-col items-center w-full">
      {/* Chart container */}
      <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
        {/* Quadrant backgrounds */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded overflow-hidden">
          {/* Top-left: Healthy & Inefficient */}
          <div
            className="flex items-start justify-start p-4"
            style={{
              backgroundColor: "var(--green-light)",
              borderTopLeftRadius: "4px",
            }}
          >
            <span
              className="text-xl font-mono font-bold"
              style={{ color: "var(--white)" }}
            >
              Healthy &
              <br />
              Inefficient
            </span>
          </div>
          {/* Top-right: Healthy & Efficient */}
          <div
            className="flex items-start justify-end p-4"
            style={{
              backgroundColor: "var(--green)",
              borderTopRightRadius: "4px",
            }}
          >
            <span
              className="text-xl font-mono font-bold"
              style={{ color: "var(--farground)" }}
            >
              Healthy &<br />
              Efficient
            </span>
          </div>
          {/* Bottom-left: Needs Improvement */}
          <div
            className="flex items-end justify-start p-4"
            style={{
              backgroundColor: "var(--red)",
              borderBottomLeftRadius: "4px",
            }}
          >
            <span
              className="text-xl font-mono font-bold"
              style={{ color: "var(--red-light)" }}
            >
              Unhealthy &
              <br />
              Inefficient
            </span>
          </div>
          {/* Bottom-right: Efficient & Unhealthy */}
          <div
            className="flex items-end justify-end p-4"
            style={{
              backgroundColor: "var(--red-light)",
              borderBottomRightRadius: "4px",
            }}
          >
            <span
              className="text-xl font-mono font-bold"
              style={{ color: "var(--red)" }}
            >
              Unhealthy &
              <br />
              Efficient
            </span>
          </div>
        </div>

        {/* Axes */}
        {/* Vertical axis (Health) */}
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: "50%",
            width: 1,
            backgroundColor: "var(--midground)",
          }}
        />
        {/* Horizontal axis (Efficiency) */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: "50%",
            height: 1,
            backgroundColor: "var(--midground)",
          }}
        />

        {/* Axis labels */}
        {/* Health top */}
        <div
          className="absolute text-xs font-semibold"
          style={{
            top: 4,
            left: "50%",
            transform: "translateX(4px)",
            color: "var(--white)",
            // opacity: 0.7,
          }}
        >
          ↑ Healthier
        </div>
        {/* Health bottom */}
        <div
          className="absolute text-xs font-semibold"
          style={{
            bottom: 4,
            right: "50%",
            transform: "translateX(-4px)",
            color: "var(--white)",
          }}
        >
          Unhealthy ↓
        </div>
        {/* Efficiency right */}
        <div
          className="absolute text-xs font-semibold"
          style={{
            right: 4,
            top: "50%",
            transform: "translateY(4px)",
            color: "var(--purple)",
          }}
        >
          Efficient →
        </div>
        {/* Efficiency left */}
        <div
          className="absolute text-xs font-semibold"
          style={{
            left: 4,
            bottom: "50%",
            transform: "translateY(-4px)",
            color: "var(--purple)",
          }}
        >
          ← Inefficient
        </div>

        {/* Outer border */}
        <div className={`absolute inset-0 rounded pointer-events-none ${surfaceBorderOnly}`} />

        {/* Home marker */}
        <div
          className="absolute flex flex-col items-center pointer-events-none"
          style={{
            left: `${xPercent}%`,
            top: `${yPercent}%`,
            transform: "translate(-50%, -50%)",
            transition:
              "left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
            zIndex: 10,
          }}
        >
          <div
            className="rounded-full flex items-center justify-center shadow-lg"
            style={{
              width: 48,
              height: 48,
              backgroundColor: "var(--white)",
              transition: "background-color 0.4s ease",
            }}
          >
            <HomeIcon color={quadrantColor} />
          </div>
        </div>
      </div>
    </div>
  );
}

const AIR_TIGHTNESS_OPTIONS: { value: AirTightness; label: string }[] = [
  { value: "old-and-leaky", label: "Old & Leaky" },
  { value: "code", label: "Code" },
  { value: "passive-house", label: "Passive House" },
];

const VENTILATION_OPTIONS: { value: Ventilation; label: string }[] = [
  { value: null, label: "None" },
  { value: "exhaust-only", label: "Exhaust Only" },
  { value: "supply-only", label: "Supply Only" },
  { value: "balanced", label: "Balanced" },
];

const WINDOWS_OPTIONS: { value: WindowsFreshAir; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function BuildingEnvelope() {
  const [state, setState] = useState<SettingsState>({ ...INITIAL_STATE });

  const setAirTightness = useCallback((v: string) => {
    setState((prev) => ({ ...prev, airTightness: v as AirTightness }));
  }, []);

  const setVentilation = useCallback((v: string) => {
    setState((prev) => ({ ...prev, ventilation: v as Ventilation }));
  }, []);

  const setWindowsFreshAir = useCallback((v: string) => {
    setState((prev) => ({ ...prev, windowsFreshAir: v as WindowsFreshAir }));
  }, []);

  const score = useMemo(() => computeScore(state), [state]);
  const selected = hasAnySelection(state);

  const handleReset = useCallback(() => {
    setState({ ...INITIAL_STATE });
  }, []);

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: 837 }}>
          <h1 className="purple-light-text text-4xl mt-12">
            Building Envelope
          </h1>
          <p className="text-lg mt-2 mb-6">
            Building for Efficiency may be at the cost of your health.
          </p>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Your Building</h2>
          </div>

          {/* Main two-column layout */}
          <div className="flex flex-col sm:flex-row-reverse gap-6 mb-12">
            {/* ---- RIGHT: Quadrant + Insights ---- */}
            <div className="flex-1 flex flex-col items-center min-w-0">
              <QuadrantChart score={score} hasSelection={selected} />
            </div>
            {/* ---- LEFT SIDEBAR: Options ---- */}
            <div>
              <div className={`${surfaceBase} sm:w-[280px] shrink-0 p-4`}>
                {/* Air Tightness */}
                <SectionHeading>Air Tightness</SectionHeading>
                <SectionDescription>
                  How well the envelope prevents uncontrolled air leakage.
                </SectionDescription>
                <div className="mb-4">
                  <SliderSelect
                    options={[
                      {
                        value: "old-and-leaky",
                        label: "Old & Leaky",
                        description:
                          "Noticeable drafts, gaps around windows/doors.",
                      },
                      {
                        value: "code",
                        label: "Code",
                        description: "Built to current energy code standards.",
                      },
                      {
                        value: "passive-house",
                        label: "Passive House",
                        description:
                          "Extremely airtight, blower door tested (≤ 0.6 ACH50).",
                      },
                    ]}
                    selectedValue={state.airTightness}
                    onChange={setAirTightness}
                  />
                </div>

                {/* Ventilation */}
                <SectionHeading>Ventilation</SectionHeading>
                <SectionDescription>
                  How is fresh air managed in the building?
                </SectionDescription>
                <div className="mb-4">
                  <SliderSelect
                    options={[
                      {
                        value: "none",
                        label: "None",
                        description: "No mechanical ventilation system.",
                      },
                      {
                        value: "exhaust-only",
                        label: "Exhaust Only",
                        description:
                          "Bath fans, range hoods — air exits but replacement is uncontrolled.",
                      },
                      {
                        value: "supply-only",
                        label: "Supply Only",
                        description:
                          "Fresh air is pushed in, but outgoing air is not recovered.",
                      },
                      {
                        value: "balanced",
                        label: "Balanced",
                        description:
                          "ERV / HRV — fresh air in, stale air out with heat/energy recovery.",
                      },
                    ]}
                    selectedValue={
                      state.ventilation === null ? "none" : state.ventilation
                    }
                    onChange={(v) => {
                      if (v === "none") {
                        setState((prev) => ({ ...prev, ventilation: null }));
                      } else {
                        setVentilation(v);
                      }
                    }}
                  />
                </div>

                {/* Windows */}
                <SectionHeading>Windows for Fresh Air</SectionHeading>
                <SectionDescription>
                  Do you open windows as a ventilation strategy?
                </SectionDescription>
                <div>
                  <SliderSelect
                    options={[
                      {
                        value: "no",
                        label: "No",
                        description: "I rely on mechanical systems.",
                      },
                      {
                        value: "yes",
                        label: "Yes",
                        description: "I regularly open windows for fresh air.",
                      },
                    ]}
                    selectedValue={state.windowsFreshAir}
                    onChange={setWindowsFreshAir}
                  />
                </div>

                <div>
                  <button
                    onClick={handleReset}
                    className="btn-outline rounded px-2 py-1 text-xs purple-text"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
