import { useState, useMemo } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Breadcrumb } from "../components/Breadcrumb";
import { NumberInput } from "../components/NumberInput";
import { surfaceBase } from "stamps/surface.css";

export const meta: MetaFunction = () => [
  { title: "Fresh Air Calculator | Nopal Tools" },
  {
    name: "description",
    content:
      "Calculate your target ERV/HRV ventilation flow rate based on occupancy. 35 CFM per person keeps CO₂ under 1,000 ppm.",
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CFM_PER_PERSON = 35;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compute(residents: number, guests: number) {
  const totalPeople = residents + guests;
  const targetCFM = totalPeople * CFM_PER_PERSON;
  return { totalPeople, targetCFM };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InputGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <p className="text-sm font-semibold mb-1">{label}</p>
      {description && (
        <p className="text-xs purple-light-text mb-2">{description}</p>
      )}
      {children}
    </div>
  );
}

function CFMGauge({ targetCFM }: { targetCFM: number }) {
  // Visual reference: 0–500 CFM range
  const MAX = 500;
  const pct = Math.min(targetCFM / MAX, 1) * 100;

  return (
    <div className="mt-4">
      <div
        style={{
          height: 10,
          borderRadius: 9999,
          background: "var(--foreground)",
          opacity: 0.12,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            right: `${100 - pct}%`,
            borderRadius: 9999,
            background: "var(--purple-light)",
            opacity: 1,
            transition: "right 0.3s ease",
          }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs opacity-40">0 CFM</span>
        <span className="text-xs opacity-40">{MAX} CFM</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party scenario note
// ---------------------------------------------------------------------------

function PartyScenarioNote({
  totalPeople,
  targetCFM,
}: {
  totalPeople: number;
  targetCFM: number;
}) {
  const scenarios = [
    {
      label: "Your estimate",
      multiplier: 1,
      co2: 1000,
      qualityNote: "comfortable, clear-headed",
      dotColor: "#22c55e",
    },
    {
      label: "2× the crowd",
      multiplier: 2,
      co2: 1600,
      qualityNote: "stuffy, some may feel drowsy",
      dotColor: "#f59e0b",
    },
    {
      label: "3× the crowd",
      multiplier: 3,
      co2: 2200,
      qualityNote: "noticeable stuffiness, impaired focus",
      dotColor: "#ef4444",
    },
  ];

  return (
    <div className={`${surfaceBase} p-5`}>
      <h3 className="text-sm font-bold mb-1">What if the party grows?</h3>
      <p className="text-xs opacity-60 mb-4">
        If your ERV stays at {targetCFM} CFM but attendance doubles or triples,
        CO₂ rises linearly — and you'll feel it.
      </p>

      <div className="flex flex-col gap-3">
        {scenarios.map((s) => (
          <div
            key={s.label}
            style={{
              display: "grid",
              gridTemplateColumns: "8px 1fr auto",
              gap: "0 10px",
              alignItems: "start",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: s.dotColor,
                marginTop: 3,
                flexShrink: 0,
              }}
            />
            <div>
              <span className="text-xs font-semibold">{s.label}</span>
              <span className="text-xs opacity-50 ml-2">
                {totalPeople * s.multiplier} people &middot;{" "}
                {(35 / s.multiplier).toFixed(1)} CFM/person
              </span>
              <div className="text-xs opacity-50 mt-0.5">{s.qualityNote}</div>
            </div>
            <div
              className="text-sm font-bold text-right"
              style={{
                color: s.dotColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ~{s.co2.toLocaleString()} ppm
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs mt-4 leading-relaxed" style={{ opacity: 0.35 }}>
        Steady-state estimates calibrated to the 35 CFM/person rule. Actual CO₂
        varies with room volume, outdoor air quality, and activity level.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ERVCalculator() {
  const [residents, setResidents] = useState(2);
  const [guests, setGuests] = useState(0);

  const { totalPeople, targetCFM } = useMemo(
    () => compute(residents, guests),
    [residents, guests]
  );

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: 720 }}>
          {/* Breadcrumb */}
          <div className="mt-4 mb-6">
            <Breadcrumb>
              <Link
                to="/tools"
                className="hover:underline purple-light-text text-sm"
              >
                Tools
              </Link>
            </Breadcrumb>
          </div>

          {/* Page header */}
          <h1 className="purple-light-text text-4xl mt-4">
            Fresh Air Calculator{" "}
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                background: "var(--green)",
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 9999,
                verticalAlign: "middle",
              }}
            >
              In Development
            </span>
          </h1>
          <p className="text-lg mt-2 mb-2">
            Find your target ventilation flow rate based on who lives in your
            home.
          </p>
          <p className="text-xs opacity-60 mb-8" style={{ maxWidth: 560 }}>
            CO₂ and VOC levels are driven by people, not floor area. At 35 CFM
            per person, indoor CO₂ stays comfortably under 1,000 ppm — the
            threshold where air quality begins to affect focus and sleep.
          </p>

          {/* Main layout */}
          <div className="flex flex-col sm:flex-row gap-6 mb-12">
            {/* ---- Inputs ---- */}
            <div className={`${surfaceBase} p-5 sm:w-[260px] shrink-0`}>
              <h2 className="text-base font-bold mb-4">Occupancy</h2>

              <InputGroup
                label="Permanent Residents"
                description="People who live in the home full-time."
              >
                <NumberInput
                  value={residents}
                  onChange={setResidents}
                  min={1}
                  max={20}
                  step={1}
                />
              </InputGroup>

              <InputGroup
                label="Guests"
                description="Largest gathering you regularly host."
              >
                <NumberInput
                  value={guests}
                  onChange={setGuests}
                  min={0}
                  max={50}
                  step={1}
                />
              </InputGroup>
            </div>

            {/* ---- Output ---- */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              {/* Primary result */}
              <div className={`${surfaceBase} p-5`}>
                <p className="text-xs font-semibold opacity-60 uppercase tracking-widest mb-1">
                  Target Ventilation Flow
                </p>
                <div
                  className="purple-light-text"
                  style={{ fontSize: "4rem", fontWeight: 800, lineHeight: 1 }}
                >
                  {targetCFM}
                  <span
                    className="opacity-60"
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: 600,
                      marginLeft: 8,
                    }}
                  >
                    CFM
                  </span>
                </div>
                {/*<CFMGauge targetCFM={targetCFM} />*/}
              </div>

              {/* Breakdown */}
              <div className={`${surfaceBase} p-5`}>
                <h3 className="text-sm font-bold mb-3">How It's Calculated</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr>
                      <td className="text-xs opacity-70 py-1.5">
                        Permanent residents
                      </td>
                      <td
                        className="text-xs font-semibold text-right py-1.5"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {residents}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-xs opacity-70 py-1.5">Guests</td>
                      <td
                        className="text-xs font-semibold text-right py-1.5"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {guests}
                      </td>
                    </tr>
                    <tr
                      style={{
                        borderTop: "1px solid var(--foreground)",
                        opacity: 0.15,
                      }}
                    >
                      <td colSpan={2} style={{ padding: 0, height: 1 }} />
                    </tr>
                    <tr>
                      <td className="text-xs opacity-70 py-1.5">
                        Total people
                      </td>
                      <td
                        className="text-xs font-semibold text-right py-1.5"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {totalPeople}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-xs opacity-70 py-1.5">
                        CFM per person
                      </td>
                      <td
                        className="text-xs font-semibold text-right py-1.5"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        × {CFM_PER_PERSON}
                      </td>
                    </tr>
                    <tr
                      style={{
                        borderTop: "1px solid var(--foreground)",
                        opacity: 0.15,
                      }}
                    >
                      <td colSpan={2} style={{ padding: 0, height: 1 }} />
                    </tr>
                    <tr>
                      <td className="text-sm font-bold py-2">Total CFM</td>
                      <td
                        className="text-sm font-bold text-right py-2 purple-light-text"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {targetCFM} CFM
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Party scenario */}
              <PartyScenarioNote
                totalPeople={totalPeople}
                targetCFM={targetCFM}
              />
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
