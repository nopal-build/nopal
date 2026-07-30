// app/routes/fruits_.vault.tsx
// The Vault — GitHub-style file browser with a cached folder tree.
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
import {
  canViewFolder,
  isFileRefLocked,
  isFolderShared,
  isVaultRootFolder,
} from "../data/vault.types";
import type {
  FileRef,
  FileRefListing,
  VaultFolder,
} from "../data/vault.types";
import {
  VAULT_ROOTS,
  canWriteToRoot,
  isRootPublishable,
  isRootShareable,
  isVaultRootKey,
} from "../data/vaultRoots";
import {
  SPACE_FOLDER_TYPES,
  SYNC_FOLDER_TYPES,
  canWriteToFolderType,
  isFolderTypePublishable,
  isFolderTypeShareable,
  type SpaceFolderTypeKey,
  type SyncFolderTypeKey,
} from "../data/vaultFolderTypes";
// Server functions are only used inside `loader`; React Router strips them
// from the client bundle automatically.
import {
  canViewFileRef,
  ensureVaultRootFolders,
  getFileRefById,
  getFolderAncestry,
  getFolderById,
  getFoldersByHuman,
  getSharedFoldersForHuman,
  listFolderChildren,
} from "../data/vault.server";
import { getHumansById } from "../data/humans.server";
import { getRelatedHumans } from "../data/relationships.server";
import { AppLayout } from "../components/AppLayout";
import { MoreMenu, type MoreMenuItem } from "../components/MoreMenu";
import MdxEditorView from "../components/MdxEditorView";
import "../styles/vault.css";
import "../styles/mdxeditor.css";

// ─── Upload constants (ported from vault v1 — the flow that “worked well”) ───

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per S3 multipart part
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // multipart for files ≥ 100 MB
const MAX_CONCURRENT_UPLOADS = 2; // max files uploading at the same time

// ─── Types ──────────────────────────────────────────────────────────────────────────────

/** One folder's direct children — the unit of lazy tree loading. */
type FolderChildren = { folders: VaultFolder[]; files: FileRefListing[] };

/** A file waiting in (or moving through) the upload queue. */
type PendingUpload = {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number; // 0-100
  status: "queued" | "uploading" | "error";
  error?: string;
  targetFolderId: string;
};

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

  const [roots, ownFolders, sharedFolders, relatedHumansRaw] =
    await Promise.all([
      ensureVaultRootFolders(user._id),
      // Every folder the human owns — one cheap query. The left tree renders
      // its full folder skeleton from this, so expanding never waits on the
      // network; only per-folder FILE listings load lazily.
      getFoldersByHuman(user._id),
      // Every folder shared with the human, anywhere in the vault — sharing
      // cascades `shared_with` onto every descendant at share-time, so this
      // already includes the full subtree of each shared folder, not just
      // its top level.
      getSharedFoldersForHuman(user._id),
      getRelatedHumans(user),
    ]);
  // Sorted alphabetically — the Share modal's checklist previously showed
  // humans in raw DB order, which made it easy to miscount/misclick on a
  // longer, scrollable list.
  const relatedHumans: HumanEntry[] = relatedHumansRaw
    .map((h) => ({ _id: h._id, name: h.name, email: h.email }))
    .sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email));

  // The left tree's folder skeleton needs BOTH the human's own folders and
  // every folder shared with them, so shared subtrees render/expand the same
  // way owned ones do (see `foldersByParent` in the component).
  const allFolders = [...ownFolders, ...sharedFolders];

  // Top-level shared folders — the entry points rendered under "Shared with
  // me" (root view + sidebar). Descendants of an already-shared folder are
  // filtered out; they render nested under it instead.
  const sharedIds = new Set(sharedFolders.map((f) => f._id));
  const topLevelSharedFolders = sharedFolders.filter(
    (f) => !f.parent_folder_id || !sharedIds.has(f.parent_folder_id),
  );
  const sharedOwners = await getHumansById([
    ...new Set(topLevelSharedFolders.map((f) => f.human_id)),
  ]);
  const sharedFolderOwners: Record<string, string> = Object.fromEntries(
    sharedOwners.map((o) => [o._id, o.name || o.email]),
  );

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
    if (!file || !(await canViewFileRef(user._id, file))) {
      throw new Response("File not found", { status: 404 });
    }
    let ancestry = file.folder_id ? await getFolderAncestry(file.folder_id) : [];
    // Not the owner: this file is only reachable via a shared folder —
    // anchor the ancestry under the viewer's OWN matching root container
    // (always "projects" today) so it reads/navigates as if nested inside
    // the viewer's own Projects folder, instead of walking up into the
    // owner's private tree above the shared folder.
    if (file.human_id !== user._id) {
      ancestry = anchorSharedAncestry(ancestry, user._id, roots);
    }
    current = { kind: "file", file, ancestry };
  } else if (folderParam) {
    const folder = await getFolderById(folderParam);
    if (!folder || !canViewFolder(user._id, folder)) {
      throw new Response("Folder not found", { status: 404 });
    }
    // Ancestry includes the folder itself (root container → … → folder).
    let ancestry = await getFolderAncestry(folder._id);
    if (folder.human_id !== user._id) {
      ancestry = anchorSharedAncestry(ancestry, user._id, roots);
    }
    // Children belong to the folder's OWNER, not necessarily the viewer.
    const children = await listFolderChildren(folder.human_id, folder._id);
    treeSeed[folder._id] = children;

    const readmeListing = children.files.find(
      (f) => f.name.toLowerCase() === "readme.md",
    );
    const readme = readmeListing
      ? ((await getFileRefById(readmeListing._id)) ?? null)
      : null;
    current = { kind: "folder", folder, ancestry, readme };
  }

  return {
    user,
    roots,
    allFolders,
    treeSeed,
    current,
    relatedHumans,
    topLevelSharedFolders,
    sharedFolderOwners,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Drops the leading (owner-private) ancestors that the viewer can't open,
 * then re-anchors the remaining shared-visible chain under the viewer's OWN
 * root container of the same kind (always "projects" today — the only
 * shareable root). This is what makes a shared project read/navigate as if
 * it lives right inside the viewer's own Projects folder (breadcrumbs,
 * "..", and the sidebar tree all agree), rather than floating in some
 * separate "shared" area or 404ing when walking into the real owner's
 * private tree above it.
 */
