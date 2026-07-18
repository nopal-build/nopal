// app/routes/fruits_.projects.$folderId.tsx
// The rolled-up view of one project folder (under the `projects` vault
// root), driven by the manifest front matter on its README.md — see
// `app/data/project.types.ts` for the manifest grammar and
// `app/data/project.server.ts` for how it's resolved.
//
// A project folder with no manifest yet just isn't a "project view" —
// redirect back to the plain vault folder view rather than showing a dead
// end, so every folder under `projects` is always viewable one way or
// another.
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
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
  if (!folder || folder.human_id !== user._id) {
    throw new Response("Not found", { status: 404 });
  }

  const project = await resolveProjectManifest(user._id, folder);
  if (!project) {
    return redirect(`/fruits/vault?folder=${folderId}`);
  }

  return { folder, project };
}

export default function ProjectRoute() {
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
