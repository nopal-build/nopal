// app/routes/prototype.seed.tsx
//
// Landing point of the onboarding funnel prototype: a real-UI pass at
// the Project Seed view for a brand-new, NOT-LOGGED-IN stranger (see
// `garden/1-seeds/project-map.md` and `garden/2-ready/
// intake-creates-project.md`). Adapted from `ProjectMapMockup`'s
// "seed" stage, but:
//   - no annotations, no "Viewing as" switcher, no lifecycle scrubber —
//     this reads as real product, not a reviewer tool.
//   - no session/chrome beyond `AuthShell` — this person hasn't logged
//     in yet.
//   - single seed packet (one person, not the mockup's per-role
//     SEEDING_ROLES map) — there's no team yet, just this one stranger.
//   - new: a "Verify your email" checklist task, modeled on the real
//     email-code flow (`/verify`'s "Check your email for the code"),
//     not a click-a-link style.
//   - no "Start Project" / "Define first camp" — those are Guide-only
//     (see the mockup's `canDefine` gate) and the Guide side of this
//     flow is explicitly out of scope for this prototype pass. Instead,
//     a plain "What happens next" section.
//
// No backend: everything is local state seeded from the funnel's URL
// search params. Reloading resets it — fine for a prototype, not a
// promise about the real page's persistence.
import { useState } from "react";
import type { MetaFunction } from "react-router";
import { useSearchParams } from "react-router";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Input } from "stamps/Input";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { button } from "stamps/button.css";
import { semanticColors } from "stamps/tokens";
import { AuthShell } from "../components/AuthShell";
import { planBySlug } from "../components/prototype-onboarding/shared";

export const meta: MetaFunction = () => [{ title: "O.No · Project Seed" }];

type EditableFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  onSave: (next: string) => void;
};