function anchorSharedAncestry(
  ancestry: VaultFolder[],
  humanId: string,
  roots: VaultFolder[],
): VaultFolder[] {
  const cutoff = ancestry.findIndex((f) => !canViewFolder(humanId, f));
  const trimmed = cutoff === -1 ? ancestry : ancestry.slice(cutoff + 1);
  const rootKey = trimmed[0]?.vault_root_key;
  const viewerRoot = rootKey
    ? roots.find((r) => r.vault_root_key === rootKey)
    : undefined;
  return viewerRoot ? [viewerRoot, ...trimmed] : trimmed;
}

function fileIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼️";
  if (contentType === "application/pdf") return "📄";
  if (contentType === "text/markdown") return "📝";
  if (contentType === "text/csv") return "📊";
  if (contentType.startsWith("video/")) return "🎬";
  return "📎";
}

function folderIcon(shared_with: VaultFolder["shared_with"]): string {
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

/**
 * Standalone icon button for copying a /public/... link — deliberately
 * NOT buried in the More Actions menu, since "grab the link" is the most
 * common thing to do with published content. Shows a checkmark + "Copied"
 * inline for a moment instead of a window.alert.
 */
function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    // Built at click time (client-only) rather than render time — `window`
    // doesn't exist during SSR.
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (older browser, non-HTTPS, etc).
      window.prompt("Copy this public link:", url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className="vault-toolbar-btn"
      onClick={handleClick}
      title="Copy public link"
      aria-label="Copy public link"
      style={{ display: "flex", alignItems: "center", gap: "5px" }}
    >
      {copied ? (
        <>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5l10 -10" />
          </svg>
          Copied
        </>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M9 15l6 -6" />
          <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
          <path d="M13 18l-.463 .536a5 5 0 0 1 -7.072 -7.072l.534 -.464" />
        </svg>
      )}
    </button>
  );
}

// ─── Share Modal ───────────────────────────────────────────────────────────────────────────────

type ProjectSharingRole = { name: string; is_owner: boolean };
type ProjectSharingEntry = { human: string; role: string };

/**
 * A project's Sharing Roles — supersedes the old "private / everyone /
 * specific people" modal entirely (see `projectSharing.server.ts`).
 * "Everyone in the app" is gone; every collaborator now gets an explicit
 * named Role (Owner/Crafter/Observer by default — see
 * `sharingRoles.server.ts`), stored directly in the project's own
 * README.md front matter. Loads/saves via
 * `/api/vault/projects/:folderId/sharing` rather than the generic folder
 * PATCH endpoint.
 */
