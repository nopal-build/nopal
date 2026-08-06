// app/routes/fruits_.newspaper.$folderId.tsx
// The Project Newspaper — the rolled-up view of one project folder (under
// the `projects` vault root), driven by the manifest front matter on its
// README.md — see `app/data/project.types.ts` for the manifest grammar and
// `app/data/project.server.ts` for how it's resolved. See also the
// `project-newspaper` skill.
//
// Lives at `/fruits/newspaper/:folderId` — was previously
// `fruits_.projects.$folderId.tsx` (renamed once this became the project's
// single detail page, rather than living alongside a separate
// OxMarkdown-based prototype at a `.../newspaper` sub-path).
//
// Gated ONLY on the viewer's ACCESS to the folder (`canViewFolder` below) —
// never on whether the README happens to have valid manifest front matter
// yet. `resolveProjectManifest` never fails closed (see its own doc), so
// anyone who can view this folder always sees this route; there's no
// redirect-to-vault fallback to worry about missing here.
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { canViewFolder } from "../data/vault.types";
import { getFolderById } from "../data/vault.server";
import { resolveProjectManifest } from "../data/project.server";
import { AppLayout } from "../components/AppLayout";
import { ProjectView } from "../components/ProjectView";
import "../styles/mdxeditor.css";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const folderId = params.folderId;
  if (!folderId) throw new Response("Not found", { status: 404 });

  const folder = await getFolderById(folderId);
  if (!folder || !canViewFolder(user._id, folder)) {
    throw new Response("Not found", { status: 404 });
  }

  // Children/README belong to the folder's OWNER, not necessarily the viewer
  // (this folder may only be reachable because it's shared with them).
  const project = await resolveProjectManifest(folder.human_id, folder);

  return { folder, project };
}

export default function NewspaperRoute() {
  const { folder, project } = useLoaderData<typeof loader>();
  const { manifest, body, files, folders, csvFields } = project;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <Link
            to="/fruits"
            className="text-xs subtle-text hover:opacity-80"
            style={{ textDecoration: "none" }}
          >
            ← Dashboard
          </Link>
          <div className="flex items-baseline justify-between gap-4 mt-2">
            <h1 className="font-bold text-2xl mb-1">
              {manifest.title ?? folder.name}
            </h1>
            <Link
              to={`/fruits/vault?folder=${folder._id}`}
              className="text-xs subtle-text hover:opacity-80 whitespace-nowrap"
              style={{ textDecoration: "none" }}
            >
              View as files →
            </Link>
          </div>
        </div>

        <ProjectView
          manifest={manifest}
          body={body}
          files={files}
          folders={folders}
          csvFields={csvFields}
        />
      </div>
    </AppLayout>
  );
}
