# Thermal Properties Reference — Building Materials

**Compiled from:** ASHRAE Fundamentals (2021), ASTM C578, NIST SRD 81, USDA Forest Products
Laboratory (FPL-GTR-190), ACI 122R-14, NCMA TEK, MatWeb, manufacturer data sheets (Havelock
Wool, Gutex, TimberHP, ROCKWOOL), FSRI Materials Database, TenWolde et al. 1988 (USDA/DOE).

**All values at ~20–25 °C / 75 °F unless otherwise noted.**

---

## Unit Conversion Notes

| Quantity | Conversion |
|---|---|
| Thermal conductivity | 1 W/m·K = 6.9325 BTU·in/hr·ft²·°F |
| R-value per inch (IP→SI) | R_SI [m²·K/W per 25.4 mm] = R_IP / 6.9325 |
| Thermal diffusivity | α = k / (ρ · cₚ) |
| R/inch (from SI k) | R/inch = 1 / (k\[W/m·K\] × 6.9325) |
| U/inch (from R/inch) | U = 1 / R |

---

## Part 1 — Insulation Materials

---

### 1. Cellulose — Blown-In (Loose Fill)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | 0.039–0.046 W/m·K | Design value: **0.040 W/m·K** at ~24 °C |
| **Density ρ** | 37–51 kg/m³ (2.3–3.2 lb/ft³) | Loose-fill typical installed: **43 kg/m³** (~2.7 lb/ft³); dense-pack wall up to 56 kg/m³ |
| **Specific Heat cₚ** | **1,600 J/kg·K** | FSRI measured 1,533–1,741 J/kg·K at 10–40 °C (unconditioned) |
| **Thermal Diffusivity α** | **5.8 × 10⁻⁷ m²/s** (0.58 mm²/s) | Calculated: 0.040 / (43 × 1,600) |
| **R-Value/inch (IP)** | **3.6–3.8 hr·ft²·°F/BTU per inch** | Typical rated: ~3.7/inch; FTC-labeled product typically 3.5–3.8 |
| **U-Value/inch (IP)** | **0.263–0.278 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** ASHRAE 2021 Fundamentals Ch. 26 Table 2; NIST SRD 81; FSRI Materials Database
(cellulose insulation data); ASTM C739 (standard spec for cellulose).

**Notes:**
- Thermal conductivity increases modestly with moisture content.
- Installed density significantly affects R-value; attic loose-fill (low density) slightly lower per inch than
  dense-pack wall applications.
- Recycled newspaper content treated with borate fire retardant.

---

### 2. Glass Fiber — Fiberglass Batt

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.038–0.040 W/m·K** | Standard batt; high-density batt: 0.031–0.036 W/m·K |
| **Density ρ** | 9–23 kg/m³ (0.55–1.41 lb/ft³) | R-13 (3.5"): ~12 kg/m³; R-15 HD (3.5"): ~23 kg/m³ |
| **Specific Heat cₚ** | **840 J/kg·K** | Glass/silica fiber; standard value (ASHRAE, NIST) |
| **Thermal Diffusivity α** | **3.8 × 10⁻⁶ m²/s** (3.8 mm²/s) | Calculated: 0.040 / (12 × 840); high α due to very low bulk density |
| **R-Value/inch (IP)** | **3.1–4.3 hr·ft²·°F/BTU per inch** | Standard batt (R-13/3.5"): **3.7/inch**; HD batt (R-15/3.5"): **4.3/inch** |
| **U-Value/inch (IP)** | **0.23–0.32 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** NIST BEES Generic Fiberglass Product Sheet; ASHRAE 2021 Fundamentals; ASTM C665
(mineral fiber batts); Oak Ridge National Laboratory fiberglass R-value studies.

**Notes:**
- High apparent thermal diffusivity reflects very low ρ·cₚ product (mostly air); temperature waves
  propagate easily but steady-state heat flux is well-resisted.
- R-19 batt at 6.25": density ~7 kg/m³, R ≈ 3.0/inch (lower density = lower R/inch).
- No meaningful moisture resistance; vapor-permeable.

---

### 3. Mineral Wool — Rock Wool / Stone Wool Batt

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.033–0.040 W/m·K** | Design value: **0.036–0.038 W/m·K**; technical pipe insulation: 0.034 W/m·K |
| **Density ρ** | 40–128 kg/m³ (2.5–8.0 lb/ft³) | Building batts: **48–80 kg/m³**; technical insulation: 96–128 kg/m³; loose fill: 27–50 kg/m³ |
| **Specific Heat cₚ** | **840 J/kg·K** | Rock/slag wool (basalt-based); standard ASHRAE/NIST value |
| **Thermal Diffusivity α** | **0.94 × 10⁻⁶ m²/s** (0.94 mm²/s) | At 48 kg/m³, k = 0.038: 0.038 / (48 × 840) |
| **R-Value/inch (IP)** | **3.7–4.3 hr·ft²·°F/BTU per inch** | Building batts: **~3.7–4.2/inch**; ROCKWOOL technical insulation: **4.1/inch** (ASTM C518 @ 75 °F) |
| **U-Value/inch (IP)** | **0.23–0.27 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** ROCKWOOL Technical Insulation Product Data Sheet (ASTM C518); ROCKWOOL Thermalrock S
Technical Data Sheet; NIST BEES Generic Mineral Wool; ASHRAE 2021 Fundamentals.

