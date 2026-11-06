// The project's Letters tab, which is the desk (Austin, 2026-11-05: the
// tab "started as deliverables, as a way of being able to send a
// deliverable to a client"; this is the turn to "writing letters back
// and forth"). Where letters are written and kept: what is being
// written, then what the house has sent and received, each letter
// saying who it is from and which house it went to. Two groups and
// nothing more: no filters, no sorting controls. The mailbox on the
// project's page is where mail is received and read.
//
// One markdown file each, newest change first (`letters.server.ts`),
// already filtered for the viewer (`deskRows`: a client sees their own
// drafts and the letters between the houses). Whoever may start a letter
// (`writes`: a Guide, or a client) gets New letter; a manager (a Guide on
// the project, or staff) also uploads, replaces in place (same id, so
// the same link) and flips each file's public link. Each row says whether
// the viewer may write it (`row.writes`: Edit, Delete, the preview). The
// server refuses all of it for anyone else; the props only hide. Crafters
// and Observers read here and do not write. A client's form is a title
// alone (Austin, 2026-11-05: no purpose line, no brief, and theirs always
// goes to the team).
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { LetterRow } from "robustness-core/data/letters.server";
import type { LetterPdfState } from "robustness-core/data/letterPdf.server";

/** A row as the tab receives it: the file, plus (for a manager, while
 * the link is on) what became of its PDF, and the first name of who a
 * housed letter is from (optional, so a caller without it still draws a
 * row). */
export type LetterTabRow = LetterRow & { pdf: LetterPdfState | null; from?: string | null; writes: boolean };

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const LETTER_TO_TEAM_NOTE = "Your letter goes to the team. Say what's on your mind first, and an outline comes back to write from.";
export const DESK_DRAFTS = "On the desk";
export const DESK_LETTERS = "Letters";
export const DESK_NO_DRAFTS = "Nothing being written.";
export const DESK_NO_LETTERS = "No letters sent or received yet.";
/** What the New letter form is told when it opens from "Write a letter
 * from this": the letter the writer kept a talk-through of. */
export type LetterStartFrom = { letterFileId: string; title: string; from: string | null };
export function letterStartFromLine(start: LetterStartFrom): string {
  return start.from ? `Starting from what you said about "${start.title}", from ${start.from}.` : `Starting from what you said about "${start.title}".`;
}
export const LETTER_START = "Start the letter";
export const LETTER_PURPOSE_HINT_PLAIN = "A sentence or three, in your words: what the letter is about, what it has to settle, and for whom. It goes into the project's record as yours, today.";
export const LETTER_FOR_ASK = "Who is it for?";
export const LETTER_FOR_LABEL: Record<House, string> = { clients: "The clients", guides: "The team" };

/** The desk's two groups: what is being written (never sent), and the
 * letters (sent, whether or not they have been edited since). Each keeps
 * the order it came in. Pure. */
export function deskGroups<R extends Pick<LetterRow, "sentDate">>(rows: readonly R[]): { drafts: R[]; letters: R[] } {
  return { drafts: rows.filter((r) => !r.sentDate), letters: rows.filter((r) => !!r.sentDate) };
}

/** The PDF line a manager reads under a shared file. Plain words; the
 * reason is the worker's own. */
export function pdfLine(pdf: LetterPdfState): string {
  switch (pdf.state) {
    case "ready":
      return "PDF ready";
    case "preparing":
      return "PDF preparing";
    case "failed":
      return `PDF couldn't be made: ${pdf.reason}${pdf.at ? ` (${longDate(pdf.at)})` : ""}`;
    case "none":
      return "PDF not made yet. The next click asks for it.";
  }
}
import { Badge } from "stamps/Badge";
import { Input } from "stamps/Input";
import { Modal } from "stamps/Modal";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { HOUSE_LABEL, HOUSE_NOT_CHOSEN, type House } from "robustness-core/data/letterHouses";
import { Checkbox } from "stamps/Checkbox";
import { ShareLinkControl } from "./ShareLinkControl";
import { dayLabel } from "./dayLabel";
import { BRIEF_RUN_NOTE } from "./LetterBrief";
import { localDateString } from "./TodayLog";

