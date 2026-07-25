import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import {
  redirect,
  useLoaderData,
  useFetcher,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Chip } from "../components/Chip";
import { DayContainer, DayTitle } from "../components/DailyLogDay";
import OxEditor from "../components/OxEditor";
import type { MentionItem, MentionSearch } from "../oxmarkdown/mention";
import type { UploadedFileInfo, UploadFileFn } from "../oxmarkdown/fileDirective";
import type { CardResolver } from "../oxmarkdown/cardDirective";
import { appendCardDirectiveMarkdown, cardedProjectFolderIds } from "../oxmarkdown/cardDirective";
import {
  getDailyLogs,
  saveDailyLog,
  workableSaveDailyLog,
  getDailyLogCards,
  createDailyLogCard,
  saveDailyLogCard,
  type DailyLog,
  type DailyLogCard,
} from "../data/dailyLog.server";
import { getProjectFolders } from "../data/vault.server";
import type { SortSummary } from "../data/sorter.server";

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
    return body as UploadedFileInfo;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function localDateString(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatEntryDate(dateStr: string, today: string): string {
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

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  // Load all entries newest-first; 500 is a generous ceiling for any user
  const { entries } = await getDailyLogs(user._id, { limit: 500 });

  // Real projects for "Add a card" (replaces the old mockup's hardcoded
  // project list) — see `vault.server.ts`'s `getProjectFolders`.
  const projectFolders = await getProjectFolders(user._id);

  // Cards for each day that actually references one — a cheap substring
  // check up front so this stays proportional to real Card usage instead
  // of doing a real folder/file lookup for every one of up to 500 days
  // unconditionally (most days won't have any).
  const cardsByDate: Record<string, DailyLogCard[]> = {};
  await Promise.all(
    entries
      .filter((e) => e.content.includes("::card{"))
      .map(async (e) => {
        cardsByDate[e.date] = await getDailyLogCards(user._id, e.date);
      }),
  );

  return {
    user,
    entries,
    projectFolders: projectFolders.map((f) => ({ id: f._id, name: f.name })),
    cardsByDate,
  };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return { error: "Not authenticated" };

  const ct = request.headers.get("content-type") ?? "";

  // ── JSON save ──────────────────────────────────────────────────────────────────────────────
  // ── JSON save ─────────────────────────────────────────────────────────────
  if (ct.includes("application/json")) {
    const body = await request.json();

    // Create (or, per `createDailyLogCard`'s own idempotency, reuse) a
    // project's Card for a day — a separate request shape (no `content`)
    // from the two content-save shapes below.
    if ("createCardForProject" in body) {
      const { date, createCardForProject } = body as {
        date?: string;
        createCardForProject?: string;
      };
      if (!date || !createCardForProject) return { error: "Invalid request" };
      const card = await createDailyLogCard(user._id, date, createCardForProject);
      return { success: true, card };
    }

    const { date, content, mode, cardFileId } = body as {
      date: string;
      content: string;
      mode?: string;
      cardFileId?: string;
    };
    if (!date || typeof content !== "string")
      return { error: "Invalid request" };

    // A Card's OWN content — always a flat overwrite, no md_version
    // snapshotting (see `saveDailyLogCard`'s own header) — distinct from
    // the day's own `readme.md` save below.
    if (cardFileId) {
      await saveDailyLogCard(cardFileId, content);
      return { success: true };
    }

    // workable mode — skip md_version snapshots for task check-offs etc.
    const entry =
      mode === "workable"
        ? await workableSaveDailyLog(user._id, date, content)
        : await saveDailyLog(user._id, date, content);
    return { success: true, entry };
  }

  // ── Multipart: form save ──────────────────────────────────────────────────
  const form = await request.formData();
  const date = String(form.get("date") ?? "");
  const content = String(form.get("content") ?? "");
  if (!date || typeof content !== "string") return { error: "Invalid request" };
  const entry = await saveDailyLog(user._id, date, content);
  return { success: true, entry };
}

// ─── Cards ────────────────────────────────────────────────────────────
// Shared by `PastLogEntry`/`TodayLogEntry` — turns a plain `cards` array +
// a "this one changed" callback into the `CardResolver` `OxEditor`'s
// `resolveCard` prop expects (see `oxmarkdown/cardDirective.ts`). A fresh
// function each render is fine — nothing memoizes on `resolveCard`'s own
// identity, only on `cards`' contents (via the `useMemo` at each call site).

function buildCardResolver(
  cards: DailyLogCard[],
  onChangeCard: (fileId: string, content: string) => void,
): CardResolver {
  return (fileName) => {
    const card = cards.find((c) => c.fileName === fileName);
    if (!card) return undefined;
    return {
      projectName: card.projectName,
      projectHref: `/fruits/vault?folder=${card.projectFolderId}`,
      markdown: card.content,
      onChange: (v) => onChangeCard(card.fileId, v),
    };
  };
}

// ─── PastLogEntry ───────────────────────────────────────────────────
// Read-mostly: main content is static prose, task checkboxes stay
// interactive (click to check off leftover items) — OxEditor's Interacting
// mode, the direct successor to the old Workable mode. Saves via
// `mode: "workable"` so ticking a box doesn't spam the version history.
// Cards behave the same way — a checkbox toggled inside a past day's card
// still saves, just without any version snapshotting (see
// `saveDailyLogCard`).

function PastLogEntry({
  entry,
  today,
  cards: initialCards,
}: {
  entry: DailyLog;
  today: string;
  cards: DailyLogCard[];
}) {
  const [content, setContent] = useState(entry.content);
  const [cards, setCards] = useState(initialCards);

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(entry.content);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (newContent === lastSavedRef.current) return;
        lastSavedRef.current = newContent;
        saveFetcher.submit(
          { date: entry.date, content: newContent, mode: "workable" },
          {
            method: "POST",
            action: "/fruits/daily-log",
            encType: "application/json",
          },
        );
      }, 1500);
    },
    [entry.date, saveFetcher],
  );

  const cardSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cardLastSaved = useRef<Record<string, string>>(
    Object.fromEntries(initialCards.map((c) => [c.fileId, c.content])),
  );
  const handleCardChange = useCallback(
    (fileId: string, newContent: string) => {
      setCards((cs) => cs.map((c) => (c.fileId === fileId ? { ...c, content: newContent } : c)));
      if (cardSaveTimers.current[fileId]) clearTimeout(cardSaveTimers.current[fileId]);
      cardSaveTimers.current[fileId] = setTimeout(() => {
        if (newContent === cardLastSaved.current[fileId]) return;
        cardLastSaved.current[fileId] = newContent;
        saveFetcher.submit(
          { date: entry.date, cardFileId: fileId, content: newContent },
          {
            method: "POST",
            action: "/fruits/daily-log",
            encType: "application/json",
          },
        );
      }, 1500);
    },
    [entry.date, saveFetcher],
  );

  const resolveCard = useMemo(
    () => buildCardResolver(cards, handleCardChange),
    [cards, handleCardChange],
  );

  return (
    <>
      <DayTitle className="subtle-text" style={{ fontWeight: 100 }}>
        {formatEntryDate(entry.date, today)}
      </DayTitle>
      <DayContainer>
        <OxEditor
          mode="interacting"
          markdown={content}
          onChange={handleChange}
          resolveCard={resolveCard}
          className="ox-card-host"
        />
      </DayContainer>
    </>
  );
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