function ShareModal({
  folder,
  allHumans,
  onClose,
  apiJson,
}: {
  folder: VaultFolder;
  allHumans: HumanEntry[];
  onClose: () => void;
  apiJson: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<ProjectSharingRole[]>([]);
  // human id -> role name; absent = not shared with this human at all.
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await apiJson(`/api/vault/projects/${folder._id}/sharing`);
      if (cancelled || !data) return;
      setRoles(data.roles ?? []);
      const next: Record<string, string> = {};
      for (const entry of (data.sharing ?? []) as ProjectSharingEntry[]) {
        next[entry.human] = entry.role;
      }
      setAssignments(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [folder._id, apiJson]);

  const defaultRole = roles.find((r) => !r.is_owner)?.name ?? roles[0]?.name ?? "";

  const setRoleFor = (humanId: string, role: string | null) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (role) next[humanId] = role;
      else delete next[humanId];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const sharing: ProjectSharingEntry[] = Object.entries(assignments).map(
      ([human, role]) => ({ human, role }),
    );
    const data = await apiJson(`/api/vault/projects/${folder._id}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ sharing }),
    });
    setSaving(false);
    if (data) onClose();
  };

  const selectStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: "12px",
    padding: "2px 6px",
  };

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="vault-modal-title">Share "{folder.name}"</h3>
        <p
          className="text-xs font-mono"
          style={{ color: "var(--text-subtle)", marginTop: "-8px", marginBottom: "16px" }}
        >
          Give a collaborator a Role on this project. There's no "everyone"
          option — pick people explicitly.
        </p>

        {loading ? (
          <p className="text-xs font-mono" style={{ padding: "12px" }}>
            Loading…
          </p>
        ) : (
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
                const role = assignments[h._id];
                return (
                  <label
                    key={h._id}
                    className={`vault-human-row ${role ? "vault-human-row--checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!role}
                      onChange={() =>
                        setRoleFor(h._id, role ? null : defaultRole)
                      }
                      style={{ accentColor: "var(--purple)", cursor: "pointer", flexShrink: 0 }}
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
                    {role && (
                      <select
                        value={role}
                        onChange={(e) => setRoleFor(h._id, e.target.value)}
                        style={selectStyle}
                      >
                        {roles.map((r) => (
                          <option key={r.name} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
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
            disabled={saving || loading}
            className="btn-purple text-xs font-mono px-3 py-1.5 rounded"
          >
            {saving ? "Saving…" : "Save"}
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

/**
 * Panel content for the "New folder" `MoreMenu` popover (see `VaultV2Page`'s
 * toolbar) — NOT a modal. Plain-folder creation is a name + Create (or hit
 * Enter); a Vault Folder Type (Skills/Syncs, or a sync connector when the
 * current folder IS a Syncs folder — see the vault skill) is a single
 * button that kicks off creation immediately, no typing required.
 */
function NewFolderPanel({
  parentFolder,
  isSpaceTypeEligible,
  existingChildren,
  onCreate,
}: {
  parentFolder: VaultFolder;
  /** True when `parentFolder` is either the Personal root or a direct child
   * of the `projects` root — the only places Space types (Skills/Syncs) may
   * be created (see the vault skill). */
  isSpaceTypeEligible: boolean;
  existingChildren: VaultFolder[];
  onCreate: (name: string, folderType: string | null) => void;
}) {
  const isSyncsContainer =
    parentFolder.folder_type === "syncs" && parentFolder.is_folder_type_root;

  const existingSpaceTypes = new Set(
    existingChildren
      .filter((f) => f.is_folder_type_root && f.folder_type)
      .map((f) => f.folder_type as string),
  );

  const spaceTypeOptions = isSpaceTypeEligible
    ? (Object.keys(SPACE_FOLDER_TYPES) as SpaceFolderTypeKey[]).filter(
        (key) => !existingSpaceTypes.has(key),
      )
    : [];
  const syncTypeOptions = isSyncsContainer
    ? (Object.keys(SYNC_FOLDER_TYPES) as SyncFolderTypeKey[])
    : [];

  const typeDefs: Record<string, { label: string; description: string; comingSoon?: boolean }> = {
    ...SPACE_FOLDER_TYPES,
    ...SYNC_FOLDER_TYPES,
  };
  const typeOptions = [...spaceTypeOptions, ...syncTypeOptions];

  const [name, setName] = useState("");
  const canSubmit = name.trim().length > 0;
  const submitPlain = () => {
    if (!canSubmit) return;
    onCreate(name.trim(), null);
  };

  return (
    <div style={{ width: "230px" }}>
      <div style={{ display: "flex", gap: "6px", padding: "2px 2px 6px" }}>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitPlain();
          }}
          placeholder="Folder name"
          className="text-xs font-mono"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "5px 7px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--text)",
          }}
        />
        <button
          type="button"
          onClick={submitPlain}
          disabled={!canSubmit}
          className="btn-purple text-xs font-mono px-2 py-1 rounded"
          style={!canSubmit ? { opacity: 0.5, cursor: "not-allowed" } : {}}
        >
          Create
        </button>
      </div>

      {typeOptions.length > 0 && (
        <>
          <div
            style={{ borderTop: "1px solid var(--border)", margin: "2px 0 4px" }}
          />
          {typeOptions.map((key) => {
            const def = typeDefs[key];
            return (
              <button
                key={key}
                type="button"
                role="menuitem"
                disabled={def.comingSoon}
                title={def.description}
                onClick={() => onCreate(def.label, key)}
                className="menu-item text-sm purple-text"
              >
                {def.label}
                {def.comingSoon ? " (soon)" : ""}
              </button>
            );
          })}
        </>
      )}
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
  sharedEntryIds,
  ownerNames = {},
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
  /** ids of top-level shared folders — only these (not their descendants)
   * get the "shared by …" annotation, wherever they're nested. */
  sharedEntryIds?: Set<string>;
  /** human_id → display name, for annotating shared folders with their owner. */
  ownerNames?: Record<string, string>;
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
        {sharedEntryIds?.has(folder._id) && ownerNames[folder.human_id] && (
          <span className="vault-v2-tree-owner">
            shared by {ownerNames[folder.human_id]}
          </span>
        )}
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
              sharedEntryIds={sharedEntryIds}
              ownerNames={ownerNames}
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
  const {
    user,
    roots,
    allFolders,
    treeSeed,
    current,
    relatedHumans,
    topLevelSharedFolders,
    sharedFolderOwners,
  } = useLoaderData<typeof loader>();

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

  // The viewer's OWN "projects" root — folders shared with them are nested
  // as if they live right inside it (see `foldersByParent` below), since
  // "projects" is the only shareable root today.
  const projectsRootId = roots.find((r) => r.vault_root_key === "projects")?._id;
  // Only the entry points get the "shared by …" annotation — not every
  // descendant, which would otherwise repeat it at every depth.
  const sharedEntryIds = useMemo(
    () => new Set(topLevelSharedFolders.map((f) => f._id)),
    [topLevelSharedFolders],
  );

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
    // Top-level shared folders don't actually live under the viewer's
    // "projects" root (their real parent is the owner's own, invisible to
    // this viewer) — graft them in here so they render/expand exactly like
    // an owned project.
    if (projectsRootId && topLevelSharedFolders.length > 0) {
      (map[projectsRootId] ??= []).push(...topLevelSharedFolders);
    }
    for (const [parentId, children] of Object.entries(map)) {
      const parent = byId.get(parentId) ?? roots.find((r) => r._id === parentId);
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
  }, [allFolders, projectsRootId, topLevelSharedFolders, roots]);

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
  const [replacing, setReplacing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // ─── Upload queue (ported from vault v1) ──────────────────────────────
  // Multi-file, max 2 concurrent, XHR byte-progress for small files, and
  // chunked S3 multipart (no proxy-timeout risk) for files ≥ 100 MB.

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // Uploads claimed by the queue processor — survives re-renders mid-flight.
  const activeUploadIds = useRef<Set<string>>(new Set());

  const finishUpload = useCallback(
    (id: string, folderId: string) => {
      setPendingUploads((prev) => prev.filter((p) => p.id !== id));
      invalidateAndRevalidate([folderId]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const failUpload = useCallback((id: string, error: string) => {
    setPendingUploads((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "error", error } : p)),
    );
  }, []);

  const setUploadProgress = useCallback((id: string, progress: number) => {
    setPendingUploads((prev) =>
      prev.map((p) => (p.id === id ? { ...p, progress } : p)),
    );
  }, []);

  const runMultipartUpload = useCallback(
    async (upload: PendingUpload) => {
      const { file, targetFolderId: folderId, id } = upload;
      const contentType = file.type || "application/octet-stream";

      const initRes = await fetch("/api/vault/multipart-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType,
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
          setUploadProgress(id, Math.round(((i + 1) / numParts) * 100));
        }

        const completeRes = await fetch("/api/vault/multipart-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            key,
            parts,
            name: file.name,
            folderId,
            contentType,
            size: file.size,
          }),
        });
        if (!completeRes.ok) {
          const data = (await completeRes.json()) as { error?: string };
          throw new Error(
            data.error ?? `Complete failed (${completeRes.status})`,
          );
        }

        finishUpload(id, folderId);
      } catch (err) {
        // Best-effort abort so S3 never leaks partial uploads
        fetch("/api/vault/multipart-abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, key }),
        }).catch(() => {});
        throw err;
      }
    },
    [finishUpload, setUploadProgress],
  );

  const startUpload = useCallback(
    (upload: PendingUpload) => {
      const { id, file, targetFolderId: folderId } = upload;

      if (file.size >= MULTIPART_THRESHOLD) {
        runMultipartUpload(upload)
          .catch((err) => {
            failUpload(
              id,
              err instanceof Error ? err.message : "Upload failed",
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
      formData.append("folderId", folderId);

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(id, Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        activeUploadIds.current.delete(id);
        if (xhr.status >= 200 && xhr.status < 300) {
          finishUpload(id, folderId);
        } else {
          let error = `Server error (HTTP ${xhr.status})`;
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            if (data.error) error = data.error;
          } catch {
            /* non-JSON body */
          }
          failUpload(id, error);
        }
      };

      xhr.onerror = () => {
        activeUploadIds.current.delete(id);
        failUpload(id, "Network error — check your connection and retry.");
      };

      xhr.ontimeout = () => {
        activeUploadIds.current.delete(id);
        failUpload(
          id,
          "Upload timed out. Try again or use a smaller file.",
        );
      };

      xhr.open("POST", "/api/vault/upload");
      xhr.send(formData);
    },
    [runMultipartUpload, finishUpload, failUpload, setUploadProgress],
  );

  // Queue processor: starts queued uploads whenever a slot opens (max 2).
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

    // Claim slots synchronously so a second effect run can't double-start.
    for (const p of toStart) activeUploadIds.current.add(p.id);

    const toStartIds = new Set(toStart.map((p) => p.id));
    setPendingUploads((prev) =>
      prev.map((p) =>
        toStartIds.has(p.id) ? { ...p, status: "uploading" } : p,
      ),
    );
    for (const upload of toStart) startUpload(upload);
  }, [pendingUploads, startUpload]);

  // Keep the screen awake while uploads run so phone auto-lock doesn't kill
  // long video uploads.
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
      if (wakeLockRef.current) return;
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
          lock.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        })
        .catch(() => {});
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => document.removeEventListener("visibilitychange", acquire);
  }, [pendingUploads]);

  // Not memoized — reads the live current folder from render scope so files
  // land in whichever folder the user has open.
  const enqueueFiles = (files: File[]) => {
    if (current.kind !== "folder" || !files.length) return;
    const folderId = current.folder._id;
    const existing = mergedCache[folderId]?.files ?? [];

    // Smallest first so quick files clear the queue early.
    const sorted = [...files].sort((a, b) => a.size - b.size);
    const newUploads: PendingUpload[] = [];
    const skipped: string[] = [];

    for (const file of sorted) {
      if (existing.some((f) => f.name === file.name)) {
        skipped.push(file.name);
        continue;
      }
      newUploads.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        status: "queued",
        targetFolderId: folderId,
      });
    }

    if (skipped.length) {
      window.alert(
        `Skipped ${skipped.length} file(s) that already exist in this folder:\n${skipped.join("\n")}`,
      );
    }
    if (newUploads.length) {
      setPendingUploads((prev) => [...prev, ...newUploads]);
    }
  };

  const dismissUpload = (id: string) => {
    setPendingUploads((prev) => prev.filter((p) => p.id !== id));
  };

  const retryUpload = (id: string) => {
    setPendingUploads((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status: "queued", progress: 0, error: undefined }
          : p,
      ),
    );
  };

  const handleCreateFolder = async (name: string, folderType: string | null) => {
    if (current.kind !== "folder") return;
    const folderId = current.folder._id;
    const data = await apiJson("/api/vault/folders", {
      method: "POST",
      body: JSON.stringify({
        name,
        parent_folder_id: folderId,
        folder_type: folderType,
      }),
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

  const handleDeleteFolder = async () => {
    if (current.kind !== "folder") return;
    const folder = current.folder;
    if (
      !window.confirm(
        `Delete "${folder.name}" and everything inside it? This cannot be undone.`,
      )
    ) {
      return;
    }
    const data = await apiJson(`/api/vault/folders/${folder._id}`, {
      method: "DELETE",
    });
    if (data) {
      // The folder is gone — land on its parent (or the vault root).
      if (folder.parent_folder_id) {
        setSearchParams({ folder: folder.parent_folder_id });
      } else {
        setSearchParams({});
      }
      invalidateAndRevalidate([folder.parent_folder_id]);
    }
  };

  const handleDeleteFile = async () => {
    if (current.kind !== "file") return;
    const file = current.file;
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) {
      return;
    }
    const data = await apiJson(`/api/vault/${file._id}`, { method: "DELETE" });
    if (data) {
      // The file is gone — land on its containing folder (or the vault root).
      if (file.folder_id) setSearchParams({ folder: file.folder_id });
      else setSearchParams({});
      invalidateAndRevalidate([file.folder_id]);
    }
  };

  const handleTogglePublish = async (nextIsPublic: boolean) => {
    if (current.kind !== "folder") return;
    const folder = current.folder;
    const data = await apiJson(`/api/vault/folders/${folder._id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_public: nextIsPublic }),
    });
    if (data) invalidateAndRevalidate([folder.parent_folder_id]);
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

  const pendingForCurrentFolder =
    current.kind === "folder"
      ? pendingUploads.filter(
          (p) => p.targetFolderId === current.folder._id,
        )
      : [];

  // Folders from the always-complete skeleton; files from the seeded/lazy
  // cache (the loader seeds the current folder on every navigation).
  const folderChildren =
    current.kind === "folder"
      ? {
          folders: foldersByParent[current.folder._id] ?? [],
          files: mergedCache[current.folder._id]?.files ?? [],
        }
      : null;

  // Shared (non-owned) folders/files are view-only in this UI — all
  // mutation actions below (rename/move/share/publish/delete/upload/replace)
  // are gated on ownership; the server enforces this too.
  const isOwnedByViewer =
    current.kind === "root" ||
    (current.kind === "folder"
      ? current.folder.human_id === user._id
      : current.file.human_id === user._id);

  const currentIsRootContainer =
    current.kind === "folder" && isVaultRootFolder(current.folder);
  const currentFolderType =
    current.kind === "folder" ? (current.folder.folder_type ?? null) : null;
  // Sharing Roles only apply at the PROJECT level (a role is a project-
  // wide grant stored in that project's own README.md — see
  // `projectSharing.server.ts`), never to an arbitrary nested subfolder,
  // so "Share" is only offered on a folder that IS a top-level project:
  // a direct child of the `projects` root (ancestry = [root, folder]).
  const isTopLevelProject =
    current.kind === "folder" &&
    current.folder.vault_root_key === "projects" &&
    current.ancestry.length === 2;
  const canShareCurrent =
    isOwnedByViewer &&
    current.kind === "folder" &&
    !currentIsRootContainer &&
    isTopLevelProject &&
    isRootShareable(current.folder.vault_root_key) &&
    isFolderTypeShareable(currentFolderType);
  const canPublishCurrent =
    isOwnedByViewer &&
    current.kind === "folder" &&
    !currentIsRootContainer &&
    isRootPublishable(current.folder.vault_root_key) &&
    isFolderTypePublishable(currentFolderType);
  // Some root subtrees or folder TYPES (e.g. `skills`) restrict writing to
  // Admin/Super, even inside the OWNING human's own vault — see
  // `vaultRoots.ts` / `vaultFolderTypes.ts`. This ONLY hides the buttons;
  // the server enforces the real restriction (see the `vault` skill's own
  // rule against hidden-button-only gating).
  const canWriteCurrent =
    isOwnedByViewer &&
    current.kind === "folder" &&
    canWriteToRoot(current.folder.vault_root_key, user.role) &&
    canWriteToFolderType(currentFolderType, user.role);
  // A folder is publicly reachable either because it was Published itself,
  // or because an ancestor was — Publish is resolved dynamically (see
  // resolvePublicRootFolder), not cascaded onto descendants at publish time,
  // so newly added sub-folders/files stay published with nothing to re-run.
  const folderOwnPublic =
    current.kind === "folder" && current.folder.is_public === true;
  const folderPublicViaAncestor =
    current.kind === "folder" &&
    current.ancestry.slice(0, -1).some((f) => f.is_public);
  const folderEffectivelyPublic = folderOwnPublic || folderPublicViaAncestor;
  const filePublicViaAncestor =
    current.kind === "file" && current.ancestry.some((f) => f.is_public);
  const fileEffectivelyPublic =
    current.kind === "file" &&
    (current.file.is_public === true || filePublicViaAncestor);
  // Any folder can be moved anywhere — except root containers, folder-type
  // anchors (a project's own "Skills"/"Syncs" folder, or a sync connector
  // inside one — pinned in place, see the vault skill), and folders that
  // are currently shared (the server also rejects shared descendants).
  const canMoveCurrent =
    isOwnedByViewer &&
    current.kind === "folder" &&
    !currentIsRootContainer &&
    !current.folder.is_folder_type_root &&
    !isFolderShared(current.folder);

  const fileHasS3 =
    current.kind === "file" &&
    Boolean(current.file.s3_key || current.file.s3_url);
  // Past daily-log files are read-only — no Replace/Delete (server enforces too).
  const fileLocked = current.kind === "file" && isFileRefLocked(current.file);

  // A file's own root key isn't denormalized onto it directly (only
  // folders carry `vault_root_key`) — `ancestry[0]` is the root CONTAINER
  // itself (see `getFolderAncestry`'s "root container → … → the folder
  // itself" ordering), which always carries its own key.
  const fileRootKey =
    current.kind === "file" ? current.ancestry[0]?.vault_root_key : undefined;
  // Same reasoning as fileRootKey above, but for the file's TYPE — the
  // immediate containing folder (last in the ancestry chain) carries the
  // correct denormalized `folder_type` for wherever the file actually lives.
  const fileFolderType =
    current.kind === "file"
      ? current.ancestry[current.ancestry.length - 1]?.folder_type
      : undefined;
  const canWriteCurrentFile =
    current.kind === "file" &&
    isOwnedByViewer &&
    canWriteToRoot(fileRootKey, user.role) &&
    canWriteToFolderType(fileFolderType, user.role);

  // "More Actions" dropdown — management actions, gated by the same
  // policies that previously hid the standalone buttons. Unavailable actions
  // are omitted; when nothing is available the trigger renders disabled.
  // Upload / New folder / Download stay as standalone toolbar buttons.
  const moreActions: MoreMenuItem[] = [];
  if (current.kind === "folder" && canWriteCurrent) {
    if (!currentIsRootContainer) {
      moreActions.push({ label: "Rename", onClick: handleRenameFolder });
    }
    if (canMoveCurrent) {
      moreActions.push({ label: "Move", onClick: () => setMoveOpen(true) });
    }
    if (canShareCurrent) {
      moreActions.push({ label: "Share", onClick: () => setShareOpen(true) });
    }
    if (canPublishCurrent) {
      if (folderOwnPublic) {
        moreActions.push({
          label: "Unpublish",
          onClick: () => handleTogglePublish(false),
        });
      } else if (!folderPublicViaAncestor) {
        // Publicity inherited from an ancestor has no toggle here — unpublish
        // the ancestor folder to revoke it. The link icon button still
        // works either way.
        moreActions.push({
          label: "Publish",
          onClick: () => handleTogglePublish(true),
        });
      }
    }
    if (!currentIsRootContainer) {
      moreActions.push({
        label: "Delete",
        onClick: handleDeleteFolder,
        danger: true,
      });
    }
  } else if (current.kind === "file" && canWriteCurrentFile) {
    if (!fileLocked) {
      moreActions.push({
        label: "Replace",
        onClick: () => replaceInputRef.current?.click(),
        disabled: replacing,
      });
      moreActions.push({
        label: "Delete",
        onClick: handleDeleteFile,
        danger: true,
      });
    }
  }

  const moreActionsTrigger = ({
    toggle,
    open,
    label,
  }: {
    toggle: () => void;
    open: boolean;
    label: string;
  }) => (
    <button
      type="button"
      className="vault-toolbar-btn"
      disabled={moreActions.length === 0 || replacing}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={toggle}
    >
      {replacing ? "Replacing…" : "More Actions ▾"}
    </button>
  );

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
            to="/fruits/vault"
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
                sharedEntryIds={sharedEntryIds}
                ownerNames={sharedFolderOwners}
              />
            ))}
          </div>
        </div>

        {/* ═══ RIGHT: main view ═════════════════════════════════════════════ */}
        <div className="vault-main">
          {/* Breadcrumb + actions */}
          <div className="vault-panel-header">
            <div className="flex items-center gap-2">
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
                <Link to="/fruits/vault" className="vault-v2-crumb">
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
            </div>

            {(folderEffectivelyPublic || fileEffectivelyPublic) && (
              <span
                className="text-xs font-mono"
                style={{
                  color: "var(--purple-light)",
                  whiteSpace: "nowrap",
                }}
                title="Anyone with the link can view this"
              >
                Published
              </span>
            )}

            {/* Actions */}
            {current.kind === "folder" && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {canWriteCurrent && (
                  <button
                    className="vault-toolbar-btn"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    ↑ Upload files
                  </button>
                )}
                {canWriteCurrent && (
                  <MoreMenu
                    label="New folder"
                    align="left"
                    trigger={({ toggle, open, label }) => (
                      <button
                        type="button"
                        className="vault-toolbar-btn"
                        aria-label={label}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onClick={toggle}
                      >
                        + New folder
                      </button>
                    )}
                  >
                    {({ close }) => (
                      <NewFolderPanel
                        parentFolder={current.folder}
                        isSpaceTypeEligible={
                          (current.folder.vault_root_key === "personal" &&
                            isVaultRootFolder(current.folder)) ||
                          current.folder.parent_folder_id === projectsRootId
                        }
                        existingChildren={
                          foldersByParent[current.folder._id] ?? []
                        }
                        onCreate={(name, folderType) => {
                          handleCreateFolder(name, folderType);
                          close();
                        }}
                      />
                    )}
                  </MoreMenu>
                )}
                {folderEffectivelyPublic && (
                  <CopyLinkButton path={`/public/folder/${current.folder._id}`} />
                )}
                <MoreMenu
                  label="More actions"
                  items={moreActions}
                  trigger={moreActionsTrigger}
                />
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) enqueueFiles(files);
                    e.target.value = ""; // allow re-selecting the same files
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
                {fileEffectivelyPublic && (
                  <CopyLinkButton path={`/public/file/${current.file._id}`} />
                )}
                <MoreMenu
                  label="More actions"
                  items={moreActions}
                  trigger={moreActionsTrigger}
                />
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
                  folderChildren.files.length === 0 &&
                  pendingForCurrentFolder.length === 0 && (
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
                      {sharedEntryIds.has(folder._id) &&
                        sharedFolderOwners[folder.human_id] && (
                          <span className="vault-v2-tree-owner">
                            {" "}
                            — shared by {sharedFolderOwners[folder.human_id]}
                          </span>
                        )}
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
                {/* In-flight uploads for this folder */}
                {pendingForCurrentFolder.map((p) => (
                  <div
                    key={p.id}
                    className="vault-v2-row vault-v2-row--pending"
                  >
                    <span className="vault-v2-row-icon">
                      {p.status === "error" ? "⚠️" : "⏳"}
                    </span>
                    <span className="vault-v2-row-name">
                      {p.name}
                      {p.status === "error" && (
                        <span className="vault-v2-upload-error">
                          {" — "}
                          {p.error}
                        </span>
                      )}
                    </span>
                    {p.status === "error" ? (
                      <span className="vault-v2-upload-actions">
                        <button
                          className="vault-toolbar-btn"
                          onClick={() => retryUpload(p.id)}
                        >
                          Retry
                        </button>
                        <button
                          className="vault-toolbar-btn"
                          onClick={() => dismissUpload(p.id)}
                        >
                          Dismiss
                        </button>
                      </span>
                    ) : (
                      <>
                        <span className="vault-v2-row-size">
                          {formatSize(p.size)}
                        </span>
                        <span className="vault-v2-upload-bar">
                          {p.status === "queued" ? (
                            <span className="vault-v2-upload-queued">
                              queued
                            </span>
                          ) : (
                            <span className="vault-upload-progress">
                              <span
                                className="vault-upload-progress-fill"
                                style={{ width: `${p.progress}%` }}
                              />
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
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
          onClose={() => {
            setShareOpen(false);
            invalidateAndRevalidate([current.folder._id, current.folder.parent_folder_id]);
          }}
          apiJson={apiJson}
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
        <Link to="/fruits/vault" className="btn btn-primary">
          Back to Vault
        </Link>
      </div>
    </AppLayout>
  );
}