export function letterPublicPath(fileId: string): string {
  return `/public/letter/${fileId}`;
}

/** Where a letter is written: the desk in its project, a page of its own
 * (`routes/newspaper.$folderId_.letter.$fileId.tsx`). Not the Vault. */
export function letterDeskPath(projectFolderId: string, fileId: string): string {
  return `/newspaper/${projectFolderId}/letter/${fileId}`;
}

export const LETTER_DELETE_DRAFT_ASK = "Delete this draft? It goes for good, with its talk-through and outline.";

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function LettersView({
  projectFolderId,
  rows,
  manage,
  writes,
  asClient = false,
  asksHouse = false,
  startFrom = null,
  onChanged,
}: {
  projectFolderId: string;
  rows: LetterTabRow[];
  /** Upload, Replace and the share switch. */
  manage: boolean;
  /** New letter (`mayStartLetter`). */
  writes: boolean;
  /** The viewer is a client: the form asks a title and nothing else. */
  asClient?: boolean;
  /** The project has clients, so a new letter says who it is for. */
  asksHouse?: boolean;
  /** Arrived from "Write a letter from this" on a letter's page: the
   * letter the viewer kept a talk-through of (the project page's loader
   * has checked it is theirs to start from). The form opens by itself. */
  startFrom?: LetterStartFrom | null;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // After an upload from outside: the picture paths the markdown named
  // that weren't in the upload, so the Guide knows what to add in the
  // editor. Shown once, cleared by the next upload.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  const send = async (url: string, form: FormData): Promise<{ fileId?: string; unmatched?: string[] } | null> => {
    setBusy(true);
    setError(null);
    setUnmatched([]);
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; fileId?: string; unmatched?: string[] };
      if (!res.ok) {
        setError(data.error ?? "That didn't save. Try again.");
        return null;
      }
      setUnmatched(data.unmatched ?? []);
      onChanged();
      return data;
    } catch {
      setError("That didn't save. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** One markdown file with its pictures, picked or dropped together. */
  const upload = (files: File[]) => {
    if (files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("file", f);
    void send(`/api/projects/${projectFolderId}/letters`, form);
  };

  // "New letter" asks for a title and what the letter is for (Austin,
  // 2026-10-22). The purpose line is the guide's words: the route keeps
  // it on the letter and puts it in the graph in their name, dated the
  // day on this device, the daily log's rule.
  // Opened by itself from "Write a letter from this", but only once the
  // page is ready: a form drawn open by the server can be submitted
  // before its handlers exist, and would post nothing.
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (startFrom) setStarting(true);
  }, [startFrom]);
  // The form stays "from what you said" only while it is the one that
  // opened that way; closed and opened again it is a plain new letter.
  const [from, setFrom] = useState<LetterStartFrom | null>(startFrom ?? null);

  /** An empty letter with a title and a purpose, opened in the editor. */
  const create = async (name: string, purpose: string, withBrief: boolean, to: House | null) => {
    const form = new FormData();
    form.append("name", name);
    form.append("purpose", purpose);
    if (to) form.append("to", to);
    if (from) form.append("from", from.letterFileId);
    if (!withBrief || from) form.append("brief", "skip");
    form.append("date", localDateString());
    const data = await send(`/api/projects/${projectFolderId}/letters`, form);
    if (data?.fileId) window.location.assign(letterDeskPath(projectFolderId, data.fileId));
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!manage) return;
    e.preventDefault();
    upload(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={sprinkles({ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 })}
      aria-label="Letters"
      onDragOver={manage ? (e) => e.preventDefault() : undefined}
      onDrop={manage ? onDrop : undefined}
    >
      {writes && (
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
          <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => setStarting(true)}>
            New letter
          </button>
          {manage && (
            <>
              <input
                ref={uploadInput}
                type="file"
                multiple
                accept=".md,text/markdown,image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.currentTarget.files ?? []);
                  e.currentTarget.value = "";
                  upload(files);
                }}
              />
              <button type="button" className={button({ variant: "secondary", size: "compact" })} disabled={busy} onClick={() => uploadInput.current?.click()}>
                Upload a letter
              </button>
              <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                A markdown file, with its pictures alongside. Or drop them here.
              </span>
            </>
          )}
        </div>
      )}
      {writes && (
        <NewLetterModal
          open={starting}
          busy={busy}
          error={error}
          onClose={() => {
            setStarting(false);
            setFrom(null);
          }}
          asksHouse={asksHouse && !asClient}
          asClient={asClient}
          startFrom={from}
          onStart={(name, purpose, withBrief, to) => void create(name, purpose, withBrief, to)}
        />
      )}
      {error && !starting && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </p>
      )}
      {unmatched.length > 0 && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }} role="status" data-unmatched-pictures>
          {unmatched.length === 1 ? "One picture wasn't in the upload" : `${unmatched.length} pictures weren't in the upload`}: {unmatched.join(", ")}. Add them in the editor.
        </p>
      )}
      {rows.length === 0 ? (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          No letters yet.
        </p>
      ) : (
        // Drafts apart from the letters that have gone (Austin,
        // 2026-11-05: the list of "ones that are in draft, and ones that
        // are shared and not" was getting messy).
        ([
          ["drafts", DESK_DRAFTS, DESK_NO_DRAFTS, deskGroups(rows).drafts],
          ["letters", DESK_LETTERS, DESK_NO_LETTERS, deskGroups(rows).letters],
        ] as const).map(([key, heading, empty, group]) => (
          <Stack gap={3} key={key} data-desk-group={key}>
            <h2 className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`} style={{ margin: 0, color: semanticColors.textSubtle }}>
              {heading}
            </h2>
            {group.length === 0 ? (
              <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }}>
                {empty}
              </p>
            ) : (
              <ul className={sprinkles({ display: "flex", flexDirection: "column", gap: 4 })} style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {group.map((row) => (
                  <LetterRowView
                    key={row.fileId}
                    row={row}
                    manage={manage}
                    projectFolderId={projectFolderId}
                    busy={busy}
                    onReplace={(file) => {
                      const form = new FormData();
                      form.append("file", file);
                      void send(`/api/vault/replace/${row.fileId}`, form);
                    }}
                    onDelete={() => {
                      if (!window.confirm(LETTER_DELETE_DRAFT_ASK)) return;
                      void send(`/api/letter/${row.fileId}/remove`, new FormData());
                    }}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}
          </Stack>
        ))
      )}
    </section>
  );
}

/** Three things and two ways in. The title names the file; the purpose
 * line is one sentence the guide writes, and it is theirs in the
 * project's record from that day; and who it is for, the clients or the
 * team (Austin, 2026-11-05: "when you sit down to write a letter, it's:
 * what is it, what's the title, why are you writing it, and who are you
 * writing it to"). All are required: a letter starts with what it is for
 * and where it is going. Nothing is picked for them, and on a project
 * with no clients the question isn't asked. Then the guide picks: write
 * the brief first (a model run), or go straight to the letter and run
 * nothing (Austin, 2026-11-03). */
export function NewLetterModal({
  open,
  busy,
  error,
  asksHouse = false,
  asClient = false,
  startFrom = null,
  onClose,
  onStart,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  /** The project has clients, so the form asks who the letter is for. */
  asksHouse?: boolean;
  /** A client's letter: a title, and it goes to the team. No purpose
   * line (it feeds the brief, which a client doesn't get), no house to
   * pick, no brief to choose (Austin, 2026-11-05). */
  asClient?: boolean;
  /** The letter this one is started from what the writer said about. The
   * same three questions, nothing picked for them; no brief to choose,
   * since the letter they read stands where a brief would. */
  startFrom?: LetterStartFrom | null;
  onClose: () => void;
  onStart: (name: string, purpose: string, withBrief: boolean, to: House | null) => void;
}) {
  const [to, setTo] = useState<House | null>(null);
  const [unpicked, setUnpicked] = useState(false);
  // A client's letter has nowhere to pick: it goes to the team.
  const picksHouse = asksHouse && !asClient;
  // A form opened again starts with nothing picked.
  useEffect(() => {
    if (!open) {
      setTo(null);
      setUnpicked(false);
    }
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="New letter" maxWidth={620}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          const purpose = String(form.get("purpose") ?? "").trim();
          if (!name || (!purpose && !asClient)) return;
          if (picksHouse && !to) {
            setUnpicked(true);
            return;
          }
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          onStart(name, purpose, submitter?.value !== "skip", picksHouse ? to : null);
        }}
      >
        <Stack gap={3}>
          {startFrom && (
            <p className={textSize.sm} style={{ margin: 0 }} data-letter-start-from>
              {letterStartFromLine(startFrom)}
            </p>
          )}
          <Input name="name" label="Title" required autoFocus />
          {!asClient && (
            <>
              <Input type="textarea" name="purpose" label="What is this letter for?" required />
              <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }}>
                {startFrom ? LETTER_PURPOSE_HINT_PLAIN : `${LETTER_PURPOSE_HINT_PLAIN.slice(0, -1)}, and a brief is written from it.`}
              </p>
            </>
          )}
          {asClient && (
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-letter-to-team>
              {LETTER_TO_TEAM_NOTE}
            </p>
          )}
          {picksHouse && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} data-letter-for>
              <legend className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ padding: 0, marginBottom: 8 }}>
                {LETTER_FOR_ASK}
              </legend>
              <Cluster gap={5}>
                {(["clients", "guides"] as const).map((house) => (
                  <Checkbox
                    key={house}
                    variant="radio"
                    name="to"
                    label={LETTER_FOR_LABEL[house]}
                    checked={to === house}
                    onChange={() => {
                      setTo(house);
                      setUnpicked(false);
                    }}
                    disabled={busy}
                  />
                ))}
              </Cluster>
              {unpicked && (
                <p className={textSize.sm} style={{ margin: "8px 0 0", color: semanticColors.textDanger }} role="alert">
                  {HOUSE_NOT_CHOSEN}
                </p>
              )}
            </fieldset>
          )}
          {!startFrom && !asClient && (
            <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-brief-run-note>
              {BRIEF_RUN_NOTE}
            </p>
          )}
          {error && (
            <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert">
              {error}
            </p>
          )}
          {/* Three things in a row don't fit a narrow panel: the row wraps,
              each button whole, never a label broken over four lines or
              Cancel pushed off the panel's edge. */}
          <Cluster gap={3} style={{ justifyContent: "flex-end" }}>
            <button type="button" className={`${link} ${textSize.sm}`} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            {startFrom || asClient ? (
              <button type="submit" name="start" value="skip" className={button({ variant: "purple" })} style={{ whiteSpace: "nowrap", padding: "8px 16px" }} disabled={busy} data-letter-start>
                {busy ? "Starting…" : LETTER_START}
              </button>
            ) : (
            <>
            <button type="submit" name="start" value="skip" className={button({ variant: "secondary" })} style={{ whiteSpace: "nowrap" }} disabled={busy}>
              Go straight to the letter
            </button>
            {/* Stamps' `primary` is the page-sized call to action (16px by
                32px of padding); `secondary` is half that. Side by side they
                read as two different kinds of button. `purple` is primary's
                colour with no size of its own, so the two here are one
                size, told apart by colour alone. */}
            <button type="submit" name="start" value="brief" className={button({ variant: "purple" })} style={{ whiteSpace: "nowrap", padding: "8px 16px" }} disabled={busy}>
              {busy ? "Starting…" : "Write the brief first"}
            </button>
            </>
            )}
          </Cluster>
        </Stack>
      </form>
    </Modal>
  );
}

function LetterRowView({
  row,
  manage,
  projectFolderId,
  busy,
  onReplace,
  onDelete,
  onChanged,
}: {
  row: LetterTabRow;
  manage: boolean;
  projectFolderId: string;
  busy: boolean;
  onReplace: (file: File) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const publicPath = letterPublicPath(row.fileId);
  // Writing happens at the desk, in the project (Austin, 2026-11-06).
  const deskPath = letterDeskPath(projectFolderId, row.fileId);
  // Only a draft can be deleted here: one that was sent, or whose link
  // was ever on, is in someone's hands. The route refuses the rest.
  const draft = !row.sentDate && !row.sharedAt;
  // The title opens exactly what the reader sees (Austin, 2026-10-21):
  // the letter's page. Before the send that page admits the letter's
  // writer as a preview, so a writer's title always goes there; anyone
  // else's title is a link only once it's sent. Writing it is "Edit", at
  // the desk. Only a letter's writer gets either (`row.writes`: a guide
  // for the guides' letters, a client for their own).
  const href = row.sentDate || row.writes ? publicPath : null;
  const title = href ? (
    <a href={href} className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ color: "inherit" }}>
      {row.title}
    </a>
  ) : (
    <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{row.title}</span>
  );
  return (
    <li className={sprinkles({ display: "flex", flexDirection: "column", gap: 1.5 })} data-letter={row.fileId}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 2 })}>
        {title}
        <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          {row.name} · updated {longDate(row.updatedAt)}
        </span>
        {row.sentDate && (
          <Badge variant="success">
            Sent {dayLabel(row.sentDate)}
            {row.sentCount > 1 && ", updated"}
          </Badge>
        )}
        {row.writes && row.editedSinceSent && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-edited-since>
            edited since
          </span>
        )}
        {row.sharedAt && <Badge variant="neutral">Link on</Badge>}
      </div>
      {/* Who it is from and where it went, once it is sent; a draft
          says where it is going. */}
      {(row.houses || row.toHouse) && (
        <p className={textSize.xs} style={{ margin: 0, color: semanticColors.textSubtle }} data-letter-houses>
          {row.houses ? `From ${row.from ?? "someone no longer here"}, to ${HOUSE_LABEL[row.houses.toHouse]}` : row.toHouse && `To ${HOUSE_LABEL[row.toHouse]}`}
        </p>
      )}
      {row.purpose && (
        <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }} data-letter-purpose>
          {row.purpose}
        </p>
      )}
      {manage && row.pdf && (
        <p className={textSize.xs} style={{ margin: 0, color: row.pdf.state === "failed" ? semanticColors.textDanger : semanticColors.textSubtle }} data-pdf-state={row.pdf.state}>
          {pdfLine(row.pdf)}
        </p>
      )}
      {(manage || row.writes) && (
        <div className={sprinkles({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 })}>
          {manage && (
            <>
              {/* The link is the manager's on any sent letter; Replace
                  rewrites the words, so only on a letter they may write. */}
              {row.sentDate ? (
                <ShareLinkControl what="this letter" path={publicPath} endpoint={`/api/letter/${row.fileId}/share`} sharedAt={row.sharedAt} onChanged={onChanged} />
              ) : (
                <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-send-first>
                  Send it first. The link is a second step.
                </span>
              )}
              <input
                ref={replaceInput}
                type="file"
                accept=".md,text/markdown"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) onReplace(file);
                }}
              />
              {row.writes && (
                <button type="button" className={textSize.xs} disabled={busy} onClick={() => replaceInput.current?.click()} style={{ background: "transparent", border: "none", color: semanticColors.textSubtle, padding: 0, cursor: "pointer" }}>
                  Replace
                </button>
              )}
            </>
          )}
          {row.writes && (
            <a href={deskPath} className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-edit>
              Edit
            </a>
          )}
          {row.writes && draft && (
            <button type="button" className={textSize.xs} disabled={busy} onClick={onDelete} style={{ background: "transparent", border: "none", color: semanticColors.textSubtle, cursor: "pointer", padding: 0, textDecoration: "underline" }} data-letter-delete>
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}
