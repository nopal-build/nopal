import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import {
  redirect,
  useLoaderData,
  useFetcher,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import {
  EditorLoadingFallback,
  EditorErrorBoundary,
} from "../components/MdxEditorFallback";
import {
  getDailyLogs,
  saveDailyLog,
  workableSaveDailyLog,
  type DailyLog,
} from "../data/dailyLog.server";

import projectStyles from "../styles/project.css?url";
import mdxEditorStyles from "../styles/mdxeditor.css?url";

// Lazy-load editor components — client only, never run on the server.
const MdxEditorEditable = lazy(() => import("../components/MdxEditorEditable"));
const MdxEditorWorkable = lazy(() => import("../components/MdxEditorWorkable"));

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: projectStyles },
  { rel: "stylesheet", href: mdxEditorStyles },
];

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

  // ── Multipart: file upload OR form save ──────────────────────────────────
  const form = await request.formData();

  // ── Regular form save ─────────────────────────────────────────────────────────
  const date = String(form.get("date") ?? "");
  const content = String(form.get("content") ?? "");
  if (!date || typeof content !== "string") return { error: "Invalid request" };
  const entry = await saveDailyLog(user._id, date, content);
  return { success: true, entry };
}

// ─── PastLogEntry ─────────────────────────────────────────────────────────────

function PastLogEntry({ entry, today }: { entry: DailyLog; today: string }) {
  const [content, setContent] = useState(entry.content);

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
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
        }}
      >
        {formatEntryDate(entry.date, today)}
      </div>

      <EditorErrorBoundary>
        <Suspense fallback={<EditorLoadingFallback hasTray={false} />}>
          <MdxEditorWorkable markdown={content} onChange={handleChange} />
        </Suspense>
      </EditorErrorBoundary>
    </div>
  );
}

// ─── TodayLogEntry ────────────────────────────────────────────────────────────

function TodayLogEntry({
  date,
  today,
  content,
  onChange,
  onEditorMounted,
}: {
  date: string;
  today: string;
  content: string;
  onChange: (v: string) => void;
  onEditorMounted?: () => void;
}) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source", "daily-log");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? `Upload failed: ${res.status}`);
    }
    const { url } = (await res.json()) as { url: string };
    return url;
  }, []);

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

  return (
    <div
      style={{
        marginBottom: "12px",
      }}
    >
      <div className="nopal-editor-sticky-header">
        <span
          className="purple-light-text"
          style={{
            fontFamily: "monospace",
            fontSize: "16px",
          }}
        >
          {heading}
        </span>
      </div>

      <div className="mdx-editor-wrapper">
        {isClient && date ? (
          <EditorErrorBoundary>
            <Suspense fallback={<EditorLoadingFallback />}>
              <MdxEditorEditable
                key={date}
                markdown={content}
                onChange={onChange}
                uploadFile={uploadFile}
                onEditorReady={
                  onEditorMounted ? () => onEditorMounted() : undefined
                }
              />
            </Suspense>
          </EditorErrorBoundary>
        ) : (
          <EditorLoadingFallback />
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
  const { user, entries: serverEntries } = useLoaderData<typeof loader>();
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
    if (serverEntry?.content) setTodayContent(serverEntry.content);
  }, []); // intentionally empty — run exactly once after hydration

  // ── Derived values (gated on today being resolved) ───────────────────────

  // While today === "" all entries render as past entries on the server;
  // after hydration the correct split is applied.
  const pastEntries = today
    ? serverEntries.filter((e) => e.date !== today)
    : [];

  // ── Server save ───────────────────────────────────────────────────────────

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(
    (content: string) => {
      if (!today) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
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
    [today, scheduleSave],
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
