// app/components/project-map-mockup/ProjectMapMockup.tsx
//
// Throwaway visual exploration for `garden/1-seeds/project-map.md` —
// built to make the seed's open questions clickable, not to answer them.
// Everything here is local React state over hardcoded mock data; nothing
// reads or writes a real project. Meant to be deleted or replaced once the
// seed's open questions are resolved and real work starts (see the seed's
// "Next step").
//
// v2 (2026-10-28): expanded from a single fixed "which camp is focused"
// toggle into a full lifecycle SIMULATION — empty project -> Basecamp
// prep/onboarding -> Discovery -> Design -> Sourcing -> Construction ->
// complete — with realistic per-phase camp counts (5-10 each, ~33 total)
// to stress-test whether the Basecamp/Camps navigation actually holds up
// at a believable scale, not just with the 4 toy camps v1 had.
//
// The controls at the top exist ONLY to let open questions (and a few new
// findings this larger simulation surfaced) be seen side-by-side, not
// because every option shown is seriously proposed as a final design.
// `pm-flag` callouts point at an exact open question from the seed;
// `pm-flag--finding` callouts point at something this exercise itself
// surfaced that the seed didn't anticipate; `pm-flag--decision` points at
// something Gerald has already settled (not open anymore).
//
// v3 (2026-10-28): adds a "Viewing as" role switcher (Observer / Client /
// Crafter / Guide, the real `GROUPS` from `features.ts`) plus an
// Admin/Super override checkbox, since those are two independent axes in
// the real permission system (project-level group vs. account-level
// staff tier). Only a Guide (or staff override) can touch the
// Basecamp-prep checklist/"Establish" button or "+ Define a future
// camp" — everyone else sees the same thing read-only. Deliberately kept
// SEPARATE from the lifecycle scrubber above: the scrubber is a
// reviewer-only convenience for exploring every state regardless of
// role, not a simulation of a real control any role would see.
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
import { Checkbox } from "stamps/Checkbox";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Disclosure } from "stamps/Disclosure";
import { Input } from "stamps/Input";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import "./projectMapMockup.css";

type CampStatus = "done" | "focused" | "upcoming";
type StepSource = "manual" | "graphlog";

type Step = {
  id: string;
  label: string;
  done: boolean;
  source: StepSource;
  /** What GraphLog's graph-structure stage supposedly matched this to —
   * mockup-only text, nothing is actually wired to graph nodes here. */
  graphNode?: string;
};

type ContentItem = { id: string; type: "effort" | "file" | "logbook"; label: string; when: string };

/** A camp's static definition — everything ABOUT it. Its live status
 * (done/focused/upcoming) is deliberately NOT stored here: it's derived
 * from where the simulated "cursor" sits, so moving through the
 * lifecycle recomputes the whole page instead of needing to hand-edit
 * 30+ status fields. */
type Camp = {
  id: string;
  phaseId: string;
  name: string;
  description: string;
  stepLabels: string[];
};

type PhaseDef = { id: string; name: string; camps: Omit<Camp, "phaseId">[] };

const BASECAMP = {
  overview:
    "Contract signed, budget approved, site access confirmed, and the design packet handed to the crew. This is the one spot everyone can always return to if a camp stalls.",
  kickoff: "Sep 2, 2026",
  targetFinish: "Jun 2027 (estimate)",
  checklist: [
    "Contract signed",
    "Budget approved",
    "Site access confirmed",
    "Design packet delivered to crew",
  ],
};

const FINAL_GOAL = "Move-in ready";

