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
import { useState, useEffect, useRef, useCallback } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import OxEditor from "../components/OxEditor";
import type { MentionItem, MentionSearch } from "../oxmarkdown/mention";
import type { UploadedFileInfo, UploadFileFn } from "../oxmarkdown/fileDirective";
import {
  getDailyLogs,
  saveDailyLog,
  workableSaveDailyLog,
  type DailyLog,
} from "../data/dailyLog.server";

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
  return { user, entries };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return { error: "Not authenticated" };

  const ct = request.headers.get("content-type") ?? "";

  // ── JSON save ──────────────────────────────────────────────────────────────────────────────
  if (ct.includes("application/json")) {
    const body = await request.json();
    const { date, content, mode } = body as {
      date: string;
      content: string;
      mode?: string;
    };
    if (!date || typeof content !== "string")
      return { error: "Invalid request" };
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

// ─── PastLogEntry ─────────────────────────────────────────────────────────────
// Read-mostly: main content is static prose, task checkboxes stay
// interactive (click to check off leftover items) — OxEditor's Interacting
// mode, the direct successor to the old Workable mode. Saves via
// `mode: "workable"` so ticking a box doesn't spam the version history.

function PastLogEntry({ entry, today }: { entry: DailyLog; today: string }) {
  const [content, setContent] = useState(entry.content);

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

  return (
    <div style={{ marginBottom: "80px" }}>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: "20px",
          fontWeight: "100",
          color: "var(--text-subtle)",
          borderBottom: "1px solid var(--midground)",
          marginBottom: "12px",
        }}
      >
        {formatEntryDate(entry.date, today)}
      </div>

      <div className="good-box p-4">
        <OxEditor mode="interacting" markdown={content} onChange={handleChange} />
      </div>
    </div>
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
}: {
  date: string;
  today: string;
  content: string;
  onChange: (v: string) => void;
}) {
  // Build "Today — Monday, November 15, 2024"
  const [y, m, d] = date.split("-").map(Number);
  const fullDate = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateLabel = formatEntryDate(date, today);
  const heading = dateLabel === "Today" ? `Today — ${fullDate}` : dateLabel;

  // Stable per-date reference (not re-created every render) so `OxEditor`
  // doesn't see it as a changing prop — `date` is only ever the CURRENT
  // day here anyway (this component always renders "today"), so a plain
  // closure is enough without needing useCallback's dependency dance.
  const onUploadFile: UploadFileFn = (file) => uploadDailyLogFile(date, file);

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ marginBottom: "8px" }}>
        <span className="purple-light-text" style={{ fontFamily: "monospace", fontSize: "16px" }}>
          {heading}
        </span>
      </div>

      <div className="good-box p-4">
        <OxEditor
          key={date}
          mode="editing"
          markdown={content}
          onChange={onChange}
          mentionSearch={dailyLogMentionSearch}
          onMentionSelect={recordMentionSelected}
          allowFileAttachments
          onUploadFile={onUploadFile}
        />
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
  const { entries: serverEntries } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // ── today + todayContent ──────────────────────────────────────────────────
  // Both start as "" so the server render and the initial client render
  // produce identical output (no hydration mismatch). The real device date
  // and server content are read in a single useEffect after hydration.

  const [today, setToday] = useState("");
  const [todayContent, setTodayContent] = useState("");

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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div
        style={{
          padding: "32px 16px 80px",
          maxWidth: "680px",
          margin: "0 auto",
        }}
      >
        {/* Today's editable entry — at the top of the page */}
        <TodayLogEntry
          date={today}
          today={today}
          content={todayContent}
          onChange={handleChange}
        />

        {/* Past entries: newest first */}
        <div style={{ marginTop: "60px" }}>
          {pastEntries.map((entry) => (
            <PastLogEntry key={entry.date} entry={entry} today={today} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
