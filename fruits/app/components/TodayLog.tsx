/**
 * Today's Daily Log entry, the whole of it: the editor, Cards added from
 * the "Add a card" chips inside the frame, uploads, @ mentions, autosave,
 * and the realtime/revalidate reconcile. Moved as is out of
 * `routes/daily-log.tsx` so the dashboard (`/`) and the Daily Log page
 * are the same editor, not two (2026-09-24).
 *
 * Saves go to the Daily Log route's own action (`/daily-log`) from
 * wherever this is mounted, so there is one save path.
 */
import {
  useFetcher,
  useRevalidator,
} from "react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Chip } from "stamps/Chip";
import { Cluster } from "stamps/Cluster";
import { textSize } from "stamps/typography.css";
import { fonts, semanticColors } from "stamps/tokens";
import { DayContainer, DayTitle } from "./DailyLogDay";
import OxEditor from "./OxEditor";
import type { MentionItem, MentionSearch } from "oxmarkdown-core";
import type { UploadedFileInfo, UploadFileFn } from "../oxmarkdown/fileDirective";
import type { CardResolver } from "oxmarkdown-core";
import {
  appendCardDirectiveMarkdown,
  removeCardDirectiveMarkdown,
  cardedProjectFolderIds,
  cardFileName,
  pendingCardFileId,
  isPendingCardFileId,
} from "oxmarkdown-core";
import type { DailyLog, DailyLogCard } from "robustness-core/data/dailyLog.server";
import type { action } from "../routes/daily-log";
import { useVaultEvents, markOwnMutation } from "../hooks/useVaultEvents";

// ─── @ mentions ───────────────────────────────────────────────────────────────────────────────────
// Module-level (not defined inside the component) since neither closes
// over any route-specific state — a stable function reference also means
// `MentionPlugin`'s search-effect never re-runs needlessly. Real search
// logic (empty → recent-or-projects, query → closest match) lives
// server-side in `data/mentionSearch.server.ts`; this is just the fetch.

const dailyLogMentionSearch: MentionSearch = async (query) => {
  const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: MentionItem[] };
  return body.items ?? [];
};

// Fire-and-forget — a failed recording only means the "recently mentioned"
// list doesn't update; the mention link itself is already inserted by the
// time this runs, so there's nothing to roll back or retry here.
function recordMentionSelected(item: MentionItem) {
  fetch("/api/mentions/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: item.name, path: item.path }),
  }).catch(() => {});
}

// ─── File attachments ───────────────────────────────────────────────────────
// The Daily Log's `onUploadFile` (see `oxmarkdown/fileDirective.ts`'s
// `UploadFileFn`) — uploads into THAT day's own vault folder
// (`daily-logs/YYYY-MM-DD/`), mirroring where `readme.md` itself lives.
// `OxEditor` stays ignorant of vault/folder specifics; this is the one
// place that knows the file belongs to a particular day.