// ─── Sort testing panel ─────────────────────────────────────────────
// A manual trigger for the Sorter (`sorter.server.ts`) against TODAY's
// already-saved content — lets a human type something, save (the normal
// debounced autosave already does this), click, and immediately see what
// the Sorter would do, rather than waiting for the once-a-day cron. Always
// passes `force: true` — without it, a second click during the same
// testing session would just report "already sorted" from the FIRST
// click, which defeats the whole point of a repeatable manual trigger.
// Deliberately styled as an obvious dev/testing panel (monospace, boxed,
// labeled), not blended into the rest of the day's own content the way
// Cards/prose are — this is a tool for iterating on the Sorter itself,
// not a permanent part of the daily-log-writing experience.
function SortTestPanel({ date }: { date: string }) {
  const sortFetcher = useFetcher<SortSummary | { error: string }>();

  const handleSort = () => {
    sortFetcher.submit(
      { date, force: true },
      { method: "POST", action: "/api/daily-log/sort", encType: "application/json" },
    );
  };

  const result = sortFetcher.data;
  const loading = sortFetcher.state !== "idle";
  const hasError = result && "error" in result;
  const summary = result && !hasError ? (result as SortSummary) : null;

  return (
    <div
      className="good-box"
      style={{
        padding: "16px",
        marginTop: "-8px",
        marginBottom: "32px",
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
        <span
          className="subtle-text"
          style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "11px" }}
        >
          Testing: Sorter
        </span>
        <button className="vault-toolbar-btn" onClick={handleSort} disabled={loading}>
          {loading ? "Sorting…" : "Sort this day"}
        </button>
      </div>

      {hasError && <p className="red-text">{(result as { error: string }).error}</p>}

      {summary && (
        <div>
          {summary.entriesWritten === 0 ? (
            <p className="subtle-text">
              Nothing to sort — no @mentions of a project, completed Card tasks, or Card file
              attachments found.
            </p>
          ) : (
            <p>
              Wrote {summary.entriesWritten} entr{summary.entriesWritten === 1 ? "y" : "ies"} across{" "}
              {summary.projectsTouched.join(", ")}.
            </p>
          )}
          <p className="subtle-text" style={{ marginTop: "12px", marginBottom: "4px" }}>
            This day's release-log.md:
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "var(--midground)",
              padding: "10px",
              borderRadius: "6px",
              margin: 0,
              maxHeight: "320px",
              overflowY: "auto",
            }}
          >
            {summary.dailyReleaseLog || "(empty)"}
          </pre>
        </div>
      )}
    </div>
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
        className="subtle-text"
        style={{
          fontFamily: "monospace",
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "8px",
        }}
      >
        Add a card
      </div>
      <div className="flex flex-wrap gap-2">
        {projectFolders.length === 0 ? (
          <span className="text-sm subtle-text">
            No projects yet — create one in the Vault first.
          </span>
        ) : available.length === 0 ? (
          <span className="text-sm subtle-text">
            Every project already has a card today.
          </span>
        ) : (
          available.map((p) => (
            <Chip key={p.id} onClick={() => onCreate(p.id)}>
              {p.name}
            </Chip>
          ))
        )}
      </div>
    </div>
  );
}