**Notes:**
- Non-combustible (melting point > 1,000 °C); Euroclass A1 / ASTM E136 non-combustible.
- Higher density → higher R/inch (denser product packs more fiber, reducing radiation heat transfer).
- ROCKWOOL ComfortBatt R-15 at 3.5" = R-4.3/inch (high-density variant).

---

### 4. Closed-Cell Spray Foam — ccSPF (Medium Density)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.020–0.026 W/m·K** | Aged (90-day, ASTM C518); HFO-blown: **~0.022 W/m·K**; HFC-blown: **~0.024 W/m·K** |
| **Density ρ** | 24–48 kg/m³ (1.5–3.0 lb/ft³) | Typical wall application: **32 kg/m³** (2.0 lb/ft³) |
| **Specific Heat cₚ** | **1,400–1,600 J/kg·K** | Rigid polyurethane foam; use **1,500 J/kg·K** |
| **Thermal Diffusivity α** | **4.6 × 10⁻⁷ m²/s** (0.46 mm²/s) | At 32 kg/m³, k = 0.022: 0.022 / (32 × 1,500) |
| **R-Value/inch (IP)** | **5.8–7.0 hr·ft²·°F/BTU per inch** | HFO-blown (current): **~6.5/inch**; HFC-blown (older): **~6.0/inch** |
| **U-Value/inch (IP)** | **0.143–0.172 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** American Chemistry Council / Spray Polyurethane Foam Alliance (SPFA) Performance Data;
ASTM C518; DOE Building America Spray Foam Guide (2009); industry TDS from Huntsman, BASF.

**Notes:**
- Vapor retarder at ≥2" (Class II per IRC); acts as air barrier.
- Applied in 2"–3" lifts maximum per pass; total thickness requires multiple passes.
- R-value declared at 90-day aged condition per FTC Labeling Rule.
- Blowing agent: HFO (hydrofluoroolefin) in current low-GWP formulations; older HFC products
  slightly lower initial R-value.

---

### 5. Open-Cell Spray Foam — ocSPF (Low Density)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.037–0.048 W/m·K** | Typical: **0.039 W/m·K** (R-3.7/inch); blowing agent = water |
| **Density ρ** | 8–22 kg/m³ (0.5–1.4 lb/ft³) | Standard 0.5 lb/ft³ product: **8 kg/m³** |
| **Specific Heat cₚ** | **1,400 J/kg·K** | Open-cell polyurethane; approximate |
| **Thermal Diffusivity α** | **3.5 × 10⁻⁶ m²/s** (3.5 mm²/s) | At 8 kg/m³, k = 0.039: 0.039 / (8 × 1,400); very high α due to low density |
| **R-Value/inch (IP)** | **3.6–4.5 hr·ft²·°F/BTU per inch** | Typical: **3.7/inch** (0.5 lb/ft³ product); higher density variant: up to 4.5/inch |
| **U-Value/inch (IP)** | **0.22–0.28 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** American Chemistry Council / SPFA Performance Data; Tiger Foam Technical Data Sheet
(ASTM C518, 90-day aged @ 60 °C: R-4.3/inch); Huntsman Building Solutions product TDS.

