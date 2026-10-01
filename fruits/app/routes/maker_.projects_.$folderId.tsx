// app/routes/maker_.projects_.$folderId.tsx (the underscore keeps it out of
// `/maker/projects`'s layout: a page of its own at /maker/projects/:id)
// A project's page in the Maker (ADR-026): who is on it, and the one
// place to add, invite, regroup, remove or withdraw (Austin, 2026-09-28:
// "same place, on the project page in Maker"). Its Guide sees it, and
// admins see every project's; anyone else gets the same 404 as a project
// that doesn't exist. Starting a project lands here with only you on it.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { assignableGroups } from "robustness-core/data/features";
import { navFor } from "../data/nav.server";
import { candidatesFor, isStaff, peopleAction, peopleOn, runsPeople } from "../data/projectPeople.server";
import { AppLayout } from "../components/AppLayout";
import { MakerErrorBoundary } from "../components/MakerErrorBoundary";
import { ProjectPeople } from "../components/ProjectPeople";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const folder = params.folderId ? await getFolderById(params.folderId) : undefined;
  if (!folder || !(await runsPeople(user, folder))) throw data("Not found", { status: 404 });

  const staff = isStaff(user);
  const [project, everyone, nav] = await Promise.all([peopleOn(folder), candidatesFor(user), navFor(user._id)]);
  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    project,
    everyone,
    groups: assignableGroups(staff),
    staff,
    ...nav,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const form = await request.formData();
  // This page's project, whatever the form carries.
  form.set("projectId", params.folderId ?? "");
  return peopleAction(user, form, request);
}

export function ErrorBoundary() {
  return <MakerErrorBoundary notFound="Not a project you guide." backTo={{ to: "/maker/projects", label: "← Projects and humans" }} />;
}

export default function MakerProject() {
  const { project, everyone, groups, staff } = useLoaderData<typeof loader>();
  const subtle = { color: semanticColors.textSubtle };
  return (
    <AppLayout>
      <CenterContent maxWidth={720}>
        <Stack gap={6} className={sprinkles({ mb: 8 })}>
          <Link to="/maker/projects" className={`${link} ${textSize.xs}`}>
            ← Projects and humans
          </Link>
          <Stack gap={1}>
            <Cluster gap={3} align="baseline">
              <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>{project.name}</h1>
              <Link to={project.href} className={`${link} ${textSize.sm}`}>
                Open the project →
              </Link>
            </Cluster>
          </Stack>

          <Surface className={sprinkles({ p: 4 })}>
            <ProjectPeople project={project} everyone={everyone} groups={groups} action={`/maker/projects/${project.id}`} />
          </Surface>

          {!staff && (
            <p className={`${textSize.xs} ${sprinkles({ m: 0 })}`} style={subtle}>
              Only an admin can make a Guide.
            </p>
          )}
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