// ─── ErrorBoundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  let message = "Couldn't load Daily Log.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401 || error.status === 403) {
      message = "Your session has expired.";
    } else {
      message = `Error ${error.status}: ${error.statusText}`;
    }
  } else if (error instanceof Error) {
    // iOS Safari reports network failures as "Load failed"
    if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError") ||
      error.message.includes("Load failed")
    ) {
      message =
        "Couldn't reach the server. Check your connection and try again.";
    } else {
      message = error.message;
    }
  }

  return (
    <AppLayout>
      <div
        style={{
          padding: "60px 16px",
          maxWidth: "480px",
          margin: "0 auto",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <p
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
          }}
        >
          Daily Log
        </p>
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-subtle)",
            lineHeight: "1.5",
          }}
        >
          {message}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </AppLayout>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyLogPage() {
  const { entries: serverEntries, projectFolders, cardsByDate } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // ── today + todayContent ───────────────────────────────────────
  // Both start as "" so the server render and the initial client render
  // produce identical output (no hydration mismatch). The real device date
  // and server content are read in a single useEffect after hydration.

  const [today, setToday] = useState("");
  const [todayContent, setTodayContent] = useState("");
  const [todayCards, setTodayCards] = useState<DailyLogCard[]>([]);

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

  // ── Derived values (gated on today being resolved) ───────────────────────

  // While today === "" all entries render as past entries on the server;
  // after hydration the correct split is applied.
  const pastEntries = today
    ? serverEntries.filter((e) => e.date !== today && e.content?.trim())
    : [];

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
          action: "/fruits/daily-log",
          encType: "application/json",
        },
      );
    },
    [today, saveFetcher],
  );

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
      if (content === cardLastSaved.current[fileId]) return;
      cardLastSaved.current[fileId] = content;
      saveFetcher.submit(
        { date: today, cardFileId: fileId, content },
        { method: "POST", action: "/fruits/daily-log", encType: "application/json" },
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
  // Two steps, both driven off the SAME fetcher response: (1) get/create
  // the card's own vault file server-side, (2) append its `::card{...}`
  // mount point to the readme's own markdown — the SAME `saveNow` path
  // any other edit uses, so the reference is persisted immediately rather
  // than waiting for the next debounced readme save.

  const createCardFetcher = useFetcher<typeof action>();

  const handleCreateCard = useCallback(
    (projectFolderId: string) => {
      if (!today) return;
      createCardFetcher.submit(
        { date: today, createCardForProject: projectFolderId },
        { method: "POST", action: "/fruits/daily-log", encType: "application/json" },
      );
    },
    [today, createCardFetcher],
  );

  useEffect(() => {
    const data = createCardFetcher.data;
    if (!data || !("card" in data) || !data.card) return;
    const card = data.card;
    setTodayCards((cards) =>
      cards.some((c) => c.fileId === card.fileId) ? cards : [...cards, card],
    );
    // Reads `todayContent` from THIS render's closure rather than a
    // `setTodayContent` updater function — an updater must be a pure
    // function of its previous value (React may invoke it more than
    // once), so the side-effecting `saveNow` call below can't safely live
    // inside one. Safe to read directly here: nothing else changes
    // `todayContent` between this card being created and this effect
    // running.
    const next = appendCardDirectiveMarkdown(todayContent, {
      file: card.fileName,
      projectFolderId: card.projectFolderId,
    });
    setTodayContent(next);
    saveNow(next);
    // Only ever re-run when the fetcher actually delivers a NEW response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCardFetcher.data]);

  // ─────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div
        style={{
          padding: "32px 16px 80px",
          maxWidth: "680px",
          margin: "0 auto",
        }}
      >
        {/* Today's editable entry — at the top of the page. Deliberately
            NOT rendered at all until `today` resolves (skips the SSR/
            initial-hydration window where it would otherwise mount with
            a placeholder `markdown=""` before real content is known) —
            confirmed by direct testing that mounting with a placeholder
            value here is NOT just a harmless visual flash: `OxEditor`'s
            own initial reseed can itself be dirty enough to echo an
            empty `onChange("")` back up, which can race with (and,
            depending on timing, overwrite) the hydration effect's
            `setTodayContent(realContent)` call right after — silently
            replacing real saved content with blank. Skipping the render
            entirely sidesteps the race rather than trying to out-time
            it. */}
        {today && (
          <>
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
            <SortTestPanel date={today} />
          </>
        )}

        {/* Past entries: newest first — no extra wrapper spacing needed,
            `DayContainer`'s own `marginBottom` already separates every
            day consistently, Today included. */}
        {pastEntries.map((entry) => (
          <PastLogEntry
            key={entry.date}
            entry={entry}
            today={today}
            cards={cardsByDate[entry.date] ?? []}
          />
        ))}
      </div>
    </AppLayout>
  );
}