**Notes:**
- Vapor-permeable (≈10 perms/inch); NOT a vapor retarder without additional membrane.
- Excellent air barrier at installed thicknesses ≥3.5".
- Expands ~100× volume; applied in a single pass at full depth (up to 10").
- High α means low thermal mass / heat storage; poor phase-shift performance.

---

### 6. EPS — Expanded Polystyrene

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.031–0.038 W/m·K** | Varies with density; Type I: **0.0375 W/m·K**; Type II: **0.0346 W/m·K** |
| **Density ρ** | 12–48 kg/m³ (0.75–3.0 lb/ft³) | **Type I** (1.0 pcf): **16 kg/m³** [most common]; **Type II** (1.5 pcf): **24 kg/m³**; Type IX (2.0 pcf): **32 kg/m³** |
| **Specific Heat cₚ** | **1,250 J/kg·K** | Polystyrene foam; standard value |
| **Thermal Diffusivity α** | **Type I: 1.88 × 10⁻⁶ m²/s** (1.88 mm²/s) | 0.0375 / (16 × 1,250); **Type II: 1.15 × 10⁻⁶ m²/s** (1.15 mm²/s) |
| **R-Value/inch (IP) @ 75 °F** | **Type I: 3.85 / Type II: 4.17 / Type IX: 4.35** hr·ft²·°F/BTU per inch | ASTM C578 minimum; tested per ASTM C518 |
| **U-Value/inch (IP)** | **0.23–0.26 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** ASTM C578 Standard Specification for Rigid Cellular Polystyrene Thermal Insulation;
Northwest Foam Products ASTM C578 data table; Universal Construction Foam EPS Physical Properties
sheet; ASHRAE 2021 Fundamentals.

**Notes:**
- Blowing agent = pentane (rapidly replaced by air after manufacturing); R-value is stable long-term.
- R-value **increases at lower temperatures** (better winter performance than XPS).
- Water vapor permeance: 2.0–5.0 perms per inch (Type I); decreases with increasing density.
- Max continuous service temperature: 74 °C (165 °F).

---

### 7. XPS — Extruded Polystyrene

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.029–0.033 W/m·K** | New product: **0.0288 W/m·K** (R-5.0/inch); long-term aged: ~0.032–0.035 W/m·K |
| **Density ρ** | 25–56 kg/m³ (1.5–3.5 lb/ft³) | Standard boards: **32–38 kg/m³** (2–2.4 lb/ft³) |
| **Specific Heat cₚ** | **1,450 J/kg·K** | Polystyrene foam with residual blowing agent |
| **Thermal Diffusivity α** | **5.7 × 10⁻⁷ m²/s** (0.57 mm²/s) | At 35 kg/m³, k = 0.0288: 0.0288 / (35 × 1,450) |
| **R-Value/inch (IP) @ 75 °F** | **5.0 hr·ft²·°F/BTU per inch** (new) | ASTM C578 all Types; FTC-required rated value. Long-term aged ~4.2–4.5/inch |
| **U-Value/inch (IP)** | **0.200 BTU/hr·ft²·°F per inch** (new) | 1 / R |

**Sources:** ASTM C578; DuPont/Owens Corning XPS vs EPS Technical Comparison; ASCE 32-01
(in-service effective design R-values for below-grade); ASHRAE 2021 Fundamentals.

**Notes:**
- Blowing agent = HFC or HFO (retained in closed cells); R-value **degrades over 20–30 years** as
  blowing agent escapes. ASCE 32-01 long-term below-grade effective values: ~4.2–4.5/inch.
- Highest compressive strength of rigid foam boards; preferred for below-slab and green-roof applications.
- Low water absorption (<0.3% by volume per ASTM C578); suitable for below-grade.
- ASTM C578 lists XPS as a single type category for all densities (unlike EPS's multiple types).

---

### 8. Wool Insulation — Havelock Brand (Sheep's Wool)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **Blown-in: 0.034 W/m·K / Batt: 0.040 W/m·K** | From R-value data: blown-in k = 1/(4.3 × 6.9325); batt k = 1/(3.6 × 6.9325) |
| **Density ρ** | **Blown-in: ~22 kg/m³ (1.4 lb/ft³) / Batt: ~25 kg/m³ (1.6 lb/ft³)** | Estimated from coverage data on product TDS; typical sheep's wool insulation range |
| **Specific Heat cₚ** | **1,700 J/kg·K** | Protein (keratin) matrix; high cp vs. synthetic fibers; literature value for wool fiber |
| **Thermal Diffusivity α** | **Blown-in: 9.0 × 10⁻⁷ m²/s** (0.90 mm²/s) | 0.034 / (22 × 1,700) |
| | **Batt: 9.4 × 10⁻⁷ m²/s** (0.94 mm²/s) | 0.040 / (25 × 1,700) |
| **R-Value/inch (IP)** | **Blown-in: 4.3 / Batt: 3.6** hr·ft²·°F/BTU per inch | Havelock manufacturer specification; ASTM C518 test |
| **U-Value/inch (IP)** | **Blown-in: 0.233 / Batt: 0.278** BTU/hr·ft²·°F per inch | 1 / R |

**Sources:** Havelock Wool Full Spec Sheet (Nov 2022); Azure Magazine spec sheet (R-4.3 blown-in,
R-3.6 batt); ASTM C518.

**Notes:**
- 100% sheep's wool; no synthetic binders or chemical mix.
- Absorbs and releases moisture vapor without significant R-value degradation; resists mold.
- Absorbs formaldehyde, NOₓ, SO₂ (indoor air quality benefit).
- 50-year material warranty.
- Blown-in installation requires commercial vacuum/blower (not standard insulation blower).
- High cₚ relative to synthetic insulation → better thermal mass and phase-shift performance.
- Density estimates based on coverage calculations from TDS bag weight and coverage area data.

---

### 9. Wood Fiber Insulation — Gutex Brand

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **Thermofibre (blown): 0.038 W/m·K / Thermoflex (batt): 0.036 W/m·K** | Nominal declared values (λD) per EN 12667; design values (λB) +0.002 W/m·K |
| **Density ρ** | **Thermofibre: 25–45 kg/m³** / **Thermoflex: ~50 kg/m³** / **Rigid boards: 100–270 kg/m³** | Thermofibre blow-in exposed: 25–30 kg/m³; enclosed: 29–45 kg/m³ |
| **Specific Heat cₚ** | **2,100 J/kg·K** | Manufacturer stated value (Gutex TDS); significantly higher than synthetic insulations |
| **Thermal Diffusivity α** | **Thermofibre (35 kg/m³): 5.2 × 10⁻⁷ m²/s** (0.52 mm²/s) | 0.038 / (35 × 2,100) |
| | **Thermoflex (50 kg/m³): 3.4 × 10⁻⁷ m²/s** (0.34 mm²/s) | 0.036 / (50 × 2,100) |
| **R-Value/inch (IP)** | **Thermofibre: 3.80 / Thermoflex: 4.01** hr·ft²·°F/BTU per inch | Calculated from λD; design values slightly lower |
| **U-Value/inch (IP)** | **Thermofibre: 0.263 / Thermoflex: 0.249** BTU/hr·ft²·°F per inch | 1 / R |

**Sources:** Gutex Thermofibre Technical Data Sheet (2025-06-03); Gutex Thermoflex Technical Data Sheet
(2023-06-16); Ecological Building Systems product documentation; EN 12667, EN 13171.

**Notes:**
- Made from untreated fir and spruce; ammonium salt flame retardant (5–6%).
- The very high cₚ (2,100 J/kg·K vs. 840–1,250 for synthetic foams) provides excellent **thermal mass
  / heat storage capacity** and summer overheating protection ("phase shift").
- Vapor-open (µ = 1–2); moisture-buffering capability.
- Rigid board products (Thermowall, Multitherm): λ = 0.038–0.040 W/m·K; density 140–270 kg/m³.
- ETA-12/0181 European Technical Assessment.

---

### 10. Wood Fiber Insulation — TimberHP Brand

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **TimberBatt: 0.037–0.040 W/m·K / TimberBoard: 0.039–0.042 W/m·K / TimberFill: 0.038–0.042 W/m·K** | Calculated from R-values using k = 1/(R × 6.9325) |
| **Density ρ** | **TimberBatt: ~48 kg/m³ (3 lb/ft³)** | TimberBoard: 109–151 kg/m³ (6.8–9.4 lb/ft³); TimberFill dense-pack: ~48–80 kg/m³ |
| **Specific Heat cₚ** | **2,100 J/kg·K** | Wood fiber; same as Gutex (consistent with EN 12524 wood fiber value) |
| **Thermal Diffusivity α** | **TimberBatt: 3.7 × 10⁻⁷ m²/s** (0.37 mm²/s) | 0.037 / (48 × 2,100) |
| | **TimberBoard (130 kg/m³): 1.5 × 10⁻⁷ m²/s** (0.15 mm²/s) | 0.040 / (130 × 2,100) |
| **R-Value/inch (IP)** | **TimberBatt: 3.7–4.0 / TimberBoard: 3.4–3.7 / TimberFill loose: ~3.4 / TimberFill dense-pack: ~3.8** hr·ft²·°F/BTU per inch | TimberHP product pages; ASTM C518 |
| **U-Value/inch (IP)** | **0.25–0.29** BTU/hr·ft²·°F per inch | 1 / R range |

**Sources:** TimberHP product pages (timberhp.com) — TimberBatt, TimberBoard, TimberFill technical
specifications; ICC-ES Evaluation Reports for each product; ASTM C518.

**Notes:**
- Made from Maine softwood wood fiber (spruce/fir residuals); liquid borate fire retardant.
- Vapor-permeable (~44–46 perms at 1 inch); suitable for vapor-open assemblies.
- Declare Labeled and Red List Free.
- Like Gutex, the very high cₚ (2,100 J/kg·K) gives excellent thermal phase-shift and buffering.
- TimberBoard is a rigid CI board; TimberBatt is a batt for cavity fill; TimberFill is loose/blown.

---

## Part 2 — Non-Insulation Building Materials

---

### 11. Dimensional Lumber — Douglas Fir / Typical Framing Softwood

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.12 W/m·K** across grain | ASHRAE 2021 Fundamentals design value at 12% MC; TenWolde equation gives ~0.14 W/m·K |
| **Density ρ** | **480–530 kg/m³** | Douglas Fir at 12% MC; SG ≈ 0.48–0.50. Hem-fir/SPF similar (~430–510 kg/m³) |
| **Specific Heat cₚ** | **1,700 J/kg·K** | At 12% MC (includes bound moisture contribution); dry wood ~1,300–1,500 J/kg·K |
| **Thermal Diffusivity α** | **1.4 × 10⁻⁷ m²/s** (0.14 mm²/s) | 0.12 / (500 × 1,700) at ρ = 500 kg/m³ |
| **R-Value/inch (IP)** | **1.25 hr·ft²·°F/BTU per inch** | ASHRAE standard value (across grain, 12% MC) |
| **U-Value/inch (IP)** | **0.80 BTU/hr·ft²·°F per inch** | 1 / 1.25 |

**Sources:** ASHRAE 2021 Fundamentals Ch. 26 Table 2; USDA Forest Products Laboratory Wood Handbook
FPL-GTR-190, Chapter 4 (Thermal Properties); TenWolde, McNatt & Krahn (1988) DOE/USDA-21697-1;
BSC/DOE Building Materials Property Table.

**Notes:**
- Thermal conductivity for structural purposes is **across-the-grain** (perpendicular to fibers).
- Along-grain k is 2–3× higher (~0.30–0.40 W/m·K) but not relevant for wall/floor assemblies.
- k increases ~1–3% per 1% increase in moisture content above FSP.
- Typical framing species (SPF, Hem-Fir, Southern Yellow Pine) have similar thermal properties;
  denser species (SYP, Doug Fir) slightly higher k vs. lighter species (SPF).
- TenWolde equation: k = SG × (0.1941 + 0.004064 × MC) + 0.01864 [W/m·K]

---

### 12. Plywood Sheathing — Structural (CDX / BCX grade)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.12 W/m·K** | ASHRAE 2021; FSRI measured 0.113 W/m·K (unconditioned, 15 °C) |
| **Density ρ** | **500–560 kg/m³** | Typical structural plywood (Douglas Fir/Southern Pine face): **~540 kg/m³** |
| **Specific Heat cₚ** | **1,300 J/kg·K** | FSRI measured 1,383 J/kg·K (unconditioned at 20 °C); dried ~1,191 J/kg·K |
| **Thermal Diffusivity α** | **1.7 × 10⁻⁷ m²/s** (0.17 mm²/s) | 0.12 / (540 × 1,300) |
| **R-Value/inch (IP)** | **1.20–1.25 hr·ft²·°F/BTU per inch** | ASHRAE; BSC table gives R-0.5 per 3/8" → 1.33/inch |
| **U-Value/inch (IP)** | **0.80–0.83 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** ASHRAE 2021 Fundamentals Ch. 26; FSRI Materials & Products Database (Plywood entry);
TenWolde et al. 1988; BSC/DOE Building Materials Property Table (ASHRAE 2001 reference).

**Notes:**
- Properties vary by species and glue type; softwood plywood slightly lower k than hardwood.
- k increases notably with moisture content above ~6% MC.
- Water vapor permeance: 0.75 dry-cup / 3.5 wet-cup perm·inch (CDX).

---

### 13. OSB Sheathing — Oriented Strand Board (7/16" typical)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **0.13 W/m·K** | Across-panel; slightly higher than plywood due to higher density and resin content |
| **Density ρ** | **630–680 kg/m³** | Typical: **650 kg/m³** (per NIST BEES data: 7.15 kg/m² ÷ 0.011 m) |
| **Specific Heat cₚ** | **1,300 J/kg·K** | Wood fiber composite; similar to plywood |
| **Thermal Diffusivity α** | **1.5 × 10⁻⁷ m²/s** (0.15 mm²/s) | 0.13 / (650 × 1,300) |
| **R-Value/inch (IP)** | **1.11–1.33 hr·ft²·°F/BTU per inch** | Lower bound from k = 0.13; upper from BSC table (R-0.5 per 3/8") |
| **U-Value/inch (IP)** | **0.75–0.90 BTU/hr·ft²·°F per inch** | 1 / R |

**Sources:** NIST BEES Generic Oriented Strand Board Sheathing product data; ASHRAE 2021 Fundamentals;
TenWolde et al. 1988; ORNL/ASHRAE building materials data.

**Notes:**
- Denser than plywood; lower vapor permeance (~0.75 dry-cup / 2.0 wet-cup perm·inch for 3/8").
- OSB water vapor permeance increases only marginally with increased relative humidity (unlike plywood).
- k similar to plywood; both commonly listed together in energy codes.
- Constituents: ~95% wood strands, ~5% resin (PF + MDI) and wax.

---

### 14. CMU — 8" Normal Weight Hollow Block (No Fill)

> **Note:** CMU is an **assembly**, not a homogeneous material. Two sets of values are given:
> (a) the concrete **material** in the block webs/face shells, and (b) the **whole-block assembly**.

#### (a) Concrete Material in Block

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **1.4–2.0 W/m·K** | Depends on aggregate; NWC (≥120 pcf) with sand/gravel aggregate: **~1.6 W/m·K** |
| **Density ρ** | **1,900–2,200 kg/m³** | Block face/web concrete; normal weight aggregate |
| **Specific Heat cₚ** | **880 J/kg·K** | Normal weight concrete; ASHRAE / ACI 122R-14 |
| **Thermal Diffusivity α** | **~8.6 × 10⁻⁷ m²/s** (0.86 mm²/s) | 1.6 / (2,100 × 880) representative estimate |

#### (b) Whole-Block Assembly (8" Hollow CMU, Normal Weight, No Fill)

| Property | Value | Notes |
|---|---|---|
| **Block R-value** | **~1.11 hr·ft²·°F/BTU** (for full 8" unit) | ASHRAE 2021 Fundamentals Table 4; NW hollow (> 125 pcf avg. density) |
| **Effective R/inch** | **~0.14 hr·ft²·°F/BTU per inch** | 1.11 ÷ 8 in. (approximate; not appropriate for direct per-inch comparison) |
| **Effective U/inch** | **~7.2 BTU/hr·ft²·°F per inch** | 1 / 0.14 |
| **Heat Capacity (HC)** | **~19–22 BTU/ft²·°F** | From NCMA TEK 06-16A; NW wall >7 Btu/ft²·°F → qualifies as "mass wall" |

**Sources:** ASHRAE 2021 Fundamentals Ch. 27 Table 4 (Masonry block assemblies); NCMA TEK 06-12E
(Concrete Masonry in IECC); NCMA TEK 06-16A (Heat Capacity of CMU Walls); ACI 122R-14 Guide to
Thermal Properties of Concrete and Masonry Systems.

**Notes:**
- R-value of hollow block is NOT additive per inch in the same way as homogeneous materials; the
  "per inch" value is only an approximation of the assembly behavior.
- Normal weight (> 125 pcf aggregate density) has **lower** R per block than medium or lightweight CMU.
  - Medium weight (~105 pcf / 1,680 kg/m³): R ≈ 2.0–2.2 per 8" block
  - Lightweight (~80 pcf / 1,280 kg/m³): R ≈ 2.5–3.3 per 8" block
- Thermal mass (heat capacity) is the primary energy performance advantage; qualifies as ASHRAE 90.1
  "mass wall" at HC > 7 Btu/ft²·°F, enabling reduced R-value requirements in many climate zones.
- Solid-grouted or foam-filled cores change assembly R-value significantly.

---

### 15. Concrete — Normal Weight, 3,000 psi (≈20.7 MPa)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **1.6–2.1 W/m·K** | NWC 20–25 MPa; **typical design value: 1.75 W/m·K** (ASHRAE/ACI); range per Talebi et al. 2020 |
| **Density ρ** | **2,200–2,400 kg/m³** | Standard normal weight: **2,300 kg/m³** per ASTM C138 |
| **Specific Heat cₚ** | **840–1,000 J/kg·K** | ASHRAE uses **880 J/kg·K**; ACI 122R-14 uses 900 J/kg·K; dry concrete ~840 J/kg·K |
| **Thermal Diffusivity α** | **8.6 × 10⁻⁷ m²/s** (0.86 mm²/s) | 1.75 / (2,300 × 880) |
| **R-Value/inch (IP)** | **0.082 hr·ft²·°F/BTU per inch** | 1 / (1.75 × 6.9325) = 1/12.13 |
| **U-Value/inch (IP)** | **12.1 BTU/hr·ft²·°F per inch** | 1 / 0.082 |

**Sources:** ACI 122R-14 Guide to Thermal Properties of Concrete and Masonry Systems; ASHRAE 2021
Fundamentals; Talebi, Kayan et al. (2020) "Investigation of Thermal Properties of Normal Weight
Concrete for Different Strength Classes," *Journal of Environmental Treatment Techniques* 8(3):908–914;
ASTM C177 / C518.

**Notes:**
- k varies significantly with aggregate type: siliceous/quartzite aggregate → higher k (up to 2.1 W/m·K);
  limestone/basalt aggregate → lower k (~1.4–1.8 W/m·K).
- Higher w/c ratio and porosity → slightly lower k.
- Concrete is a high-thermal-mass material; R/inch is low but heat capacity is substantial.
- Saturated concrete has higher k (water ~0.6 W/m·K fills pores); dry concrete slightly lower.

---

### 16. Mild Steel — AISI 1018 (Cold Drawn / Hot Rolled)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **49.8–51.9 W/m·K** | MatWeb: **51.9 W/m·K** (estimated from similar low-carbon steels); typical range for 0.1–0.2% C |
| **Density ρ** | **7,870 kg/m³** | MatWeb / ASM standard value |
| **Specific Heat cₚ** | **486 J/kg·K** | MatWeb (annealed, 50–100 °C); AISI 1018 |
| **Thermal Diffusivity α** | **1.36 × 10⁻⁵ m²/s** (13.6 mm²/s) | 51.9 / (7,870 × 486) |
| **R-Value/inch (IP)** | **0.0028 hr·ft²·°F/BTU per inch** | 1 / (51.9 × 6.9325) = 1/359.8; negligible |
| **U-Value/inch (IP)** | **360 BTU/hr·ft²·°F per inch** | Essentially a perfect conductor vs. insulation |

**Sources:** MatWeb AISI 1018 Steel Cold Drawn datasheet (AMS 5069, ASTM A108, UNS G10180);
ASM International materials database.

**Notes:**
- Composition: 0.14–0.20% C, 0.60–0.90% Mn, balance Fe.
- k is estimated from similar low-carbon steels; direct measurements vary ±5–10%.
- Thermal properties nearly identical to A36; differences are in mechanical properties.
- Thermal conductivity **decreases** with temperature above ~100 °C.

---

### 17. Structural Steel — ASTM A36

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **50 W/m·K** | AISC/engineering standard; range from sources: 48–54 W/m·K at ambient |
| **Density ρ** | **7,850 kg/m³** | AISC / ASTM standard; typical A36 (Fe-Mn-Si alloy) |
| **Specific Heat cₚ** | **459–486 J/kg·K** | Engineering Database: **459 J/kg·K**; AISC thermal: **460 J/kg·K** |
| **Thermal Diffusivity α** | **1.38 × 10⁻⁵ m²/s** (13.8 mm²/s) | 50 / (7,850 × 460) |
| **R-Value/inch (IP)** | **0.0029 hr·ft²·°F/BTU per inch** | 1 / (50 × 6.9325) = 1/346.6; negligible |
| **U-Value/inch (IP)** | **347 BTU/hr·ft²·°F per inch** | Nearly perfect thermal conductor in building context |

**Sources:** AISC (American Institute of Steel Construction) thermal properties; Engineering Database
(A36 Structural Steel entry: k = 63.1 W/m·K — note this may reflect an elevated source; AISC/standard
value of 50 W/m·K used here); Khaliq & Kodur (2013) TPS measurements of A36 thermal conductivity;
Steel grades database ASTM A36 cross-reference.

**Notes:**
- Composition: ≤0.29% C, 0.85–1.20% Mn, 0.15–0.40% Si, ≥98% Fe.
- Thermal properties essentially identical to 1018 steel; both are low-carbon mild steels.
- Significant source variation: AISC uses 50 W/m·K; some databases give 54–63 W/m·K; Eurocode
  (EN 1993-1-2) uses 54 W/m·K at ambient for carbon steel fire design.
- A36 is primarily distinguished from 1018 by its structural grade designation and yield strength.
- A36 and 1018 are not meaningfully different thermally — α ≈ 13.8 mm²/s for both.

---

### 18. Stainless Steel — AISI 304 (18-8)

| Property | Value | Notes |
|---|---|---|
| **Thermal Conductivity k** | **16.2 W/m·K** | NIST/ASM standard at 20 °C; Eurocode: 15 W/m·K; some sources 14.7–16.5 W/m·K |
| **Density ρ** | **7,900–8,030 kg/m³** | Typical: **7,960 kg/m³** (ASM); 18% Cr, 8% Ni composition |
| **Specific Heat cₚ** | **500 J/kg·K** | NIST / ASM at 20–25 °C |
| **Thermal Diffusivity α** | **4.1 × 10⁻⁶ m²/s** (4.1 mm²/s) | 16.2 / (7,960 × 500); Engineers Edge: 4.2 × 10⁻⁶ m²/s |
| **R-Value/inch (IP)** | **0.0089 hr·ft²·°F/BTU per inch** | 1 / (16.2 × 6.9325) = 1/112.3 |
| **U-Value/inch (IP)** | **112 BTU/hr·ft²·°F per inch** | High thermal bridge risk |

**Sources:** NIST/ASM International 304 SS properties; Engineers Edge Thermal Diffusivity Table (SS 304A
= 4.2 × 10⁻⁶ m²/s); Thermal properties table from *Scientific Reports* (2021) Vol. 11, Table 4 (298 K:
ρ = 8,020 kg/m³, cₚ = 479 J/kg·K, k = 14.7 W/m·K — slightly conservative).

**Notes:**
- Composition: 18% Cr, 8–10.5% Ni, ≤0.08% C, balance Fe.
- **Significantly lower k than carbon steel** (~16 vs. ~50 W/m·K) due to Ni/Cr solid solution scattering.
- k **increases** with temperature (opposite of carbon steel behavior): ~14.7 W/m·K at 25 °C → ~25.8 W/m·K at 800 °C.
- Still ~135× more conductive than wood and ~1,200× more conductive than typical insulation;
  remains a significant thermal bridge in building assemblies.
- 316 SS (Mo-bearing): similar properties (k ≈ 16.3 W/m·K at 20 °C, ρ ≈ 7,960 kg/m³).

---

## Quick Reference Summary Table

### Insulation Materials

| Material | k (W/m·K) | ρ (kg/m³) | cₚ (J/kg·K) | α (mm²/s) | R/inch (IP) | U/inch (IP) |
|---|---|---|---|---|---|---|
| Cellulose (blown-in) | 0.040 | 37–51 (typ. 43) | 1,600 | 0.58 | 3.6–3.8 | 0.26–0.28 |
| Fiberglass Batt (std) | 0.039 | 9–23 (typ. 12) | 840 | 3.8 | 3.1–4.3 (typ. 3.7) | 0.23–0.32 |
| Mineral Wool Batt | 0.036–0.040 | 40–128 (typ. 48) | 840 | 0.94 | 3.7–4.3 | 0.23–0.27 |
| ccSPF (2 pcf) | 0.020–0.026 | 24–48 (typ. 32) | 1,500 | 0.46 | 5.8–7.0 (typ. 6.5) | 0.14–0.17 |
| ocSPF (0.5 pcf) | 0.039 | 8–22 (typ. 8) | 1,400 | 3.5 | 3.6–4.5 (typ. 3.7) | 0.22–0.28 |
| EPS Type I (1 pcf) | 0.0375 | 16 | 1,250 | 1.88 | 3.85 | 0.260 |
| EPS Type II (1.5 pcf) | 0.0346 | 24 | 1,250 | 1.15 | 4.17 | 0.240 |
| XPS (all types) | 0.029 | 32–38 | 1,450 | 0.57 | 5.0 (new); 4.2–4.5 (aged) | 0.200 |
| Havelock Wool (blown) | 0.034 | ~22 | 1,700 | 0.90 | 4.3 | 0.233 |
| Havelock Wool (batt) | 0.040 | ~25 | 1,700 | 0.94 | 3.6 | 0.278 |
| Gutex Thermofibre | 0.038 | 25–45 (typ. 35) | 2,100 | 0.52 | 3.8 | 0.263 |
| Gutex Thermoflex | 0.036 | ~50 | 2,100 | 0.34 | 4.0 | 0.249 |
| TimberHP TimberBatt | 0.037–0.040 | ~48 | 2,100 | 0.37 | 3.7–4.0 | 0.25–0.27 |
| TimberHP TimberBoard | 0.039–0.042 | 109–151 | 2,100 | ~0.15 | 3.4–3.7 | 0.27–0.29 |
| TimberHP TimberFill | 0.038–0.042 | ~30–80 | 2,100 | var | 3.4–3.8 | 0.26–0.29 |

### Non-Insulation Building Materials

| Material | k (W/m·K) | ρ (kg/m³) | cₚ (J/kg·K) | α (mm²/s) | R/inch (IP) | U/inch (IP) |
|---|---|---|---|---|---|---|
| Douglas Fir Lumber (12% MC) | 0.12 | 480–530 (typ. 500) | 1,700 | 0.14 | 1.25 | 0.80 |
| Plywood Sheathing | 0.12 | 500–560 (typ. 540) | 1,300 | 0.17 | 1.20–1.25 | 0.80–0.83 |
| OSB Sheathing | 0.13 | 630–680 (typ. 650) | 1,300 | 0.15 | 1.11–1.33 | 0.75–0.90 |
| CMU 8" NW Hollow (assembly) | — | — | — | — | **0.14 (assembly)** | **7.2 (assembly)** |
| CMU concrete material | 1.4–2.0 | 1,900–2,200 | 880 | 0.86 | — | — |
| Concrete NW 3000 psi | 1.75 | 2,300 | 880 | 0.86 | 0.082 | 12.1 |
| Mild Steel AISI 1018 | 51.9 | 7,870 | 486 | 13.6 | 0.0028 | 360 |
| Structural Steel A36 | 50 | 7,850 | 460 | 13.8 | 0.0029 | 347 |
| Stainless Steel 304 | 16.2 | 7,960 | 500 | 4.1 | 0.0089 | 112 |

---

## Notes on Thermal Diffusivity (α) Interpretation

**α = k / (ρ · cₚ)** — measures how quickly **temperature changes** propagate through a material.

- **High α** (metals): temperature equalizes very rapidly; e.g., steel responds in milliseconds to surface
  temperature changes. This is why steel sections are major thermal bridges.
- **Low α, high ρ·cₚ** (dense wood fiber, concrete): temperature waves are **attenuated and phase-shifted**
  significantly. A 24-hour outdoor temperature cycle may emerge inside a thick concrete wall 8–12 hours
  later and at a fraction of the amplitude. This is the mechanism of **thermal mass** benefit.
- **Low α, low ρ·cₚ** (fiberglass, ocSPF): even though steady-state R-value is adequate, **dynamic thermal
  performance is poor** — temperature waves penetrate quickly because there is little heat storage capacity
  per unit volume. Very low density insulations are mostly air.
- **Wood fiber insulation** (Gutex, TimberHP) with cₚ = 2,100 J/kg·K combined with moderate density
  achieves **the lowest α among insulation products listed**, providing the best combination of resistance
  and thermal mass/phase-shift of any insulation product in this list.

---

## Sources and Standards Summary

| Source | Relevance |
|---|---|
| **ASHRAE Handbook of Fundamentals 2021**, Ch. 26–27 | Primary reference for insulation and building material thermal properties; R-values, k, ρ, cₚ for most materials |
| **ASTM C578** | EPS and XPS rigid foam specification; R-values by type |
| **ASTM C518** | Standard test method for thermal resistance (heat flow meter) |
| **ASTM C739** | Cellulose insulation standard |
| **ASTM C665** | Mineral fiber batts standard |
| **NIST SRD 81** | NIST Heat Transmission Properties of Insulating and Building Materials database |
| **NIST BEES** (Building for Environmental and Economic Sustainability) | Product-level LCA data including density and thermal properties for common materials |
| **USDA FPL-GTR-190** (Wood Handbook, 2021) | Thermal, physical, and mechanical properties of wood by species |
| **TenWolde, McNatt & Krahn (1988)** DOE/USDA-21697-1 | Thermal properties of wood and wood panel products; equations for k vs. SG and MC |
| **ACI 122R-14** | Guide to Thermal Properties of Concrete and Masonry Systems |
| **NCMA TEK 06-12E, 06-16A** | CMU thermal performance in energy codes; heat capacity values |
| **Talebi, Kayan et al. (2020)** | Thermal properties of NWC at different strength classes |
| **MatWeb / ASM International** | Steel alloy thermal properties (1018, A36, 304 SS) |
| **Engineers Edge** | Thermal diffusivity reference table |
| **SPFA / American Chemistry Council** | Spray foam R-value and performance data |
| **Havelock Wool Full Spec Sheet (Nov 2022)** | R-4.3/inch blown-in, R-3.6/inch batt; 100% wool |
| **Gutex Technical Data Sheets** (2023–2025) | k = 0.036–0.038 W/m·K; cₚ = 2,100 J/kg·K; density ranges |
| **TimberHP Product Pages + ICC-ES Reports** | R-3.4–4.0/inch; density 3 lb/ft³ (batt), 6.8–9.4 lb/ft³ (board) |
| **FSRI Materials and Products Database** | Experimental specific heat and conductivity for cellulose, plywood, OSB |

---

*Last compiled: 2025 | Values are representative and may vary by specific product, manufacturer, moisture
content, temperature, and installation conditions. Always verify with current manufacturer technical data
sheets and applicable ASTM test reports for design and compliance purposes.*
