// app/routes/fruits_.vault.tsx
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  useNavigate,
} from "react-router";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { getUser } from "../modules/auth/auth.server";
// Types + shared utils live in a server-free file — safe on client and server.
import { isFileRefLocked } from "../data/vault.types";
import type { FileRef, VaultFolder } from "../data/vault.types";
// Server functions are only used inside `loader`; React Router strips them
// from the client bundle automatically.
import {
  getFileRefsByHuman,
  getFoldersByHuman,
  getSharedFoldersForHuman,
  getFileRefsByFolderIds,
} from "../data/vault.server";
import { getHumansById } from "../data/humans.server";
import { getRelatedHumans } from "../data/relationships.server";
import { AppLayout } from "../components/AppLayout";
import {
  EditorLoadingFallback,
  EditorErrorBoundary,
} from "../components/MdxEditorFallback";
import type { VaultRefItem } from "../components/refPopoverPlugin";
import {
  PROJECTS_FOLDER_NAME,
  PROJECT_CSV_NAME,
  PROJECT_README_NAME,
  defaultProjectCsv,
  defaultProjectReadme,
  parseCsvFields,
  serializeCsvFields,
  csvFieldsToRecord,
  isCsvFileName,
  type CsvField,
} from "../util/projectCsv";
import "../styles/vault.css";
import MdxEditorView from "../components/MdxEditorView";
import MdxEditorWorkable from "../components/MdxEditorWorkable";

// Lazy-load the MDX editor — client only, never runs on the server.
const MdxEditorClient = lazy(() => import("../components/MdxEditorClient"));

// ─── Upload constants ────────────────────────────────────────────────────────

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per S3 multipart part
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // switch to multipart for files ≥ 100 MB
const MAX_CONCURRENT_UPLOADS = 2; // max files uploading at the same time

// ─── Types ────────────────────────────────────────────────────────────────────

type SharedFolder = VaultFolder & {
  ownerName: string;
  ownerHumanId: string;
};

type PanelTarget =
  | { kind: "my-root" }
  | { kind: "my-folder"; folderId: string }
  | { kind: "shared-folder"; folderId: string; ownerName: string };

