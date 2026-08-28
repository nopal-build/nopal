import type { MetaFunction } from "react-router";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { surfaceBase } from "stamps/surface.css";

export const meta: MetaFunction = () => [
  { title: "Thermal Inertia | Nopal Tools" },
  {
    name: "description",
    content:
      "Compare thermal diffusivity of common insulation materials. Understand how thermal inertia affects real-world building comfort beyond R-values alone.",
  },
];

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface InsulationMaterial {
  name: string;
  shortName: string;
  alpha: number; // mm²/s — thermal diffusivity
  k: number; // W/m·K — thermal conductivity
  density: number; // kg/m³
  cp: number; // J/kg·K — specific heat capacity
  rPerInch: number; // hr·ft²·°F/BTU per inch (IP R-value)
  note?: string;
}

type Category = "insulation" | "framing" | "sheathing" | "masonry" | "metal";

interface FullMaterial {
  name: string;
  alpha: number | null; // mm²/s — null for materials where it's not meaningful
  k: number | null; // W/m·K
  density: number | null; // kg/m³
  cp: number | null; // J/kg·K
  rPerInch: number | null; // null for CMU (per-inch not meaningful)
  category: Category;
  note?: string;
}

// Sorted descending by alpha — worst thermal inertia (highest α) first
const INSULATION_DATA: InsulationMaterial[] = [
  {
    name: "Glass Fiber Batt",
    shortName: "Glass Fiber",
    alpha: 3.87,
    k: 0.039,
    density: 12,
    cp: 840,
    rPerInch: 3.7,
    note: "Standard batt, ~0.75 lb/ft³",
  },
  {
    name: "Open Cell Spray Foam",
    shortName: "Open Cell SPF",
    alpha: 3.48,
    k: 0.039,
    density: 8,
    cp: 1400,
    rPerInch: 3.7,
    note: "0.5 lb/ft³ half-pound foam",
  },
  {
    name: "EPS (Expanded Polystyrene)",
    shortName: "EPS",
    alpha: 1.17,
    k: 0.035,
    density: 24,
    cp: 1250,
    rPerInch: 4.2,
    note: "Type II, 1.5 lb/ft³",
  },
  {
    name: "Havelock Wool Insulation",
    shortName: "Havelock Wool",
    alpha: 0.91,
    k: 0.034,
    density: 22,
    cp: 1700,
    rPerInch: 4.3,
    note: "Blown-in; batt version ~R-3.6/in",
  },
  {
    name: "Mineral Wool Batt",
    shortName: "Mineral Wool",
    alpha: 0.89,
    k: 0.036,
    density: 48,
    cp: 840,
    rPerInch: 4.0,
    note: "Stone/rock wool, ~3 lb/ft³",
  },
  {
    name: "Cellulose (Blown-in)",
    shortName: "Cellulose",
    alpha: 0.58,
    k: 0.04,
    density: 43,
    cp: 1600,
    rPerInch: 3.6,
    note: "Dense-pack; recycled paper fiber",
  },
  {
    name: "XPS (Extruded Polystyrene)",
    shortName: "XPS",
    alpha: 0.57,
    k: 0.029,
    density: 35,
    cp: 1450,
    rPerInch: 5.0,
    note: "R-5/in new; ages to ~R-4.2–4.5 over time",
  },
  {
    name: "Gutex Wood Fiber Insulation",
    shortName: "Gutex",
    alpha: 0.52,
    k: 0.038,
    density: 35,
    cp: 2100,
    rPerInch: 3.8,
    note: "Gutex Thermofibre blown-in product",
  },
  {
    name: "Closed Cell Spray Foam",
    shortName: "Closed Cell SPF",
    alpha: 0.46,
    k: 0.022,
    density: 32,
    cp: 1500,
    rPerInch: 6.5,
    note: "2 lb/ft³; R-6.5/in initial value",
  },
  {
    name: "TimberHP Wood Fiber Insulation",
    shortName: "TimberHP",
    alpha: 0.38,
    k: 0.038,
    density: 48,
    cp: 2100,
    rPerInch: 3.8,
    note: "TimberBatt; Maine-made wood fiber",
  },
];