const PHASE_DEFS: PhaseDef[] = [
  {
    id: "discovery",
    name: "Discovery",
    camps: [
      { id: "disc-kickoff", name: "Kickoff Call", description: "Intro call to align on expectations and timeline.", stepLabels: ["Schedule kickoff call", "Confirm scope & goals", "Share welcome packet"] },
      { id: "disc-site-walk", name: "Site Walk & Measurements", description: "Walk the space and record as-built measurements.", stepLabels: ["Walk the site", "Record measurements", "Photograph existing conditions"] },
      { id: "disc-interview", name: "Lifestyle Interview", description: "Understand how the family actually uses the space.", stepLabels: ["Send intake questionnaire", "Hold interview", "Summarize needs"] },
      { id: "disc-inspiration", name: "Inspiration Gathering", description: "Collect references and build a shared style direction.", stepLabels: ["Review client references", "Build mood board", "Align on style direction"] },
      { id: "disc-conditions", name: "Existing Conditions Survey", description: "Document structure, utilities, and constraints.", stepLabels: ["Draft as-built plan", "Flag structural concerns", "Confirm utility locations"] },
      { id: "disc-budget", name: "Budget Conversation", description: "Set a realistic budget range before design starts.", stepLabels: ["Share ballpark ranges", "Discuss priorities vs. budget", "Confirm comfortable range"] },
      { id: "disc-program", name: "Program Definition", description: "Lock the room and scope list.", stepLabels: ["Draft scope list", "Review with client", "Finalize program"] },
      { id: "disc-signoff", name: "Discovery Sign-off", description: "Wrap discovery and hand off to design.", stepLabels: ["Compile discovery summary", "Client sign-off", "Hand off to design team"] },
    ],
  },
  {
    id: "design",
    name: "Design",
    camps: [
      { id: "des-concept", name: "Concept Sketches", description: "First-pass layout ideas.", stepLabels: ["Sketch 2-3 concepts", "Internal review", "Present to client"] },
      { id: "des-floorplan", name: "Floor Plan Options", description: "Develop layout options worth pursuing.", stepLabels: ["Draft plan options", "Client walkthrough", "Narrow to one direction"] },
      { id: "des-palette", name: "Material & Finish Palette", description: "Choose the overall look.", stepLabels: ["Pull material samples", "Build palette board", "Client approval"] },
      { id: "des-renderings", name: "3D Renderings", description: "Visualize the chosen direction.", stepLabels: ["Model the space", "Render key views", "Share with client"] },
      { id: "des-rev1", name: "Design Revisions — Round 1", description: "Incorporate the first round of feedback.", stepLabels: ["Collect feedback", "Revise drawings", "Re-share for review"] },
      { id: "des-structural", name: "Structural & Engineering Review", description: "Confirm the design is actually buildable.", stepLabels: ["Send plans to engineer", "Resolve structural notes", "Update drawings"] },
      { id: "des-permitprep", name: "Permit Drawing Prep", description: "Prepare drawings for permit submission.", stepLabels: ["Draft permit set", "Internal QA pass", "Package for submission"] },
      { id: "des-rev2", name: "Design Revisions — Round 2", description: "Final polish before lock.", stepLabels: ["Incorporate engineer notes", "Final client walkthrough", "Lock drawings"] },
      { id: "des-signoff", name: "Design Sign-off", description: "Final approval before sourcing starts.", stepLabels: ["Compile final design packet", "Client sign-off", "Hand off to sourcing"] },
    ],
  },
  {
    id: "sourcing",
    name: "Sourcing",
    camps: [
      { id: "src-spec", name: "Scope & Spec Finalization", description: "Lock exact specs before pricing goes out.", stepLabels: ["Finalize spec sheet", "Confirm quantities", "Share with vendors"] },
      { id: "src-bids", name: "Contractor Bids", description: "Collect and compare bids.", stepLabels: ["Send out for bid", "Compare proposals", "Select contractor"] },
      { id: "src-cabinetry", name: "Cabinetry & Countertop Selections", description: "Choose cabinetry and countertop material.", stepLabels: ["Review cabinet lines", "Select countertop material", "Place order"] },
      { id: "src-tile", name: "Tile & Fixture Selections", description: "Choose tile, plumbing & lighting fixtures.", stepLabels: ["Select tile", "Select fixtures", "Confirm lead times"] },
      { id: "src-longlead", name: "Long-Lead Item Ordering", description: "Order windows, appliances, anything slow to arrive.", stepLabels: ["Confirm long-lead items", "Place orders", "Track confirmations"] },
      { id: "src-permit", name: "Permit Submission", description: "Submit for permit approval.", stepLabels: ["Submit permit application", "Respond to plan check", "Receive approval"] },
      { id: "src-contract", name: "Contract & Schedule Finalization", description: "Lock the contract and the start date.", stepLabels: ["Finalize contract", "Set start date", "Confirm crew schedule"] },
    ],
  },
  {
    id: "construction",
    name: "Construction",
    camps: [
      { id: "con-demo", name: "Demo", description: "Remove existing materials.", stepLabels: ["Protect adjacent areas", "Demo existing space", "Haul debris"] },
      { id: "con-foundation", name: "Foundation & Structural", description: "Footings and structural framing prep.", stepLabels: ["Pour/repair footings", "Structural framing", "Inspection"] },
      { id: "con-framing", name: "Framing", description: "Walls and roof structure.", stepLabels: ["Frame walls", "Set roof structure", "Framing inspection"] },
      { id: "con-rough", name: "Rough Mechanicals", description: "Electrical, plumbing, HVAC rough-in.", stepLabels: ["Rough electrical", "Rough plumbing", "Rough HVAC"] },
      { id: "con-insulation", name: "Insulation & Drywall", description: "Close up the walls.", stepLabels: ["Insulate", "Hang drywall", "Tape & finish"] },
      { id: "con-finishes", name: "Interior Finishes", description: "Paint and flooring.", stepLabels: ["Paint", "Install flooring", "Trim & millwork"] },
      { id: "con-cabinetry", name: "Cabinetry & Fixture Install", description: "Install cabinets, counters, fixtures.", stepLabels: ["Install cabinetry", "Install countertops", "Install fixtures"] },
      { id: "con-inspections", name: "Final Inspections", description: "Pass remaining inspections.", stepLabels: ["Schedule inspections", "Address punch items", "Pass final inspection"] },
      { id: "con-punchlist", name: "Punch List & Closeout", description: "Final walkthrough and handoff.", stepLabels: ["Walkthrough with client", "Complete punch list", "Project handoff"] },
    ],
  },
];

