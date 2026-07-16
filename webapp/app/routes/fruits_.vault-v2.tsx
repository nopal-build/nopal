// app/routes/fruits_.vault-v2.tsx
// Vault v2 — GitHub-style file browser with a lazy folder tree.
// URL state: ?folder=<folderId> OR ?file=<fileId>; neither → root view.
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  isRouteErrorResponse,
  redirect,
  useLoaderData,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUser } from "../modules/auth/auth.server";
// Types + shared utils live in a server-free file — safe on client and server.
import { isFolderShared, isVaultRootFolder } from "../data/vault.types";
import type {
  FileRef,
  FileRefListing,
  VaultFolder,
} from "../data/vault.types";
import {
  VAULT_ROOTS,
  isRootShareable,
  isVaultRootKey,
} from "../data/vaultRoots";
// Server functions are only used inside `loader`; React Router strips them
// from the client bundle automatically.
import {
  ensureVaultRootFolders,
  getFileRefById,
  getFolderAncestry,
  getFolderById,
  getFoldersByHuman,
  listFolderChildren,
} from "../data/vault.server";
import { getRelatedHumans } from "../data/relationships.server";
import { AppLayout } from "../components/AppLayout";
import MdxEditorView from "../components/MdxEditorView";
import "../styles/vault.css";
import "../styles/vault-v2.css";
import "../styles/mdxeditor.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One folder's direct children — the unit of lazy tree loading. */
type FolderChildren = { folders: VaultFolder[]; files: FileRefListing[] };

type Current =
  | { kind: "root" }
  | {
      kind: "folder";
      folder: VaultFolder;
      ancestry: VaultFolder[];
      readme: FileRef | null;
    }
  | { kind: "file"; file: FileRef; ancestry: VaultFolder[] };

type HumanEntry = { _id: string; name: string; email: string };

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const [roots, allFolders, relatedHumansRaw] = await Promise.all([
    ensureVaultRootFolders(user._id),
    // Every folder the human owns — one cheap query. The left tree renders
    // its full folder skeleton from this, so expanding never waits on the
    // network; only per-folder FILE listings load lazily.
    getFoldersByHuman(user._id),
    getRelatedHumans(user),
  ]);
  const relatedHumans: HumanEntry[] = relatedHumansRaw.map((h) => ({
    _id: h._id,
    name: h.name,
    email: h.email,
  }));

  const url = new URL(request.url);
  const fileParam = url.searchParams.get("file");
  const folderParam = url.searchParams.get("folder");

  // Children-cache seed. Folder structure comes from `allFolders`, so only
  // the CURRENT folder's listing (files for the main view) is fetched here —
  // this doubles as the "refetch on click" freshness pass, since navigating
  // re-runs the loader. Files for other expanded tree folders load lazily.
  const treeSeed: Record<string, FolderChildren> = {
    root: { folders: roots, files: [] },
  };

  let current: Current = { kind: "root" };

  if (fileParam) {
    const file = await getFileRefById(fileParam);
    if (!file || file.human_id !== user._id) {
      throw new Response("File not found", { status: 404 });
    }
    const ancestry = file.folder_id
      ? await getFolderAncestry(file.folder_id)
      : [];
    current = { kind: "file", file, ancestry };
  } else if (folderParam) {
    const folder = await getFolderById(folderParam);
    if (!folder || folder.human_id !== user._id) {
      throw new Response("Folder not found", { status: 404 });
    }
    // Ancestry includes the folder itself (root container → … → folder).
    const ancestry = await getFolderAncestry(folder._id);
    const children = await listFolderChildren(user._id, folder._id);
    treeSeed[folder._id] = children;

    const readmeListing = children.files.find(
      (f) => f.name.toLowerCase() === "readme.md",
    );
    const readme = readmeListing
      ? ((await getFileRefById(readmeListing._id)) ?? null)
      : null;
    current = { kind: "folder", folder, ancestry, readme };
  }

  return { user, roots, allFolders, treeSeed, current, relatedHumans };
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

