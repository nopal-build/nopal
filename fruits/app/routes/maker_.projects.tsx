// app/routes/maker_.projects.tsx
// Projects and humans (Austin, 2026-09-29): start a project on top; a
// search that finds a person or a project; then two tabs in the project
// page's card style, whose rows twirl down in place (the stamp
// `Disclosure`) instead of leaving the page. Projects: the ones this
// person runs, each opening to who's on it and the controls to change
// that. Humans, for admins only: everyone once, each opening to their
// group on every project. A Guide who isn't an admin gets the Projects
// tab alone; the Humans tab typed is a 404, like a project tab their
// group isn't given. Every people change goes through `peopleAction`.
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, data, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { guidesAny, listEveryProject, listProjectsFor, resolveRole, roleIn } from "robustness-core/data/projectSharing.server";
import { startProject } from "../data/startProject.server";
import { getHumans } from "robustness-core/data/humans.server";
import { GROUPS, GROUP_FEATURES, assignableGroups, groupOf, type Group } from "robustness-core/data/features";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
import { displayName } from "robustness-core/data/humanNames";
import { navFor } from "../data/nav.server";
import { candidatesFor, isStaff, peopleAction, peopleOnMany, type PeopleProject, type PersonRow } from "../data/projectPeople.server";
import { AppLayout } from "../components/AppLayout";
import { MakerErrorBoundary } from "../components/MakerErrorBoundary";
import { GroupSelect, ProjectPeople } from "../components/ProjectPeople";
import { CardTabs } from "../components/stamps-candidates/CardTabs";
import { Badge } from "stamps/Badge";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Disclosure } from "stamps/Disclosure";
import { Input } from "stamps/Input";
import { SearchField } from "stamps/SearchField";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · M.Projects" }];

type Tab = "projects" | "humans";
const TAB_LABELS: Record<Tab, string> = { projects: "Projects", humans: "Humans" };

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const staff = isStaff(user);
  const memberships = await listProjectsFor(user._id);
  if (!staff && !guidesAny(memberships)) throw data("Forbidden", { status: 403 });

  const allowed: Tab[] = staff ? ["projects", "humans"] : ["projects"];
  const wanted = new URL(request.url).searchParams.get("tab") ?? "projects";
  const tab = allowed.find((t) => t === wanted);
  if (!tab) throw data("Not found", { status: 404 });

  // An admin: every project, websites marked. A Guide: the ones they guide.
  const everyProject = staff ? await listEveryProject() : memberships.filter((m) => resolveRole(m.role).guiding);
  // One humans read for an admin: the candidates and the Humans tab share it.
  const allHumans = staff ? ((await getHumans())?.data ?? []) : null;
  const [peopleProjects, everyone] = await Promise.all([peopleOnMany(everyProject), candidatesFor(user, allHumans ?? undefined)]);
  const projects = peopleProjects.map((p, i) => ({
    ...p,
    website: isWebsiteFolder(everyProject[i].folder),
    you: roleIn(everyProject[i].sharing, user._id),
  }));

  // Everyone, once, with their group on each project: for the Humans tab
  // and the search. An admin gets everyone; a Guide the people on the
  // projects they guide.
  const onProjects = (id: string) =>
    everyProject.flatMap(({ folder, sharing }) => {
      const entry = sharing.find((e) => e.human === id);
      return entry ? [{ id: folder._id, name: folder.name, group: entry.role }] : [];
    });
  const humans = allHumans
    ? allHumans.map((h) => ({ id: h._id as string, name: displayName(h), email: h.email, role: h.role as string | null, projects: onProjects(h._id) }))
    : [...new Map(peopleProjects.flatMap((p) => p.members).map((m) => [m.id, m])).values()].map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: null,
        projects: onProjects(m.id),
      }));
  humans.sort((a, b) => a.name.localeCompare(b.name));

  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    staff,
    tab,
    tabs: allowed.map((key) => ({ key, label: TAB_LABELS[key], to: key === "projects" ? "/maker/projects" : `/maker/projects?tab=${key}` })),
    projects,
    humans,
    everyone,
    groups: assignableGroups(staff),
    legend: GROUPS.map((g) => ({ name: g, features: [...GROUP_FEATURES[g]] })),
    ...(await navFor(user._id, memberships)),
  };
}