const BASE_CAMPS: Camp[] = PHASE_DEFS.flatMap((phase) => phase.camps.map((c) => ({ ...c, phaseId: phase.id })));

const MILESTONES = [
  { key: "empty", label: "Empty" },
  { key: "prep", label: "Basecamp prep" },
  { key: "discovery", label: "Discovery" },
  { key: "design", label: "Design" },
  { key: "sourcing", label: "Sourcing" },
  { key: "construction", label: "Construction" },
  { key: "complete", label: "Complete" },
] as const;

type Stage = "empty" | "prep" | "active" | "complete";

/** The real project-level groups (`GROUPS` in `robustness-core/data/
 * features.ts`), kept in the same order the human asked for here rather
 * than that file's own order — purely a display choice, same 4 values. */
type Role = "Observer" | "Client" | "Crafter" | "Guide";
const ROLES: Role[] = ["Observer", "Client", "Crafter", "Guide"];
function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as string[]).includes(x);
}

const VIEWER_STORAGE_KEY = "nopal:project-map-mockup:viewer";
type ViewerPref = { role: Role; staff: boolean };
function loadViewerPref(): ViewerPref | null {
  try {
    const raw = window.localStorage.getItem(VIEWER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRole(parsed?.role) ? { role: parsed.role, staff: !!parsed.staff } : null;
  } catch {
    return null;
  }
}

function Callout({
  kind = "question",
  n,
  children,
}: {
  kind?: "question" | "finding" | "decision";
  n: number;
  children: ReactNode;
}) {
  const modifier = kind === "finding" ? "pm-flag--finding" : kind === "decision" ? "pm-flag--decision" : "";
  const tag = kind === "finding" ? `Finding ${n}` : kind === "decision" ? `Decided ${n}` : `Open Q${n}`;
  return (
    <div className={`pm-flag ${modifier}`.trim()}>
      <span className="pm-flag__tag">{tag}</span>
      <p>{children}</p>
    </div>
  );
}

/** Left: the actual simulated mockup. Right: our notes about how it
 * functions, in the handwritten red hand (see `pm-flag`'s CSS) so the
 * two are never visually confused with each other. `notes` is optional —
 * most mockup-only control panels (the lifecycle scrubber, the "define a
 * future camp" form) have nothing to annotate and render with an empty
 * right column. Stacks to one column under 900px. */
function Row({ main, notes }: { main: ReactNode; notes?: ReactNode }) {
  return (
    <div className="pm-row">
      <div className="pm-row__main">{main}</div>
      <div className="pm-row__notes">{notes}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pm-stat">
      <span className="pm-stat__label">{label}</span>
      <span className="pm-stat__value">{value}</span>
    </div>
  );
}

function CampNode({
  kind,
  label,
  selected,
  onClick,
}: {
  kind: "basecamp" | CampStatus | "final";
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const glyph = kind === "done" ? "\u2713" : kind === "basecamp" ? "B" : kind === "final" ? "\u2605" : "";
  const classes = ["pm-node", `pm-node--${kind}`, selected && "pm-node--selected"].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} onClick={onClick} disabled={!onClick} aria-pressed={selected}>
      <span className="pm-node__dot">{glyph}</span>
      <span className="pm-node__label">{label}</span>
    </button>
  );
}

function TrailLink({ last }: { last?: boolean }) {
  return last ? null : <span className="pm-link" aria-hidden="true" />;
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Surface className="pm-empty">
      <Stack gap={3} align="center">
        <p className="pm-eyebrow">NEW PROJECT</p>
        <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>No project map yet</h2>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, textAlign: "center", maxWidth: 420 }}>
          Before any camp can start, Basecamp needs to be established — contract signed, budget approved, site
          access confirmed, design packet handed off to the crew.
        </p>
        <button type="button" className={button({ variant: "primary" })} onClick={onStart}>
          Start Basecamp prep
        </button>
      </Stack>
    </Surface>
  );
}

type ContentFilter = "steps" | "effort" | "file" | "logbook";

