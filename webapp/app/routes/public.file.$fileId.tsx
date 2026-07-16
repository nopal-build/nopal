// app/routes/public.file.$fileId.tsx
// Public, unauthenticated view of a single vault file — reachable when the
// file was published individually (the original single-card feature) OR it
// sits inside a folder that's been Published from the Vault.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  getFileRefById,
  getFolderAncestry,
  resolvePublicRootFolder,
} from "../data/vault.server";
import { isVaultRootFolder } from "../data/vault.types";
import { VAULT_ROOTS, isVaultRootKey } from "../data/vaultRoots";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import MdxEditorView from "../components/MdxEditorView";
import { fileIcon, formatSize, isMarkdownFile } from "../util/publicVaultDisplay";
import "../styles/vault.css";
import "../styles/mdxeditor.css";

type Crumb = { id: string; label: string };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) throw new Response("Not Found", { status: 404 });

  const file = await getFileRefById(fileId);
  if (!file) throw new Response("Not Found", { status: 404 });

  // A direct link to this ONE file (no `root` param) shows no breadcrumb at
  // all — there's nothing to click "up" into. Arriving via a link that was
  // reached by browsing a published folder (every internal <Link> on the
  // folder page carries `?root=`) shows the same boundary the visitor was
  // already browsing within. `root` is untrusted and can only narrow the
  // boundary in, never past the true published root (see Math.max below).
  let crumbs: Crumb[] = [];
  let isPublic = file.is_public === true;

  if (file.folder_id) {
    const publicRoot = await resolvePublicRootFolder(file.folder_id);
    if (publicRoot) {
      isPublic = true;

      const rootParam = new URL(request.url).searchParams.get("root");
      if (rootParam) {
        const fullAncestry = await getFolderAncestry(file.folder_id);
        const selfIdx = fullAncestry.length - 1;
        const lowerBoundIdx = fullAncestry.findIndex(
          (f) => f._id === publicRoot._id,
        );
        const idx = fullAncestry.findIndex((f) => f._id === rootParam);
        if (idx !== -1 && idx <= selfIdx) {
          const startIdx = Math.max(idx, lowerBoundIdx);
          crumbs = fullAncestry.slice(startIdx).map((f) => ({
            id: f._id,
            label:
              isVaultRootFolder(f) && isVaultRootKey(f.vault_root_key)
                ? VAULT_ROOTS[f.vault_root_key].label
                : f.name,
          }));
        }
      }
    }
  }

  if (!isPublic) throw new Response("Not Found", { status: 404 });

  // Needed to build ABSOLUTE og:image/og:video URLs below — link-preview
  // crawlers (Discord, Slack, iMessage, etc.) require absolute URLs; a
  // relative path is silently ignored.
  const origin = new URL(request.url).origin;

  return { file, crumbs, origin };
}

/**
 * Open Graph / Twitter Card tags so pasting a public file link anywhere
 * (Discord, Slack, iMessage, X...) shows an actual preview instead of a
 * bare link — and, for videos, an inline player embedded directly in the
 * chat (Discord reads `og:video` and plays it right there).
 *
 * The image/video URL points at our own `/api/vault/public-view/:fileId`
 * (not the raw S3 URL) so every fetch — including the crawler's — gets a
 * fresh presigned redirect; nothing here can go stale.
 */
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not found" }];
  const { file, origin } = data;

  const pageUrl = `${origin}/public/file/${file._id}`;
  const mediaUrl = `${origin}/api/vault/public-view/${file._id}`;
  const description = [formatSize(file.size), "Shared from Nopal"]
    .filter(Boolean)
    .join(" · ");

  const tags: Array<Record<string, string>> = [
    { title: file.name },
    { name: "description", content: description },
    { property: "og:site_name", content: "Nopal" },
    { property: "og:title", content: file.name },
    { property: "og:description", content: description },
    { property: "og:url", content: pageUrl },
  ];

  if (file.content_type.startsWith("image/")) {
    tags.push(
      { property: "og:type", content: "website" },
      { property: "og:image", content: mediaUrl },
      { property: "og:image:secure_url", content: mediaUrl },
      { property: "og:image:type", content: file.content_type },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: mediaUrl },
    );
  } else if (file.content_type.startsWith("video/")) {
    tags.push(
      { property: "og:type", content: "video.other" },
      { property: "og:video", content: mediaUrl },
      { property: "og:video:secure_url", content: mediaUrl },
      { property: "og:video:type", content: file.content_type },
      { name: "twitter:card", content: "player" },
    );
  }

  return tags;
};

export default function PublicFilePage() {
  const { file, crumbs } = useLoaderData<typeof loader>();
  const rootForLinks = crumbs[0]?.id;
  const hasDownload = Boolean(file.s3_key || file.s3_url);

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: "820px" }}>
          {crumbs.length > 0 && (
            <p
              className="font-mono text-xs"
              style={{ margin: "40px 0 4px", color: "var(--text-subtle)" }}
            >
              {crumbs.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && <span className="vault-v2-crumb-sep">/</span>}
                  <Link
                    to={
                      rootForLinks
                        ? `/public/folder/${c.id}?root=${rootForLinks}`
                        : `/public/folder/${c.id}`
                    }
                    className="vault-v2-crumb"
                  >
                    {c.label}
                  </Link>
                </span>
              ))}
            </p>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px",
              margin: crumbs.length > 0 ? "0 0 24px" : "40px 0 24px",
            }}
          >
            <h1
              className="font-mono font-bold purple-light-text"
              style={{ fontSize: "1.5rem", margin: 0, wordBreak: "break-word" }}
            >
              {file.name}
            </h1>
            {hasDownload && (
              <a
                href={`/api/vault/public-download/${file._id}`}
                className="btn-purple text-sm font-mono px-4 py-2 rounded"
                style={{
                  textDecoration: "none",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                ↓ Download
              </a>
            )}
          </div>

          {isMarkdownFile(file) ? (
            <div className="vault-readme-section">
              <MdxEditorView markdown={file.content ?? ""} />
            </div>
          ) : file.content_type.startsWith("image/") ? (
            <img
              className="vault-v2-media"
              src={`/api/vault/public-view/${file._id}`}
              alt={file.name}
            />
          ) : file.content_type.startsWith("video/") ? (
            <video
              className="vault-v2-media"
              controls
              src={`/api/vault/public-view/${file._id}`}
            />
          ) : (
            <div className="vault-v2-file-fallback">
              <span style={{ fontSize: "32px" }}>
                {fileIcon(file.content_type)}
              </span>
              <span className="text-sm font-mono">{file.name}</span>
              <span className="text-xs font-mono subtle-text">
                {[formatSize(file.size), file.content_type]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
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
            This file doesn't exist, or isn't published.
          </p>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
