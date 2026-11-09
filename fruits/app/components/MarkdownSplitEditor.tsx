// app/components/MarkdownSplitEditor.tsx
// Lifted out of `routes/vault.tsx` unchanged (2026-11-06) so a page that
// is not the Vault can mount it: a letter is written at the project's
// desk (`LetterWriting`, `routes/newspaper.$folderId_.letter.$fileId.tsx`),
// not in the file browser. The Vault still mounts it for website pages,
// analysis notes and, as a back room, letters. Its rules stay where they
// were, in `styles/vault.css`, every one scoped to a `.vault-` class.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { splitFrontmatter, withReadmeBody } from "robustness-core/data/project.types";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { Surface } from "stamps/Surface";
import { ActionBar, ActionBarButton, ActionBarGroup } from "stamps/ActionBar";
import { button as actionBarButtonClass } from "stamps/actionBar.css";
import { ExpandIcon } from "stamps/ExpandIcon";
import { LayoutFlipIcon } from "stamps/LayoutFlipIcon";
import { useStickyPaneMaxHeight } from "stamps/useStickyPaneMaxHeight";
import { insertAtSelection } from "../oxmarkdown/insertAtSelection";
import { letterLengthLabel } from "./letterLength";
import "../styles/vault.css";

// ─── Markdown split editor (Markdown + Preview) ─────────────────────────
// Generic raw-Markdown/live-Preview split editor -- raw markdown source on
// one side, a real `OxRenderer` preview on the other, rather than the
// WYSIWYG `OxEditor` every other kind of vault markdown file gets
// (`SkillFileEditor`, below). Originally built for website pages only
// (hence the `website`-flavored CSS class names/localStorage key below,
// left as-is rather than churned) -- now shared by `WebsitePageSplitEditor`
// and `SyncApiRunEditor` (both further below), which supply the
// website-specific publish toggle / directive-aware preview or omit them
// entirely via `toolbarLeft`/`renderPreview`/`showScratchPadLink`. Front
// matter is stripped via `splitFrontmatter`/rejoined via `withReadmeBody`
// on save, same as the WYSIWYG editor this replaced. EXPLICIT save (a real
// button, disabled until dirty), not the debounced-auto-save every other
// editor here uses -- a deliberate difference for a raw-markdown surface,
// where a human editing literal syntax expects to control exactly when
// it's written, not have it silently committed mid-sentence. `key` at each
// call site includes `updated_at` (not just the file id) so a DIFFERENT
// mutation path on the same file (e.g. the website publish toggle) always
// forces a clean remount with fresh front matter, rather than risking a
// stale save clobbering it back.
const WEBSITE_EDITOR_MD_SIDE_KEY = "nopal:vault:website-split-editor:md-side";

function readStoredMdSide(): "left" | "right" {
  if (typeof window === "undefined") return "left";
  return window.localStorage.getItem(WEBSITE_EDITOR_MD_SIDE_KEY) === "right" ? "right" : "left";
}

// Same 859px the rest of this file's own `vault.css` breakpoint uses
// (the sidebar drawer, etc.) -- literal here rather than importing
// `stamps/tokens`' `breakpoints.navMax` (numerically identical today,
// but that one's conceptually about `AppLayout`'s own top nav; this is
// Vault's own, separate breakpoint that just happens to match). Reactive
// to the window crossing it, not just a one-time check at mount --
// `useStickyPaneMaxHeight` must be DISABLED below this width, where
// `.vault-website-editor-markdown` is `position: static` (not sticky) and
// `max-height: none` in CSS -- an inline `maxHeight` from that hook would
// otherwise override that and wrongly cap the pane on mobile too.
function useIsMobileWebsiteEditor(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 859px)");
    const recompute = () => setIsMobile(mql.matches);
    recompute();
    mql.addEventListener("change", recompute);
    return () => mql.removeEventListener("change", recompute);
  }, []);
  return isMobile;
}