function stepsForCamp(camp: Camp, status: CampStatus): Step[] {
  const n = camp.stepLabels.length;
  const doneCount = status === "done" ? n : status === "focused" ? Math.ceil(n / 2) : 0;
  return camp.stepLabels.map((label, i) => {
    const done = i < doneCount;
    // The one step right at the done/not-done boundary of the focused
    // camp stands in for "GraphLog just auto-identified this" (open Q5)
    // — deliberately only one per camp, not every step, since this is
    // meant to illustrate the idea, not simulate a real classifier.
    const isBoundary = status === "focused" && i === doneCount - 1;
    return {
      id: `${camp.id}-step-${i}`,
      label,
      done,
      source: isBoundary ? "graphlog" : "manual",
      graphNode: isBoundary ? `Auto-identified from recent activity on \u201c${camp.name}\u201d` : undefined,
    };
  });
}

function contentForCamp(camp: Camp, status: CampStatus): ContentItem[] {
  if (status === "upcoming") return [];
  const items: ContentItem[] = [
    { id: `${camp.id}-effort`, type: "effort", label: `${camp.name} progress update`, when: status === "done" ? "Completed" : "This week" },
    { id: `${camp.id}-log`, type: "logbook", label: `Note: progress on ${camp.name}`, when: status === "done" ? "Completed" : "Recently" },
  ];
  if (status === "done") items.push({ id: `${camp.id}-file`, type: "file", label: `${camp.name} completion photos`, when: "Completed" });
  return items;
}

