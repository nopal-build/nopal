/**
 * Seed packets on the project page (Austin, 2026-09-30).
 *
 * `SeedPacket`: while a seeding round is open, each person on the project
 * sees their own packet next to the Steep-o-meter and adds whatever they
 * have from before: threads, emails, notes, PDFs, photos. Only they and
 * the project's Guides can open what is in it (`api.seed-packet.$fileId`).
 *
 * `SeedRoundControls`: the Guides' two buttons. Sow turns what is waiting
 * into seed, each file read once. End the seeding round sows what is
 * left and puts the packets away until a Guide opens another round.
 *
 * Who decides what. A person: what goes in a packet, when to sow, when a
 * round ends. Code: who may see a packet, what is waiting. The model
 * reads the files only when a Guide presses Sow.
 */
import { useRef, useState } from "react";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Surface } from "stamps/Surface";
import { Disclosure } from "stamps/Disclosure";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export type PacketFileRow = { id: string; name: string; sown: boolean };

export type SeedingForPage = {
  /** A round is open: packets are showing. */
  open: boolean;
  /** The viewer's own packet, while a round is open. */
  mine: PacketFileRow[] | null;
  /** For Guides: what waits, everyone's packets, and the questions out. */
  guide: {
    waiting: number;
    questions: number;
    packets: { person: string; files: PacketFileRow[] }[];
  } | null;
};

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export function SeedPacket({
  projectFolderId,
  files,
  seeding,
  onChanged,
}: {
  projectFolderId: string;
  files: PacketFileRow[];
  /** The whole seeding state; a Guide's controls sit in the tile's footer. */
  seeding: SeedingForPage;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(picked)) {
        const form = new FormData();
        form.append("file", file);
        form.append("projectFolderId", projectFolderId);
        const res = await fetch("/api/seed-packet", { method: "POST", body: form });
        if (!res.ok) {
          setError(`${file.name}: ${await readError(res, "that didn't upload.")}`);
          break;
        }
      }
    } catch {
      setError("That didn't upload. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      onChanged();
    }
  };

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch("/api/seed-packet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ act: "remove", id }) });
    if (!res.ok) setError(await readError(res, "That didn't come out. Try again."));
    onChanged();
  };

  return (
    // Room to breathe, and pushed to the right so its edge lines up with
    // the tabbed view below it (Austin, 2026-09-30).
    <Surface data-seed-packet className={sprinkles({ padding: 5 })} style={{ width: "100%", maxWidth: 440, marginLeft: "auto" }}>
      <Stack gap={3}>
        <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
          <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>Your seed packet</span>
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Adding…" : "Add files"}
          </button>
        </Cluster>
        <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          Upload any existing info you have: threads, emails, notes, documents, photos, etc.
        </p>
        <input ref={input} type="file" multiple hidden aria-label="Add files to your seed packet" onChange={(e) => add(e.target.files)} />
        {files.length > 0 && (
          // Ten lines, then the list scrolls inside the tile rather than
          // pushing the page down (Austin, 2026-10-01). Waiting files sit
          // on top: they are the ones with something to do (Take out), and
          // a scrolled list would otherwise bury them under what is sown.
          <ul className={textSize.xs} style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: "10lh", overflowY: "auto" }}>
            {[...files.filter((f) => !f.sown), ...files.filter((f) => f.sown)].map((f) => (
              <li key={f.id} className={sprinkles({ display: "flex", alignItems: "baseline", gap: 2 })}>
                <a href={`/api/seed-packet/${f.id}`} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                  {f.name}
                </a>
                <span style={{ color: semanticColors.textSubtle }}>{f.sown ? "sown" : "waiting"}</span>
                {!f.sown && (
                  <button type="button" className={`${button({ variant: "quiet" })} ${textSize.xs}`} aria-label={`Take ${f.name} out`} onClick={() => remove(f.id)}>
                    Take out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className={textSize.xs} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
        {seeding.guide && (
          <div style={{ borderTop: `1px solid ${semanticColors.surfaceBorder}`, paddingTop: 12 }}>
            <SeedRoundControls projectFolderId={projectFolderId} seeding={seeding} onChanged={onChanged} />
          </div>
        )}
      </Stack>
    </Surface>
  );
}

/**
 * What a Guide sees when no round is open: one compact button at the end
 * of the people line, beside the status, the durable spot when no seeding
 * is happening (Austin, 2026-09-30). If a sowing was left unfinished, the
 * waiting count shows beside it, so it is never lost.
 */
export function SeedRoundQuiet({ projectFolderId, seeding, onChanged }: { projectFolderId: string; seeding: SeedingForPage; onChanged: () => void }) {
  const guide = seeding.guide!;
  const [busy, setBusy] = useState<"open" | "sow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "open" | "sow") => {
    setBusy(kind);
    setError(null);
    try {
      const res =
        kind === "open"
          ? await fetch("/api/seed-round", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectFolderId, act: "open" }) })
          : await fetch("/api/graphlog/sow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectFolderId }) });
      if (!res.ok) setError(await readError(res, "That didn't go through. Try again."));
    } finally {
      setBusy(null);
      onChanged();
    }
  };
  return (
    <Cluster gap={3} align="center">
      {guide.waiting > 0 && (
        <button type="button" className={`${button({ variant: "quiet" })} ${textSize.xs}`} disabled={busy !== null} onClick={() => act("sow")}>
          {busy === "sow" ? "Sowing…" : `Sow (${guide.waiting} waiting)`}
        </button>
      )}
      <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy !== null} onClick={() => act("open")}>
        {busy === "open" ? "Opening…" : "Open a seeding round"}
      </button>
      {error && <span className={textSize.xs} style={{ color: semanticColors.textDanger }}>{error}</span>}
    </Cluster>
  );
}