/** Starting a project is `startProject`, the one path; any other post is
 * a people change from a twirled-down row (`peopleAction`). */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const form = await request.formData();
  if (form.get("intent") !== "start") return peopleAction(user, form, request);

  const result = await startProject(user, String(form.get("name") ?? ""));
  if (!result.ok) {
    if (result.status === 403) throw data("Forbidden", { status: 403 });
    return { error: result.error };
  }
  return redirect(`/maker/projects/${result.folder._id}`);
}

export function ErrorBoundary() {
  return <MakerErrorBoundary />;
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type ProjectRow = Data["projects"][number];
type HumanRow = Data["humans"][number];
const ACTION = "/maker/projects";
const subtle = { color: semanticColors.textSubtle };

function StartProject() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const starting = navigation.state !== "idle" && navigation.formData?.get("intent") === "start";
  const error = result && "error" in result ? result.error : null;
  return (
    <Form method="post" data-start-project>
      <Surface className={sprinkles({ p: 4 })}>
        <input type="hidden" name="intent" value="start" />
        <Stack gap={3}>
          <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Start a new project</h2>
          <Cluster gap={2} align="center">
            <div style={{ flex: "1 1 240px" }}>
              <Input label="Project name" hideLabel name="name" placeholder="A new project's name" required />
            </div>
            <button type="submit" className={button({ variant: "primary" })} disabled={starting}>
              {starting ? "Starting…" : "Great, get started"}
            </button>
          </Cluster>
          <span className={textSize.xs} style={subtle}>
            {error ?? "You'll be its Guide. Add people once it opens."}
          </span>
        </Stack>
      </Surface>
    </Form>
  );
}

/** One project, twirled down to who's on it and the controls. */
function ProjectDisclosure({ project, everyone, groups }: { project: ProjectRow; everyone: PersonRow[]; groups: readonly Group[] }) {
  const people: PeopleProject = project;
  return (
    <Disclosure
      data-maker-project={project.id}
      summary={
        <Cluster gap={3} align="baseline" style={{ justifyContent: "space-between" }}>
          <Cluster gap={2} align="baseline">
            <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{project.name}</span>
            {project.website && <Badge variant="neutral">website</Badge>}
          </Cluster>
          <span className={textSize.xs} style={subtle}>
            {project.members.length} {project.members.length === 1 ? "person" : "people"}
            {project.you ? ` · you: ${project.you}` : ""}
          </span>
        </Cluster>
      }
    >
      <Stack gap={3}>
        <Link to={project.href} className={`${link} ${textSize.sm}`}>
          Open the project →
        </Link>
        <ProjectPeople project={people} everyone={everyone} groups={groups} action={ACTION} />
      </Stack>
    </Disclosure>
  );
}

/** One person, twirled down to their group on each project. */
function HumanDisclosure({ person, groups }: { person: HumanRow; groups: readonly Group[] }) {
  return (
    <Disclosure
      data-person={person.id}
      summary={
        <Cluster gap={3} align="baseline" style={{ justifyContent: "space-between" }}>
          <Cluster gap={2} align="baseline">
            <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{person.name}</span>
            {person.name !== person.email && (
              <span className={textSize.xs} style={subtle}>
                {person.email}
              </span>
            )}
            {person.role && <Badge>{person.role}</Badge>}
          </Cluster>
          <span className={textSize.xs} style={subtle}>
            {person.projects.length === 0 ? "no project" : person.projects.length === 1 ? "1 project" : `${person.projects.length} projects`}
          </span>
        </Cluster>
      }
    >
      {person.projects.length === 0 ? (
        <span className={textSize.sm} style={subtle}>
          Not on a project yet.
        </span>
      ) : (
        <Stack gap={2}>
          {person.projects.map((p) => (
            <Cluster key={p.id} gap={3} align="center" style={{ justifyContent: "space-between" }}>
              <span className={textSize.sm}>{p.name}</span>
              <GroupSelect humanId={person.id} projectId={p.id} group={p.group} personName={person.name} projectName={p.name} groups={groups} action={ACTION} />
            </Cluster>
          ))}
        </Stack>
      )}
    </Disclosure>
  );
}