function uploadDailyLogFile(date: string, file: File): Promise<UploadedFileInfo> {
  const form = new FormData();
  form.append("file", file);
  form.append("date", date);
  return fetch("/api/daily-log/upload", { method: "POST", body: form }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "Upload failed");
    // This tab's own upload — the real-time `file.created` echo for this
    // exact id shows up moments later over `/api/events`; suppress it (see
    // `useVaultEvents`) since this tab already knows about it firsthand.
    markOwnMutation(body?.fileId);
    return body as UploadedFileInfo;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function localDateString(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatEntryDate(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const diff = Math.round((todayDate.getTime() - date.getTime()) / 86400000);
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}


// ─── Cards ────────────────────────────────────────────────────────────
// Shared by `PastLogEntry`/`TodayLogEntry` — turns a plain `cards` array +
// a "this one changed" callback into the `CardResolver` `OxEditor`'s
// `resolveCard` prop expects (see `oxmarkdown/cardDirective.ts`). A fresh
// function each render is fine — nothing memoizes on `resolveCard`'s own
// identity, only on `cards`' contents (via the `useMemo` at each call site).

export function buildCardResolver(
  cards: DailyLogCard[],
  onChangeCard: (fileId: string, content: string) => void,
): CardResolver {
  return (fileName) => {
    const card = cards.find((c) => c.fileName === fileName);
    if (!card) return undefined;
    return {
      projectName: card.projectName,
      projectHref: `/vault?folder=${card.projectFolderId}`,
      markdown: card.content,
      onChange: (v) => onChangeCard(card.fileId, v),
      // Derived from the card's OWN fileId, never set independently — see
      // `ResolvedCard.pending`'s own header for why that matters.
      pending: isPendingCardFileId(card.fileId),
    };
  };
}


// ─── TodayLogEntry ────────────────────────────────────────────────────────────
// Free-form typing — OxEditor's Editing mode, the direct successor to the
// old MdxEditorEditable. `key={date}` forces a clean remount once the real
// device date is known after hydration (see the `today`/`todayContent`
// comment in DailyLogPage), rather than relying on prop-diffing to reseed.

function TodayLogEntry({
  date,
  today,
  content,
  onChange,
  cards,
  onChangeCardContent,
  projectFolders,
  onCreateCard,
}: {
  date: string;
  today: string;
  content: string;
  onChange: (v: string) => void;
  cards: DailyLogCard[];
  onChangeCardContent: (fileId: string, content: string) => void;
  projectFolders: { id: string; name: string }[];
  onCreateCard: (projectFolderId: string) => void;
}) {
  // Stable per-date reference (not re-created every render) so `OxEditor`
  // doesn't see it as a changing prop — `date` is only ever the CURRENT
  // day here anyway (this component always renders "today"), so a plain
  // closure is enough without needing useCallback's dependency dance.
  const onUploadFile: UploadFileFn = (file) => uploadDailyLogFile(date, file);

  const resolveCard = useMemo(
    () => buildCardResolver(cards, onChangeCardContent),
    [cards, onChangeCardContent],
  );
  // Which projects already have a card today — parsed straight from the
  // readme's OWN markdown (the source of truth for which cards exist; see
  // `oxmarkdown/cardDirective.ts`), not a separately-tracked list that
  // could drift from it.
  const existingProjectFolderIds = useMemo(() => cardedProjectFolderIds(content), [content]);

  return (
    <>
      <DayTitle className="purple-light-text">{formatEntryDate(date, today)}</DayTitle>
      <DayContainer>
        <OxEditor
          key={date}
          mode="editing"
          markdown={content}
          onChange={onChange}
          mentionSearch={dailyLogMentionSearch}
          onMentionSelect={recordMentionSelected}
          allowFileAttachments
          onUploadFile={onUploadFile}
          resolveCard={resolveCard}
          className="ox-card-host"
        />

        <AddCardSection
          projectFolders={projectFolders}
          existingProjectFolderIds={existingProjectFolderIds}
          onCreate={onCreateCard}
        />
      </DayContainer>
    </>
  );
}

// ─── AddCardSection ────────────────────────────────────────────────
// Always-visible list of real projects (folder selections), not a
// click-to-reveal button — one fewer step, every option visible at a
// glance. Only projects WITHOUT an existing card today are offered
// (enforces one-card-per-project-per-day at a glance; the server
// enforces it for real — see `createDailyLogCard`'s idempotency). A
// future `/card` slash command could trigger the identical `onCreate`
// from the cursor instead of a chip click — nothing about how a card
// renders would change.

function AddCardSection({
  projectFolders,
  existingProjectFolderIds,
  onCreate,
}: {
  projectFolders: { id: string; name: string }[];
  existingProjectFolderIds: Set<string>;
  onCreate: (projectFolderId: string) => void;
}) {
  const available = projectFolders.filter((p) => !existingProjectFolderIds.has(p.id));

  return (
    <div style={{ paddingLeft: "var(--ox-grid, 41px)", marginTop: "8px", marginBottom: "16px" }}>
      <div
        style={{
          color: semanticColors.textSubtle,
          fontFamily: fonts.mono,
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "8px",
        }}
      >
        Add a card
      </div>
      <Cluster gap={2}>
        {projectFolders.length === 0 ? (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            No projects yet. Create one in the Vault first.
          </span>
        ) : available.length === 0 ? (
          <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            Every project already has a card today.
          </span>
        ) : (
          available.map((p) => (
            <Chip key={p.id} onClick={() => onCreate(p.id)}>
              {p.name}
            </Chip>
          ))
        )}
      </Cluster>
    </div>
  );
}


// ─── TodayLog ─────────────────────────────────────────────────────────────────

export function TodayLog({
  entries: serverEntries,
  cardsByDate,
  projectFolders,
}: {
  /** Recent entries from the loader; today's is found by the device's date. */
  entries: Pick<DailyLog, "date" | "content">[];
  cardsByDate: Record<string, DailyLogCard[]>;
  projectFolders: { id: string; name: string }[];
}) {
  const revalidator = useRevalidator();

  // ── today + todayContent ───────────────────────────────────────
  // Both start as "" so the server render and the initial client render
  // produce identical output (no hydration mismatch). The real device date
  // and server content are read in a single useEffect after hydration.

  const [today, setToday] = useState("");
  const [todayContent, setTodayContent] = useState("");
  const [todayCards, setTodayCards] = useState<DailyLogCard[]>([]);

  // Always the LATEST todayContent, unlike a value captured in a closure
  // that only re-created when some OTHER dependency last changed —
  // needed by handleCreateCard's rollback-on-error path below, which runs
  // inside an effect keyed on createCardFetcher.data (not todayContent),
  // so a closure over todayContent there could otherwise be stale by the
  // time a real network round trip resolves.
  const todayContentRef = useRef(todayContent);
  useEffect(() => {
    todayContentRef.current = todayContent;
  }, [todayContent]);

  useEffect(() => {
    const d = localDateString();
    setToday(d);

    const serverEntry = serverEntries.find((e) => e.date === d);
    if (serverEntry?.content) {
      // Today already has saved content — use it as-is.
      setTodayContent(serverEntry.content);
      lastSavedRef.current = serverEntry.content;
    }
    // No entry for today yet: start blank. (Carrying over unchecked tasks
    // from a previous day used to happen here — removed. It made today's
    // entry start with content the user didn't write and hadn't saved yet,
    // which was more confusing than useful in practice.)
    setTodayCards(cardsByDate[d] ?? []);
  }, []); // intentionally empty — run exactly once after hydration


  // ── Server save ───────────────────────────────────────────────────────────

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef("");

  const saveNow = useCallback(
    (content: string) => {
      if (!today) return;
      if (content === lastSavedRef.current) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      lastSavedRef.current = content;
      saveFetcher.submit(
        { date: today, content },
        {
          method: "POST",
          action: "/daily-log",
          encType: "application/json",
        },
      );
    },
    [today, saveFetcher],
  );

  // This tab's own save — suppress the real-time echo for it (see
  // `useVaultEvents`), the same way uploads/card saves already do. Waits
  // for the fetcher's own response (rather than tagging synchronously in
  // `saveNow`) because the readme's underlying vault file id isn't known
  // until the server hands it back.
  useEffect(() => {
    const data = saveFetcher.data;
    if (data && "success" in data && data.success && "fileId" in data) {
      markOwnMutation(data.fileId);
    }
  }, [saveFetcher.data]);

  // Pulls a fresh `serverEntries`/`cardsByDate` in for TODAY specifically —
  // run after every loader re-run (revalidate), but only takes effect once
  // `today` itself is known (post-hydration). Cards are merged additively
  // only (a brand-new card from elsewhere is added; an already-known
  // card's content is left alone — its own save/echo-suppression path owns
  // that), so that half is always safe. Content is the risky half: only
  // touch `todayContent` when (a) this tab has no unsaved edit pending
  // (`todayContent === lastSavedRef.current`) AND (b) no save from this tab
  // is currently in flight (`saveFetcher.state === "idle"`). (b) closes a
  // real race — `lastSavedRef.current` is set SYNCHRONOUSLY the moment a
  // save starts, before the request even lands, so a revalidate that
  // happens to run while that save is still in flight could otherwise read
  // the server's PRE-save content, satisfy (a) anyway, and reconcile
  // `todayContent` back to stale data — which is exactly the "card gets
  // added, then removed, then re-added" bug this fixes (a coincidental
  // revalidate briefly winning a race against this tab's own in-flight
  // save, before that save's own now-tagged echo would have been
  // suppressed anyway).
  const lastServerEntriesRef = useRef(serverEntries);
  useEffect(() => {
    if (!today) return;
    if (serverEntries === lastServerEntriesRef.current) return;
    lastServerEntriesRef.current = serverEntries;

    const freshContent = serverEntries.find((e) => e.date === today)?.content ?? "";
    if (
      saveFetcher.state === "idle" &&
      todayContent === lastSavedRef.current &&
      freshContent !== todayContent
    ) {
      setTodayContent(freshContent);
      lastSavedRef.current = freshContent;
    }

    const freshCards = cardsByDate[today] ?? [];
    if (freshCards.length) {
      setTodayCards((cards) => {
        const known = new Set(cards.map((c) => c.fileId));
        const newOnes = freshCards.filter((c) => !known.has(c.fileId));
        return newOnes.length ? [...cards, ...newOnes] : cards;
      });
    }
  }, [serverEntries, cardsByDate, today, todayContent, saveFetcher.state]);

  const scheduleSave = useCallback(
    (content: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveNow(content), 2000);
    },
    [saveNow],
  );

  // Cancel any pending debounce on unmount
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // iOS Safari BFCache: when a frozen tab is restored, revalidate loader data
  // so session expiry or stale entries surface immediately rather than silently
  // leaving the page in a broken state.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        revalidator.revalidate();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [revalidator]);

  // Real-time: a daily-log file changed anywhere in this human's vault —
  // e.g. an attachment added from another device, or a past day edited
  // from the Vault directly (see `data/realtime.server.ts`). Filtered to
  // `source === "daily_log" | "daily_log_card"` — nothing on this page
  // reads from a project/personal file or a folder rename, so reacting to
  // those would just be noise (and, prior to the `saveFetcher.state` guards
  // below, actual bug risk: every extra revalidate was one more chance to
  // land mid-save and read stale data). Just calling `revalidator.revalidate()`
  // here would otherwise silently do nothing visible anyway: BOTH
  // `todayContent`/`todayCards` (below) and `PastLogEntry`'s own
  // `content`/`cards` are seeded from loader data once and then
  // deliberately frozen in local state afterwards, to protect in-progress
  // typing from being clobbered by a stray revalidation — so a bare
  // revalidate refreshes `serverEntries`/`cardsByDate` but every
  // already-mounted entry keeps ignoring it. The reconciliation effects
  // below (right after `lastSavedRef`, and inside `PastLogEntry` itself)
  // are what actually pull a fresh value in, and ONLY when it's safe to —
  // i.e. this tab has no unsaved edit of its own pending for that same day
  // AND no save of its own is currently in flight. Debounced briefly since
  // a folder-delete cascade (or a day with several attachments) fires many
  // individual events at once.
  const realtimeRevalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useVaultEvents(
    useCallback(
      (event) => {
        if (event.table !== "file_refs") return;
        if (event.source !== "daily_log" && event.source !== "daily_log_card") return;
        if (realtimeRevalidateTimer.current) clearTimeout(realtimeRevalidateTimer.current);
        realtimeRevalidateTimer.current = setTimeout(() => revalidator.revalidate(), 300);
      },
      [revalidator],
    ),
  );
  useEffect(
    () => () => {
      if (realtimeRevalidateTimer.current) clearTimeout(realtimeRevalidateTimer.current);
    },
    [],
  );

  const handleChange = useCallback(
    (content: string) => {
      setTodayContent(content);
      scheduleSave(content);
    },
    [scheduleSave],
  );

  // ── Card content save ───────────────────────────────────────
  // Mirrors `saveNow`/`scheduleSave` above, but per-card (keyed by fileId)
  // — a card's content is a SEPARATE vault file with its own save target
  // (`cardFileId` in the action), never touching the readme's own content.

  const cardSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cardLastSaved = useRef<Record<string, string>>({});

  const saveCardNow = useCallback(
    (fileId: string, content: string) => {
      if (!today) return;
      // Defensive only — the UI never renders an editable editor for a
      // still-pending card (see `ResolvedCard.pending`), so this should be
      // unreachable, but a save against a placeholder id would otherwise
      // silently 404/fail server-side once the real save request lands.
      if (isPendingCardFileId(fileId)) return;
      if (content === cardLastSaved.current[fileId]) return;
      cardLastSaved.current[fileId] = content;
      // A Card's content lives in its own `file_refs` row — this save is
      // an UPDATE to it, so suppress the real-time echo the same way an
      // upload's `markOwnMutation` does above.
      markOwnMutation(fileId);
      saveFetcher.submit(
        { date: today, cardFileId: fileId, content },
        { method: "POST", action: "/daily-log", encType: "application/json" },
      );
    },
    [today, saveFetcher],
  );

  const handleCardChange = useCallback(
    (fileId: string, content: string) => {
      setTodayCards((cards) =>
        cards.map((c) => (c.fileId === fileId ? { ...c, content } : c)),
      );
      if (cardSaveTimers.current[fileId]) clearTimeout(cardSaveTimers.current[fileId]);
      cardSaveTimers.current[fileId] = setTimeout(() => saveCardNow(fileId, content), 2000);
    },
    [saveCardNow],
  );

  // ── Add a card ──────────────────────────────────────────────────
  // OPTIMISTIC: the whole point is to not make "click a project chip"
  // wait on a real round trip before anything visible happens. On click,
  // `handleCreateCard` immediately (a) adds a placeholder `DailyLogCard`
  // to `todayCards` (real project name/href, computed client-side — see
  // `cardFileName`'s own header — but no real content yet, rendered
  // grayed-out via `ResolvedCard.pending`) and (b) appends + saves the
  // `::card{...}` mount point, the SAME `saveNow` path any other edit
  // uses. The actual server request still happens in the background;
  // its response effect below only ever RECONCILES what's already on
  // screen (swap the placeholder for the real card, or roll both steps
  // back on a genuine failure) — it never blocks anything on its own.
  //
  // Known, deliberate limitation: `createCardFetcher` is a single fetcher
  // instance, so only one "Add a card" request is meaningfully tracked at
  // a time via `pendingCreateRef` below — this pre-dates this optimistic
  // rework (the fetcher itself has always only tracked one in-flight
  // submission), and clicking a SECOND project chip before the first
  // one's request resolves isn't a new regression, just not specially
  // hardened against either.

  const createCardFetcher = useFetcher<typeof action>();
  const pendingCreateRef = useRef<{ projectFolderId: string; fileName: string } | null>(null);

  const handleCreateCard = useCallback(
    (projectFolderId: string) => {
      if (!today) return;
      const fileName = cardFileName(projectFolderId);
      // Chips are already filtered to projects WITHOUT a card yet (see
      // `AddCardSection`'s `existingProjectFolderIds`), but that filter is
      // recomputed from `todayContent` — which this function itself is
      // about to change — so re-check directly to guard against a
      // double-click landing both calls before the chip has a chance to
      // disappear.
      if (cardedProjectFolderIds(todayContent).has(projectFolderId)) return;

      const projectFolder = projectFolders.find((f) => f.id === projectFolderId);
      setTodayCards((cards) => [
        ...cards,
        {
          fileId: pendingCardFileId(fileName),
          fileName,
          projectFolderId,
          projectName: projectFolder?.name ?? "Project",
          content: "",
        },
      ]);

      // Updates the EDITOR's displayed content immediately (so the row
      // appears right away) but deliberately does NOT call `saveNow` yet
      // — see the effect below for why: persisting this reference before
      // the underlying vault file is CONFIRMED to exist can leave a
      // permanently dangling `::card{...}` (a card that looks like it
      // exists but has no backing file, stuck on "Loading card…"
      // forever) if the create request never completes — page closed/
      // refreshed mid-flight, a network failure, or simply outliving the
      // component. This is a REAL bug that shipped once already; see the
      // oxmarkdown skill's own note on it for the full story.
      const next = appendCardDirectiveMarkdown(todayContent, { file: fileName, projectFolderId });
      setTodayContent(next);

      pendingCreateRef.current = { projectFolderId, fileName };
      createCardFetcher.submit(
        { date: today, createCardForProject: projectFolderId },
        { method: "POST", action: "/daily-log", encType: "application/json" },
      );
    },
    [today, todayContent, projectFolders, createCardFetcher],
  );

  useEffect(() => {
    const data = createCardFetcher.data;
    if (!data) return;
    const pending = pendingCreateRef.current;

    if ("error" in data) {
      // The one real, reachable failure here is a permission check (see the
      // action) — roll the optimistic content edit back exactly, using the
      // freshest content (not a stale closure — see `todayContentRef`'s
      // own header), since the user may well have kept typing elsewhere
      // during the round trip. `saveNow` here is a safety net, not the
      // normal path — the reference was never persisted in the first
      // place (see `handleCreateCard`), so this is a no-op UNLESS an
      // unrelated edit's own debounced autosave already persisted it in
      // the meantime; either way, this guarantees the server never ends
      // up with a dangling reference.
      pendingCreateRef.current = null;
      if (!pending) return;
      setTodayCards((cards) => cards.filter((c) => c.fileName !== pending.fileName));
      const rolledBack = removeCardDirectiveMarkdown(todayContentRef.current, pending.fileName);
      setTodayContent(rolledBack);
      saveNow(rolledBack);
      return;
    }

    if (!("card" in data) || !data.card) return;
    const card = data.card;
    pendingCreateRef.current = null;
    // A brand-new Card is its own new `file_refs` row — suppress the
    // real-time echo for it, same reasoning as `saveCardNow`/uploads above.
    markOwnMutation(card.fileId);
    setTodayCards((cards) => {
      const idx = cards.findIndex((c) => c.fileName === card.fileName);
      // Nothing to reconcile (e.g. the user removed the placeholder card
      // before the server responded) — don't resurrect it.
      if (idx === -1) return cards;
      const next = [...cards];
      next[idx] = card;
      return next;
    });
    // NOW it's safe to persist the `::card{...}` reference — the
    // underlying vault file is CONFIRMED to exist. Uses the freshest
    // content (not the `next` string computed back in `handleCreateCard`,
    // which would be stale if the user kept typing elsewhere during the
    // round trip), same reasoning as the rollback branch above.
    saveNow(todayContentRef.current);
    // Only ever re-run when the fetcher actually delivers a NEW response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCardFetcher.data]);

  // ─────────────────────────────────────────────────────

  // Deliberately NOT rendered at all until `today` resolves (skips the SSR/
  // initial-hydration window where it would otherwise mount with a
  // placeholder `markdown=""` before real content is known) — confirmed by
  // direct testing that mounting with a placeholder value here is NOT just
  // a harmless visual flash: `OxEditor`'s own initial reseed can itself be
  // dirty enough to echo an empty `onChange("")` back up, which can race
  // with (and, depending on timing, overwrite) the hydration effect's
  // `setTodayContent(realContent)` call right after — silently replacing
  // real saved content with blank. Skipping the render entirely sidesteps
  // the race rather than trying to out-time it.
  if (!today) return null;
  return (
    <TodayLogEntry
      date={today}
      today={today}
      content={todayContent}
      onChange={handleChange}
      cards={todayCards}
      onChangeCardContent={handleCardChange}
      projectFolders={projectFolders}
      onCreateCard={handleCreateCard}
    />
  );
}