function folderIcon(shared_with: VaultFolder["shared_with"]): string {
  if (shared_with === "everyone") return "🌍";
  if (Array.isArray(shared_with) && shared_with.length > 0) return "👥";
  return "📁";
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

/** Root containers display their VAULT_ROOTS label; everything else its name. */
function folderLabel(folder: VaultFolder): string {
  if (isVaultRootFolder(folder) && isVaultRootKey(folder.vault_root_key)) {
    return VAULT_ROOTS[folder.vault_root_key].label;
  }
  return folder.name;
}

function isMarkdownFile(file: Pick<FileRef, "name" | "content_type">): boolean {
  return (
    file.content_type === "text/markdown" ||
    file.name.toLowerCase().endsWith(".md")
  );
}

/** Column header row for the GitHub-style listing table. */
function ListingHeader() {
  return (
    <div className="vault-v2-listing-header">
      <span className="vault-v2-row-icon" aria-hidden="true" />
      <span className="vault-v2-row-name">Name</span>
      <span className="vault-v2-row-size">Size</span>
      <span className="vault-v2-row-date">Last updated</span>
    </div>
  );
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

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
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
                    <span
                      className="text-sm font-mono"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.name || h.email}
                    </span>
                  </label>
                );
              })
            )}
          </div>
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

// ─── Move Folder Modal ─────────────────────────────────────────────────────────

/** One selectable folder row in the move-destination picker. The subtree of
 * the folder being moved is never rendered — you can't move into yourself. */