function EditableField({ label, value, placeholder, onSave }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <Cluster gap={2} align="center" wrap>
        <Input label={label} hideLabel name={`seed-${label}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder={placeholder} />
        <button
          type="button"
          className={button({ variant: "primary", size: "compact" })}
          onClick={() => {
            onSave(draft);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </Cluster>
    );
  }

  return (
    <div className="proto-stat">
      <span className="proto-stat__label">{label}</span>
      <Cluster gap={2} align="center">
        <span className="proto-stat__value">{value || placeholder}</span>
        <button type="button" className={button({ variant: "quiet" })} onClick={() => setEditing(true)}>
          Edit
        </button>
      </Cluster>
    </div>
  );
}

export default function PrototypeSeed() {
  const [searchParams] = useSearchParams();
  const plan = planBySlug(searchParams.get("plan"));
  const date = searchParams.get("date");
  const time = searchParams.get("time");
  const email = searchParams.get("email") ?? "";

  const [projectName, setProjectName] = useState(searchParams.get("projectName") || "New Project");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);

  const [targetFinish, setTargetFinish] = useState("");
  const [finalGoal, setFinalGoal] = useState("");

  const [note, setNote] = useState("");
  const [files, setFiles] = useState<string[]>([]);

  const [emailVerified, setEmailVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");

  const uploadedSomething = note.trim().length > 0 || files.length > 0;
  const meetingScheduled = !!(date && time);

  const checklist = [
    { label: "Upload project info & files", done: uploadedSomething },
    { label: "Verify your email", done: emailVerified },
    { label: meetingScheduled ? `Initial Guide meeting — ${date} at ${time}` : "Initial Guide meeting", done: meetingScheduled },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  function addMockFile() {
    setFiles((fs) => [...fs, `upload-${fs.length + 1}.pdf`]);
  }

  function submitCode() {
    if (codeDraft.trim().length === 0) return;
    setEmailVerified(true);
    setVerifying(false);
    setCodeDraft("");
  }

  return (
    <AuthShell maxWidth="720px">
      <div className={sprinkles({ display: "flex", flexDirection: "column", gap: 6 })}>
        <div className="proto-guest-banner">
          You're not logged in yet. Verify your email below so your Guide can reach you — a
          full account follows once they confirm the project.
        </div>

        <header>
          <p className="proto-eyebrow">PROJECT SEED{plan ? ` \u00b7 ${plan.name.toUpperCase()}` : ""}</p>
          {editingName ? (
            <Cluster gap={2} align="center" wrap>
              <Input label="Project name" hideLabel name="project-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
              <button
                type="button"
                className={button({ variant: "primary", size: "compact" })}
                disabled={!nameDraft.trim()}
                onClick={() => {
                  setProjectName(nameDraft.trim());
                  setEditingName(false);
                }}
              >
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
              <button type="button" className={button({ variant: "quiet" })} onClick={() => setEditingName(true)}>
                Edit name
              </button>
            </Cluster>
          )}
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            This is the start of your project — your Guide will pick it up from here once
            you've shared what you can and verified your email.
          </p>
        </header>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={4}>
            <Cluster gap={8} wrap>
              <EditableField label="Target finish" value={targetFinish} placeholder="Not set yet" onSave={setTargetFinish} />
              <EditableField label="Final goal" value={finalGoal} placeholder="Not set yet" onSave={setFinalGoal} />
            </Cluster>
            <Stack gap={2}>
              <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>
                What's needed to move forward ({doneCount}/{checklist.length})
              </p>
              <ul className="proto-checklist">
                {checklist.map((item) => (
                  <li key={item.label} data-done={item.done}>
                    <span className="proto-check">{item.done ? "\u2713" : ""}</span>
                    <span className="proto-checklist__label">{item.label}</span>
                  </li>
                ))}
              </ul>
            </Stack>
          </Stack>
        </Surface>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Verify your email</p>
            {emailVerified ? (
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                {"\u2713"} {email || "Your email"} is verified.
              </p>
            ) : verifying ? (
              <Stack gap={3}>
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  Check {email || "your email"} for the code.
                </p>
                <div className="proto-code-box">
                  <Input label="Code" name="verify-code" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} placeholder="123456" />
                  <button type="button" className={button({ variant: "primary", size: "compact" })} disabled={!codeDraft.trim()} onClick={submitCode}>
                    Continue
                  </button>
                </div>
              </Stack>
            ) : (
              <Stack gap={3}>
                <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                  We'll send a code to {email || "your email"}.
                </p>
                <Cluster>
                  <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={() => setVerifying(true)}>
                    Send code
                  </button>
                </Cluster>
              </Stack>
            )}
          </Stack>
        </Surface>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Share what you already have</p>
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              Notes, threads, photos, documents — anything about the project so far. This stays
              editable by you until your Guide picks it up.
            </p>
            <textarea className="proto-note-editor" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell us about the project..." />
            <Cluster gap={2} align="center" wrap>
              <button type="button" className={button({ variant: "outline", size: "compact" })} onClick={addMockFile}>
                + Add a file (prototype)
              </button>
            </Cluster>
            {files.length > 0 && (
              <ul className="proto-file-list">
                {files.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </Stack>
        </Surface>

        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            <Cluster gap={2} align="center">
              <Badge variant="neutral">Waiting on your Guide</Badge>
            </Cluster>
            <p className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>What happens next</p>
            <ul className="proto-next-steps">
              <li>Your Guide gets notified and reviews what you've shared.</li>
              <li>
                You'll meet {meetingScheduled ? `on ${date} at ${time}` : "at your scheduled time"} — by
                then, they'll already know the project.
              </li>
              <li>Together you'll set up Basecamp and the first camp to work toward.</li>
            </ul>
          </Stack>
        </Surface>

        {plan && (
          <Cluster gap={2}>
            <Chip>Plan: {plan.name}</Chip>
          </Cluster>
        )}
      </div>
    </AuthShell>
  );
}