export function MarkdownSplitEditor({
  fileId,
  initialContent,
  editable,
  onSave,
  headerLeft,
  toolbarLeft,
  toolbarRight,
  renderPreview,
  showScratchPadLink = false,
  onBodyChange,
  onInsertFiles,
  renderPicturePicker,
  spellCheck = false,
  autosave = false,
  showLength = false,
  toolbarTools,
}: {
  fileId: string;
  initialContent: string;
  editable: boolean;
  onSave: (fileId: string, content: string) => Promise<unknown>;
  /** The browser's spellcheck on the Markdown pane. Off by default: a
   * vault file or a website page is as much frontmatter, directives and
   * code as prose, and the red underlines are noise there. A letter
   * is prose a client reads, so `LetterSplitEditor` turns it on
   * (Austin, 2026-10-27). */
  spellCheck?: boolean;
  /** Save on its own two seconds after typing stops, the way the daily
   * log does (`TodayLog`'s `scheduleSave`), instead of waiting for the
   * Save button. Off by default; `LetterSplitEditor` turns it on
   * (Austin, 2026-10-27: a letter "should auto save, like the daily
   * log, not need a click like the website"). The Save button goes away
   * and nothing takes its place: like the log, the save is silent
   * (Austin, 2026-10-29). */
  autosave?: boolean;
  /** Show the body's word count and read time in the save row, updating
   * as the guide types. Off by default; `LetterSplitEditor` turns it on
   * (Austin, 2026-10-29). */
  showLength?: boolean;
  /** Pictures dropped, pasted or picked into the Markdown pane: given the
   * files, stores them and returns the markdown to put at the cursor,
   * one string per file (`LetterSplitEditor` uploads each beside the
   * page and returns a standard image). Omitted by editors whose pages
   * take no pictures this way (a website page, a sync-api run). */
  onInsertFiles?: (files: File[]) => Promise<string[]>;
  /** A panel for choosing pictures already on the project, opened by
   * "Add picture" and rendered above the Markdown pane; `insert` puts
   * markdown at the cursor, `upload` opens the file picker, `close` shuts
   * the panel. Without it, "Add picture" opens the file picker directly. */
  renderPicturePicker?: (ctx: { insert: (markdown: string[]) => void; upload: () => void; close: () => void }) => ReactNode;
  /** Rendered FIRST in the merged toolbar row -- the vault's own
   * breadcrumb (+ mobile folder-tree-drawer toggle + "Published"
   * public-link badge), built once by `VaultV2Page` and reused here
   * instead of that generic `.vault-panel-header` rendering its own copy
   * -- this merges what used to be two separate header rows (breadcrumb
   * row above, this toolbar below) into the one row below. */
  headerLeft?: ReactNode;
  /** Rendered right after `headerLeft`, before the light/dark/scratch-
   * pad/flip/expand `ActionBar` -- the website editor's own
   * `WebsitePublishToggle`; omitted entirely for anything with no
   * draft/published concept (e.g. a sync-api run's notes). */
  toolbarLeft?: ReactNode;
  /** Rendered LAST in the merged toolbar row -- `VaultV2Page`'s "New
   * Page"/"Copy public link"/"Actions" (Download folded in, alongside
   * whatever `moreActions` already had) cluster, replacing the separate
   * actions block the old, now-unused `.vault-panel-header` file branch
   * used to render for these two file kinds. */
  toolbarRight?: ReactNode;
  /** Renders the live-preview pane's own body from the current raw
   * Markdown `body` -- the website editor wraps it in `WebsitePageContent`
   * with the full website directive registry so it matches the real
   * published page exactly; anything else gets a bare `OxRenderer`. */
  renderPreview: (body: string, previewScheme: "light" | "dark") => ReactNode;
  showScratchPadLink?: boolean;
  /** Fires (in an effect, not during render) whenever the live, possibly-
   * unsaved `body` changes -- `WebsitePageSplitEditor`'s own hook for
   * re-resolving `::include-ox{...}` against whatever's CURRENTLY typed,
   * not just what's on disk (see its own `resolveIncludes` effect).
   * Omitted entirely by anything that doesn't need to react to body
   * changes outside the render-prop `renderPreview` already gets them
   * through (e.g. `SyncApiRunEditor`). */
  onBodyChange?: (body: string) => void;
  /** Rendered in the toolbar before `toolbarRight`, with the live body, a
   * way to change it (the change autosaves like typing), and the preview
   * pane's element. `LetterSplitEditor`'s "Read it to them": the
   * recording records the preview and lands as the letter's first block. */
  toolbarTools?: (ctx: {
    body: string;
    updateBody: (update: (prev: string) => string) => void;
    previewElement: () => HTMLElement | null;
    setReading: (reading: boolean) => void;
  }) => ReactNode;
}) {
  const initialBody = useMemo(() => splitFrontmatter(initialContent).body, [initialContent]);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const [body, setBody] = useState(initialBody);
  const [isSaving, setIsSaving] = useState(false);
  const lastSavedBodyRef = useRef(initialBody);
  const isDirty = body !== lastSavedBodyRef.current;

  // Pictures into the text (`onInsertFiles`): the files are stored first,
  // then their markdown lands where the cursor was, as its own block
  // (`insertAtSelection`). One status line while that runs; a failure says
  // so and inserts nothing.
  const [insertStatus, setInsertStatus] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement | null>(null);
  // Where the cursor is when the text arrives: the textarea's own
  // selection, read at that moment (the picker panel may hold focus).
  const insertTexts = useCallback(
    (texts: string[]) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? start;
      setBody((prev) => insertAtSelection(prev, start, end, texts.join("\n\n")).body);
    },
    [body.length],
  );
  const insertFiles = useCallback(
    async (candidates: File[]) => {
      if (!onInsertFiles || !editable) return;
      const files = candidates.filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      setInsertStatus(files.length === 1 ? "Adding the picture…" : `Adding ${files.length} pictures…`);
      try {
        const texts = await onInsertFiles(files);
        insertTexts(texts);
        setInsertStatus(null);
        setPickerOpen(false);
      } catch (err) {
        setInsertStatus(err instanceof Error && err.message ? err.message : "The picture didn't upload. Try again.");
      }
    },
    [onInsertFiles, editable, insertTexts],
  );
  const openAddPicture = useCallback(() => {
    if (renderPicturePicker) setPickerOpen((open) => !open);
    else pictureInputRef.current?.click();
  }, [renderPicturePicker]);

  useEffect(() => {
    onBodyChange?.(body);
  }, [body, onBodyChange]);

  // Persisted globally (not per-file) -- "which side do I like Markdown
  // on" is a human's own standing preference, the same way an editor's
  // remembered panel layout usually is, not something worth re-deciding
  // per page.
  const [mdSide, setMdSide] = useState<"left" | "right">(readStoredMdSide);
  const toggleMdSide = useCallback(() => {
    setMdSide((prev) => {
      const next = prev === "left" ? "right" : "left";
      try {
        window.localStorage.setItem(WEBSITE_EDITOR_MD_SIDE_KEY, next);
      } catch {
        // Ignore -- e.g. storage disabled/full; not worth surfacing over.
      }
      return next;
    });
  }, []);

  // Mobile-only: which single pane is showing right now -- NOT persisted,
  // always starts on Preview (matches the mockup's own "(default)" note).
  const [mobileView, setMobileView] = useState<"preview" | "markdown">("preview");

  // Forces the Preview pane's own `--website-bg-page`/`--website-accent-*`
  // tokens (website.css) to a specific scheme, regardless of this browser's
  // actual `prefers-color-scheme` -- same mechanism (and same default,
  // "light") as the `/maker/stamps/scratch` guide's own preview toggle
  // (`PreviewBox`'s `previewScheme` there). NOT persisted -- a per-session
  // preview aid, not a real setting. Desktop-only, same as "Flip layout"
  // right alongside it below -- the whole toolbar this lives in is hidden
  // on mobile (`.vault-website-editor-toolbar`'s own `@media` rule).
  const [previewScheme, setPreviewScheme] = useState<"light" | "dark">("light");

  // Self-contained fullscreen takeover -- see `.vault-website-editor--
  // expanded`'s own CSS comment for why this doesn't need to reach into
  // Vault's own sidebar/topbar state to hide them.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  // Reading: the rendered page alone, filling the window, with only the
  // toolbar tools above it. `LetterRecorder` turns it on for a recording
  // so the guide reads the letter as the client will see it and the
  // video is the letter, not the editor (Austin, 2026-10-29). The page
  // scrolls inside the preview body, so the recorded region holds still.
  const [reading, setReading] = useState(false);

  const isMobile = useIsMobileWebsiteEditor();
  const markdownPaneRef = useRef<HTMLDivElement | null>(null);
  // A real `height` (below), not a `max-height` -- the pane should always
  // FILL the available space (per this feature's own "go full height"
  // note), not just be capped at it, so a short document doesn't leave
  // the pane's own box shorter than Preview alongside it.
  const measuredHeight = useStickyPaneMaxHeight(markdownPaneRef, isMobile);

  // Mobile: the textarea grows to fit ALL of its own content instead of
  // scrolling internally -- the whole page scrolls instead, same as
  // Preview already does on every breakpoint. Desktop is unaffected
  // (CSS's own `overflow-y: auto` + the measured `height` above still
  // apply there -- this effect is a no-op off mobile).
  //
  // Gated on `mobileView === "markdown"`, not just `isMobile` -- REAL BUG
  // fixed here: Preview shows by default, so the textarea starts
  // `display: none`, and a hidden element's `scrollHeight` is always 0 --
  // measuring on mount alone permanently stuck the height at `0px`, never
  // recovering even after switching to Markdown (nothing re-ran this
  // effect on THAT change). Depending on `mobileView` makes switching TO
  // Markdown itself trigger a fresh, correct measurement every time.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!isMobile || mobileView !== "markdown") return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [isMobile, mobileView, body]);

  const handleSave = useCallback(() => {
    if (!editable || !isDirty) return;
    setIsSaving(true);
    const toSave = body;
    void onSave(fileId, withReadmeBody(initialContent, toSave)).finally(() => {
      lastSavedBodyRef.current = toSave;
      setIsSaving(false);
    });
  }, [body, editable, fileId, initialContent, isDirty, onSave]);

  // Autosave: one timer, reset on every keystroke, so a pause of two
  // seconds saves once. A timer that fires while a save is in flight does
  // nothing; `isSaving` flipping back to false re-runs this effect, which
  // schedules the next save if the text moved on meanwhile, so two PATCHes
  // never race each other for the same file.
  useEffect(() => {
    if (!autosave || !editable || !isDirty || isSaving) return;
    const timer = setTimeout(handleSave, 2000);
    return () => clearTimeout(timer);
  }, [autosave, editable, isDirty, isSaving, body, handleSave]);

  const expandButton = (
    <ActionBarButton
      onClick={() => setExpanded((v) => !v)}
      aria-label={expanded ? "Exit fullscreen" : "Expand"}
    >
      <span
        style={{
          display: "inline-flex",
          transform: expanded ? "rotate(180deg)" : undefined,
        }}
      >
        <ExpandIcon />
      </span>
    </ActionBarButton>
  );

  const saveButtonLabel = isSaving ? "Saving\u2026" : "Save";
  const lengthLabel = useMemo(() => (showLength ? letterLengthLabel(body) : null), [showLength, body]);

  return (
    <div
      className={`vault-website-editor${expanded || reading ? " vault-website-editor--expanded" : ""}`}
      style={reading ? { display: "flex", flexDirection: "column", overflow: "hidden" } : undefined}
    >
      <div className="vault-website-editor-toolbar">
        {!reading && headerLeft}
        <div className="vault-website-editor-toolbar-actions">
          {!reading && toolbarLeft}
          {!reading && (
            <ActionBar>
              <ActionBarGroup>
                <ActionBarButton
                  active={previewScheme === "light"}
                  onClick={() => setPreviewScheme("light")}
                  aria-label="Preview in light mode"
                >
                  Light
                </ActionBarButton>
                <ActionBarButton
                  active={previewScheme === "dark"}
                  onClick={() => setPreviewScheme("dark")}
                  aria-label="Preview in dark mode"
                >
                  Dark
                </ActionBarButton>
              </ActionBarGroup>
              {showScratchPadLink && (
                <ActionBarGroup>
                  {/* Plain `<Link>` styled with the SAME recipe `ActionBarButton`
                      itself uses (`stamps/actionBar.css`), rather than extending
                      that shared component with an `href` variant -- matches this
                      codebase's own established convention (`button.css`'s own
                      recipe, `link.css`, `surfaceBase`, ...) of applying a
                      recipe's className polymorphically at each call site instead
                      of baking router-awareness into a router-agnostic `stamps`
                      component. Opens in a new tab -- this is a REFERENCE jump
                      (going to look up/try a directive's own vocabulary), not a
                      navigation away from the file currently being edited here.
                      Website pages only -- not relevant to a non-website
                      markdown editor like `SyncApiRunEditor`. */}
                  <Link
                    to="/maker/stamps/scratch"
                    className={actionBarButtonClass({ active: false })}
                    aria-label="Open the website directives scratch pad in a new tab"
                  >
                    Scratch pad
                  </Link>
                </ActionBarGroup>
              )}
              {/* Flip layout is genuinely inert on mobile (one pane shows at a
                  time regardless, controlled by the bottom bar's own Preview/
                  Markdown toggle, not `mdSide`) and Expand already has its own
                  mobile equivalent inside each pane's own label row
                  (`.vault-website-editor-mobile-expand`, below) -- rendering
                  BOTH here too on mobile would just be a confusing, partly-
                  inert duplicate. Checked in JS (`isMobile`), not hidden via
                  CSS media query like the rest of this toolbar's surroundings
                  used to be -- this group is the ONE part of the merged row
                  that's genuinely desktop-only; everything else (Light/Dark,
                  Scratch pad, `headerLeft`, `toolbarLeft`, `toolbarRight`)
                  stays reachable on every width now, wrapping instead of
                  disappearing -- see `vault.css`'s own comment on this. */}
              {!isMobile && (
                <ActionBarGroup>
                  <ActionBarButton onClick={toggleMdSide} aria-label="Flip layout">
                    <LayoutFlipIcon mdSide={mdSide} />
                  </ActionBarButton>
                  {expandButton}
                </ActionBarGroup>
              )}
            </ActionBar>
          )}
          {toolbarTools?.({ body, updateBody: setBody, previewElement: () => previewBodyRef.current, setReading })}
          {!reading && toolbarRight}
        </div>
      </div>

      <div
        className="vault-website-editor-panes"
        data-mobile-view={reading ? "preview" : mobileView}
        style={{
          flexDirection: mdSide === "left" ? "row" : "row-reverse",
          ...(reading && { flex: "1 1 auto", minHeight: 0, alignItems: "stretch" }),
        }}
      >
        {/* Hidden, not unmounted, while reading: the textarea keeps its
            cursor and undo history for when the recording ends. */}
        <div
          ref={markdownPaneRef}
          className="vault-website-editor-markdown"
          style={reading ? { display: "none" } : measuredHeight != null ? { height: measuredHeight } : undefined}
        >
          <div className="vault-website-editor-pane-label">
            <span>Markdown</span>
            <span className="vault-website-editor-mobile-expand">{expandButton}</span>
          </div>
          {pickerOpen &&
            renderPicturePicker?.({
              insert: (texts) => {
                insertTexts(texts);
                setPickerOpen(false);
              },
              upload: () => pictureInputRef.current?.click(),
              close: () => setPickerOpen(false),
            })}
          <textarea
            ref={textareaRef}
            className="vault-website-editor-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            readOnly={!editable}
            spellCheck={spellCheck}
            placeholder="Write this page..."
            onDragOver={onInsertFiles ? (e) => e.preventDefault() : undefined}
            onDrop={
              onInsertFiles
                ? (e) => {
                    const files = Array.from(e.dataTransfer.files);
                    if (files.some((f) => f.type.startsWith("image/"))) {
                      e.preventDefault();
                      void insertFiles(files);
                    }
                  }
                : undefined
            }
            onPaste={
              onInsertFiles
                ? (e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.some((f) => f.type.startsWith("image/"))) {
                      e.preventDefault();
                      void insertFiles(files);
                    }
                  }
                : undefined
            }
          />
          <div className="vault-website-editor-save-row">
            {lengthLabel && (
              <span className="text-xs font-mono subtle-text" style={{ alignSelf: "center", marginRight: "auto" }}>
                {lengthLabel}
              </span>
            )}
            {!autosave && (
              <button
                type="button"
                className="vault-website-editor-save-btn"
                onClick={handleSave}
                disabled={!editable || !isDirty || isSaving}
              >
                {saveButtonLabel}
              </button>
            )}
            {onInsertFiles && editable && (
              <>
                <input
                  ref={pictureInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = "";
                    void insertFiles(files);
                  }}
                />
                <button type="button" className="vault-toolbar-btn" onClick={openAddPicture} disabled={insertStatus?.startsWith("Adding") ?? false} aria-expanded={pickerOpen}>
                  Add picture
                </button>
                {insertStatus && (
                  <span className="text-xs font-mono" style={{ color: insertStatus.startsWith("Adding") ? "var(--color-text-subtle)" : "var(--color-text-danger)" }}>
                    {insertStatus}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="vault-website-editor-preview" style={reading ? { display: "flex", flexDirection: "column" } : undefined}>
          <Surface
            className="vault-website-editor-preview-surface"
            style={reading ? { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" } : undefined}
          >
            <div className="vault-website-editor-pane-label" style={reading ? { display: "none" } : undefined}>
              <span>Preview</span>
              <span className="vault-website-editor-mobile-expand">{expandButton}</span>
            </div>
            <div
              ref={previewBodyRef}
              className={`vault-website-editor-preview-body ${
                previewScheme === "dark" ? "website-preview-force-dark" : "website-preview-force-light"
              }`}
              // Same technique the scratch guide's own `PreviewBox` uses --
              // `--website-bg-page` is exactly the token the two force-scheme
              // classes above override, so painting it here (rather than
              // leaving this pane showing `Surface`'s own neutral app-panel
              // background) makes the preview's own resting background
              // actually flip with the toggle too, not just section/accent
              // colors inside it. A non-website consumer (e.g.
              // `SyncApiRunEditor`) never opts into the `--website-*` tokens
              // at all in its own `renderPreview`, so this is simply inert
              // for it.
              style={{
                background: "var(--website-bg-page)",
                // `isolation`: Element Capture records only an element that
                // makes its own stacking context.
                ...(reading && { flex: "1 1 auto", minHeight: 0, overflowY: "auto", isolation: "isolate" }),
              }}
            >
              {renderPreview(body, previewScheme)}
            </div>
          </Surface>
        </div>
      </div>

      <div className="vault-website-editor-mobile-bar" style={reading ? { display: "none" } : undefined}>
        <ActionBarGroup>
          <ActionBarButton
            active={mobileView === "preview"}
            onClick={() => setMobileView("preview")}
            aria-label="Show preview"
          >
            Preview
          </ActionBarButton>
          <ActionBarButton
            active={mobileView === "markdown"}
            onClick={() => setMobileView("markdown")}
            aria-label="Show markdown"
          >
            Markdown
          </ActionBarButton>
        </ActionBarGroup>
        {/* The same length and picture button the desktop save row has;
            that row is hidden on narrow screens (`vault.css`). */}
        {lengthLabel && (
          <span className="text-xs font-mono subtle-text" style={{ alignSelf: "center" }}>
            {lengthLabel}
          </span>
        )}
        {onInsertFiles && editable && (
          <button type="button" className="vault-toolbar-btn" onClick={openAddPicture} disabled={insertStatus?.startsWith("Adding") ?? false} aria-expanded={pickerOpen}>
            Add picture
          </button>
        )}
        {!autosave && (
          <button
            type="button"
            className="vault-website-editor-mobile-save"
            onClick={handleSave}
            disabled={!editable || !isDirty || isSaving}
          >
            {saveButtonLabel}
          </button>
        )}
      </div>
    </div>
  );
}