function MovePickerNode({
  folder,
  depth,
  movingId,
  currentParentId,
  foldersByParent,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: {
  folder: VaultFolder;
  depth: number;
  movingId: string;
  currentParentId: string | null;
  foldersByParent: Record<string, VaultFolder[]>;
  expanded: Set<string>;
  onToggle: (folderId: string) => void;
  selectedId: string | null;
  onSelect: (folderId: string) => void;
}) {
  const isMoving = folder._id === movingId;
  const isCurrentParent = folder._id === currentParentId;
  const disabled = isMoving || isCurrentParent;
  const isExpanded = !isMoving && expanded.has(folder._id);
  const childFolders = foldersByParent[folder._id] ?? [];

  return (
    <div>
      <div
        className={`vault-v2-move-row${
          selectedId === folder._id ? " vault-v2-move-row--selected" : ""
        }${disabled ? " vault-v2-move-row--disabled" : ""}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {isMoving ? (
          <span className="vault-v2-chevron-spacer" />
        ) : (
          <button
            className="vault-v2-chevron"
            onClick={() => onToggle(folder._id)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        )}
        <button
          className="vault-v2-tree-name-btn"
          disabled={disabled}
          onClick={() => onSelect(folder._id)}
        >
          📁 {folderLabel(folder)}
          {isMoving ? " (moving)" : isCurrentParent ? " (current location)" : ""}
        </button>
      </div>

      {isExpanded &&
        childFolders.map((child) => (
          <MovePickerNode
            key={child._id}
            folder={child}
            depth={depth + 1}
            movingId={movingId}
            currentParentId={currentParentId}
            foldersByParent={foldersByParent}
            expanded={expanded}
            onToggle={onToggle}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function MoveFolderModal({
  folder,
  roots,
  foldersByParent,
  onMove,
  onClose,
}: {
  folder: VaultFolder;
  roots: VaultFolder[];
  foldersByParent: Record<string, VaultFolder[]>;
  onMove: (targetFolderId: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggle = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="vault-modal-title">Move "{folder.name}"</h3>

        <p
          className="text-xs font-mono"
          style={{ color: "var(--text-subtle)", margin: "0 0 10px" }}
        >
          Pick a destination folder:
        </p>

        <div className="vault-v2-move-tree">
          {roots.map((root) => (
            <MovePickerNode
              key={root._id}
              folder={root}
              depth={0}
              movingId={folder._id}
              currentParentId={folder.parent_folder_id}
              foldersByParent={foldersByParent}
              expanded={expanded}
              onToggle={toggle}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
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
              if (selectedId) onMove(selectedId);
              onClose();
            }}
            disabled={!selectedId}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
            style={!selectedId ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar tree ───────────────────────────────────────────────────────────────

function TreeNode({
  folder,
  depth,
  foldersByParent,
  cache,
  expanded,
  activeFolderId,
  activeFileId,
  onToggleExpand,
  onSelectFolder,
  onSelectFile,
}: {
  folder: VaultFolder;
  depth: number;
  /** Full folder skeleton (from the loader) — renders instantly. */
  foldersByParent: Record<string, VaultFolder[]>;
  /** Lazily-fetched per-folder listings — only used for FILES here. */
  cache: Record<string, FolderChildren>;
  expanded: Set<string>;
  activeFolderId: string | null;
  activeFileId: string | null;
  onToggleExpand: (folder: VaultFolder) => void;
  onSelectFolder: (folder: VaultFolder) => void;
  onSelectFile: (file: FileRefListing) => void;
}) {
  const isExpanded = expanded.has(folder._id);
  const childFolders = foldersByParent[folder._id] ?? [];
  const files = cache[folder._id]?.files;
  const isActive = activeFolderId === folder._id;
  const indent = 8 + depth * 14;

  return (
    <div>
      <div
        className={`vault-sidebar-item${isActive ? " vault-sidebar-item--active" : ""}`}
        style={{ alignItems: "center", gap: "4px", paddingLeft: indent }}
      >
        <button
          className="vault-v2-chevron"
          onClick={() => onToggleExpand(folder)}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {isExpanded ? "▼" : "▶"}
        </button>
        <button
          className="vault-v2-tree-name-btn"
          onClick={() => onSelectFolder(folder)}
        >
          {folderIcon(folder.shared_with)} {folderLabel(folder)}
        </button>
      </div>

      {isExpanded && (
        <div>
          {/* Sub-folders — always available from the skeleton, no loading state */}
          {childFolders.map((child) => (
            <TreeNode
              key={child._id}
              folder={child}
              depth={depth + 1}
              foldersByParent={foldersByParent}
              cache={cache}
              expanded={expanded}
              activeFolderId={activeFolderId}
              activeFileId={activeFileId}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
              onSelectFile={onSelectFile}
            />
          ))}

          {/* Files — lazily fetched; brief “…” only on first expand */}
          {!files ? (
            <div
              className="vault-v2-tree-loading"
              style={{ paddingLeft: indent + 22 }}
            >
              …
            </div>
          ) : (
            files.map((file) => (
              <button
                key={file._id}
                className={`vault-sidebar-item${activeFileId === file._id ? " vault-sidebar-item--active" : ""}`}
                style={{
                  alignItems: "center",
                  gap: "4px",
                  paddingLeft: indent + 14,
                }}
                onClick={() => onSelectFile(file)}
              >
                <span className="vault-v2-chevron-spacer" />
                <span className="vault-v2-tree-name">
                  {fileIcon(file.content_type)} {file.name}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VaultV2Page() {
  const { roots, allFolders, treeSeed, current, relatedHumans } =
    useLoaderData<typeof loader>();

  const revalidator = useRevalidator();
  const [, setSearchParams] = useSearchParams();

  // ─── Sidebar (mobile drawer) ────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ─── Client children-cache (lazy tree) ──────────────────────────────────────
  // Server-seeded entries (treeSeed) always win over stale client fetches.
  const [cache, setCache] = useState<Record<string, FolderChildren>>({});
  const mergedCache = useMemo<Record<string, FolderChildren>>(
    () => ({ ...cache, ...treeSeed }),
    [cache, treeSeed],
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Full folder skeleton, keyed by parent id — refreshed by every loader run,
  // so the tree renders (and stays) complete without per-folder fetches.
  // Children of a root container follow its childSort policy (daily-logs is
  // latest → oldest); everything else sorts name ASC.
  const foldersByParent = useMemo(() => {
    const byId = new Map(allFolders.map((f) => [f._id, f]));
    const map: Record<string, VaultFolder[]> = {};
    for (const f of allFolders) {
      if (!f.parent_folder_id) continue; // root containers come from `roots`
      (map[f.parent_folder_id] ??= []).push(f);
    }
    for (const [parentId, children] of Object.entries(map)) {
      const parent = byId.get(parentId);
      const desc =
        parent &&
        !parent.parent_folder_id &&
        isVaultRootKey(parent.vault_root_key) &&
        VAULT_ROOTS[parent.vault_root_key].childSort === "name-desc";
      children.sort((a, b) =>
        desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name),
      );
    }
    return map;
  }, [allFolders]);

  const loadChildren = useCallback(async (folderId: string) => {
    setLoadingIds((prev) => new Set(prev).add(folderId));
    try {
      const res = await fetch(`/api/vault/folders/${folderId}/children`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setCache((prev) => ({ ...prev, [folderId]: data }));
      }
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  }, []);

  /** Drop cached children for the given folders, then re-run the loader. */
  const invalidateAndRevalidate = (
    folderIds: (string | null | undefined)[],
  ) => {
    setCache((prev) => {
      const next = { ...prev };
      for (const id of folderIds) delete next[id ?? "root"];
      return next;
    });
    revalidator.revalidate();
  };

  // ─── Expansion state — folders on the ancestry path start expanded ─────────
  const ancestry = current.kind === "root" ? [] : current.ancestry;
  const ancestryKey = ancestry.map((f) => f._id).join(",");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestry.map((f) => f._id)),
  );
  useEffect(() => {
    if (!ancestryKey) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ancestryKey.split(",")) {
        if (id && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ancestryKey]);

  // Fetch file listings for any expanded folder that doesn't have one yet —
  // covers first expand, deep-link auto-expansion, and post-mutation
  // invalidation in one place. Folder structure never waits on this.
  useEffect(() => {
    for (const id of expanded) {
      if (id !== "root" && !mergedCache[id] && !loadingIds.has(id)) {
        loadChildren(id);
      }
    }
  }, [expanded, mergedCache, loadingIds, loadChildren]);

  const activeFolderId = current.kind === "folder" ? current.folder._id : null;
  const activeFileId = current.kind === "file" ? current.file._id : null;

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const selectFolder = (folder: VaultFolder) => {
    setSearchParams({ folder: folder._id });
    setExpanded((prev) => new Set(prev).add(folder._id));
    setSidebarOpen(false);
  };

  const selectFile = (file: FileRefListing | FileRef) => {
    setSearchParams({ file: file._id });
    setSidebarOpen(false);
  };

  const toggleExpand = (folder: VaultFolder) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folder._id)) next.delete(folder._id);
      else next.add(folder._id);
      return next;
    });
  };

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const apiJson = useCallback(async (url: string, options: RequestInit = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      window.alert(data?.error ?? `Request failed (${res.status})`);
      return null;
    }
    return data;
  }, []);

  const apiForm = useCallback(async (url: string, form: FormData) => {
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      window.alert(data?.error ?? `Request failed (${res.status})`);
      return null;
    }
    return data;
  }, []);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const handleUpload = async (file: File) => {
    if (current.kind !== "folder") return;
    const folderId = current.folder._id;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folderId", folderId);
      const data = await apiForm("/api/vault/upload", form);
      if (data) invalidateAndRevalidate([folderId]);
    } finally {
      setUploading(false);
    }
  };

  const handleNewFolder = async () => {
    if (current.kind !== "folder") return;
    const folderId = current.folder._id;
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    const data = await apiJson("/api/vault/folders", {
      method: "POST",
      body: JSON.stringify({ name, parent_folder_id: folderId }),
    });
    if (data) invalidateAndRevalidate([folderId]);
  };

  const handleRenameFolder = async () => {
    if (current.kind !== "folder") return;
    const folder = current.folder;
    const name = window.prompt("Rename folder", folder.name)?.trim();
    if (!name || name === folder.name) return;
    const data = await apiJson(`/api/vault/folders/${folder._id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    if (data) invalidateAndRevalidate([folder.parent_folder_id]);
  };

  const handleShareFolder = async (shared_with: string[] | "everyone") => {
    if (current.kind !== "folder") return;
    const folder = current.folder;
    const data = await apiJson(`/api/vault/folders/${folder._id}`, {
      method: "PATCH",
      body: JSON.stringify({ shared_with }),
    });
    if (data) invalidateAndRevalidate([folder.parent_folder_id]);
  };

  const handleMoveFolder = async (targetFolderId: string) => {
    if (current.kind !== "folder") return;
    const folder = current.folder;
    const data = await apiJson(`/api/vault/folders/${folder._id}`, {
      method: "PATCH",
      body: JSON.stringify({ parent_folder_id: targetFolderId }),
    });
    // Both the old and new parent listings changed.
    if (data) invalidateAndRevalidate([folder.parent_folder_id, targetFolderId]);
  };

  const handleDownload = async (file: FileRef) => {
    const res = await fetch(`/api/vault/download/${file._id}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      window.alert(data?.error ?? `Request failed (${res.status})`);
      return;
    }
    if (data?.url) {
      const a = document.createElement("a");
      a.href = data.url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleReplace = async (uploaded: File) => {
    if (current.kind !== "file") return;
    const file = current.file;
    setReplacing(true);
    try {
      const form = new FormData();
      form.append("file", uploaded);
      const data = await apiForm(`/api/vault/replace/${file._id}`, form);
      if (data) invalidateAndRevalidate([file.folder_id]);
    } finally {
      setReplacing(false);
    }
  };

  // ─── Derived view data ──────────────────────────────────────────────────────

  // Folders from the always-complete skeleton; files from the seeded/lazy
  // cache (the loader seeds the current folder on every navigation).
  const folderChildren =
    current.kind === "folder"
      ? {
          folders: foldersByParent[current.folder._id] ?? [],
          files: mergedCache[current.folder._id]?.files ?? [],
        }
      : null;

  const currentIsRootContainer =
    current.kind === "folder" && isVaultRootFolder(current.folder);
  const canShareCurrent =
    current.kind === "folder" &&
    !currentIsRootContainer &&
    isRootShareable(current.folder.vault_root_key);
  // Any folder can be moved anywhere — except root containers and folders
  // that are currently shared (the server also rejects shared descendants).
  const canMoveCurrent =
    current.kind === "folder" &&
    !currentIsRootContainer &&
    !isFolderShared(current.folder);

  const fileHasS3 =
    current.kind === "file" &&
    Boolean(current.file.s3_key || current.file.s3_url);

  // Parent for the ".." row — second-to-last ancestor, or the vault root view.
  const parentFolder =
    current.kind === "folder"
      ? (current.ancestry[current.ancestry.length - 2] ?? null)
      : null;

  // Breadcrumb items: every ancestor is a link; the last item is plain text.
  const crumbs: { id: string; label: string; link: boolean }[] = [];
  if (current.kind === "folder") {
    current.ancestry.forEach((f, i) => {
      crumbs.push({
        id: f._id,
        label: folderLabel(f),
        link: i < current.ancestry.length - 1,
      });
    });
  } else if (current.kind === "file") {
    for (const f of current.ancestry) {
      crumbs.push({ id: f._id, label: folderLabel(f), link: true });
    }
    crumbs.push({ id: current.file._id, label: current.file.name, link: false });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="vault-layout">
        {/* ═══ LEFT: lazy folder tree ═══════════════════════════════════════ */}
        {/* Backdrop: closes drawer when tapped on mobile */}
        <div
          className={`vault-sidebar-backdrop${sidebarOpen ? " vault-sidebar-backdrop--visible" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />

        <div
          className={`vault-sidebar${sidebarOpen ? " vault-sidebar--open" : ""}`}
        >
          {/* Close button — top of the drawer on mobile; hidden on desktop */}
          <div className="vault-sidebar-close-row">
            <button
              className="vault-sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close folder tree"
            >
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

          <Link
            to="/fruits/vault-v2"
            className="vault-section-btn"
            style={{ textDecoration: "none" }}
            onClick={() => setSidebarOpen(false)}
          >
            Vault
          </Link>

          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            {roots.map((root) => (
              <TreeNode
                key={root._id}
                folder={root}
                depth={0}
                foldersByParent={foldersByParent}
                cache={mergedCache}
                expanded={expanded}
                activeFolderId={activeFolderId}
                activeFileId={activeFileId}
                onToggleExpand={toggleExpand}
                onSelectFolder={selectFolder}
                onSelectFile={selectFile}
              />
            ))}
          </div>
        </div>

        {/* ═══ RIGHT: main view ═════════════════════════════════════════════ */}
        <div className="vault-main">
          {/* Breadcrumb + actions */}
          <div className="vault-panel-header">
            {/* Mobile: open drawer button (close btn lives in the sidebar) */}
            {!sidebarOpen && (
              <button
                className="vault-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open folder tree"
              >
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

            <h2
              className="font-mono font-bold text-sm purple-light-text"
              style={{ margin: 0, minWidth: 0 }}
            >
              {current.kind === "root" ? (
                <span>Vault</span>
              ) : (
                <Link to="/fruits/vault-v2" className="vault-v2-crumb">
                  Vault
                </Link>
              )}
              {crumbs.map((c) => (
                <span key={c.id}>
                  <span className="vault-v2-crumb-sep">/</span>
                  {c.link ? (
                    <Link to={`?folder=${c.id}`} className="vault-v2-crumb">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </span>
              ))}
            </h2>

            {/* Actions */}
            {current.kind === "folder" && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="vault-toolbar-btn"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "↑ Upload file"}
                </button>
                <button className="vault-toolbar-btn" onClick={handleNewFolder}>
                  + New folder
                </button>
                {!currentIsRootContainer && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={handleRenameFolder}
                  >
                    Rename
                  </button>
                )}
                {canMoveCurrent && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={() => setMoveOpen(true)}
                  >
                    Move
                  </button>
                )}
                {canShareCurrent && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={() => setShareOpen(true)}
                  >
                    Share
                  </button>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = ""; // allow re-selecting the same file
                  }}
                />
              </div>
            )}

            {current.kind === "file" && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {fileHasS3 && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={() => handleDownload(current.file)}
                  >
                    ↓ Download
                  </button>
                )}
                <button
                  className="vault-toolbar-btn"
                  onClick={() => replaceInputRef.current?.click()}
                  disabled={replacing}
                >
                  {replacing ? "Replacing…" : "⇄ Replace"}
                </button>
                <input
                  ref={replaceInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleReplace(file);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </div>

          {/* ── Root view — the three root containers, no actions ───────── */}
          {current.kind === "root" && (
            <div className="vault-v2-listing">
              <ListingHeader />
              {roots.map((root) => (
                <button
                  key={root._id}
                  className="vault-v2-row"
                  onClick={() => selectFolder(root)}
                >
                  <span className="vault-v2-row-icon">📁</span>
                  <span className="vault-v2-row-name">{folderLabel(root)}</span>
                  <span className="vault-v2-row-size" />
                  <span className="vault-v2-row-date">
                    {formatDate(root.updated_at)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── Folder view — GitHub-style table + optional readme ───────── */}
          {current.kind === "folder" && folderChildren && (
            <>
              <div className="vault-v2-listing">
                <ListingHeader />
                {/* ".." — up to the parent folder (or the vault root) */}
                <button
                  className="vault-v2-row"
                  onClick={() =>
                    parentFolder
                      ? selectFolder(parentFolder)
                      : setSearchParams({})
                  }
                  aria-label="Go to parent folder"
                >
                  <span className="vault-v2-row-icon" aria-hidden="true" />
                  <span className="vault-v2-row-name">..</span>
                  <span className="vault-v2-row-size" />
                  <span className="vault-v2-row-date" />
                </button>
                {folderChildren.folders.length === 0 &&
                  folderChildren.files.length === 0 && (
                    <div className="vault-v2-empty">This folder is empty.</div>
                  )}
                {folderChildren.folders.map((folder) => (
                  <button
                    key={folder._id}
                    className="vault-v2-row"
                    onClick={() => selectFolder(folder)}
                  >
                    <span className="vault-v2-row-icon">
                      {folderIcon(folder.shared_with)}
                    </span>
                    <span className="vault-v2-row-name">
                      {folderLabel(folder)}
                    </span>
                    <span className="vault-v2-row-size" />
                    <span className="vault-v2-row-date">
                      {formatDate(folder.updated_at)}
                    </span>
                  </button>
                ))}
                {folderChildren.files.map((file) => (
                  <button
                    key={file._id}
                    className="vault-v2-row"
                    onClick={() => selectFile(file)}
                  >
                    <span className="vault-v2-row-icon">
                      {fileIcon(file.content_type)}
                    </span>
                    <span className="vault-v2-row-name">{file.name}</span>
                    <span className="vault-v2-row-size">
                      {formatSize(file.size)}
                    </span>
                    <span className="vault-v2-row-date">
                      {formatDate(file.updated_at)}
                    </span>
                  </button>
                ))}
              </div>

              {current.readme && (
                <div className="vault-readme-section">
                  <MdxEditorView markdown={current.readme.content ?? ""} />
                </div>
              )}
            </>
          )}

          {/* ── File view — render by content type ────────────────────────── */}
          {current.kind === "file" &&
            (isMarkdownFile(current.file) ? (
              <div className="vault-readme-section">
                <MdxEditorView markdown={current.file.content ?? ""} />
              </div>
            ) : current.file.content_type.startsWith("image/") ? (
              <img
                className="vault-v2-media"
                src={`/api/vault/view/${current.file._id}`}
                alt={current.file.name}
              />
            ) : current.file.content_type.startsWith("video/") ? (
              <video
                className="vault-v2-media"
                controls
                src={`/api/vault/view/${current.file._id}`}
              />
            ) : (
              <div className="vault-v2-file-fallback">
                <span style={{ fontSize: "32px" }}>
                  {fileIcon(current.file.content_type)}
                </span>
                <span className="text-sm font-mono">{current.file.name}</span>
                <span className="text-xs font-mono subtle-text">
                  {[formatSize(current.file.size), current.file.content_type]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {fileHasS3 && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={() => handleDownload(current.file)}
                  >
                    ↓ Download
                  </button>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Share modal */}
      {shareOpen && current.kind === "folder" && (
        <ShareModal
          folder={current.folder}
          allHumans={relatedHumans}
          onClose={() => setShareOpen(false)}
          onSave={handleShareFolder}
        />
      )}

      {/* Move modal */}
      {moveOpen && current.kind === "folder" && (
        <MoveFolderModal
          folder={current.folder}
          roots={roots}
          foldersByParent={foldersByParent}
          onMove={handleMoveFolder}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </AppLayout>
  );
}

// ─── Error boundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  let message = "Couldn't load the Vault.";
  if (isRouteErrorResponse(error)) {
    message =
      typeof error.data === "string" && error.data
        ? error.data
        : `Error ${error.status}: ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;
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
          Vault
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
        <Link to="/fruits/vault-v2" className="btn btn-primary">
          Back to Vault
        </Link>
      </div>
    </AppLayout>
  );
}