type SowResult = { files?: number; days?: string[]; documents?: number; questions?: number; incomplete?: string[]; skipped?: boolean };

/** Past this many questions from one run the count is said plainly
 * (`SOW_QUESTION_NOTICE`, kept in step by hand: the server module can't
 * be imported here). */
const QUESTION_NOTICE = 10;

function sowSentence(r: SowResult): string {
  if (r.skipped || !r.files) return "Nothing was waiting.";
  const files = `${r.files} ${r.files === 1 ? "file" : "files"}`;
  const days = r.days?.length ? ` into ${r.days.length} ${r.days.length === 1 ? "day" : "days"}` : "";
  const docs = r.documents ? `, ${r.documents} kept as ${r.documents === 1 ? "a document" : "documents"}` : "";
  const q = r.questions ?? 0;
  const questions = q === 0 ? " No questions." : q > QUESTION_NOTICE ? ` ${q} questions, which is a lot. They're in Suggestions.` : ` ${q} ${q === 1 ? "question" : "questions"} in Suggestions.`;
  const left = r.incomplete?.length ? ` ${r.incomplete.length} didn't finish and ${r.incomplete.length === 1 ? "is" : "are"} still waiting.` : "";
  return `Sowed ${files}${days}${docs}.${questions}${left} Print an update on the Efforts tab to build the page from it.`;
}

export function SeedRoundControls({ projectFolderId, seeding, onChanged }: { projectFolderId: string; seeding: SeedingForPage; onChanged: () => void }) {
  const guide = seeding.guide!;
  const [busy, setBusy] = useState<"sow" | "end" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const follow = async (jobId: string) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/graphlog/jobs/${jobId}`);
      if (!res.ok) throw new Error(await readError(res, "Couldn't follow the sowing."));
      const job = (await res.json()) as { state: string; result?: SowResult; error?: string };
      if (job.state === "completed") return job.result ?? {};
      if (job.state === "failed") throw new Error(job.error ?? "Sowing stopped.");
    }
  };

  const post = async (kind: "sow" | "end") => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const res =
        kind === "sow"
          ? await fetch("/api/graphlog/sow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectFolderId }) })
          : await fetch("/api/seed-round", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectFolderId, act: kind }) });
      if (!res.ok) {
        setError(await readError(res, "That didn't go through. Try again."));
        return;
      }
      const data = (await res.json()) as { jobId?: string | null };
      onChanged();
      if (data.jobId) {
        setMessage(kind === "end" ? "The round is ended. Sowing what was left…" : "Sowing…");
        setMessage(sowSentence(await follow(data.jobId)));
      } else setMessage("The round is ended. Nothing was left to sow.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const total = guide.packets.reduce((n, p) => n + p.files.length, 0);
  return (
    <Stack gap={2} data-seed-round>
      <Cluster gap={3} align="center">
        {/* Greyed when nothing waits, and a click on it says why (Austin,
            2026-09-30: "that teaches the habit"). A disabled button gets
            no click, so the wrapper takes it. */}
        <span
          onClick={() => {
            if (guide.waiting === 0 && busy === null) setMessage("Nothing waiting to sow. Files go in a seed packet first.");
          }}
        >
          <button
            type="button"
            className={button({ variant: "secondary", size: "compact" })}
            disabled={busy !== null || guide.waiting === 0}
            style={guide.waiting === 0 ? { pointerEvents: "none" } : undefined}
            onClick={() => post("sow")}
          >
            {busy === "sow" ? "Sowing…" : guide.waiting > 0 ? `Sow (${guide.waiting} waiting)` : "Sow"}
          </button>
        </span>
        <button
          type="button"
          className={`${button({ variant: "quiet" })} ${textSize.xs}`}
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm("End the seeding round? What's left gets sown and the seed packets go away for everyone.")) void post("end");
          }}
        >
          {busy === "end" ? "Ending…" : "End the seeding round"}
        </button>
        {guide.questions > 0 && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {guide.questions} {guide.questions === 1 ? "question" : "questions"} waiting in Suggestions
          </span>
        )}
      </Cluster>
      {message && <p className={textSize.xs}>{message}</p>}
      {error && (
        <p className={textSize.xs} style={{ color: semanticColors.textDanger }}>
          {error}
        </p>
      )}
      {total > 0 && (
        <Disclosure summary={<span className={textSize.xs}>Seed packets · {total} {total === 1 ? "file" : "files"}</span>}>
          <Stack gap={2}>
            {guide.packets.map((p) => (
              <div key={p.person} className={textSize.xs}>
                <span className={sprinkles({ fontWeight: "semibold" })}>{p.person}</span>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {p.files.map((f) => (
                    <li key={f.id}>
                      <a href={`/api/seed-packet/${f.id}`} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                        {f.name}
                      </a>{" "}
                      <span style={{ color: semanticColors.textSubtle }}>{f.sown ? "sown" : "waiting"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Stack>
        </Disclosure>
      )}
    </Stack>
  );
}