type PendingUpload = {
  id: string;
  file: File; // kept for retry
  name: string;
  size: number;
  contentType: string;
  progress: number; // 0–100
  status: "queued" | "uploading" | "error";
  error?: string;
  targetFolderId: string | null; // folder captured at upload-start time
};

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const [myFiles, myFolders, sharedFolders, relatedHumans] =
    await Promise.all([
      getFileRefsByHuman(user._id),
      getFoldersByHuman(user._id),
      getSharedFoldersForHuman(user._id),
      getRelatedHumans(user),
    ]);

  const sharedFolderIds = sharedFolders.map((f) => f._id);
  const sharedFiles = await getFileRefsByFolderIds(sharedFolderIds);

  const ownerIds = [...new Set(sharedFolders.map((f) => f.human_id))];
  const owners = await getHumansById(ownerIds);
  const ownerMap = Object.fromEntries(owners.map((o) => [o._id, o]));

  const sharedFoldersWithOwner: SharedFolder[] = sharedFolders.map((f) => ({
    ...f,
    ownerName:
      ownerMap[f.human_id]?.name ?? ownerMap[f.human_id]?.email ?? "Unknown",
    ownerHumanId: f.human_id,
  }));

  // Humans this user has a relationship with — passed to the client for the share modal
  const allOtherHumans = relatedHumans;

  return {
    user,
    myFiles,
    myFolders,
    sharedFolders: sharedFoldersWithOwner,
    sharedFiles,
    allOtherHumans,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼️";
  if (contentType === "application/pdf") return "📄";
  if (contentType === "text/markdown") return "📝";
  if (contentType === "text/csv") return "📊";
  if (contentType.startsWith("video/")) return "🎬";
  return "📎";
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  // Parse the calendar date directly from the ISO string so that server (UTC)
  // and browser (local timezone) always produce the same string and React
  // hydration stays in sync.
  const [datePart] = iso.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Folder icon helper ───────────────────────────────────────────────────────

function folderIcon(shared_with: VaultFolder["shared_with"]): string {
  if (shared_with === "everyone") return "🌍";
  if (Array.isArray(shared_with) && shared_with.length > 0) return "👥";
  return "📁";
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

type HumanEntry = { _id: string; name: string; email: string };

function ShareModal({
  folder,
  allHumans,
  onClose,
  onSave,
}: {
  folder: VaultFolder;
  allHumans: HumanEntry[];
  onClose: () => void;
  onSave: (shared_with: string[] | "everyone") => void;
}) {
  const current = folder.shared_with;

  const [mode, setMode] = useState<"private" | "everyone" | "specific">(
    current === "everyone"
      ? "everyone"
      : Array.isArray(current) && current.length > 0
        ? "specific"
        : "private",
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(Array.isArray(current) ? current : []),
  );

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSave = () => {
    if (mode === "everyone") onSave("everyone");
    else if (mode === "specific") onSave([...selectedIds]);
    else onSave([]);
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    accentColor: "var(--purple)",
    cursor: "pointer",
    flexShrink: 0,
  };
  const radioRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  };

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="vault-modal-title">Share "{folder.name}"</h3>

        {/* Mode selector */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: "16px",
          }}
        >
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={mode === "private"}
              onChange={() => setMode("private")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">🔒 Private (only me)</span>
          </label>
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={mode === "everyone"}
              onChange={() => setMode("everyone")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">🌍 Everyone in the app</span>
          </label>
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={mode === "specific"}
              onChange={() => setMode("specific")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">👥 Specific people</span>
          </label>
        </div>

        {/* Human list — only when "specific" */}
        {mode === "specific" && (
          <div className="vault-human-list">
            {allHumans.length === 0 ? (
              <p
                className="text-xs font-mono"
                style={{ color: "var(--text-subtle)", padding: "12px" }}
              >
                No other humans found.
              </p>
            ) : (
              allHumans.map((h) => {
                const checked = selectedIds.has(h._id);
                return (
                  <label
                    key={h._id}
                    className={`vault-human-row ${checked ? "vault-human-row--checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(h._id)}
                      style={inputStyle}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="text-sm font-mono"
                        style={{
                          color: "var(--foreground)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h.name || h.email}
                      </div>
                      {h.name && (
                        <div
                          className="text-xs font-mono"
                          style={{
                            color: "var(--text-subtle)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h.email}
                        </div>
                      )}
                    </div>
                    {checked && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          toggle(h._id);
                        }}
                        title="Remove"
                        className="vault-action-btn vault-action-btn--danger"
                        style={{ flexShrink: 0, fontSize: "16px" }}
                      >
                        ×
                      </button>
                    )}
                  </label>
                );
              })
            )}
          </div>
        )}

        {/* Currently shared summary (for "specific" mode) */}
        {mode === "specific" && selectedIds.size > 0 && (
          <p
            className="text-xs font-mono"
            style={{ color: "var(--text-subtle)", marginBottom: "12px" }}
          >
            Shared with {selectedIds.size} person
            {selectedIds.size !== 1 ? "s" : ""}
          </p>
        )}

        <div
          style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onClose}
            className="btn-outline text-xs font-mono px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Move File Modal ──────────────────────────────────────────────────────────

function MoveModal({
  file,
  myFolders,
  onClose,
  onMove,
}: {
  file: FileRef;
  myFolders: VaultFolder[];
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(file.folder_id);

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="vault-modal-title">Move "{file.name}"</h3>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "20px",
          }}
        >
          <label className="vault-move-option">
            <input
              type="radio"
              checked={selected === null}
              onChange={() => setSelected(null)}
              style={{ accentColor: "var(--purple)" }}
            />
            <span className="text-sm font-mono">Root (no folder)</span>
          </label>
          {myFolders.map((f) => (
            <label key={f._id} className="vault-move-option">
              <input
                type="radio"
                checked={selected === f._id}
                onChange={() => setSelected(f._id)}
                style={{ accentColor: "var(--purple)" }}
              />
              <span className="text-sm font-mono">{f.name}</span>
            </label>
          ))}
        </div>
        <div
          style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onClose}
            className="btn-outline text-xs font-mono px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onMove(selected);
              onClose();
            }}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Tree Item ─────────────────────────────────────────────────────────

// Returns true if targetId is a descendant of folderId in the folder tree.
function hasDescendant(
  folderId: string,
  targetId: string,
  allFolders: VaultFolder[],
): boolean {
  return allFolders
    .filter((f) => f.parent_folder_id === folderId)
    .some(
      (child) =>
        child._id === targetId ||
        hasDescendant(child._id, targetId, allFolders),
    );
}

function FolderTreeItem({
  folder,
  allFolders,
  activeFolderId,
  depth,
  onSelect,
  onRename,
  onShare,
  onDelete,
}: {
  folder: VaultFolder;
  allFolders: VaultFolder[];
  /** The _id of whichever folder is currently selected (or null). Passed down unchanged so children can highlight themselves. */
  activeFolderId: string | null;
  depth: number;
  onSelect: (f: VaultFolder) => void;
  onRename: (folder: VaultFolder) => void;
  onShare: (folder: VaultFolder) => void;
  onDelete: (folder: VaultFolder) => void;
}) {
  const children = allFolders.filter((f) => f.parent_folder_id === folder._id);
  const hasChildren = children.length > 0;
  const active = activeFolderId === folder._id;

  // Auto-expand this node if the active folder is this node or any descendant.
  const shouldAutoExpand = useMemo(() => {
    if (!activeFolderId) return false;
    if (activeFolderId === folder._id) return true;
    return hasDescendant(folder._id, activeFolderId, allFolders);
  }, [activeFolderId, folder._id, allFolders]);

  const [expanded, setExpanded] = useState(shouldAutoExpand);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (shouldAutoExpand) setExpanded(true);
  }, [shouldAutoExpand]);
  const menuRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div
        className={`vault-folder-row ${active ? "vault-folder-row--active" : ""}`}
      >
        {/* Expand toggle — 28×28px touch target so it’s easy to tap on mobile */}
        {hasChildren ? (
          <button
            className="vault-folder-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            tabIndex={-1}
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
          >
            {expanded ? (
              // chevron-down
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6l6 -6" />
              </svg>
            ) : (
              // chevron-right
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6l-6 6" />
              </svg>
            )}
          </button>
        ) : (
          // Spacer keeps folder names aligned with expandable siblings
          <div className="vault-folder-expand-spacer" />
        )}

        {/* Folder name */}
        <button
          onClick={() => {
            onSelect(folder);
            setExpanded(true);
          }}
          className={`vault-folder-name-btn ${active ? "vault-folder-name-btn--active" : ""}`}
          title={
            folder.shared_with === "everyone"
              ? "Shared with everyone"
              : Array.isArray(folder.shared_with) &&
                  folder.shared_with.length > 0
                ? `Shared with ${folder.shared_with.length} person${folder.shared_with.length !== 1 ? "s" : ""}`
                : undefined
          }
        >
          {folderIcon(folder.shared_with)} {folder.name}
        </button>

        {/* "..." menu */}
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((x) => !x);
            }}
            className="vault-folder-menu-trigger"
          >
            ···
          </button>
          {menuOpen && (
            <div className="vault-folder-menu">
              {[
                {
                  label: "Rename",
                  action: () => {
                    setMenuOpen(false);
                    onRename(folder);
                  },
                },
                {
                  label: "Share",
                  action: () => {
                    setMenuOpen(false);
                    onShare(folder);
                  },
                },
                {
                  label: "Delete",
                  action: () => {
                    setMenuOpen(false);
                    onDelete(folder);
                  },
                },
              ].map(({ label, action }) => (
                <button
                  key={label}
                  onClick={action}
                  className={`vault-folder-menu-item ${label === "Delete" ? "vault-folder-menu-item--danger" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded &&
        hasChildren &&
        children.map((child) => (
          <FolderTreeItem
            key={child._id}
            folder={child}
            allFolders={allFolders}
            activeFolderId={activeFolderId}
            depth={depth + 1}
            onSelect={onSelect}
            onRename={onRename}
            onShare={onShare}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────

function ImageModal({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="vault-image-modal-backdrop" onClick={onClose}>
      <img
        src={url}
        alt={name}
        className="vault-image-modal-img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function FileCard({
  file,
  myFolders,
  isOwned,
  isLocked,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  onMove,
  onEditMd,
  onShareFile,
  onDownload,
  onArchive,
  onUnarchive,
}: {
  file: FileRef;
  myFolders: VaultFolder[];
  isOwned: boolean;
  isLocked: boolean;
  isSelected?: boolean;
  onSelect: (file: FileRef) => void;
  onRename: (file: FileRef) => void;
  onDelete: (file: FileRef) => void;
  onMove: (file: FileRef) => void;
  onEditMd: (file: FileRef) => void;
  onShareFile?: (file: FileRef) => void;
  onDownload?: (file: FileRef) => void;
  onArchive?: (file: FileRef) => void;
  onUnarchive?: (file: FileRef) => void;
}) {
  const isMd = file.content_type === "text/markdown";
  const isImage = file.content_type.startsWith("image/");
  const isVideo = file.content_type.startsWith("video/");
  const isArchived = !!file.archived_at;
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      {previewOpen && file.s3_key && (
        <ImageModal
          url={`/api/vault/view/${file._id}`}
          name={file.name}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      <div
        className={`vault-file-card${isSelected ? " vault-file-card--selected" : ""}`}
        style={{ cursor: "pointer" }}
        onClick={() => {
          onSelect(file);
          if (isMd) onEditMd(file);
          if (isImage && file.s3_key) setPreviewOpen(true);
        }}
      >
        {/* Image thumbnail — routed through /api/vault/view so access is
            checked (and the underlying S3 URL freshly signed) on every
            request, instead of embedding a permanent public link. */}
        {isImage && file.s3_key && (
          <img
            src={`/api/vault/view/${file._id}`}
            alt={file.name}
            className="vault-image-thumb"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewOpen(true);
            }}
          />
        )}

        {/* Icon + name */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px", flexShrink: 0 }}>
            {fileIcon(file.content_type)}
          </span>
          <span
            className="text-sm font-mono purple-light-text"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={file.name}
          >
            {file.name}
          </span>
          {file.is_public && (
            <span title="Public" style={{ fontSize: "14px", flexShrink: 0 }}>
              🌐
            </span>
          )}
        </div>

        {/* Meta */}
        <div
          className="text-xs font-mono"
          style={{
            color: "var(--text-subtle)",
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          {file.size && <span>{formatSize(file.size)}</span>}
          <span>{formatDate(file.created_at)}</span>
          {isLocked && (
            <span
              title="Uploaded from Daily Log — read-only after today"
              style={{ color: "var(--text-subtle)", opacity: 0.6 }}
            >
              🔒
            </span>
          )}
        </div>

        {/* s3 link for non-md */}
        {!isMd && file.s3_key && (
          <a
            href={`/api/vault/view/${file._id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono"
            style={{ color: "var(--purple-light)", textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            Open ↗
          </a>
        )}

        {isArchived && (
          <div
            className="text-xs font-mono"
            style={{
              color: "var(--red)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🗃️</span>
            <span>
              Archived — deletes{" "}
              {new Date(
                new Date(file.archived_at!).getTime() +
                  30 * 24 * 60 * 60 * 1000,
              ).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}

        {/* Action buttons (hover) — hidden for locked daily-log files */}
        {isOwned && !isLocked && (
          <div className="vault-file-actions">
            {isVideo && file.s3_key && onDownload && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(file);
                }}
                title="Download"
                className="vault-action-btn"
              >
                ⬇️
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename(file);
              }}
              title="Rename"
              className="vault-action-btn"
            >
              ✏️
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(file);
              }}
              title="Move"
              className="vault-action-btn"
            >
              📂
            </button>
            {isMd && onShareFile && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onShareFile(file);
                }}
                title="Share"
                className="vault-action-btn"
              >
                🔗
              </button>
            )}
            {isVideo && !isArchived && onArchive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(file);
                }}
                title="Archive (schedules deletion in 30 days)"
                className="vault-action-btn"
              >
                🗃️
              </button>
            )}
            {isVideo && isArchived && onUnarchive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnarchive(file);
                }}
                title="Unarchive (cancel scheduled deletion)"
                className="vault-action-btn"
              >
                ↩️
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file);
              }}
              title="Delete"
              className="vault-action-btn vault-action-btn--danger"
            >
              🗑️
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Markdown Editor Modal ────────────────────────────────────────────────────

function FolderCard({
  folder,
  onSelect,
  onRename,
  onShare,
  onDelete,
}: {
  folder: VaultFolder;
  onSelect: (folder: VaultFolder) => void;
  onRename: (folder: VaultFolder) => void;
  onShare: (folder: VaultFolder) => void;
  onDelete: (folder: VaultFolder) => void;
}) {
  return (
    <div
      className="vault-file-card"
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(folder)}
    >
      {/* Icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "20px", flexShrink: 0 }}>
          {folderIcon(folder.shared_with)}
        </span>
        <span
          className="text-sm font-mono purple-light-text"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={folder.name}
        >
          {folder.name}
        </span>
      </div>

      {/* Meta */}
      <div
        className="text-xs font-mono"
        style={{ color: "var(--text-subtle)", display: "flex", gap: "10px" }}
      >
        <span>{formatDate(folder.created_at)}</span>
      </div>

      {/* Action buttons */}
      <div className="vault-file-actions">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRename(folder);
          }}
          title="Rename"
          className="vault-action-btn"
        >
          ✏️
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShare(folder);
          }}
          title="Share"
          className="vault-action-btn"
        >
          👥
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(folder);
          }}
          title="Delete"
          className="vault-action-btn vault-action-btn--danger"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

function MdEditorModal({
  file,
  csvFile,
  refItems,
  onSave,
  onSaveCsv,
  onClose,
  onWikiLinkCreate,
  onWikiLinkNavigate,
  mode = "editable",
}: {
  file: FileRef;
  /** Sibling project CSV file (e.g. project.csv) — enables `[key]` chips. */
  csvFile?: FileRef | null;
  /** Vault pages/files offered by the `[[` reference popover. */
  refItems?: VaultRefItem[];
  onSave: (content: string) => void;
  onSaveCsv?: (content: string) => void;
  onClose: () => void;
  /** Called when the user clicks an unresolved [[wiki-link]] to create the page. */
  onWikiLinkCreate?: (label: string) => void;
  /** Called when the user clicks a resolved [[wiki-link]] chip to navigate. */
  onWikiLinkNavigate?: (href: string) => void;
  mode?: "view" | "workable" | "editable";
}) {
  const [isClient, setIsClient] = useState(false);
  const contentRef = useRef(file.content ?? "");
  const lastSavedRef = useRef(file.content ?? ""); // tracks what's already on the server
  const isDirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fire any pending save and cancel the timer. Safe to call multiple times.
  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (isDirtyRef.current) {
      onSave(contentRef.current);
      lastSavedRef.current = contentRef.current;
      isDirtyRef.current = false;
    }
  }, [onSave]);

  // Close the modal, flushing any unsaved changes first.
  const close = useCallback(() => {
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  // Keyboard shortcuts: Escape and Cmd/Ctrl+Enter both act as Done.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [close]);

  // Cancel any pending debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Auto-save 200 ms after the last keystroke, but only if content changed.
  const handleChange = useCallback(
    (md: string) => {
      contentRef.current = md;
      if (md === lastSavedRef.current) return; // nothing new to save
      isDirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(contentRef.current);
        lastSavedRef.current = contentRef.current;
        isDirtyRef.current = false;
        debounceRef.current = null;
      }, 200);
    },
    [onSave],
  );

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source", "vault");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? `Upload failed: ${res.status}`);
    }
    const { fileId } = (await res.json()) as { fileId?: string };
    if (!fileId) throw new Error("Upload succeeded but no file id was returned");
    // Route through /api/vault/view so the embedded reference stays valid
    // (freshly signed + ownership-checked) indefinitely, instead of baking
    // in a permanent public S3 URL. The `name` query param is just a hint
    // so the stored reference still ends in a real file extension (needed
    // for isImage detection + a readable name after a reload) — the route
    // itself ignores it.
    return `/api/vault/view/${fileId}?name=${encodeURIComponent(file.name)}`;
  }, []);

  // ── Project CSV fields (for `[key]` references in the markdown) ────────
  const [csvFields, setCsvFields] = useState<CsvField[]>(() =>
    csvFile ? parseCsvFields(csvFile.content ?? "") : [],
  );
  const csvFieldsRef = useRef(csvFields);

  const csvRecord = useMemo(() => csvFieldsToRecord(csvFields), [csvFields]);

  const handleCsvFieldChange = useCallback(
    (key: string, value: string) => {
      const prev = csvFieldsRef.current;
      const next = prev.some((f) => f.key === key)
        ? prev.map((f) => (f.key === key ? { ...f, value } : f))
        : [...prev, { key, value }];
      csvFieldsRef.current = next;
      setCsvFields(next);
      onSaveCsv?.(serializeCsvFields(next));
    },
    [onSaveCsv],
  );

  return (
    <div
      className="vault-modal-backdrop"
      style={{ alignItems: "stretch", padding: "16px 32px" }}
      onClick={close}
    >
      <div
        className="vault-modal"
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: "760px",
          overflow: "hidden",
          padding: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="vault-panel-header"
          style={{
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span className="vault-modal-title" style={{ marginBottom: 0 }}>
            {mode === "view" ? "👁" : mode === "workable" ? "✅" : "📝"}{" "}
            {file.name}
          </span>
          {(mode === "view" || mode === "workable") && (
            <button
              onClick={close}
              className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
            >
              Done
            </button>
          )}
        </div>

        {/* Editor */}
        <div
          className="mdx-editor-wrapper vault-editor-container"
          style={{
            flex: 1,
            overflow: "hidden",
            borderRadius: 0,
          }}
        >
          {mode === "view" ? (
            <MdxEditorView
              markdown={file.content ?? ""}
              wikiItems={refItems}
              onWikiLinkCreate={onWikiLinkCreate}
            />
          ) : mode === "workable" ? (
            <EditorErrorBoundary>
              <Suspense fallback={<EditorLoadingFallback />}>
                <MdxEditorWorkable
                  key={file._id}
                  markdown={file.content ?? ""}
                  onChange={handleChange}
                  wikiItems={refItems}
                  onWikiLinkCreate={onWikiLinkCreate}
                />
              </Suspense>
            </EditorErrorBoundary>
          ) : isClient ? (
            <EditorErrorBoundary>
              <Suspense fallback={<EditorLoadingFallback />}>
                <MdxEditorClient
                  key={file._id}
                  markdown={file.content ?? ""}
                  onChange={handleChange}
                  uploadFile={uploadFile}
                  csvFields={csvFile ? csvRecord : undefined}
                  onCsvFieldChange={csvFile ? handleCsvFieldChange : undefined}
                  refItems={refItems}
                  onWikiLinkNavigate={onWikiLinkNavigate}
                  onWikiLinkCreate={onWikiLinkCreate}
                  actions={
                    <button
                      onClick={close}
                      className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
                    >
                      Done
                    </button>
                  }
                />
              </Suspense>
            </EditorErrorBoundary>
          ) : (
            <EditorLoadingFallback />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CSV Editor Modal ──────────────────────────────────────────────────────────────

/**
 * Simple two-column (name / value) table editor for project CSV files.
 * Saves are debounced while typing and flushed on close.
 */
function CsvEditorModal({
  file,
  readOnly,
  onSave,
  onClose,
}: {
  file: FileRef;
  readOnly: boolean;
  onSave: (content: string) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<CsvField[]>(() =>
    parseCsvFields(file.content ?? ""),
  );
  const fieldsRef = useRef(fields);
  const isDirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (next: CsvField[]) => {
      fieldsRef.current = next;
      setFields(next);
      if (readOnly) return;
      isDirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(serializeCsvFields(fieldsRef.current));
        isDirtyRef.current = false;
        debounceRef.current = null;
      }, 400);
    },
    [onSave, readOnly],
  );

  const close = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (isDirtyRef.current && !readOnly) {
      onSave(serializeCsvFields(fieldsRef.current));
      isDirtyRef.current = false;
    }
    onClose();
  }, [onSave, onClose, readOnly]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [close]);

  // Cancel any pending debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const updateField = (i: number, patch: Partial<CsvField>) => {
    scheduleSave(
      fieldsRef.current.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    );
  };

  const removeField = (i: number) => {
    scheduleSave(fieldsRef.current.filter((_, idx) => idx !== i));
  };

  const addField = () => {
    scheduleSave([...fieldsRef.current, { key: "", value: "" }]);
  };

  return (
    <div className="vault-modal-backdrop" onClick={close}>
      <div
        className="vault-modal"
        style={{ maxWidth: "560px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vault-modal-title">📊 {file.name}</div>

        <p
          className="text-xs font-mono"
          style={{ color: "var(--text-subtle)", margin: "0 0 12px" }}
        >
          Reference any of these in the readme with <code>[name]</code> — e.g.{" "}
          <code>[location]</code>.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            marginBottom: "14px",
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          {/* Header row */}
          <div
            className="text-xs font-mono font-bold"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr 28px",
              gap: "8px",
              color: "var(--text-subtle)",
            }}
          >
            <span>name</span>
            <span>value</span>
            <span />
          </div>

          {fields.map((field, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.4fr 28px",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <input
                value={field.key}
                disabled={readOnly}
                placeholder="e.g. location"
                className="vault-inline-input font-mono text-xs"
                onChange={(e) => updateField(i, { key: e.target.value })}
              />
              <input
                value={field.value}
                disabled={readOnly}
                placeholder="value"
                className="vault-inline-input font-mono text-xs"
                onChange={(e) => updateField(i, { value: e.target.value })}
              />
              {!readOnly ? (
                <button
                  onClick={() => removeField(i)}
                  title="Remove field"
                  className="vault-action-btn vault-action-btn--danger"
                >
                  ✕
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}

          {fields.length === 0 && (
            <div
              className="text-xs font-mono"
              style={{ color: "var(--text-subtle)", padding: "8px 0" }}
            >
              No fields yet.
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            justifyContent: "space-between",
          }}
        >
          {!readOnly ? (
            <button className="vault-toolbar-btn" onClick={addField}>
              + Add field
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={close}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Folder Input ─────────────────────────────────────────────────────────────

function NewFolderInput({
  parentFolderId,
  onDone,
}: {
  parentFolderId: string | null;
  onDone: (name: string) => void;
}) {
  const [val, setVal] = useState("");

  const submit = () => {
    const name = val.trim();
    if (name) onDone(name);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 4px",
      }}
    >
      <span style={{ fontSize: "12px" }}>📁</span>
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone("");
        }}
        onBlur={() => {
          if (val.trim()) submit();
          else onDone("");
        }}
        placeholder="Folder name"
        className="vault-inline-input font-mono text-xs"
        style={{ flex: 1 }}
      />
    </div>
  );
}

// ─── Rename Input ─────────────────────────────────────────────────────────────

function RenameInput({
  initialValue,
  onDone,
}: {
  initialValue: string;
  onDone: (name: string) => void;
}) {
  const [val, setVal] = useState(initialValue);

  const submit = () => {
    const name = val.trim();
    if (name && name !== initialValue) onDone(name);
    else onDone("");
  };

  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onDone("");
      }}
      onBlur={submit}
      className="vault-inline-input font-mono text-xs"
      style={{ width: "100%" }}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Upload placeholder card ─────────────────────────────────────────────────────────────

function UploadPlaceholderCard({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isError = upload.status === "error";
  const isQueued = upload.status === "queued";

  return (
    <div className="vault-file-card vault-upload-placeholder">
      {/* Icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "20px", flexShrink: 0 }}>
          {isError ? "⚠️" : fileIcon(upload.contentType)}
        </span>
        <span
          className="text-sm font-mono"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            opacity: 0.7,
          }}
          title={upload.name}
        >
          {upload.name}
        </span>
      </div>

      {/* File size */}
      <div className="text-xs font-mono subtle-text">
        {formatSize(upload.size)}
      </div>

      {isQueued ? (
        <div className="text-xs font-mono subtle-text">Queued…</div>
      ) : isError ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div
            className="text-xs font-mono red-text"
            style={{ wordBreak: "break-word", lineHeight: 1.4 }}
          >
            {upload.error}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              className="btn-purple"
              style={{ padding: "3px 10px", fontSize: "11px" }}
              onClick={onRetry}
            >
              ↺ Retry
            </button>
            <button
              className="btn-outline"
              style={{ padding: "3px 10px", fontSize: "11px" }}
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div className="vault-upload-progress">
            <div
              className="vault-upload-progress-fill"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <div className="text-xs font-mono subtle-text">
            {upload.progress > 0 ? `${upload.progress}%` : "Starting…"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── File Share Modal ────────────────────────────────────────────────────────

function FileShareModal({
  file,
  onClose,
  onSave,
}: {
  file: FileRef;
  onClose: () => void;
  onSave: (updates: {
    is_public: boolean;
    shared_type: "view" | "workable" | "editable";
  }) => void;
}) {
  const [isPublic, setIsPublic] = useState(file.is_public ?? false);
  const [sharedType, setSharedType] = useState<
    "view" | "workable" | "editable"
  >(file.shared_type ?? "view");
  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/card/${file._id}`
      : `/card/${file._id}`;

  const handleSave = () => {
    onSave({ is_public: isPublic, shared_type: sharedType });
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    accentColor: "var(--purple)",
    cursor: "pointer",
    flexShrink: 0,
  };
  const radioRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  };

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="vault-modal-title">
          Share "{file.name.replace(/\.md$/i, "")}"
        </h3>

        {/* Public toggle */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              ...radioRowStyle,
              marginBottom: isPublic ? "10px" : 0,
            }}
          >
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              style={inputStyle}
            />
            <span className="text-sm font-mono">🌐 Public on the web</span>
          </label>
          {isPublic && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                alignItems: "center",
                marginTop: "8px",
                padding: "8px 10px",
                background: "var(--midground)",
                borderRadius: "6px",
              }}
            >
              <span
                className="text-xs font-mono"
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--purple-light)",
                }}
              >
                {publicUrl}
              </span>
              <button
                className="vault-action-btn"
                onClick={() => navigator.clipboard.writeText(publicUrl)}
                title="Copy link"
              >
                📋
              </button>
            </div>
          )}
        </div>

        {/* Sharing type for vault visitors */}
        <p
          className="text-xs font-mono"
          style={{ color: "var(--text-subtle)", marginBottom: "10px" }}
        >
          Vault visitor access:
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "20px",
          }}
        >
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={sharedType === "view"}
              onChange={() => setSharedType("view")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">👁 View only</span>
          </label>
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={sharedType === "workable"}
              onChange={() => setSharedType("workable")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">
              ✅ Workable (tasks editable)
            </span>
          </label>
          <label style={radioRowStyle}>
            <input
              type="radio"
              checked={sharedType === "editable"}
              onChange={() => setSharedType("editable")}
              style={inputStyle}
            />
            <span className="text-sm font-mono">✏️ Editable</span>
          </label>
        </div>

        <div
          style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onClose}
            className="btn-outline text-xs font-mono px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VaultPage() {
  const {
    user,
    myFiles,
    myFolders,
    sharedFolders,
    sharedFiles,
    allOtherHumans,
  } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL params that encode navigation state
  const folderParam = searchParams.get("folder");
  const sharedParam = searchParams.get("shared");
  const fileParam = searchParams.get("file");

  // ── Sidebar drawer (mobile) ───────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Panel derived from URL ────────────────────────────────────────────────
  const panel: PanelTarget = useMemo(() => {
    if (folderParam) return { kind: "my-folder", folderId: folderParam };
    if (sharedParam) {
      const sf = sharedFolders.find((f) => f._id === sharedParam);
      if (sf)
        return {
          kind: "shared-folder",
          folderId: sharedParam,
          ownerName: sf.ownerName,
        };
    }
    return { kind: "my-root" };
  }, [folderParam, sharedParam, sharedFolders]);

  // ── Modals / inline UI ────────────────────────────────────────────────────
  const [shareFolder, setShareFolder] = useState<VaultFolder | null>(null);
  const [moveFile, setMoveFile] = useState<FileRef | null>(null);
  const [shareFile, setShareFile] = useState<FileRef | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);

  // ── Collapsibles ──────────────────────────────────────────────────────────
  const [myFilesOpen, setMyFilesOpen] = useState(true);
  const [sharedOpen, setSharedOpen] = useState(true);

  // Auto-expand the owner group for the active shared folder on first render.
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(() => {
    if (sharedParam) {
      const sf = sharedFolders.find((f) => f._id === sharedParam);
      if (sf) return new Set([sf.ownerHumanId]);
    }
    return new Set();
  });

  // Navigate to a panel — updates the URL (and closes the mobile drawer).
  const handleSelectPanel = useCallback(
    (target: PanelTarget) => {
      setSidebarOpen(false);
      if (target.kind === "my-root") {
        setSearchParams({});
      } else if (target.kind === "my-folder") {
        setSearchParams({ folder: target.folderId });
      } else if (target.kind === "shared-folder") {
        setSearchParams({ shared: target.folderId });
        // Auto-expand the owner section when navigating to a shared folder.
        const sf = sharedFolders.find((f) => f._id === target.folderId);
        if (sf) {
          setExpandedOwners((prev) => {
            if (prev.has(sf.ownerHumanId)) return prev;
            const next = new Set(prev);
            next.add(sf.ownerHumanId);
            return next;
          });
        }
      }
    },
    [setSearchParams, sharedFolders],
  );

  // Select a file — adds ?file=<id> to the URL, preserving the current panel.
  const handleSelectFile = useCallback(
    (file: FileRef) => {
      const params: Record<string, string> = {};
      if (panel.kind === "my-folder") params.folder = panel.folderId;
      if (panel.kind === "shared-folder") params.shared = panel.folderId;
      params.file = file._id;
      setSearchParams(params);
    },
    [panel, setSearchParams],
  );

  // Close the MD editor — removes the file param while keeping the panel.
  const handleCloseEditor = useCallback(() => {
    const params: Record<string, string> = {};
    if (panel.kind === "my-folder") params.folder = panel.folderId;
    if (panel.kind === "shared-folder") params.shared = panel.folderId;
    setSearchParams(params);
  }, [panel, setSearchParams]);

  // ── File uploads ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // Tracks IDs currently being HTTP-uploaded to prevent the queue effect from double-starting them
  const activeUploadIds = useRef<Set<string>>(new Set());

  // ─── Derived data ──────────────────────────────────────────────────────────

  const currentFolderId = panel.kind === "my-folder" ? panel.folderId : null;

  // The currently-selected file (drives the MD editor and card highlight).
  const editMdFile = useMemo(() => {
    if (!fileParam) return null;
    const file = [...myFiles, ...sharedFiles].find((f) => f._id === fileParam);
    return file?.content_type === "text/markdown" ? (file ?? null) : null;
  }, [fileParam, myFiles, sharedFiles]);

  const editMdMode = useMemo<"view" | "workable" | "editable">(() => {
    if (!editMdFile) return "view";
    if (editMdFile.human_id === user._id) return "editable";
    return editMdFile.shared_type ?? "view";
  }, [editMdFile, user._id]);

  // CSV files open in the table editor instead.
  const editCsvFile = useMemo(() => {
    if (!fileParam) return null;
    const file = [...myFiles, ...sharedFiles].find((f) => f._id === fileParam);
    return file && isCsvFileName(file.name, file.content_type) ? file : null;
  }, [fileParam, myFiles, sharedFiles]);

  // Sibling CSV for the markdown file being edited (project.csv preferred).
  // Enables `[key]` value chips inside the readme editor.
  const projectCsvFile = useMemo(() => {
    if (!editMdFile) return null;
    const siblings = [...myFiles, ...sharedFiles].filter(
      (f) =>
        f.folder_id === editMdFile.folder_id &&
        f._id !== editMdFile._id &&
        isCsvFileName(f.name, f.content_type),
    );
    return (
      siblings.find((f) => f.name === PROJECT_CSV_NAME) ?? siblings[0] ?? null
    );
  }, [editMdFile, myFiles, sharedFiles]);

  // Everything the `[` popover can reference: vault pages, photos and files,
  // searchable by name + folder path (+ owner for shared items).
  const refItems = useMemo<VaultRefItem[]>(() => {
    if (!editMdFile) return [];

    const folderById = new Map<string, VaultFolder>();
    for (const f of [...myFolders, ...sharedFolders]) folderById.set(f._id, f);
    const sharedById = new Map(sharedFolders.map((f) => [f._id, f]));

    const folderPathOf = (folderId: string | null): string => {
      const parts: string[] = [];
      let current = folderId ? folderById.get(folderId) : undefined;
      // Defensive depth cap in case of a parent_folder_id cycle
      for (let depth = 0; current && depth < 20; depth++) {
        parts.unshift(current.name);
        current = current.parent_folder_id
          ? folderById.get(current.parent_folder_id)
          : undefined;
      }
      return parts.join("/");
    };

    const items: VaultRefItem[] = [];
    for (const f of [...myFiles, ...sharedFiles]) {
      if (f._id === editMdFile._id) continue;
      // CSV fields are offered individually — skip the csv files themselves
      if (isCsvFileName(f.name, f.content_type)) continue;

      const shared = f.folder_id ? sharedById.get(f.folder_id) : undefined;
      const path = folderPathOf(f.folder_id);
      const detail = shared ? `${shared.ownerName} / ${path}` : path;

      if (f.content_type === "text/markdown") {
        const params = new URLSearchParams();
        if (f.folder_id) params.set(shared ? "shared" : "folder", f.folder_id);
        params.set("file", f._id);
        items.push({
          id: f._id,
          label: f.name,
          detail,
          kind: "page",
          href: `/fruits/vault?${params.toString()}`,
        });
      } else if (f.content_type.startsWith("image/") && f.s3_key) {
        items.push({
          id: f._id,
          label: f.name,
          detail,
          kind: "image",
          // `?name=` keeps the reference recognisable as an image (real
          // extension) after the doc it's embedded into is saved + reloaded
          // — see isFileUrl/IMAGE_EXT in nopalMarkdown.ts.
          url: `/api/vault/view/${f._id}?name=${encodeURIComponent(f.name)}`,
        });
      } else if (f.s3_key) {
        items.push({
          id: f._id,
          label: f.name,
          detail,
          kind: "file",
          href: `/api/vault/view/${f._id}`,
        });
      }
    }
    return items;
  }, [editMdFile, myFiles, sharedFiles, myFolders, sharedFolders]);

  const selectedFileId = fileParam ?? null;

  // Pending uploads visible in the current panel
  const pendingForCurrentFolder = pendingUploads.filter(
    (p) => p.targetFolderId === currentFolderId,
  );

  const visibleFolders: VaultFolder[] = (() => {
    if (panel.kind === "my-root")
      return myFolders.filter((f) => !f.parent_folder_id);
    if (panel.kind === "my-folder")
      return myFolders.filter((f) => f.parent_folder_id === panel.folderId);
    return [];
  })();

  const visibleFiles: FileRef[] = (() => {
    if (panel.kind === "my-root") return myFiles.filter((f) => !f.folder_id);
    if (panel.kind === "my-folder")
      return myFiles.filter((f) => f.folder_id === panel.folderId);
    if (panel.kind === "shared-folder")
      return sharedFiles.filter((f) => f.folder_id === panel.folderId);
    return [];
  })();

  // Readme displayed inline at the top of the folder view (case-insensitive match).
  const readmeFile =
    visibleFiles.find(
      (f) =>
        f.name.toLowerCase() === "readme.md" &&
        f.content_type === "text/markdown",
    ) ?? null;
  // All files except the readme — these become the card grid below the readme.
  const cardFiles = readmeFile
    ? visibleFiles.filter((f) => f._id !== readmeFile._id)
    : visibleFiles;

  const breadcrumb = (() => {
    if (panel.kind === "my-root") return "My Files";
    if (panel.kind === "my-folder") {
      const folder = myFolders.find((f) => f._id === panel.folderId);
      return `My Files / ${folder?.name ?? "Folder"}`;
    }
    if (panel.kind === "shared-folder") {
      return `Shared / ${panel.ownerName} / ${sharedFolders.find((f) => f._id === panel.folderId)?.name ?? "Folder"}`;
    }
    return "";
  })();

  const isMyPanel = panel.kind === "my-root" || panel.kind === "my-folder";

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const apiFetch = useCallback(async (url: string, options: RequestInit) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, []);

  const createFolder = async (name: string) => {
    const duplicate = myFolders.some(
      (f) => f.parent_folder_id === currentFolderId && f.name === name,
    );
    if (duplicate) {
      alert(`A folder named "${name}" already exists here.`);
      return;
    }
    await apiFetch("/api/vault/folders", {
      method: "POST",
      body: JSON.stringify({ name, parent_folder_id: currentFolderId }),
    });
    revalidate();
  };

  const renameFolder = async (folderId: string, name: string) => {
    const folder = myFolders.find((f) => f._id === folderId);
    const duplicate = myFolders.some(
      (f) =>
        f._id !== folderId &&
        f.parent_folder_id === (folder?.parent_folder_id ?? null) &&
        f.name === name,
    );
    if (duplicate) {
      alert(`A folder named "${name}" already exists here.`);
      return;
    }
    await apiFetch(`/api/vault/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    revalidate();
  };

  const shareFolder_ = async (
    folderId: string,
    shared_with: string[] | "everyone",
  ) => {
    await apiFetch(`/api/vault/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ shared_with }),
    });
    revalidate();
  };

  const deleteFolder = async (folderId: string) => {
    if (
      !window.confirm(
        "Delete this folder and all its contents? This cannot be undone.",
      )
    )
      return;
    await apiFetch(`/api/vault/folders/${folderId}`, { method: "DELETE" });
    if (panel.kind === "my-folder" && panel.folderId === folderId) {
      setSearchParams({});
    }
    revalidate();
  };

  const renameFile = async (fileId: string, name: string) => {
    const file = myFiles.find((f) => f._id === fileId);
    const duplicate = myFiles.some(
      (f) =>
        f._id !== fileId &&
        f.folder_id === (file?.folder_id ?? null) &&
        f.name === name,
    );
    if (duplicate) {
      alert(`A file named "${name}" already exists here.`);
      return;
    }
    await apiFetch(`/api/vault/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    revalidate();
  };

  const moveFile_ = async (fileId: string, folder_id: string | null) => {
    await apiFetch(`/api/vault/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ folder_id }),
    });
    revalidate();
  };

  const deleteFile = async (fileId: string) => {
    if (!window.confirm("Delete this file? This cannot be undone.")) return;
    await apiFetch(`/api/vault/${fileId}`, { method: "DELETE" });
    revalidate();
  };

  const downloadFile = async (file: FileRef) => {
    const data = await apiFetch(`/api/vault/download/${file._id}`, {
      method: "GET",
      headers: {},
    });
    if (data?.url) {
      const a = document.createElement("a");
      a.href = data.url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const archiveFile = async (file: FileRef) => {
    await apiFetch(`/api/vault/${file._id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    });
    revalidate();
  };

  const unarchiveFile = async (file: FileRef) => {
    await apiFetch(`/api/vault/${file._id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived_at: null }),
    });
    revalidate();
  };

  const saveMdFile = async (fileId: string, content: string) => {
    await apiFetch(`/api/vault/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
    revalidate();
  };

  const shareFileMutation = async (
    fileId: string,
    updates: {
      is_public: boolean;
      shared_type: "view" | "workable" | "editable";
    },
  ) => {
    await apiFetch(`/api/vault/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    revalidate();
  };

  /**
   * Scaffolds a new project:
   *   projects/<name>/readme.md   — top-level reference (template)
   *   projects/<name>/project.csv — key/value project info (template)
   * Creates the top-level `projects` folder on first use, then navigates
   * into the new project folder.
   */
  const createProject = async () => {
    const name = window.prompt("Project name:");
    if (!name?.trim()) return;
    const projectName = name.trim();

    // 1. Ensure the top-level projects/ folder exists
    let projectsFolderId = myFolders.find(
      (f) => !f.parent_folder_id && f.name === PROJECTS_FOLDER_NAME,
    )?._id;
    if (!projectsFolderId) {
      const res = (await apiFetch("/api/vault/folders", {
        method: "POST",
        body: JSON.stringify({
          name: PROJECTS_FOLDER_NAME,
          parent_folder_id: null,
        }),
      })) as { folder: VaultFolder };
      projectsFolderId = res.folder._id;
    } else if (
      myFolders.some(
        (f) =>
          f.parent_folder_id === projectsFolderId && f.name === projectName,
      )
    ) {
      alert(`A project named "${projectName}" already exists.`);
      return;
    }

    // 2. Create the project folder
    const folderRes = (await apiFetch("/api/vault/folders", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        parent_folder_id: projectsFolderId,
      }),
    })) as { folder: VaultFolder };

    // 3. Seed readme.md + project.csv
    await Promise.all([
      apiFetch("/api/vault", {
        method: "POST",
        body: JSON.stringify({
          name: PROJECT_README_NAME,
          content: defaultProjectReadme(projectName),
          content_type: "text/markdown",
          folder_id: folderRes.folder._id,
        }),
      }),
      apiFetch("/api/vault", {
        method: "POST",
        body: JSON.stringify({
          name: PROJECT_CSV_NAME,
          content: defaultProjectCsv(projectName),
          content_type: "text/csv",
          folder_id: folderRes.folder._id,
        }),
      }),
    ]);

    revalidate();
    setSearchParams({ folder: folderRes.folder._id });
  };

  const createMdFileFromWikiLink = async (label: string) => {
    const fullName = label.endsWith(".md") ? label : `${label}.md`;

    // If a file with this name already exists in the current folder, open it.
    const existing = myFiles.find(
      (f) => f.folder_id === currentFolderId && f.name === fullName,
    );
    if (existing) {
      const params: Record<string, string> = {};
      if (panel.kind === "my-folder") params.folder = panel.folderId;
      if (panel.kind === "shared-folder") params.shared = panel.folderId;
      params.file = existing._id;
      setSearchParams(params);
      return;
    }

    const { fileRef } = (await apiFetch("/api/vault", {
      method: "POST",
      body: JSON.stringify({
        name: fullName,
        content: "",
        content_type: "text/markdown",
        folder_id: currentFolderId,
      }),
    })) as { fileRef: FileRef };

    revalidate();

    // Open the newly created file in the editor right away.
    const params: Record<string, string> = {};
    if (panel.kind === "my-folder") params.folder = panel.folderId;
    if (panel.kind === "shared-folder") params.shared = panel.folderId;
    params.file = fileRef._id;
    setSearchParams(params);
  };

  const createMdFile = async () => {
    const name = window.prompt("Card name (without extension):");
    if (!name?.trim()) return;
    const fullName = name.trim().endsWith(".md")
      ? name.trim()
      : `${name.trim()}.md`;
    const duplicate = myFiles.some(
      (f) => f.folder_id === currentFolderId && f.name === fullName,
    );
    if (duplicate) {
      alert(`A file named "${fullName}" already exists here.`);
      return;
    }
    await apiFetch("/api/vault", {
      method: "POST",
      body: JSON.stringify({
        name: fullName,
        content: "",
        content_type: "text/markdown",
        folder_id: currentFolderId,
      }),
    });
    revalidate();
  };

  // Runs a multipart upload for large files. Progress advances with each
  // completed part (staircase, but clear). On any error it aborts the S3
  // multipart upload to avoid orphaned storage.
  const runMultipartUpload = useCallback(
    async (file: File, folderId: string | null, id: string) => {
      // ── Init ─────────────────────────────────────────────────────────────────────
      const initRes = await fetch("/api/vault/multipart-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          folderId,
          originalName: file.name,
          size: file.size,
        }),
      });
      if (!initRes.ok) {
        const data = (await initRes.json()) as { error?: string };
        throw new Error(data.error ?? `Init failed (${initRes.status})`);
      }
      const { uploadId, key } = (await initRes.json()) as {
        uploadId: string;
        key: string;
      };

      const numParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts: Array<{ PartNumber: number; ETag: string }> = [];

      try {
        // ── Upload parts ────────────────────────────────────────────────────────
        for (let i = 0; i < numParts; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const partForm = new FormData();
          partForm.append("uploadId", uploadId);
          partForm.append("key", key);
          partForm.append("partNumber", String(i + 1));
          partForm.append("chunk", chunk);

          const partRes = await fetch("/api/vault/multipart-part", {
            method: "POST",
            body: partForm,
          });
          if (!partRes.ok) {
            const data = (await partRes.json()) as { error?: string };
            throw new Error(
              data.error ?? `Part ${i + 1} failed (${partRes.status})`,
            );
          }
          const { ETag } = (await partRes.json()) as { ETag: string };
          parts.push({ PartNumber: i + 1, ETag });

          // Update progress after each completed part
          const pct = Math.round(((i + 1) / numParts) * 100);
          setPendingUploads((prev) =>
            prev.map((p) => (p.id === id ? { ...p, progress: pct } : p)),
          );
        }

        // ── Complete ───────────────────────────────────────────────────────────
        const completeRes = await fetch("/api/vault/multipart-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            key,
            parts,
            name: file.name,
            folderId,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        if (!completeRes.ok) {
          const data = (await completeRes.json()) as { error?: string };
          throw new Error(
            data.error ?? `Complete failed (${completeRes.status})`,
          );
        }

        setPendingUploads((prev) => prev.filter((p) => p.id !== id));
        revalidate();
      } catch (err) {
        // Best-effort abort to clean up S3 resources
        fetch("/api/vault/multipart-abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, key }),
        }).catch(() => {});
        throw err;
      }
    },
    [revalidate, setPendingUploads],
  );

  // Start an upload. Uses XHR (with byte-level progress) for small files and
  // multipart chunked upload (with per-part progress) for large ones.
  // Starts the actual HTTP transfer for an upload already present in pendingUploads.
  // Always call after adding the id to activeUploadIds.current.
  const startUploadHttp = useCallback(
    (id: string, file: File, folderId: string | null) => {
      if (file.size >= MULTIPART_THRESHOLD) {
        // Large file: chunked multipart (no proxy timeout risk)
        runMultipartUpload(file, folderId, id)
          .catch((err) => {
            const error = err instanceof Error ? err.message : "Upload failed";
            setPendingUploads((prev) =>
              prev.map((p) =>
                p.id === id ? { ...p, status: "error", error } : p,
              ),
            );
          })
          .finally(() => {
            activeUploadIds.current.delete(id);
          });
        return;
      }

      // Small file: XHR with byte-level progress
      const formData = new FormData();
      formData.append("file", file);
      if (folderId) formData.append("folderId", folderId);

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setPendingUploads((prev) =>
            prev.map((p) => (p.id === id ? { ...p, progress: pct } : p)),
          );
        }
      };

      xhr.onload = () => {
        activeUploadIds.current.delete(id);
        if (xhr.status >= 200 && xhr.status < 300) {
          setPendingUploads((prev) => prev.filter((p) => p.id !== id));
          revalidate();
        } else {
          let error = `Server error (HTTP ${xhr.status})`;
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            if (data.error) error = data.error;
          } catch {
            /* non-JSON body */
          }
          setPendingUploads((prev) =>
            prev.map((p) =>
              p.id === id ? { ...p, status: "error", error } : p,
            ),
          );
        }
      };

      xhr.onerror = () => {
        activeUploadIds.current.delete(id);
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: "error",
                  error: "Network error — check your connection and retry.",
                }
              : p,
          ),
        );
      };

      xhr.ontimeout = () => {
        activeUploadIds.current.delete(id);
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: "error",
                  error:
                    "Upload timed out. The file may be too large or your connection too slow. Try again or use a smaller file.",
                }
              : p,
          ),
        );
      };

      xhr.open("POST", "/api/vault/upload");
      xhr.send(formData);
    },
    [revalidate, runMultipartUpload],
  );

  // Queue processor: starts queued uploads whenever a slot opens up (max 2 concurrent).
  useEffect(() => {
    const activeCount = pendingUploads.filter(
      (p) => p.status === "uploading",
    ).length;
    const slots = MAX_CONCURRENT_UPLOADS - activeCount;
    if (slots <= 0) return;

    const toStart = pendingUploads
      .filter(
        (p) => p.status === "queued" && !activeUploadIds.current.has(p.id),
      )
      .slice(0, slots);

    if (!toStart.length) return;

    // Claim slots synchronously (before the state update) to prevent a
    // second effect run from starting the same uploads again.
    for (const p of toStart) {
      activeUploadIds.current.add(p.id);
    }

    const toStartIds = new Set(toStart.map((p) => p.id));
    setPendingUploads((prev) =>
      prev.map((p) =>
        toStartIds.has(p.id) ? { ...p, status: "uploading" } : p,
      ),
    );

    for (const upload of toStart) {
      startUploadHttp(upload.id, upload.file, upload.targetFolderId);
    }
  }, [pendingUploads, startUploadHttp]);

  // Keep the screen awake while files are uploading so the user doesn't have
  // to fight their phone's auto-lock during long video uploads.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const isActive = pendingUploads.some(
      (p) => p.status === "queued" || p.status === "uploading",
    );

    if (!isActive) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      return;
    }

    const acquire = () => {
      if (!("wakeLock" in navigator)) return;
      if (document.visibilityState !== "visible") return;
      if (wakeLockRef.current) return; // already held
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
          // The system releases the lock when the tab is hidden; clear our ref so
          // the visibilitychange handler knows to re-acquire on the way back.
          lock.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        })
        .catch(() => {}); // silently ignore — denied or unsupported
    };

    acquire();

    // Re-acquire when the user switches back to this tab
    document.addEventListener("visibilitychange", acquire);
    return () => document.removeEventListener("visibilitychange", acquire);
  }, [pendingUploads]);

  // Not memoized — always reads the live currentFolderId from the render scope
  // so files land in whichever folder the user currently has open.
  const enqueueFiles = (files: File[]) => {
    if (!files.length) return;

    // Sort smallest → largest so smaller files clear first (fewer retries on failure)
    const sorted = [...files].sort((a, b) => a.size - b.size);

    const newUploads: PendingUpload[] = [];
    const skipped: string[] = [];

    for (const file of sorted) {
      const duplicate = myFiles.some(
        (f) => f.folder_id === currentFolderId && f.name === file.name,
      );
      if (duplicate) {
        skipped.push(file.name);
        continue;
      }
      newUploads.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        progress: 0,
        status: "queued",
        targetFolderId: currentFolderId,
      });
    }

    if (skipped.length) {
      alert(
        `Skipped ${
          skipped.length
        } file(s) that already exist in this folder:\n${skipped.join("\n")}`,
      );
    }

    if (newUploads.length) {
      setPendingUploads((prev) => [...prev, ...newUploads]);
    }
  };

  // ─── Owner groupings for shared section ───────────────────────────────────
  const sharedByOwner = sharedFolders.reduce<
    Record<string, { ownerName: string; folders: SharedFolder[] }>
  >((acc, f) => {
    const key = f.ownerHumanId;
    if (!acc[key]) acc[key] = { ownerName: f.ownerName, folders: [] };
    acc[key].folders.push(f);
    return acc;
  }, {});

  // ─── Render ──────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="vault-layout">
        {/* ═══ LEFT PANEL: Folder Tree ══════════════════════════════════════ */}
        {/* Backdrop: closes drawer when tapped on mobile */}
        <div
          className={`vault-sidebar-backdrop${sidebarOpen ? " vault-sidebar-backdrop--visible" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />

        <div
          className={`vault-sidebar${sidebarOpen ? " vault-sidebar--open" : ""}`}
        >
          {/* Close button — sits at the top of the drawer on mobile.
               The CSS class hides it on desktop where the sidebar is always open. */}
          <div className="vault-sidebar-close-row">
            <button
              className="vault-sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close folder tree"
            >
              {/* layout-sidebar-right-expand — “collapse” */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
                <path d="M15 4v16" />
                <path d="M10 10l-2 2l2 2" />
              </svg>
            </button>
          </div>

          {/* ── My Files ──────────────────────────────────────────────────────────── */}
          <button
            className="vault-section-btn"
            onClick={() => setMyFilesOpen((x) => !x)}
          >
            <span>{myFilesOpen ? "▼" : "▶"}</span>
            My Files
          </button>

          {myFilesOpen && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "1px" }}
            >
              {/* Root item */}
              <button
                className={`vault-sidebar-item ${panel.kind === "my-root" ? "vault-sidebar-item--active" : ""}`}
                onClick={() => handleSelectPanel({ kind: "my-root" })}
              >
                /
              </button>

              {/* My folders (top-level only) */}
              {myFolders
                .filter((f) => !f.parent_folder_id)
                .map((folder) =>
                  renamingFolderId === folder._id ? (
                    <div key={folder._id} style={{ padding: "2px 4px" }}>
                      <RenameInput
                        initialValue={folder.name}
                        onDone={(name) => {
                          setRenamingFolderId(null);
                          if (name) renameFolder(folder._id, name);
                        }}
                      />
                    </div>
                  ) : (
                    <FolderTreeItem
                      key={folder._id}
                      folder={folder}
                      allFolders={myFolders}
                      activeFolderId={
                        panel.kind === "my-folder" ? panel.folderId : null
                      }
                      depth={0}
                      onSelect={(f) =>
                        handleSelectPanel({
                          kind: "my-folder",
                          folderId: f._id,
                        })
                      }
                      onRename={(f) => setRenamingFolderId(f._id)}
                      onShare={(f) => setShareFolder(f)}
                      onDelete={(f) => deleteFolder(f._id)}
                    />
                  ),
                )}

              {/* New folder inline input */}
              {addingFolder && (
                <NewFolderInput
                  parentFolderId={currentFolderId}
                  onDone={(name) => {
                    setAddingFolder(false);
                    if (name) createFolder(name);
                  }}
                />
              )}
            </div>
          )}

          {/* ── Shared with me ────────────────────────────────────── */}
          {sharedFolders.length > 0 && (
            <>
              <button
                className="vault-section-btn"
                style={{ marginTop: "12px" }}
                onClick={() => setSharedOpen((x) => !x)}
              >
                <span>{sharedOpen ? "▼" : "▶"}</span>
                Shared with me
              </button>

              {sharedOpen &&
                Object.entries(sharedByOwner).map(
                  ([ownerId, { ownerName, folders }]) => {
                    const isExpanded = expandedOwners.has(ownerId);
                    return (
                      <div key={ownerId}>
                        <button
                          className="vault-sidebar-item"
                          style={{
                            fontSize: "12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                          onClick={() =>
                            setExpandedOwners((prev) => {
                              const next = new Set(prev);
                              if (next.has(ownerId)) next.delete(ownerId);
                              else next.add(ownerId);
                              return next;
                            })
                          }
                        >
                          <span style={{ fontSize: "10px" }}>
                            {isExpanded ? "▼" : "▶"}
                          </span>
                          👤 {ownerName}
                        </button>
                        {isExpanded &&
                          folders.map((f) => (
                            <div key={f._id} style={{ marginLeft: "16px" }}>
                              <button
                                className={`vault-sidebar-item ${panel.kind === "shared-folder" && panel.folderId === f._id ? "vault-sidebar-item--active" : ""}`}
                                onClick={() =>
                                  handleSelectPanel({
                                    kind: "shared-folder",
                                    folderId: f._id,
                                    ownerName,
                                  })
                                }
                              >
                                📁 {f.name}
                              </button>
                            </div>
                          ))}
                      </div>
                    );
                  },
                )}
            </>
          )}
        </div>

        {/* ═══ RIGHT PANEL: File List ════════════════════════════════════════ */}
        <div className="vault-main">
          {/* Header row */}
          <div className="vault-panel-header">
            {/* Open button — only rendered on mobile when the sidebar drawer is closed.
                 Once open, the close button lives inside the sidebar itself. */}
            {!sidebarOpen && (
              <button
                className="vault-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open folder tree"
              >
                {/* layout-sidebar-left-expand — “open” */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
                  <path d="M9 4v16" />
                  <path d="M14 10l2 2l-2 2" />
                </svg>
              </button>
            )}

            {/* Breadcrumb */}
            <h2
              className="font-mono font-bold text-sm purple-light-text"
              style={{ margin: 0 }}
            >
              {breadcrumb}
            </h2>

            {/* Actions */}
            {isMyPanel && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="vault-toolbar-btn"
                  onClick={() => setAddingFolder(true)}
                >
                  + New Folder
                </button>
                <button className="vault-toolbar-btn" onClick={createMdFile}>
                  + New Card
                </button>
                <button className="vault-toolbar-btn" onClick={createProject}>
                  + New Project
                </button>
                <button
                  className="vault-toolbar-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ↑ Upload Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) {
                      enqueueFiles(files);
                      e.target.value = ""; // allow re-selecting the same files
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* Readme — shown as the main content when the folder has a readme.md */}
          {readmeFile && (
            <div className="vault-readme-section">
              <MdxEditorView markdown={readmeFile.content ?? ""} />
            </div>
          )}

          {/* File grid */}
          {!readmeFile &&
          visibleFolders.length === 0 &&
          cardFiles.length === 0 &&
          pendingForCurrentFolder.length === 0 ? (
            <div
              className="text-sm font-mono subtle-text"
              style={{ padding: "40px 0", textAlign: "center" }}
            >
              {isMyPanel
                ? "No files here yet. Upload one or create a card."
                : "No files in this shared folder."}
            </div>
          ) : visibleFolders.length > 0 ||
            cardFiles.length > 0 ||
            pendingForCurrentFolder.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              {/* Folders first */}
              {visibleFolders.map((folder) =>
                renamingFolderId === folder._id ? (
                  <div
                    key={folder._id}
                    className="vault-file-card"
                    style={{ borderColor: "var(--purple)" }}
                  >
                    <RenameInput
                      initialValue={folder.name}
                      onDone={(name) => {
                        setRenamingFolderId(null);
                        if (name) renameFolder(folder._id, name);
                      }}
                    />
                  </div>
                ) : (
                  <FolderCard
                    key={folder._id}
                    folder={folder}
                    onSelect={(f) =>
                      handleSelectPanel({ kind: "my-folder", folderId: f._id })
                    }
                    onRename={(f) => setRenamingFolderId(f._id)}
                    onShare={(f) => setShareFolder(f)}
                    onDelete={(f) => deleteFolder(f._id)}
                  />
                ),
              )}

              {/* In-progress and errored upload placeholders */}
              {pendingForCurrentFolder.map((upload) => (
                <UploadPlaceholderCard
                  key={upload.id}
                  upload={upload}
                  onRetry={() => {
                    // Reset to queued; the queue processor will pick it up when a slot opens
                    setPendingUploads((prev) =>
                      prev.map((p) =>
                        p.id === upload.id
                          ? {
                              ...p,
                              status: "queued",
                              progress: 0,
                              error: undefined,
                            }
                          : p,
                      ),
                    );
                  }}
                  onDismiss={() =>
                    setPendingUploads((prev) =>
                      prev.filter((p) => p.id !== upload.id),
                    )
                  }
                />
              ))}

              {/* Completed files */}
              {cardFiles.map((file) => {
                const locked = isFileRefLocked(file);
                // Don't allow the inline rename widget for locked files
                return renamingFileId === file._id && !locked ? (
                  <div
                    key={file._id}
                    className="vault-file-card"
                    style={{ borderColor: "var(--purple)" }}
                  >
                    <RenameInput
                      initialValue={file.name}
                      onDone={(name) => {
                        setRenamingFileId(null);
                        if (name) renameFile(file._id, name);
                      }}
                    />
                  </div>
                ) : (
                  <FileCard
                    key={file._id}
                    file={file}
                    myFolders={myFolders}
                    isOwned={isMyPanel}
                    isLocked={locked}
                    isSelected={selectedFileId === file._id}
                    onSelect={handleSelectFile}
                    onRename={(f) => setRenamingFileId(f._id)}
                    onDelete={(f) => deleteFile(f._id)}
                    onMove={(f) => setMoveFile(f)}
                    onEditMd={(f) => handleSelectFile(f)}
                    onShareFile={isMyPanel ? (f) => setShareFile(f) : undefined}
                    onDownload={isMyPanel ? (f) => downloadFile(f) : undefined}
                    onArchive={isMyPanel ? (f) => archiveFile(f) : undefined}
                    onUnarchive={
                      isMyPanel ? (f) => unarchiveFile(f) : undefined
                    }
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {shareFolder && (
        <ShareModal
          folder={shareFolder}
          allHumans={allOtherHumans}
          onClose={() => setShareFolder(null)}
          onSave={(shared_with) => shareFolder_(shareFolder._id, shared_with)}
        />
      )}

      {moveFile && (
        <MoveModal
          file={moveFile}
          myFolders={myFolders}
          onClose={() => setMoveFile(null)}
          onMove={(folderId) => moveFile_(moveFile._id, folderId)}
        />
      )}

      {editMdFile && (
        <MdEditorModal
          file={editMdFile}
          csvFile={projectCsvFile}
          refItems={refItems}
          onSave={(content) => saveMdFile(editMdFile._id, content)}
          onSaveCsv={
            projectCsvFile
              ? (content) => saveMdFile(projectCsvFile._id, content)
              : undefined
          }
          onClose={handleCloseEditor}
          onWikiLinkCreate={createMdFileFromWikiLink}
          onWikiLinkNavigate={(href) => navigate(href)}
          mode={editMdMode}
        />
      )}

      {editCsvFile && (
        <CsvEditorModal
          file={editCsvFile}
          readOnly={editCsvFile.human_id !== user._id}
          onSave={(content) => saveMdFile(editCsvFile._id, content)}
          onClose={handleCloseEditor}
        />
      )}

      {shareFile && (
        <FileShareModal
          file={shareFile}
          onClose={() => setShareFile(null)}
          onSave={(updates) => shareFileMutation(shareFile._id, updates)}
        />
      )}
    </AppLayout>
  );
}