const ALL_MATERIALS: FullMaterial[] = [
  // — Insulation —
  ...INSULATION_DATA.map((m) => ({
    name: m.name,
    alpha: m.alpha,
    k: m.k,
    density: m.density,
    cp: m.cp,
    rPerInch: m.rPerInch,
    category: "insulation" as Category,
    note: m.note,
  })),
  // — Framing —
  {
    name: "Dimensional Lumber",
    alpha: 0.14,
    k: 0.12,
    density: 505,
    cp: 1700,
    rPerInch: 1.25,
    category: "framing",
    note: "Douglas fir, ~12% moisture content",
  },
  // — Sheathing —
  {
    name: "Plywood Sheathing",
    alpha: 0.17,
    k: 0.12,
    density: 540,
    cp: 1300,
    rPerInch: 1.22,
    category: "sheathing",
    note: "Typical structural plywood",
  },
  {
    name: "OSB Sheathing",
    alpha: 0.15,
    k: 0.13,
    density: 650,
    cp: 1300,
    rPerInch: 1.11,
    category: "sheathing",
    note: "Oriented strand board",
  },
  // — Masonry —
  {
    name: 'CMU (8" Normal Weight)',
    alpha: null,
    k: null,
    density: null,
    cp: null,
    rPerInch: null,
    category: "masonry",
    note: '8" hollow block ≈ R-1.11 for entire assembly; per-inch not meaningful†',
  },
  {
    name: "Concrete (3,000 psi)",
    alpha: 0.86,
    k: 1.75,
    density: 2300,
    cp: 880,
    rPerInch: 0.082,
    category: "masonry",
    note: "Normal weight, ~143 lb/ft³",
  },
  // — Metals —
  {
    name: "Mild Steel (1018)",
    alpha: 13.6,
    k: 51.9,
    density: 7870,
    cp: 486,
    rPerInch: 0.0028,
    category: "metal",
    note: "AISI 1018 carbon steel",
  },
  {
    name: "Structural Steel (A36)",
    alpha: 13.8,
    k: 50.0,
    density: 7850,
    cp: 460,
    rPerInch: 0.0029,
    category: "metal",
    note: "ASTM A36",
  },
  {
    name: "Stainless Steel (304)",
    alpha: 4.07,
    k: 16.2,
    density: 7960,
    cp: 500,
    rPerInch: 0.0089,
    category: "metal",
    note: "AISI 304 austenitic SS",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAlphaColor(alpha: number | null): string {
  if (alpha === null) return "var(--text-subtle)";
  if (alpha <= 0.6) return "var(--green)";
  if (alpha <= 1.2) return "var(--green-light)";
  if (alpha <= 4.0) return "#d97706";
  return "var(--red)";
}

function formatR(r: number | null): string {
  if (r === null || r === 0) return "—";
  if (r >= 1) return `R‑${r.toFixed(1)}`;
  if (r >= 0.05) return `R‑${r.toFixed(3)}`;
  return `R‑${r.toFixed(4)}`;
}

function formatU(r: number | null): string {
  if (r === null || r === 0) return "—";
  const u = 1 / r;
  if (u >= 100) return u.toFixed(0);
  if (u >= 10) return u.toFixed(1);
  if (u >= 1) return u.toFixed(2);
  return u.toFixed(3);
}

function formatAlpha(alpha: number | null): string {
  if (alpha === null) return "—";
  return alpha.toFixed(2);
}

const CATEGORY_LABELS: Record<Category, string> = {
  insulation: "Insulation",
  framing: "Framing",
  sheathing: "Sheathing",
  masonry: "Masonry & Concrete",
  metal: "Metals",
};

const CHART_MAX = 4.2; // mm²/s — chart x-axis upper bound

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold mb-1">{children}</h2>;
}

function ChartBar({ material }: { material: InsulationMaterial }) {
  const widthPct = (material.alpha / CHART_MAX) * 100;
  const color = getAlphaColor(material.alpha);

  return (
    <div className="flex items-center gap-2 mb-[5px]">
      {/* Label */}
      <div
        className="text-xs text-right shrink-0 purple-light-text"
        style={{ width: 130 }}
      >
        {material.shortName}
      </div>

      {/* Track */}
      <div
        className="flex-1 relative rounded"
        style={{
          height: 22,
          background: "rgba(63, 43, 70, 0.1)",
        }}
      >
        {/* Filled bar */}
        <div
          style={{
            width: `${widthPct}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: 4,
            minWidth: widthPct > 0 ? 6 : 0,
          }}
        />
        {/* Subtle gridlines at 1, 2, 3 mm²/s */}
        {[1, 2, 3].map((tick) => (
          <div
            key={tick}
            style={{
              position: "absolute",
              left: `${(tick / CHART_MAX) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "rgba(63, 43, 70, 0.18)",
              pointerEvents: "none",
            }}
          />
        ))}
      </div>

      {/* Value */}
      <div
        className="text-xs font-mono shrink-0 tabular-nums"
        style={{ width: 72, color }}
      >
        {material.alpha.toFixed(2)} mm²/s
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const CATEGORIES: Category[] = [
  "insulation",
  "framing",
  "sheathing",
  "masonry",
  "metal",
];

export default function ThermalInertia() {
  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    materials: ALL_MATERIALS.filter((m) => m.category === cat),
  }));

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: 860 }}>
          {/* ---- Header ---- */}
          <h1 className="purple-light-text text-4xl mt-12">Thermal Inertia</h1>
          <p className="text-lg mt-2 mb-6">
            R-value measures steady-state resistance. Thermal diffusivity tells
            you how fast heat actually moves — and how much a material can
            buffer daily temperature swings.
          </p>

          {/* ---- Explainer ---- */}
          <div className={`${surfaceBase} p-4 mb-6`}>
            <h2 className="text-xl font-bold mb-3">
              What is Thermal Diffusivity?
            </h2>
            <p className="text-sm mb-3">
              Thermal diffusivity (α) describes how quickly a temperature change
              propagates through a material. It is the ratio of how fast heat
              conducts to how much heat the material can store per unit volume:
            </p>

            {/* Formula */}
            <div
              className="rounded px-4 py-3 mb-4 text-center"
              style={{ background: "rgba(63, 43, 70, 0.08)" }}
            >
              <span className="font-mono text-base">
                α = k / (ρ · c<sub>p</sub>)
              </span>
            </div>

            {/* Three pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
              <div className={`${surfaceBase} p-3`}>
                <p className="font-semibold mb-1">k &mdash; Conductivity</p>
                <p className="text-xs purple-light-text">
                  How readily heat flows through the material (W/m·K). Higher
                  means heat flows faster.
                </p>
              </div>
              <div className={`${surfaceBase} p-3`}>
                <p className="font-semibold mb-1">ρ &mdash; Density</p>
                <p className="text-xs purple-light-text">
                  Mass per unit volume (kg/m³). More mass means more thermal
                  storage capacity.
                </p>
              </div>
              <div className={`${surfaceBase} p-3`}>
                <p className="font-semibold mb-1">
                  c<sub>p</sub> &mdash; Specific Heat
                </p>
                <p className="text-xs purple-light-text">
                  Energy absorbed per kilogram per degree (J/kg·K). Higher means
                  each kilogram stores more energy.
                </p>
              </div>
            </div>

            <p className="text-sm mb-2">
              A <strong>low α</strong> means the material is slow to respond to
              temperature swings — it absorbs heat during the hot part of the
              day and releases it slowly at night. This is called{" "}
              <strong>thermal inertia</strong>.
            </p>
            <p className="text-sm">
              Standard R-value describes steady-state performance: how much heat
              flows per hour when the temperature difference is held constant.
              Real buildings never experience steady-state — outdoor
              temperatures swing 20–40°F between day and night. Two walls with
              the same R-value but different thermal diffusivities will perform
              very differently under real climate conditions.
            </p>
          </div>

          {/* ---- Bar Chart ---- */}
          <div className={`${surfaceBase} p-4 mb-6`}>
            <SectionHeading>
              Thermal Diffusivity by Insulation Type
            </SectionHeading>
            <p className="text-xs purple-light-text mb-4">
              α in mm²/s &mdash; lower values indicate better thermal inertia.
              Sorted from highest (poorest) to lowest (best).
            </p>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4">
              {(
                [
                  { label: "Excellent  ≤ 0.60", color: "var(--green)" },
                  {
                    label: "Good  0.60 – 1.20",
                    color: "var(--green-light)",
                  },
                  { label: "Fair  1.20 – 4.00", color: "#d97706" },
                  { label: "Poor  > 4.00", color: "var(--red)" },
                ] as const
              ).map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1 text-xs">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      backgroundColor: color,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span className="purple-light-text">{label}</span>
                </div>
              ))}
            </div>

            {/* Scale header — aligns with bar track */}
            <div className="flex items-end gap-2 mb-1">
              <div className="shrink-0" style={{ width: 130 }} />
              <div className="flex-1 relative" style={{ height: 14 }}>
                {[0, 1, 2, 3].map((tick) => (
                  <span
                    key={tick}
                    className="absolute text-xs purple-light-text"
                    style={{
                      left: `${(tick / CHART_MAX) * 100}%`,
                      bottom: 0,
                      transform: tick === 0 ? "none" : "translateX(-50%)",
                    }}
                  >
                    {tick}
                  </span>
                ))}
                <span
                  className="absolute text-xs purple-light-text"
                  style={{ right: 0, bottom: 0 }}
                >
                  4 mm²/s →
                </span>
              </div>
              <div className="shrink-0" style={{ width: 72 }} />
            </div>

            {/* Bars */}
            {INSULATION_DATA.map((m) => (
              <ChartBar key={m.name} material={m} />
            ))}

            <p className="text-xs mt-3 purple-light-text">
              Values are representative midpoints computed from α = k / (ρ·c
              <sub>p</sub>). Actual performance varies by product density,
              moisture content, and installation method.
            </p>
          </div>

          {/* ---- Key Observations ---- */}
          <div className={`${surfaceBase} p-4 mb-6`}>
            <SectionHeading>Key Observations</SectionHeading>
            <ul className="mt-3 space-y-4">
              {[
                {
                  title: "Density is the hidden variable.",
                  body: "Glass fiber and open-cell spray foam have nearly the same R-value as cellulose — but 6–7× higher thermal diffusivity. At 8–12 kg/m³ (0.5–0.75 lb/ft³), these materials are mostly air. Any heat that enters the assembly stores almost nothing in the fibers themselves and travels through quickly.",
                },
                {
                  title: "Wood fiber stands apart.",
                  body: "Gutex and TimberHP wood fiber insulations have a specific heat capacity of 2,100 J/kg·K — more than 2.5× higher than glass fiber or mineral wool (840 J/kg·K). Combined with moderate density, their volumetric heat capacity is roughly 7–10× greater than fiberglass. This is why wood fiber is prized in passive solar and hygrothermal design.",
                },
                {
                  title: "Cellulose punches above its R-value.",
                  body: "Cellulose has similar R-values to fiberglass (~R-3.6–3.7/in) but roughly 6× better thermal inertia. Its density of ~43 kg/m³ (versus ~12 kg/m³ for fiberglass) is entirely responsible. Dense-pack cellulose significantly delays the daily heat wave.",
                },
                {
                  title: "High R-value ≠ high thermal inertia.",
                  body: "Closed cell spray foam achieves the best R-value per inch of any insulation here (R-6.5/in) but lands in the same thermal inertia tier as cellulose and XPS. Thermal diffusivity and R-value are independent properties measuring different things — one matters for hourly comfort, the other for annual energy loads.",
                },
              ].map(({ title, body }) => (
                <li key={title} className="flex gap-3 text-sm">
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: "var(--green)",
                      marginTop: 5,
                    }}
                  />
                  <p>
                    <strong>{title}</strong> {body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* ---- Properties Table ---- */}
          <div className="mb-12">
            <h2 className="text-xl font-bold mb-1">Material Properties</h2>
            <p className="text-xs purple-light-text mb-4">
              Includes insulation and common structural materials for
              comparison. R-value and U-value shown per inch of thickness (IP
              units).
            </p>

            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ borderCollapse: "collapse", minWidth: 660 }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--foreground)" }}>
                    <th className="text-left py-2 pr-4 font-semibold">
                      Material
                    </th>
                    <th className="text-right py-2 px-3 font-semibold">
                      Density
                      <div className="font-normal text-xs purple-light-text">
                        kg/m³
                      </div>
                    </th>
                    <th className="text-right py-2 px-3 font-semibold whitespace-nowrap">
                      Specific Heat
                      <div className="font-normal text-xs purple-light-text">
                        J/kg·K
                      </div>
                    </th>
                    <th className="text-right py-2 px-3 font-semibold whitespace-nowrap">
                      Diffusivity
                      <div className="font-normal text-xs purple-light-text">
                        mm²/s
                      </div>
                    </th>
                    <th className="text-right py-2 px-3 font-semibold whitespace-nowrap">
                      R-Value
                      <div className="font-normal text-xs purple-light-text">
                        per inch
                      </div>
                    </th>
                    <th className="text-right py-2 pl-3 pr-1 font-semibold whitespace-nowrap">
                      U-Value
                      <div className="font-normal text-xs purple-light-text">
                        per inch
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.flatMap(({ category, materials }) => [
                    <tr key={`cat-${category}`}>
                      <td
                        colSpan={6}
                        className="pt-5 pb-1 text-xs font-semibold uppercase tracking-wider purple-light-text"
                      >
                        {CATEGORY_LABELS[category]}
                      </td>
                    </tr>,
                    ...materials.map((m) => (
                      <tr
                        key={m.name}
                        style={{ borderBottom: "1px solid var(--foreground)" }}
                      >
                        {/* Material name + note */}
                        <td className="py-2 pr-4">
                          <div className="font-medium">{m.name}</div>
                          {m.note && (
                            <div className="text-xs purple-light-text">
                              {m.note}
                            </div>
                          )}
                        </td>

                        {/* Density */}
                        <td className="text-right py-2 px-3 font-mono text-sm tabular-nums">
                          {m.density ?? "—"}
                        </td>

                        {/* Specific heat */}
                        <td className="text-right py-2 px-3 font-mono text-sm tabular-nums">
                          {m.cp?.toLocaleString() ?? "—"}
                        </td>

                        {/* Thermal diffusivity — color coded */}
                        <td
                          className="text-right py-2 px-3 font-mono text-sm font-semibold tabular-nums"
                          style={{ color: getAlphaColor(m.alpha) }}
                        >
                          {formatAlpha(m.alpha)}
                        </td>

                        {/* R-value */}
                        <td className="text-right py-2 px-3 font-mono text-sm tabular-nums">
                          {formatR(m.rPerInch)}
                        </td>

                        {/* U-value */}
                        <td className="text-right py-2 pl-3 pr-1 font-mono text-sm tabular-nums">
                          {formatU(m.rPerInch)}
                        </td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>

            <div className="text-xs mt-4 space-y-1 purple-light-text">
              <p>
                † CMU: An 8&quot; normal-weight hollow concrete block has an
                assembly R-value of ~R-1.11. Because the hollow cores dominate
                the heat path, a per-inch value is not a useful comparison to
                solid materials.
              </p>
              <p>
                All values are representative midpoints. Sources: ASHRAE
                Handbook of Fundamentals, NIST NSRDB, manufacturer data sheets
                (Havelock, Gutex, TimberHP).
              </p>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
