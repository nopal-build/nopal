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
// Basecamp checklist/"Start a Basecamp" button or "+ Define a future
// camp" — everyone else sees the same thing read-only. Deliberately kept
// SEPARATE from the lifecycle scrubber: the scrubber is a reviewer-only
// convenience for exploring every state regardless of role, not a
// simulation of a real control any role would see.
//
// v4 (2026-10-28): a persistent two-column page layout — the LEFT column
// is only ever the simulated product itself (what a real viewer would
// see); the RIGHT column is a sticky sidebar holding every piece of
// mockup-only chrome: the "Viewing as" switcher, the lifecycle scrubber,
// and every running `Callout` note, in the same red-pen/handwritten
// convention the real GraphLog mark notes use (`oxmarkdown.css`). Nothing
// about simulating or reviewing this mockup should ever appear mixed
// into the left column.
//
// v7 (2026-10-28): the "Basecamp prep" stage is gone — folded into the
// empty stage entirely (Gerald: "we can safely merge Basecamp Prep screen
// into the empty screen"). The locked-phases preview is gone too (the
// Guide's own phase editor already shows this). The planning-stage
// notes/files are no longer a daily-log stand-in: they're modeled on the
// REAL seed packet feature (`SeedPacket.tsx`, `seedPackets.server.ts`) —
// per-person, open/editable only while a seeding round is open, and once
// a Guide closes it, read-only and (conceptually) the start of GraphLog's
// process. The Basecamp checklist's first item is no longer a manual
// checkbox: it's derived from whether anyone's seed packet actually has
// content.
import { useEffect, useId, useState, type ReactNode, Fragment } from "react";
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
    "This is the one spot everyone can always return to if a camp stalls — established once the project's info is in, the team has met, and the contract is signed.",
  kickoff: "Sep 2, 2026",
  targetFinish: "Jun 2027 (estimate)",
  // The first item is derived, not manually checked — see `anySeedContent`.
  checklist: ["Upload project info / files", "Initial Guide meeting", "Contract / payment"],
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
  { key: "discovery", label: "Discovery" },
  { key: "design", label: "Design" },
  { key: "sourcing", label: "Sourcing" },
  { key: "construction", label: "Construction" },
  { key: "complete", label: "Complete" },
] as const;

type Stage = "empty" | "active" | "complete";

/** The real project-level groups (`GROUPS` in `robustness-core/data/
 * features.ts`), kept in the same order the human asked for here rather
 * than that file's own order — purely a display choice, same 4 values. */
type Role = "Observer" | "Client" | "Crafter" | "Guide";
const ROLES: Role[] = ["Observer", "Client", "Crafter", "Guide"];
function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as string[]).includes(x);
}

/** A seed packet (`SeedPacket.tsx`, `seedPackets.server.ts`): while a
 * seeding round is open, each person adds whatever they already have.
 * Only Client/Crafter author one here (Gerald, 2026-10-28); Guide/staff
 * manage the round instead (open/sow/end) rather than contributing one. */
type SeedFile = { name: string; sown: boolean };
type SeedPacketState = { note: string; files: SeedFile[] };
const EMPTY_PACKET: SeedPacketState = { note: "", files: [] };
const SEEDING_ROLES: Role[] = ["Client", "Crafter"];

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

/** A note in the sidebar, in the hand — same red-pen/Indie-Flower
 * convention the real GraphLog mark notes use (`oxmarkdown.css`), so a
 * note always reads as "someone's handwriting about this", never
 * confusable with the mockup's own stamps-styled UI. A native `<details>`
 * (same reasoning as stamps' own `Disclosure`): `summary` is the one-line
 * version that's always visible, `children` is the full note, collapsed
 * until clicked — a sidebar with 9 of these read as a wall of handwriting
 * before, not a scannable list. */
