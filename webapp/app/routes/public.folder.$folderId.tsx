// app/routes/public.folder.$folderId.tsx
// Public, unauthenticated folder browser — reachable once a folder (or an
// ancestor of it) has been Published from the Vault. Read-only: no upload,
// rename, move, delete, or share affordances exist here.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  getFolderById,
  getFolderAncestry,
  listFolderChildren,
  getFileRefById,
  resolvePublicRootFolder,
} from "../data/vault.server";
import { isVaultRootFolder } from "../data/vault.types";
import { VAULT_ROOTS, isVaultRootKey } from "../data/vaultRoots";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import MdxEditorView from "../components/MdxEditorView";
import { fileIcon, formatDate, formatSize } from "../util/publicVaultDisplay";
import "../styles/vault.css";
import "../styles/mdxeditor.css";

type Crumb = { id: string; label: string };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { folderId } = params;
  if (!folderId) throw new Response("Not Found", { status: 404 });

  const folder = await getFolderById(folderId);
  if (!folder) throw new Response("Not Found", { status: 404 });

  // Must be published itself, or sit inside a published ancestor. 404 (not
  // 403) either way — a private folder's existence isn't revealed.
  const publicRoot = await resolvePublicRootFolder(folderId);
  if (!publicRoot) throw new Response("Not Found", { status: 404 });

  // How much of the breadcrumb to show is a DISPLAY choice, separate from
  // the access check above: a bare link (no `root` param — e.g. from the
  // "Copy public link" button on a single folder) shows nothing above
  // itself, so recipients can't click up into content they weren't
  // specifically given. Arriving via a link that WAS reached by browsing
  // (every internal <Link> here carries `?root=`) keeps that same visible
  // boundary going deeper.
  //
  // `root` is untrusted input, so it can only ever narrow the boundary
  // in, never widen it past the true published root — see the Math.max
  // below. At worst a forged value is ignored.
  const fullAncestry = await getFolderAncestry(folderId);
  const selfIdx = fullAncestry.length - 1; // folderId is always the last entry
  const lowerBoundIdx = fullAncestry.findIndex((f) => f._id === publicRoot._id);

  const rootParam = new URL(request.url).searchParams.get("root");
  let desiredIdx = selfIdx; // default: no context above self
  if (rootParam) {
    const idx = fullAncestry.findIndex((f) => f._id === rootParam);
    if (idx !== -1 && idx <= selfIdx) desiredIdx = idx;
  }
  const startIdx = Math.max(desiredIdx, lowerBoundIdx);

  const trimmed = fullAncestry.slice(startIdx);
  const crumbs: Crumb[] = trimmed.map((f) => ({
    id: f._id,
    label:
      isVaultRootFolder(f) && isVaultRootKey(f.vault_root_key)
        ? VAULT_ROOTS[f.vault_root_key].label
        : f.name,
  }));

  const children = await listFolderChildren(folder.human_id, folderId);
  const readmeListing = children.files.find(
    (f) => f.name.toLowerCase() === "readme.md",
  );
  const readme = readmeListing
    ? ((await getFileRefById(readmeListing._id)) ?? null)
    : null;

  return {
    crumbs,
    children,
    readme,
    origin: new URL(request.url).origin,
  };
}

/** Basic Open Graph tags — title + item count — so a shared folder link
 * shows more than a bare URL. No preview image: picking a representative
 * thumbnail out of a folder's contents is future scope, not this change. */
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not found" }];
  const { crumbs, children, origin } = data;
  const name = crumbs[crumbs.length - 1]?.label ?? "Shared folder";
  const count = children.folders.length + children.files.length;
  const description = `${count} item${count === 1 ? "" : "s"} · Shared from Nopal`;

  return [
    { title: name },
    { name: "description", content: description },
    { property: "og:site_name", content: "Nopal" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: name },
    { property: "og:description", content: description },
    { property: "og:url", content: `${origin}/public/folder/${crumbs[crumbs.length - 1]?.id ?? ""}` },
  ];
};

export default function PublicFolderPage() {
  const { crumbs, children, readme } = useLoaderData<typeof loader>();
  // Every link deeper from here carries the SAME visible boundary forward.
  const rootForLinks = crumbs[0]?.id;
  const withRoot = (path: string) =>
    rootForLinks ? `${path}?root=${rootForLinks}` : path;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: "820px" }}>
          <h1
            className="font-mono font-bold purple-light-text"
            style={{ fontSize: "1.1rem", margin: "40px 0 4px" }}
          >
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span className="vault-v2-crumb-sep">/</span>}
                {i === crumbs.length - 1 ? (
                  <span>{c.label}</span>
                ) : (
                  <Link
                    to={withRoot(`/public/folder/${c.id}`)}
                    className="vault-v2-crumb"
                  >
                    {c.label}
                  </Link>
                )}
              </span>
            ))}
          </h1>
          <p
            className="text-xs font-mono"
            style={{ color: "var(--text-subtle)", margin: "0 0 24px" }}
          >
            Published from Nopal
          </p>

          {children.folders.length === 0 && children.files.length === 0 ? (
            <div className="vault-v2-empty">This folder is empty.</div>
          ) : (
            <div className="vault-v2-listing">
              <div className="vault-v2-listing-header">
                <span className="vault-v2-row-icon" aria-hidden="true" />
                <span className="vault-v2-row-name">Name</span>
                <span className="vault-v2-row-size">Size</span>
                <span className="vault-v2-row-date">Last updated</span>
              </div>
              {children.folders.map((folder) => (
                <Link
                  key={folder._id}
                  to={withRoot(`/public/folder/${folder._id}`)}
                  className="vault-v2-row"
                >
                  <span className="vault-v2-row-icon">📁</span>
                  <span className="vault-v2-row-name">{folder.name}</span>
                  <span className="vault-v2-row-size" />
                  <span className="vault-v2-row-date">
                    {formatDate(folder.updated_at)}
                  </span>
                </Link>
              ))}
              {children.files.map((file) => (
                <Link
                  key={file._id}
                  to={withRoot(`/public/file/${file._id}`)}
                  className="vault-v2-row"
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
                </Link>
              ))}
            </div>
          )}

          {readme && (
            <div className="vault-readme-section" style={{ marginTop: "16px" }}>
              <MdxEditorView markdown={readme.content ?? ""} />
            </div>
          )}
        </div>
      </div>
      <Footer />
    </Layout>
  );
}

export function ErrorBoundary() {
  return (
    <Layout>
      <div className="scene1">
        <div
          className="simple-container p-4 text-center"
          style={{ maxWidth: "600px", margin: "80px auto" }}
        >
          <h1 className="font-mono font-bold purple-light-text text-xl">
            Not found
          </h1>
          <p className="text-sm font-mono" style={{ color: "var(--text-subtle)" }}>
            This folder doesn't exist, or isn't published.
          </p>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
