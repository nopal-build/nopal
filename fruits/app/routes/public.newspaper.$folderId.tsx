// app/routes/public.newspaper.$folderId.tsx
// A project's Efforts page, shared by link: anyone with the URL reads it,
// no login. On only while an Admin/Super has shared it
// (`newspaperShare.server.ts`); 404 otherwise, the same as a project that
// doesn't exist.
//
// Read only by construction: this module exports a loader and meta and
// no action, the renderer gets no `annotations` (no pen) and no
// `interactive`, and there is nothing to change. The loader returns an explicit
// list of fields, never the private page's data: no people, marks,
// suggestions, logbook, budget or tabs. Citations are removed and file
// URLs point at the folder's own routes (`publicEffortsBody`).
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getFolderById } from "robustness-core/data/vault.server";
import { resolveProjectManifest } from "robustness-core/data/project.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";
import { getEffortsPrintedAt } from "robustness-core/data/effortsPrint.server";
import { isNewspaperShared, sharedEffortsPage } from "robustness-core/data/newspaperShare.server";
import { AuthShell } from "../components/AuthShell";
import { ProjectView } from "../components/ProjectView";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const folderId = params.folderId;
  if (!folderId) throw new Response("Not Found", { status: 404 });
  const folder = await getFolderById(folderId);
  if (!folder || !isNewspaperShared(folder)) throw new Response("Not Found", { status: 404 });
  if (getProjectStatus(folder) === "trashed") throw new Response("Not Found", { status: 404 });

  const project = await resolveProjectManifest(folder.human_id, folder);
  const printedAt = await getEffortsPrintedAt(folder);

  // The whole of what leaves the server (`sharedEffortsPage`).
  return sharedEffortsPage(folder, project, printedAt, new URL(request.url).origin);
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not found" }];
  const description = data.updated ? `Updated ${data.updated}` : "Shared from Nopal";
  return [
    { title: data.title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Nopal" },
    { property: "og:type", content: "article" },
    { property: "og:title", content: data.title },
    { property: "og:description", content: description },
    { property: "og:url", content: data.url },
  ];
};

export default function SharedEffortsPage() {
  const { title, updated, body, galleryFolders } = useLoaderData<typeof loader>();
  return (
    <AuthShell maxWidth="820px">
      <header className={sprinkles({ mb: 8 })}>
        <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>{title}</h1>
        {updated && (
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            Updated {updated}
          </p>
        )}
      </header>
      <ProjectView body={body} galleryFolders={galleryFolders} servedFileIds={{}} />
    </AuthShell>
  );
}

export function ErrorBoundary() {
  return (
    <AuthShell maxWidth="600px">
      <div style={{ textAlign: "center" }}>
        <h1 className="font-bold text-xl" style={{ color: semanticColors.textBrand }}>
          Not found
        </h1>
        <p className="text-sm font-mono" style={{ color: semanticColors.textSubtle }}>
          This page doesn't exist, or isn't shared.
        </p>
      </div>
    </AuthShell>
  );
}
