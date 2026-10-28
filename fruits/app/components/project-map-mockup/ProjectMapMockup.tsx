// app/components/project-map-mockup/ProjectMapMockup.tsx
//
// Throwaway visual exploration for `garden/1-seeds/project-map.md` —
// built to make the seed's open questions clickable, not to answer them.
// Everything here is local React state over hardcoded mock data; nothing
// reads or writes real projects. Meant to be deleted or replaced once the
// seed's open questions are resolved and real work starts (see the seed's
// "Next step").
//
// The toggles at the top exist ONLY to let the open questions be seen
// side-by-side, not because both options are seriously being proposed as
// final designs. `pm-flag` callouts throughout point back at the exact
// open question in the seed each piece of UI is standing in for.
import { Fragment, useId, useState, type ReactNode } from "react";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
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

type Camp = {
  id: string;
  name: string;
  description: string;
  eta: string;
  status: CampStatus;
  steps: Step[];
  content: ContentItem[];
};

type Phase = { id: string; name: string; campIds: string[] };

const BASECAMP = {
  overview:
    "Contract signed, budget approved, site access confirmed, and the design packet handed to the crew. This is the one spot everyone can always return to if a camp stalls.",
  kickoff: "Sep 2, 2026",
  targetFinish: "Mar 2027 (estimate)",
  checklist: [
    "Contract signed",
    "Budget approved",
    "Site access confirmed",
    "Design packet delivered to crew",
  ],
};

const FINAL_GOAL = "Move-in ready";

const INITIAL_CAMPS: Camp[] = [
  {
    id: "foundation",
    name: "Foundation",
    description: "Demo, excavation, footings and slab.",
    eta: "Done — Oct 2026",
    status: "done",
    steps: [
      { id: "s1", label: "Demo existing slab", done: true, source: "manual" },
      {
        id: "s2",
        label: "Pour footings",
        done: true,
        source: "graphlog",
        graphNode: "Footing inspection passed (daily log, Oct 14)",
      },
      { id: "s3", label: "Slab cured & inspected", done: true, source: "manual" },
    ],
    content: [
      { id: "c1", type: "effort", label: "Foundation inspection passed", when: "Oct 14" },
      { id: "c2", type: "file", label: "Slab inspection photos (12)", when: "Oct 14" },
      { id: "c3", type: "logbook", label: "Austin: \u201cFootings poured, inspector signed off\u201d", when: "Oct 14" },
    ],
  },
  {
    id: "framing",
    name: "Framing & Roof",
    description: "Wall framing, roof trusses, dry-in.",
    eta: "ETA Dec 2026",
    status: "focused",
    steps: [
      { id: "s4", label: "Wall framing", done: true, source: "manual" },
      {
        id: "s5",
        label: "Roof trusses set",
        done: true,
        source: "graphlog",
        graphNode: "Truss delivery + crane day (daily log, Oct 24)",
      },
      {
        id: "s6",
        label: "Roof dry-in",
        done: false,
        source: "graphlog",
        graphNode: "\u201cStarting felt + flashing tomorrow\u201d (daily log, Oct 27)",
      },
      { id: "s7", label: "Rough window openings framed", done: false, source: "manual" },
    ],
    content: [
      { id: "c4", type: "effort", label: "Framing 60% complete", when: "Oct 24" },
      { id: "c5", type: "file", label: "Truss delivery photos (8)", when: "Oct 24" },
      { id: "c6", type: "logbook", label: "Lucas: \u201cTrusses are up, starting dry-in this week\u201d", when: "Oct 27" },
    ],
  },
  {
    id: "systems",
    name: "Interior Systems",
    description: "Rough electrical, plumbing, HVAC.",
    eta: "ETA Jan 2027",
    status: "upcoming",
    steps: [
      { id: "s8", label: "Rough electrical", done: false, source: "manual" },
      { id: "s9", label: "Rough plumbing", done: false, source: "manual" },
      { id: "s10", label: "HVAC rough-in", done: false, source: "manual" },
    ],
    content: [],
  },
  {
    id: "finishes",
    name: "Finishes",
    description: "Drywall, paint, flooring, fixtures.",
    eta: "ETA Feb 2027",
    status: "upcoming",
    steps: [
      { id: "s11", label: "Drywall & paint", done: false, source: "manual" },
      { id: "s12", label: "Flooring", done: false, source: "manual" },
      { id: "s13", label: "Fixtures & final punch list", done: false, source: "manual" },
    ],
    content: [],
  },
];