export function ProjectMapMockup() {
  const [stage, setStage] = useState<Stage>("empty");
  const [cursor, setCursor] = useState(0);
  const [checklist, setChecklist] = useState<boolean[]>(BASECAMP.checklist.map(() => false));
  const [extraCamps, setExtraCamps] = useState<Camp[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [resetPerPhase, setResetPerPhase] = useState(false);
  const [twoInFocus, setTwoInFocus] = useState(false);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("steps");
  const [showAddCamp, setShowAddCamp] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const formId = useId();

  // "Viewing as" — defaults to Guide (every control visible) until the
  // client-only localStorage read below resolves, same hydration pattern
  // as `useSchemePref`: a brief default render is fine, a server/client
  // mismatch isn't.
  const [role, setRole] = useState<Role>("Guide");
  const [staffOverride, setStaffOverride] = useState(false);
  const [viewerHydrated, setViewerHydrated] = useState(false);
  useEffect(() => {
    const pref = loadViewerPref();
    if (pref) {
      setRole(pref.role);
      setStaffOverride(pref.staff);
    }
    setViewerHydrated(true);
  }, []);
  useEffect(() => {
    if (!viewerHydrated) return;
    window.localStorage.setItem(VIEWER_STORAGE_KEY, JSON.stringify({ role, staff: staffOverride }));
  }, [role, staffOverride, viewerHydrated]);
  // Guide, or an Admin/Super human regardless of their project group —
  // the only two ways to define Basecamp/Phases/Camps (Gerald, 2026-10-28).
  const canDefine = role === "Guide" || staffOverride;

  const camps: Camp[] = [...BASE_CAMPS, ...extraCamps];
  const established = stage === "active" || stage === "complete";
  const allChecked = checklist.every(Boolean);

  function statusFor(index: number): CampStatus {
    if (stage === "complete") return "done";
    if (stage !== "active") return "upcoming";
    if (index === cursor) return "focused";
    if (twoInFocus && index === cursor + 1) return "focused";
    if (index < cursor) return "done";
    return "upcoming";
  }

  const toggleExpandedPhase = (id: string) =>
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const establish = () => {
    if (!allChecked) return;
    setStage("active");
    setCursor(0);
  };

  const jumpTo = (key: (typeof MILESTONES)[number]["key"]) => {
    setPreviewId(null);
    if (key === "empty") {
      setStage("empty");
      setCursor(0);
      setChecklist(BASECAMP.checklist.map(() => false));
      setExtraCamps([]);
      return;
    }
    if (key === "prep") {
      setStage("prep");
      return;
    }
    if (key === "complete") {
      setStage("complete");
      return;
    }
    const idx = camps.findIndex((c) => c.phaseId === key);
    setStage("active");
    setCursor(idx >= 0 ? idx : 0);
  };

  const currentMilestoneKey = (): string => {
    if (stage === "empty") return "empty";
    if (stage === "prep") return "prep";
    if (stage === "complete") return "complete";
    return camps[cursor]?.phaseId ?? "discovery";
  };

  const goBack = () => {
    if (stage === "complete") {
      setStage("active");
      setCursor(camps.length - 1);
      return;
    }
    if (stage === "active") {
      if (cursor > 0) setCursor(cursor - 1);
      else setStage("prep");
      return;
    }
    if (stage === "prep") setStage("empty");
  };

  const advance = () => {
    if (stage === "empty") {
      setStage("prep");
      return;
    }
    if (stage === "prep") {
      // Deliberately bypasses the checklist gate — this is the demo
      // scrubber's "time machine," not the real "Establish Basecamp"
      // button above, which DOES require every item checked. See
      // Finding 2 below.
      setStage("active");
      setCursor(0);
      return;
    }
    if (stage === "active") {
      if (cursor < camps.length - 1) setCursor(cursor + 1);
      else setStage("complete");
    }
  };

  const progressLabel = (): string => {
    if (stage === "empty") return "Not started";
    if (stage === "prep") return `Basecamp prep (${checklist.filter(Boolean).length}/${checklist.length})`;
    if (stage === "complete") return "Project complete";
    const camp = camps[cursor];
    const phase = PHASE_DEFS.find((p) => p.id === camp.phaseId);
    const siblings = camps.filter((c) => c.phaseId === camp.phaseId);
    const posInPhase = siblings.findIndex((c) => c.id === camp.id) + 1;
    return `${phase?.name ?? camp.phaseId} \u2014 camp ${posInPhase} of ${siblings.length}: ${camp.name}`;
  };

  const addCamp = () => {
    if (!draftName.trim()) return;
    const id = `draft-${Date.now()}`;
    setExtraCamps((prev) => [
      ...prev,
      { id, phaseId: "extra", name: draftName.trim(), description: draftDescription.trim() || "(no description yet)", stepLabels: [] },
    ]);
    setPreviewId(id);
    setDraftName("");
    setDraftDescription("");
    setShowAddCamp(false);
  };

  // --- Derived selection for the detail panel ---
  const focusIndex = stage === "active" ? cursor : stage === "complete" ? camps.length - 1 : -1;
  const selectedIndex = previewId ? camps.findIndex((c) => c.id === previewId) : focusIndex;
  const selected = selectedIndex >= 0 ? camps[selectedIndex] : null;
  const selectedStatus: CampStatus = selectedIndex >= 0 ? statusFor(selectedIndex) : "upcoming";
  const isPreviewing = stage === "active" && selectedIndex >= 0 && selectedIndex !== focusIndex;

  // --- Phase groups for the trail ---
  const indexed = camps.map((camp, index) => ({ camp, index }));
  const phaseGroups = PHASE_DEFS.map((p) => ({ id: p.id, name: p.name, items: indexed.filter((x) => x.camp.phaseId === p.id) }));
  if (extraCamps.length > 0) phaseGroups.push({ id: "extra", name: "Added camps", items: indexed.filter((x) => x.camp.phaseId === "extra") });

  const phaseStatusOf = (items: { index: number }[]): "done" | "current" | "upcoming" => {
    if (items.every((x) => statusFor(x.index) === "done")) return "done";
    if (items.some((x) => statusFor(x.index) === "focused")) return "current";
    return "upcoming";
  };

  return (
    <div className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })}>
      <div className="pm-banner">
        <strong>Mockup — Project Map.</strong> Exploring{" "}
        <code>garden/1-seeds/project-map.md</code>. Nothing here reads or writes a real
        project. v2 adds a realistic 4-phase / ~33-camp dataset (Discovery, Design,
        Sourcing, Construction) and a lifecycle scrubber, so the empty-&rarr;complete
        progression and the navigation's behavior at real scale can both be seen, not
        just imagined.
      </div>

      <header>
        <p className="pm-eyebrow">PROJECT · STANDARD</p>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>Casa Verde Remodel</h1>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Demo data only — stands in for the real Project page rework this seed feeds
          into (<code>stamps-tab-system</code>).
        </p>
      </header>

      <Row
        main={
          <Surface className={sprinkles({ p: 4 })}>
            <Stack gap={3}>
              <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Viewing as</p>
              <Cluster gap={2} wrap>
                {ROLES.map((r) => (
                  <Chip key={r} active={role === r} onClick={() => setRole(r)}>
                    {r}
                  </Chip>
                ))}
                <Chip active={staffOverride} onClick={() => setStaffOverride((v) => !v)}>
                  Also Admin/Super (site staff)
                </Chip>
              </Cluster>
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                {canDefine
                  ? "This role can define Basecamp, Phases, and Camps."
                  : "This role can only VIEW the map \u2014 defining Basecamp, Phases, or Camps is Guide-only (or an Admin/Super override)."}
              </p>
            </Stack>
          </Surface>
        }
        notes={
          <Callout kind="decision" n={1}>
            Guides (or Admin/Super humans, regardless of their project group) are the
            only ones who can define Basecamp, Phases, or Camps — confirmed by Gerald,
            2026-10-28, not an open question anymore. Switch "Viewing as" to
            Observer/Client/Crafter to see the Basecamp-prep checklist and "+ Define a
            future camp" become read-only. This doesn't gate the lifecycle scrubber
            below — that's a reviewer-only convenience for exploring every state as
            any role, not a simulation of a real in-product control.
          </Callout>
        }
      />

      <Surface className={sprinkles({ p: 4 })}>
        <Stack gap={3}>
          <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Simulate the project lifecycle</p>
          <Cluster gap={2} wrap>
            {MILESTONES.map((m) => (
              <Chip key={m.key} active={currentMilestoneKey() === m.key} onClick={() => jumpTo(m.key)}>
                {m.label}
              </Chip>
            ))}
          </Cluster>
          <Cluster gap={3} align="center">
            <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={goBack}>
              ← Back
            </button>
            <span className={textSize.sm} style={{ color: semanticColors.textSubtle, minWidth: 220 }}>
              {progressLabel()}
            </span>
            <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={advance}>
              Advance →
            </button>
          </Cluster>
          <Cluster gap={2} wrap>
            <Chip active={resetPerPhase} onClick={() => setResetPerPhase((v) => !v)}>
              Basecamp resets per Phase
            </Chip>
            <Chip active={twoInFocus} onClick={() => setTwoInFocus((v) => !v)}>
              Experimental: 2 camps in focus
            </Chip>
            <Chip active={expandAll} onClick={() => setExpandAll((v) => !v)}>
              Expand all phases (dense view)
            </Chip>
          </Cluster>
        </Stack>
      </Surface>

      {stage === "empty" ? (
        <EmptyState onStart={() => setStage("prep")} />
      ) : (
        <>
          <Row
            main={
              /* --- Basecamp --- */
              <Surface className="pm-basecamp">
            <Stack gap={4}>
              <Cluster style={{ justifyContent: "space-between" }} align="flex-start">
                <Stack gap={1}>
                  <Badge variant="accent">BASECAMP</Badge>
                  <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>
                    Home base — the overall plan &amp; timeline
                  </h2>
                </Stack>
                <Badge variant={established ? "success" : "warning"}>
                  {established ? "Established" : "Not yet established"}
                </Badge>
              </Cluster>
              <p className={textSize.sm}>{BASECAMP.overview}</p>
              <Cluster gap={8} wrap>
                <Stat label="Kickoff" value={established ? BASECAMP.kickoff : "Not started"} />
                <Stat label="Target finish" value={BASECAMP.targetFinish} />
                <Stat label="Final goal" value={FINAL_GOAL} />
              </Cluster>
              {stage === "prep" ? (
                <Stack gap={2}>
                  <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>
                    What's needed to move forward ({checklist.filter(Boolean).length}/{checklist.length})
                  </p>
                  <Stack gap={2}>
                    {BASECAMP.checklist.map((item, i) => (
                      <Checkbox
                        key={item}
                        label={item}
                        checked={checklist[i]}
                        disabled={!canDefine}
                        onChange={(v) => setChecklist((cs) => cs.map((c, ci) => (ci === i ? v : c)))}
                      />
                    ))}
                  </Stack>
                  {canDefine ? (
                    <Cluster>
                      <button type="button" className={button({ variant: "primary" })} disabled={!allChecked} onClick={establish}>
                        Establish Basecamp &amp; start Discovery
                      </button>
                    </Cluster>
                  ) : (
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                      Only a Guide (or Admin/Super) can check these off and establish
                      Basecamp. {role} can see progress here, not change it.
                    </p>
                  )}
                </Stack>
              ) : (
                <Disclosure summary={`What's in place to move forward (${BASECAMP.checklist.length}/${BASECAMP.checklist.length})`}>
                  <ul className="pm-checklist">
                    {BASECAMP.checklist.map((item) => (
                      <li key={item}>
                        <span className="pm-check">{"\u2713"}</span> {item}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </Stack>
              </Surface>
            }
            notes={
              <>
                <Callout n={2}>
                  Camps vs. Phases: toggling "Basecamp resets per Phase" shows the two live
                  options from the seed — one shared Basecamp for the whole project (off), or
                  a Basecamp re-established at the start of each Phase (on). Genuinely
                  unresolved per the seed; needs Austin's input.
                </Callout>
                <Callout kind="finding" n={2}>
                  The checklist-gated "Establish Basecamp" button is the real workflow
                  (disabled until every item is checked). The "Advance" scrubber and
                  milestone chips deliberately bypass that gate so this mockup stays
                  navigable — worth deciding whether a real "jump ahead" shortcut should
                  ever exist for staff, or whether Basecamp should always hard-block
                  camp progress.
                </Callout>
              </>
            }
          />

          {stage === "prep" && (
            <Surface className={sprinkles({ p: 3 })}>
              <Stack gap={2}>
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  Planned phases (locked until Basecamp is established):
                </p>
                <Cluster gap={2} wrap>
                  {phaseGroups.map((p) => (
                    <span key={p.id} className="pm-phase-pill pm-phase-pill--locked">
                      {p.name} · {p.items.length} camps
                    </span>
                  ))}
                  <span className="pm-phase-pill pm-phase-pill--locked">{FINAL_GOAL}</span>
                </Cluster>
              </Stack>
            </Surface>
          )}

          {(stage === "active" || stage === "complete") && (
            <>
              <Row
                main={
                  /* --- Camps trail --- */
                  <section>
                <h3
                  className={`${textSize.sm} ${sprinkles({ fontWeight: "bold", mb: 2 })}`}
                  style={{ textTransform: "uppercase", letterSpacing: "0.04em", color: semanticColors.textSubtle }}
                >
                  Camps ({camps.length} across {phaseGroups.length} phase{phaseGroups.length === 1 ? "" : "s"})
                </h3>
                <Surface className={sprinkles({ p: 2 })}>
                  <div className="pm-trail">
                    <div className="pm-trail-row">
                      {!resetPerPhase && (
                        <>
                          <CampNode kind="basecamp" label="Basecamp" />
                          <TrailLink />
                        </>
                      )}
                      {phaseGroups.map((phase) => {
                        const pStatus = phaseStatusOf(phase.items);
                        const isExpanded = expandAll || pStatus === "current" || expandedPhases.has(phase.id);
                        return (
                          <Fragment key={phase.id}>
                            <div className="pm-phase-group">
                              <span className="pm-phase-group__label">{phase.name}</span>
                              {resetPerPhase && (
                                <>
                                  <CampNode kind="basecamp" label="Basecamp" />
                                  <TrailLink />
                                </>
                              )}
                              {isExpanded ? (
                                phase.items.map(({ camp, index }, i) => (
                                  <Fragment key={camp.id}>
                                    <CampNode
                                      kind={statusFor(index)}
                                      label={camp.name}
                                      selected={index === selectedIndex}
                                      onClick={() => setPreviewId(camp.id)}
                                    />
                                    <TrailLink last={i === phase.items.length - 1} />
                                  </Fragment>
                                ))
                              ) : (
                                <button
                                  type="button"
                                  className={`pm-phase-pill pm-phase-pill--${pStatus}`}
                                  onClick={() => toggleExpandedPhase(phase.id)}
                                >
                                  {pStatus === "done" ? `\u2713 ${phase.items.length}/${phase.items.length} done` : `${phase.items.length} camps`}
                                </button>
                              )}
                            </div>
                            <TrailLink />
                          </Fragment>
                        );
                      })}
                      <CampNode kind={stage === "complete" ? "done" : "final"} label={FINAL_GOAL} />
                    </div>
                  </div>
                  </Surface>
                  </section>
                }
                notes={
                  <>
                    <Callout n={1}>
                      "Only one camp in focus at a time" is flagged in the seed as an
                      assumption to validate, not a decision. Toggle "2 camps in focus" above
                      to see the camp right after the current one light up too — worth asking
                      whether the UI (and the data model) actually needs to support that for a
                      complex build.
                    </Callout>
                    <Callout kind="finding" n={1}>
                      At a believable scale (~33 camps across 4 phases), a flat trail of every
                      camp is unwieldy — so by default this mockup collapses any phase that
                      isn't the current one into a single summary pill ("8/8 done" or "9
                      camps"), expanding only on click. Toggle "Expand all phases" to see the
                      dense version for comparison. This suggests Phases, not Camps, may need
                      to be the primary collapse/navigation unit on the real Project page.
                    </Callout>
                    <Callout kind="finding" n={3}>
                      Hand-authoring steps/content for 33 camps already felt like a lot of
                      data entry for one demo project — a real project at this grain would
                      make GraphLog's "AI-identified and sorted" piece (open Q5) less of a
                      nice-to-have and more of a requirement for this to stay usable without
                      heavy manual upkeep per camp.
                    </Callout>
                  </>
                }
              />

              {/* --- Camp detail / filtered content --- */}
              {selected && (
                <Row
                  main={
                    <Surface className="pm-camp-detail">
                  <Stack gap={4}>
                    {isPreviewing && (
                      <div className="pm-preview-banner">
                        <span>
                          Previewing <strong>{selected.name}</strong> — the team's focus is still on{" "}
                          <strong>{camps[focusIndex]?.name}</strong>.
                        </span>
                        <button type="button" onClick={() => setPreviewId(null)}>
                          Jump to focus
                        </button>
                      </div>
                    )}
                    <Cluster style={{ justifyContent: "space-between" }} align="flex-start" wrap>
                      <Stack gap={1}>
                        <Cluster gap={2}>
                          <Badge variant={selectedStatus === "done" ? "success" : selectedStatus === "focused" ? "accent" : "neutral"}>
                            {selectedStatus === "done" ? "Done" : selectedStatus === "focused" ? "In focus" : "Upcoming"}
                          </Badge>
                          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                            {PHASE_DEFS.find((p) => p.id === selected.phaseId)?.name ?? "Added"}
                          </span>
                        </Cluster>
                        <h2 className={`${textSize.xl} ${sprinkles({ fontWeight: "bold" })}`}>{selected.name}</h2>
                        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                          {selected.description}
                        </p>
                      </Stack>
                    </Cluster>

                    <Cluster gap={2} wrap>
                      <Chip active={contentFilter === "steps"} onClick={() => setContentFilter("steps")}>
                        Steps ({selected.stepLabels.length})
                      </Chip>
                      <Chip active={contentFilter === "effort"} onClick={() => setContentFilter("effort")}>
                        Efforts ({contentForCamp(selected, selectedStatus).filter((c) => c.type === "effort").length})
                      </Chip>
                      <Chip active={contentFilter === "file"} onClick={() => setContentFilter("file")}>
                        Files ({contentForCamp(selected, selectedStatus).filter((c) => c.type === "file").length})
                      </Chip>
                      <Chip active={contentFilter === "logbook"} onClick={() => setContentFilter("logbook")}>
                        Logbook ({contentForCamp(selected, selectedStatus).filter((c) => c.type === "logbook").length})
                      </Chip>
                    </Cluster>

                    {contentFilter === "steps" ? (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {selected.stepLabels.length === 0 && (
                          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                            No steps defined for this camp yet.
                          </p>
                        )}
                        {stepsForCamp(selected, selectedStatus).map((step) => (
                          <li key={step.id} className={`pm-step-row ${step.done ? "pm-step-row--done" : ""}`}>
                            <span className="pm-step-row__box">{step.done ? "\u2713" : ""}</span>
                            <span className="pm-step-row__label">{step.label}</span>
                            {step.source === "graphlog" && (
                              <Badge variant="accent" title={step.graphNode}>
                                {"\u2726 GraphLog"}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {contentForCamp(selected, selectedStatus).filter((c) => c.type === contentFilter).length === 0 && (
                          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                            Nothing filed under this camp yet.
                          </p>
                        )}
                        {contentForCamp(selected, selectedStatus)
                          .filter((c) => c.type === contentFilter)
                          .map((item) => (
                            <li key={item.id} className="pm-content-row">
                              <span>{item.label}</span>
                              <span className="pm-content-row__when">{item.when}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                      </Stack>
                    </Surface>
                  }
                  notes={
                    <>
                      <Callout n={3}>
                        How camp selection actually filters the main content below it is
                        still genuinely open — this mockup's answer (a content-type picker
                        nested inside the selected camp) is only one option it tries out,
                        not a settled design.
                      </Callout>
                      <Callout n={4}>
                        This nests a tab-like content-type picker INSIDE the selected camp
                        (one option from the seed: "camps pick a camp, tabs still pick a
                        content type within it"). The alternative — camp selection
                        replacing tabs entirely — is the other live option
                        `stamps-tab-system` would need to reconcile with.
                      </Callout>
                      <Callout n={5}>
                        The GraphLog badges above are hand-authored mock text, not a real
                        integration — today's `graph-structure` clustering has no concept
                        of camp sequencing or focus to extend (confirmed in the seed).
                        Teaching it to recognize "this node's work belongs to Camp N" is
                        real, separate work.
                      </Callout>
                    </>
                  }
                />
              )}

              {/* --- Define a future camp workflow (Guide/Admin-Super only) --- */}
              {canDefine ? (
                <div>
                  <button type="button" className={button({ variant: "outline" })} onClick={() => setShowAddCamp((v) => !v)}>
                    {showAddCamp ? "Cancel" : "+ Define a future camp"}
                  </button>
                </div>
              ) : (
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  Only a Guide (or Admin/Super) can define a new camp. Viewing as{" "}
                  {role} — this control isn't shown to that role on a real project.
                </p>
              )}
              {canDefine && showAddCamp && (
                <Surface className="pm-add-camp">
                  <Stack gap={4}>
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                      Per the seed: "Camps can be defined ahead of when they start, but
                      only one is ever in focus." Saving here only updates this browser
                      tab's state — it appends a new, upcoming camp after Construction.
                    </p>
                    <Input label="Name" name={`${formId}-name`} value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. Landscaping" />
                    <Input
                      label="Description / overview"
                      name={`${formId}-description`}
                      type="textarea"
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      placeholder="What this camp covers"
                    />
                    <Cluster gap={2}>
                      <button type="button" className={button({ variant: "primary" })} disabled={!draftName.trim()} onClick={addCamp}>
                        Save camp (mockup only)
                      </button>
                    </Cluster>
                  </Stack>
                </Surface>
              )}
            </>
          )}
        </>
      )}

    </div>
  );
}