function Callout({
  kind = "question",
  n,
  summary,
  children,
}: {
  kind?: "question" | "finding" | "decision";
  n: number;
  summary: string;
  children: ReactNode;
}) {
  const modifier = kind === "finding" ? "pm-flag--finding" : kind === "decision" ? "pm-flag--decision" : "";
  const tag = kind === "finding" ? `Finding ${n}` : kind === "decision" ? `Decided ${n}` : `Open Q${n}`;
  return (
    <details className={`pm-flag ${modifier}`.trim()}>
      <summary className="pm-flag__summary">
        <span className="pm-flag__tag">{tag}</span>
        <span className="pm-flag__summary-text">{summary}</span>
      </summary>
      <p className="pm-flag__body">{children}</p>
    </details>
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

  // The project's own name — editable by Client or Guide/staff (see
  // `canEditName` below), everyone else just reads it.
  const [projectName, setProjectName] = useState("Casa Verde Remodel");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);

  // Empty-stage-only state: a seeding round (per-person packets, open
  // until a Guide closes it) and the phase list a Guide/staff plans ahead
  // of starting Basecamp. Both scoped to `stage === "empty"` only.
  const [seedRoundOpen, setSeedRoundOpen] = useState(false);
  const [seedPackets, setSeedPackets] = useState<Record<string, SeedPacketState>>({});
  const [plannedPhaseNames, setPlannedPhaseNames] = useState<string[]>(PHASE_DEFS.map((p) => p.name));
  const [newPhaseName, setNewPhaseName] = useState("");

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
  // Client or Guide (or staff) can rename the project; Observer/Crafter
  // can't (Gerald, 2026-10-28).
  const canEditName = role === "Client" || canDefine;
  // Client and Crafter each get their own seed packet before Basecamp
  // exists; Observer and Guide/staff don't (Guide/staff manage the round
  // instead — see the empty-stage view).
  const participatesInSeeding = role === "Client" || role === "Crafter";
  const myPacket: SeedPacketState = seedPackets[role] ?? EMPTY_PACKET;
  const anySeedContent = Object.values(seedPackets).some((p) => p.note.trim() !== "" || p.files.length > 0);
  const waitingSeedCount = Object.values(seedPackets).reduce((n, p) => n + p.files.filter((f) => !f.sown).length, 0);
  const totalSeedFiles = Object.values(seedPackets).reduce((n, p) => n + p.files.length, 0);

  const camps: Camp[] = [...BASE_CAMPS, ...extraCamps];
  const established = stage === "active" || stage === "complete";
  // The first checklist item is derived from the seed packets, not a
  // manual checkbox — see the BASECAMP comment above.
  const effectiveChecklist = checklist.map((c, i) => (i === 0 ? anySeedContent : c));
  const allChecked = effectiveChecklist.every(Boolean);

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

  const startBasecamp = () => {
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
      setSeedPackets({});
      setSeedRoundOpen(false);
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
      else setStage("empty");
    }
    // stage === "empty": already at the start, nothing to go back to.
  };

  const advance = () => {
    if (stage === "empty") {
      // Deliberately bypasses the Basecamp checklist gate — this is the
      // demo scrubber's "time machine," not the real "Start a Basecamp"
      // button above, which DOES require every item checked. See Finding
      // 2 in the sidebar.
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

  const saveName = () => {
    if (!nameDraft.trim()) return;
    setProjectName(nameDraft.trim());
    setEditingName(false);
  };

  const updateMyNote = (value: string) => {
    setSeedPackets((prev) => ({ ...prev, [role]: { ...(prev[role] ?? EMPTY_PACKET), note: value } }));
  };

  const addMyFile = () => {
    setSeedPackets((prev) => {
      const mine = prev[role] ?? EMPTY_PACKET;
      const n = mine.files.length + 1;
      return { ...prev, [role]: { ...mine, files: [...mine.files, { name: `attachment-${n}.jpg (mockup only)`, sown: false }] } };
    });
  };

  const sowSeeds = () => {
    setSeedPackets((prev) => {
      const next: Record<string, SeedPacketState> = {};
      for (const [key, packet] of Object.entries(prev)) next[key] = { ...packet, files: packet.files.map((f) => ({ ...f, sown: true })) };
      return next;
    });
  };

  const endSeedRound = () => {
    sowSeeds();
    setSeedRoundOpen(false);
  };

  const addPlannedPhase = () => {
    if (!newPhaseName.trim()) return;
    setPlannedPhaseNames((prev) => [...prev, newPhaseName.trim()]);
    setNewPhaseName("");
  };

  const removePlannedPhase = (index: number) => {
    setPlannedPhaseNames((prev) => prev.filter((_, i) => i !== index));
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
        <strong>Mockup — Project Map.</strong> Exploring <code>garden/1-seeds/project-map.md</code>.
        Nothing here reads or writes a real project. Left is the simulated product — what
        a real viewer would actually see; right is our control panel and running notes
        about how it functions, in the hand, so the two are never confused.
      </div>

      <div className="pm-page">
        {/* ================= LEFT: the simulated product, nothing else ================= */}
        <div className="pm-page__main">
          <header>
            <p className="pm-eyebrow">PROJECT · STANDARD</p>
            {editingName ? (
              <Cluster gap={2} align="center" wrap>
                <Input
                  label="Project name"
                  hideLabel
                  name={`${formId}-project-name`}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  autoFocus
                />
                <button type="button" className={button({ variant: "primary", size: "compact" })} disabled={!nameDraft.trim()} onClick={saveName}>
                  Save
                </button>
                <button
                  type="button"
                  className={button({ variant: "outline", size: "compact" })}
                  onClick={() => {
                    setNameDraft(projectName);
                    setEditingName(false);
                  }}
                >
                  Cancel
                </button>
              </Cluster>
            ) : (
              <Cluster gap={3} align="baseline">
                <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>{projectName}</h1>
                {canEditName && (
                  <button type="button" className={button({ variant: "quiet" })} onClick={() => setEditingName(true)}>
                    Edit name
                  </button>
                )}
              </Cluster>
            )}
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              Demo data only — stands in for the real Project page rework this seed feeds
              into (<code>stamps-tab-system</code>).
            </p>
          </header>

          {/* --- Basecamp: always shown, "not yet established" doubles as
              the merged former "prep" screen --- */}
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
              {stage === "empty" ? (
                <Stack gap={2}>
                  <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>
                    What's needed to move forward ({effectiveChecklist.filter(Boolean).length}/{effectiveChecklist.length})
                  </p>
                  <Stack gap={2}>
                    {BASECAMP.checklist.map((item, i) => {
                      const derived = i === 0;
                      return (
                        <Checkbox
                          key={item}
                          label={derived ? `${item} (from seed packets below)` : item}
                          checked={effectiveChecklist[i]}
                          disabled={derived || !canDefine}
                          onChange={(v) => setChecklist((cs) => cs.map((c, ci) => (ci === i ? v : c)))}
                        />
                      );
                    })}
                  </Stack>
                  {canDefine ? (
                    <Cluster>
                      <button type="button" className={button({ variant: "primary" })} disabled={!allChecked} onClick={startBasecamp}>
                        Start a Basecamp
                      </button>
                    </Cluster>
                  ) : (
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                      Only a Guide (or Admin/Super) can check these off and start Basecamp.{" "}
                      {role} can see progress here, not change it.
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

          {stage === "empty" && (
            <>
              {role === "Observer" && (
                <Surface className="pm-empty">
                  <Stack gap={1} align="center">
                    <p className="pm-eyebrow">PROJECT STATUS</p>
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle, textAlign: "center", maxWidth: 420 }}>
                      This project is currently in planning. Nothing needs your attention yet —
                      check back once Basecamp is established and work starts.
                    </p>
                  </Stack>
                </Surface>
              )}

              {participatesInSeeding && (
                <Surface className={sprinkles({ p: 4 })}>
                  <Stack gap={3}>
                    <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Your seed packet</p>
                    {seedRoundOpen ? (
                      <>
                        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                          Upload any existing info you have: threads, emails, notes, documents,
                          photos, etc. Stays open and editable until a Guide closes the seed
                          round — once closed, this becomes the start of GraphLog's process.
                        </p>
                        <textarea
                          className="pm-note-editor"
                          value={myPacket.note}
                          onChange={(e) => updateMyNote(e.target.value)}
                          placeholder="Add a note to your packet..."
                        />
                        <Cluster gap={2} align="center" wrap>
                          <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={addMyFile}>
                            + Add a file (mockup)
                          </button>
                        </Cluster>
                        {myPacket.files.length > 0 && (
                          <ul className="pm-file-list">
                            {myPacket.files.map((f, i) => (
                              <li key={i}>
                                {f.name} <span style={{ color: semanticColors.textSubtle }}>· {f.sown ? "sown" : "waiting"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : myPacket.note || myPacket.files.length > 0 ? (
                      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                        Seed round closed — your packet is read-only now. It's the start of
                        GraphLog's process from here.
                      </p>
                    ) : (
                      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                        No seeding round open yet — check back once a Guide starts one.
                      </p>
                    )}
                  </Stack>
                </Surface>
              )}

              {canDefine && (
                <Surface className={sprinkles({ p: 4 })}>
                  <Stack gap={3}>
                    <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Define phases</p>
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                      Defaults to the usual Standard-project pipeline — add or remove to fit
                      this project.
                    </p>
                    <Cluster gap={2} wrap>
                      {plannedPhaseNames.map((name, i) => (
                        <span key={`${name}-${i}`} className="pm-phase-editable">
                          {name}
                          <button type="button" onClick={() => removePlannedPhase(i)} aria-label={`Remove ${name}`}>
                            ×
                          </button>
                        </span>
                      ))}
                    </Cluster>
                    <Cluster gap={2} align="center">
                      <Input
                        label="New phase name"
                        hideLabel
                        name="new-phase-name"
                        value={newPhaseName}
                        onChange={(e) => setNewPhaseName(e.target.value)}
                        placeholder="e.g. Permitting"
                      />
                      <button type="button" className={button({ variant: "outline", size: "compact" })} disabled={!newPhaseName.trim()} onClick={addPlannedPhase}>
                        + Add phase
                      </button>
                    </Cluster>
                    <p className={textSize.sm} style={{ color: semanticColors.textSubtle, fontStyle: "italic" }}>
                      Mockup limitation: this list is illustrative only — once Basecamp
                      starts, the rest of this mockup still uses the fixed Discovery/Design/
                      Sourcing/Construction dataset built earlier. Regenerating camps per
                      custom phase is out of scope for this pass.
                    </p>
                  </Stack>
                </Surface>
              )}

              {canDefine && (
                <Surface className={sprinkles({ p: 4 })}>
                  <Stack gap={3}>
                    <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Seed round</p>
                    {!seedRoundOpen ? (
                      <>
                        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                          Open a round so Client/Crafter can add what they already have before
                          Basecamp starts.
                        </p>
                        <Cluster>
                          <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={() => setSeedRoundOpen(true)}>
                            Open a seeding round
                          </button>
                        </Cluster>
                      </>
                    ) : (
                      <>
                        <Cluster gap={3} align="center" wrap>
                          <button type="button" className={button({ variant: "outline", size: "compact" })} disabled={waitingSeedCount === 0} onClick={sowSeeds}>
                            Sow ({waitingSeedCount} waiting)
                          </button>
                          <button type="button" className={button({ variant: "quiet" })} onClick={endSeedRound}>
                            End the seeding round
                          </button>
                        </Cluster>
                        {totalSeedFiles > 0 && (
                          <Disclosure summary={`Seed packets · ${totalSeedFiles} file${totalSeedFiles === 1 ? "" : "s"}`}>
                            <Stack gap={2}>
                              {SEEDING_ROLES.filter((r) => (seedPackets[r]?.files.length ?? 0) > 0 || seedPackets[r]?.note).map((r) => (
                                <div key={r} className={textSize.sm}>
                                  <span className={sprinkles({ fontWeight: "semibold" })}>{r}</span>
                                  {seedPackets[r]?.note && (
                                    <p style={{ color: semanticColors.textSubtle, margin: "2px 0" }}>{seedPackets[r]?.note}</p>
                                  )}
                                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                                    {seedPackets[r]?.files.map((f, i) => (
                                      <li key={i} style={{ color: semanticColors.textSubtle }}>
                                        {f.name} · {f.sown ? "sown" : "waiting"}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </Stack>
                          </Disclosure>
                        )}
                      </>
                    )}
                  </Stack>
                </Surface>
              )}
            </>
          )}

          {(stage === "active" || stage === "complete") && (
                <>
                  {/* --- Camps trail --- */}
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

                  {/* --- Camp detail / filtered content --- */}
                  {selected && (
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
        </div>

        {/* ================= RIGHT: our control panel + running notes ================= */}
        <aside className="pm-page__side">
          <Surface className={sprinkles({ p: 4 })}>
            <Stack gap={4}>
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

              <hr className="pm-side-divider" />

              <Stack gap={3}>
                <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Simulate the project lifecycle</p>
                <Cluster gap={2} wrap>
                  {MILESTONES.map((m) => (
                    <Chip key={m.key} active={currentMilestoneKey() === m.key} onClick={() => jumpTo(m.key)}>
                      {m.label}
                    </Chip>
                  ))}
                </Cluster>
                <Cluster gap={3} align="center" wrap>
                  <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={goBack}>
                    ← Back
                  </button>
                  <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
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
            </Stack>
          </Surface>

          <Callout kind="decision" n={1} summary="Guide-only (or Admin/Super) can define Basecamp, Phases, or Camps.">
            Guides (or Admin/Super humans, regardless of their project group) are the
            only ones who can define Basecamp, Phases, or Camps — confirmed by Gerald,
            2026-10-28, not an open question anymore. Switch "Viewing as" to
            Observer/Client/Crafter to see the Basecamp checklist and "+ Define a
            future camp" become read-only. This doesn't gate the scrubber above — that's
            a reviewer-only convenience for exploring every state as any role, not a
            simulation of a real in-product control.
          </Callout>

          <Callout n={2} summary="Does Basecamp reset per Phase, or stay one for the whole project?">
            Camps vs. Phases: toggling "Basecamp resets per Phase" shows the two live
            options from the seed — one shared Basecamp for the whole project (off), or
            a Basecamp re-established at the start of each Phase (on). Genuinely
            unresolved per the seed; needs Austin's input.
          </Callout>

          <Callout kind="finding" n={2} summary="The real gate (checklist) and the demo-only scrubber need to stay visibly distinct.">
            The checklist-gated "Start a Basecamp" button is the real workflow
            (disabled until every item is checked). The "Advance" scrubber and milestone
            chips deliberately bypass that gate so this mockup stays navigable — worth
            deciding whether a real "jump ahead" shortcut should ever exist for staff, or
            whether Basecamp should always hard-block camp progress.
          </Callout>

          <Callout n={1} summary='Is "only one camp in focus at a time" actually right?'>
            "Only one camp in focus at a time" is flagged in the seed as an assumption to
            validate, not a decision. Toggle "2 camps in focus" above to see the camp
            right after the current one light up too — worth asking whether the UI (and
            the data model) actually needs to support that for a complex build.
          </Callout>

          <Callout kind="finding" n={1} summary="A flat trail doesn't scale — Phases, not Camps, likely need to collapse.">
            At a believable scale (~33 camps across 4 phases), a flat trail of every camp
            is unwieldy — so by default this mockup collapses any phase that isn't the
            current one into a single summary pill ("8/8 done" or "9 camps"), expanding
            only on click. Toggle "Expand all phases" to see the dense version for
            comparison. This suggests Phases, not Camps, may need to be the primary
            collapse/navigation unit on the real Project page.
          </Callout>

          <Callout kind="finding" n={3} summary="Per-camp authoring cost makes GraphLog auto-sorting feel load-bearing, not optional.">
            Hand-authoring steps/content for 33 camps already felt like a lot of data
            entry for one demo project — a real project at this grain would make
            GraphLog's "AI-identified and sorted" piece (open Q5) less of a nice-to-have
            and more of a requirement for this to stay usable without heavy manual
            upkeep per camp.
          </Callout>

          <Callout n={3} summary="How does camp selection actually filter the main content below it?">
            How camp selection actually filters the main content below it is still
            genuinely open — this mockup's answer (a content-type picker nested inside
            the selected camp) is only one option it tries out, not a settled design.
          </Callout>

          <Callout n={4} summary="Tabs nested inside a camp, or camps replacing tabs entirely?">
            This nests a tab-like content-type picker INSIDE the selected camp (one
            option from the seed: "camps pick a camp, tabs still pick a content type
            within it"). The alternative — camp selection replacing tabs entirely — is
            the other live option `stamps-tab-system` would need to reconcile with.
          </Callout>

          <Callout n={5} summary="GraphLog badges here are mocked — the real integration is separate work.">
            The GraphLog badges in the steps list are hand-authored mock text, not a real
            integration — today's `graph-structure` clustering has no concept of camp
            sequencing or focus to extend (confirmed in the seed). Teaching it to
            recognize "this node's work belongs to Camp N" is real, separate work.
          </Callout>
        </aside>
      </div>
    </div>
  );
}