const PHASES: Phase[] = [
  { id: "design", name: "Design", campIds: ["foundation"] },
  { id: "sourcing-construction", name: "Sourcing & Construction", campIds: ["framing", "systems", "finishes"] },
];

function Flag({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="pm-flag">
      <span className="pm-flag__tag">Open Q{n}</span>
      <p>{children}</p>
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

type ContentFilter = "steps" | "effort" | "file" | "logbook";

export function ProjectMapMockup() {
  const [showPhases, setShowPhases] = useState(false);
  const [resetPerPhase, setResetPerPhase] = useState(false);
  const [twoInFocus, setTwoInFocus] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("steps");
  const [camps, setCamps] = useState<Camp[]>(INITIAL_CAMPS);
  const [showAddCamp, setShowAddCamp] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftEta, setDraftEta] = useState("");
  const formId = useId();

  const effectiveCamps = camps.map((c) =>
    twoInFocus && c.id === "systems" ? { ...c, status: "focused" as CampStatus } : c,
  );

  const focusedCamps = effectiveCamps.filter((c) => c.status === "focused");
  const primaryFocus = focusedCamps[0] ?? effectiveCamps[0];
  const selected = effectiveCamps.find((c) => c.id === previewId) ?? primaryFocus;
  const isPreviewing = selected.id !== primaryFocus.id;

  const addCamp = () => {
    if (!draftName.trim()) return;
    const id = `draft-${Date.now()}`;
    const newCamp: Camp = {
      id,
      name: draftName.trim(),
      description: draftDescription.trim() || "(no description yet)",
      eta: draftEta.trim() || "ETA not set",
      status: "upcoming",
      steps: [],
      content: [],
    };
    setCamps((prev) => [...prev, newCamp]);
    setPreviewId(id);
    setDraftName("");
    setDraftDescription("");
    setDraftEta("");
    setShowAddCamp(false);
  };

  const campsByPhase = (phase: Phase) => effectiveCamps.filter((c) => phase.campIds.includes(c.id));
  const phasedIds = new Set(PHASES.flatMap((p) => p.campIds));
  const unphased = effectiveCamps.filter((c) => !phasedIds.has(c.id));

  return (
    <div className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })}>
      <div className="pm-banner">
        <strong>Mockup — Project Map.</strong> Exploring{" "}
        <code>garden/1-seeds/project-map.md</code>. Nothing here reads or writes a real
        project; the toggles below exist to make the seed's open questions visible
        side-by-side, not to declare an answer. See the "Open questions in this mockup"
        section at the bottom for the full list.
      </div>

      <header>
        <p className="pm-eyebrow">PROJECT · STANDARD</p>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>Casa Verde Remodel</h1>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Demo data only — stands in for the real Project page rework this seed feeds
          into (<code>stamps-tab-system</code>).
        </p>
      </header>

      <Surface className={sprinkles({ p: 4 })}>
        <Cluster gap={4} wrap>
          <Chip active={showPhases} onClick={() => setShowPhases((v) => !v)}>
            Show Phases wrapper
          </Chip>
          <Chip active={resetPerPhase} onClick={() => setResetPerPhase((v) => !v)}>
            Basecamp resets per Phase
          </Chip>
          <Chip active={twoInFocus} onClick={() => setTwoInFocus((v) => !v)}>
            Experimental: 2 camps in focus
          </Chip>
        </Cluster>
      </Surface>

      {/* --- Basecamp --- */}
      <Surface className="pm-basecamp">
        <Stack gap={4}>
          <Cluster style={{ justifyContent: "space-between" }} align="flex-start">
            <Stack gap={1}>
              <Badge variant="accent">BASECAMP</Badge>
              <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>
                Home base — the overall plan &amp; timeline
              </h2>
            </Stack>
            <Badge variant="success">Established</Badge>
          </Cluster>
          <p className={textSize.sm}>{BASECAMP.overview}</p>
          <Cluster gap={8} wrap>
            <Stat label="Kickoff" value={BASECAMP.kickoff} />
            <Stat label="Target finish" value={BASECAMP.targetFinish} />
            <Stat label="Final goal" value={FINAL_GOAL} />
          </Cluster>
          <Disclosure summary={`What's in place to move forward (${BASECAMP.checklist.length}/${BASECAMP.checklist.length})`}>
            <ul className="pm-checklist">
              {BASECAMP.checklist.map((item) => (
                <li key={item}>
                  <span className="pm-check">{"\u2713"}</span> {item}
                </li>
              ))}
            </ul>
          </Disclosure>
        </Stack>
      </Surface>

      <Flag n={2}>
        Camps vs. Phases: toggling "Basecamp resets per Phase" shows the two live
        options from the seed — one shared Basecamp for the whole project (off), or a
        Basecamp re-established at the start of each Phase (on). Genuinely unresolved
        per the seed; needs Austin's input.
      </Flag>

      {/* --- Camps trail --- */}
      <section>
        <h3 className={`${textSize.sm} ${sprinkles({ fontWeight: "bold", mb: 2 })}`} style={{ textTransform: "uppercase", letterSpacing: "0.04em", color: semanticColors.textSubtle }}>
          Camps
        </h3>
        <Surface className={sprinkles({ p: 2 })}>
          <div className="pm-trail">
            {!showPhases && (
              <div className="pm-trail-row">
                <CampNode kind="basecamp" label="Basecamp" />
                <TrailLink />
                {effectiveCamps.map((camp, i) => (
                  <Fragment key={camp.id}>
                    <CampNode
                      kind={camp.status}
                      label={camp.name}
                      selected={camp.id === selected.id}
                      onClick={() => setPreviewId(camp.id)}
                    />
                    <TrailLink last={i === effectiveCamps.length - 1} />
                  </Fragment>
                ))}
                <CampNode kind="final" label={FINAL_GOAL} />
              </div>
            )}

            {showPhases && (
              <div className="pm-trail-row">
                {!resetPerPhase && (
                  <>
                    <CampNode kind="basecamp" label="Basecamp" />
                    <TrailLink />
                  </>
                )}
                {PHASES.map((phase, pi) => (
                  <Fragment key={phase.id}>
                    <div className="pm-phase-group">
                      <span className="pm-phase-group__label">{phase.name}</span>
                      {resetPerPhase && (
                        <>
                          <CampNode kind="basecamp" label="Basecamp" />
                          <TrailLink />
                        </>
                      )}
                      {campsByPhase(phase).map((camp, i, arr) => (
                        <Fragment key={camp.id}>
                          <CampNode
                            kind={camp.status}
                            label={camp.name}
                            selected={camp.id === selected.id}
                            onClick={() => setPreviewId(camp.id)}
                          />
                          <TrailLink last={i === arr.length - 1} />
                        </Fragment>
                      ))}
                    </div>
                    {pi < PHASES.length - 1 && <TrailLink />}
                  </Fragment>
                ))}
                {unphased.length > 0 && (
                  <>
                    <TrailLink />
                    {unphased.map((camp, i) => (
                      <Fragment key={camp.id}>
                        <CampNode
                          kind={camp.status}
                          label={camp.name}
                          selected={camp.id === selected.id}
                          onClick={() => setPreviewId(camp.id)}
                        />
                        <TrailLink last={i === unphased.length - 1} />
                      </Fragment>
                    ))}
                  </>
                )}
                <TrailLink />
                <CampNode kind="final" label={FINAL_GOAL} />
              </div>
            )}
          </div>
        </Surface>
      </section>

      <Flag n={1}>
        "Only one camp in focus at a time" is flagged in the seed as an assumption to
        validate, not a decision. Toggle "2 camps in focus" above to see Framing &amp;
        Roof and Interior Systems both lit up — worth asking whether the UI (and the
        data model) actually needs to support that for a complex build.
      </Flag>

      {/* --- Camp detail / filtered content --- */}
      <Surface className="pm-camp-detail">
        <Stack gap={4}>
          {isPreviewing && (
            <div className="pm-preview-banner">
              <span>
                Previewing <strong>{selected.name}</strong> — the team's focus is still on{" "}
                <strong>{primaryFocus.name}</strong>.
              </span>
              <button type="button" onClick={() => setPreviewId(null)}>
                Jump to focus
              </button>
            </div>
          )}
          <Cluster style={{ justifyContent: "space-between" }} align="flex-start" wrap>
            <Stack gap={1}>
              <Cluster gap={2}>
                <Badge variant={selected.status === "done" ? "success" : selected.status === "focused" ? "accent" : "neutral"}>
                  {selected.status === "done" ? "Done" : selected.status === "focused" ? "In focus" : "Upcoming"}
                </Badge>
                <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  {selected.eta}
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
              Steps ({selected.steps.length})
            </Chip>
            <Chip active={contentFilter === "effort"} onClick={() => setContentFilter("effort")}>
              Efforts ({selected.content.filter((c) => c.type === "effort").length})
            </Chip>
            <Chip active={contentFilter === "file"} onClick={() => setContentFilter("file")}>
              Files ({selected.content.filter((c) => c.type === "file").length})
            </Chip>
            <Chip active={contentFilter === "logbook"} onClick={() => setContentFilter("logbook")}>
              Logbook ({selected.content.filter((c) => c.type === "logbook").length})
            </Chip>
          </Cluster>

          <Flag n={4}>
            This nests a tab-like content-type picker INSIDE the selected camp (one
            option from the seed: "camps pick a camp, tabs still pick a content type
            within it"). The alternative — camp selection replacing tabs entirely — is
            the other live option `stamps-tab-system` would need to reconcile with.
          </Flag>

          {contentFilter === "steps" ? (
            <ul className={sprinkles({ display: "flex", flexDirection: "column" })} style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {selected.steps.length === 0 && (
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  No steps defined for this camp yet.
                </p>
              )}
              {selected.steps.map((step) => (
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
              {selected.content.filter((c) => c.type === contentFilter).length === 0 && (
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  Nothing filed under this camp yet.
                </p>
              )}
              {selected.content
                .filter((c) => c.type === contentFilter)
                .map((item) => (
                  <li key={item.id} className="pm-content-row">
                    <span>{item.label}</span>
                    <span className="pm-content-row__when">{item.when}</span>
                  </li>
                ))}
            </ul>
          )}

          <Flag n={5}>
            The GraphLog badges above are hand-authored mock text, not a real
            integration — today's `graph-structure` clustering has no concept of camp
            sequencing or focus to extend (confirmed in the seed). Teaching it to
            recognize "this node's work belongs to Camp N" is real, separate work.
          </Flag>
        </Stack>
      </Surface>

      {/* --- Define a future camp workflow --- */}
      <div>
        <button type="button" className={button({ variant: "outline" })} onClick={() => setShowAddCamp((v) => !v)}>
          {showAddCamp ? "Cancel" : "+ Define a future camp"}
        </button>
      </div>
      {showAddCamp && (
        <Surface className="pm-add-camp">
          <Stack gap={4}>
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              Per the seed: "Camps can be defined ahead of when they start, but only
              one is ever in focus." Saving here only updates this browser tab's state
              — it appends a new, upcoming camp to the trail above.
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
            <Input label="ETA" name={`${formId}-eta`} value={draftEta} onChange={(e) => setDraftEta(e.target.value)} placeholder="e.g. ETA Apr 2027" />
            <Cluster gap={2}>
              <button type="button" className={button({ variant: "primary" })} disabled={!draftName.trim()} onClick={addCamp}>
                Save camp (mockup only)
              </button>
            </Cluster>
          </Stack>
        </Surface>
      )}

      {/* --- Open questions recap --- */}
      <Surface className={sprinkles({ p: 4 })}>
        <Stack gap={2}>
          <h3 className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Open questions flagged in this mockup</h3>
          <ol className={textSize.sm} style={{ color: semanticColors.textSubtle, paddingLeft: "1.2em" }}>
            <li>Is "only one camp in focus at a time" actually right? (toggle above)</li>
            <li>Camps vs. Phases — does Basecamp reset per Phase, or stay one for the whole project? (toggle above)</li>
            <li>How does camp selection actually filter the main content below it?</li>
            <li>Relationship to <code>stamps-tab-system</code> — reshaped, absorbed, or independent of camp filtering?</li>
            <li>What would "AI-identified and sorted" actually require from GraphLog's <code>graph-structure</code> stage?</li>
          </ol>
        </Stack>
      </Surface>
    </div>
  );
}