/** A person or a project, by name or email, from what's loaded. */
function Search({ projects, humans, everyone, groups }: { projects: ProjectRow[]; humans: HumanRow[]; everyone: PersonRow[]; groups: readonly Group[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const foundProjects = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : [];
  const foundHumans = q ? humans.filter((h) => h.name.toLowerCase().includes(q) || h.email.toLowerCase().includes(q)) : [];
  return (
    <Stack gap={2} data-maker-search>
      <SearchField label="Find a person or project" name="q" placeholder="Find a person or project…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {q && (
        <Surface className={sprinkles({ px: 3, py: 2 })}>
          {foundProjects.length === 0 && foundHumans.length === 0 ? (
            <p className={`${textSize.sm} ${sprinkles({ m: 0, py: 2 })}`} style={subtle}>
              No match.
            </p>
          ) : (
            <Stack gap={3}>
              {foundProjects.length > 0 && (
                <div>
                  <p className={`${textSize.xs} ${sprinkles({ m: 0, pt: 2 })}`} style={subtle}>
                    Projects
                  </p>
                  {foundProjects.map((p) => (
                    <ProjectDisclosure key={p.id} project={p} everyone={everyone} groups={groups} />
                  ))}
                </div>
              )}
              {foundHumans.length > 0 && (
                <div>
                  <p className={`${textSize.xs} ${sprinkles({ m: 0, pt: 2 })}`} style={subtle}>
                    People
                  </p>
                  {foundHumans.map((h) => (
                    <HumanDisclosure key={h.id} person={h} groups={groups} />
                  ))}
                </div>
              )}
            </Stack>
          )}
        </Surface>
      )}
    </Stack>
  );
}

export default function MakerProjects() {
  const { staff, tab, tabs, projects, humans, everyone, groups, legend } = useLoaderData<typeof loader>();
  return (
    <AppLayout>
      <CenterContent maxWidth={960}>
        <Stack gap={6} className={sprinkles({ mb: 8 })}>
          <Link to="/maker" className={`${link} ${textSize.xs}`}>
            ← Maker
          </Link>
          <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>Projects and humans</h1>
          <StartProject />
          <Search projects={projects} humans={humans} everyone={everyone} groups={groups} />
          <CardTabs tabs={tabs} active={tab} label="Projects and humans">
            {tab === "projects" &&
              (projects.length === 0 ? (
                <p className={textSize.sm} style={subtle}>
                  No projects yet.
                </p>
              ) : (
                <div>
                  {projects.map((p) => (
                    <ProjectDisclosure key={p.id} project={p} everyone={everyone} groups={groups} />
                  ))}
                </div>
              ))}
            {tab === "humans" && (
              <Stack gap={4}>
                <Stack gap={1} data-groups>
                  {legend.map((g) => (
                    <p key={g.name} className={`${textSize.sm} ${sprinkles({ m: 0 })}`}>
                      <strong>{g.name}</strong> <span style={subtle}>gets {g.features.join(", ")}</span>
                    </p>
                  ))}
                </Stack>
                <div>
                  {humans.map((h) => (
                    <HumanDisclosure key={h.id} person={h} groups={groups} />
                  ))}
                </div>
              </Stack>
            )}
          </CardTabs>
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
