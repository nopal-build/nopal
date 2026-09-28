// app/routes/maker_.humans.tsx
// Everyone, in one list (Austin, 2026-09-25): each person's human role,
// their group on every project, and what that group gets. An admin changes
// a group here instead of hunting through each project's share modal,
// which is how a client gets missed. Admin/Super only, like the rest of
// the Maker. Every change goes through `setProjectSharing`, the same
// checked path the share modal uses.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useFetcher, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getHumans } from "robustness-core/data/humans.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { getProjectSharing, listEveryProject, setProjectSharing } from "robustness-core/data/projectSharing.server";
import { GROUPS, GROUP_FEATURES, groupOf } from "robustness-core/data/features";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

function isStaff(role: string | undefined): boolean {
  return role === "Admin" || role === "Super";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  if (!isStaff(user.role)) throw data("Forbidden", { status: 403 });

  const [humans, projects] = await Promise.all([getHumans(), listEveryProject()]);
  const people = (humans?.data ?? [])
    .map((h) => ({
      id: h._id as string,
      name: h.name || h.email,
      email: h.email,
      role: h.role,
      projects: projects.flatMap(({ folder, sharing }) => {
        const entry = sharing.find((e) => e.human === h._id);
        return entry ? [{ id: folder._id, name: folder.name, group: entry.role }] : [];
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    people,
    groups: GROUPS.map((g) => ({ name: g, features: [...GROUP_FEATURES[g]] })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  if (!isStaff(user.role)) throw data("Forbidden", { status: 403 });

  const form = await request.formData();
  const humanId = String(form.get("humanId") ?? "");
  const projectId = String(form.get("projectId") ?? "");
  const group = String(form.get("group") ?? "");
  const folder = projectId ? await getFolderById(projectId) : undefined;
  if (!humanId || !folder) return { error: "Not found" };
  if (group && !groupOf(group)) return { error: `Unknown group "${group}"` };

  // "" takes them off the project.
  const others = (await getProjectSharing(folder)).filter((e) => e.human !== humanId);
  const result = await setProjectSharing(user._id, folder, group ? [...others, { human: humanId, role: group }] : others);
  return result.ok ? { ok: true } : { error: result.error };
}

type Person = ReturnType<typeof useLoaderData<typeof loader>>["people"][number];

function GroupSelect({ person, project }: { person: Person; project: Person["projects"][number] }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const shown = pending ? String(fetcher.formData?.get("group") ?? project.group) : project.group;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post" data-membership={`${person.id}:${project.id}`}>
      <input type="hidden" name="humanId" value={person.id} />
      <input type="hidden" name="projectId" value={project.id} />
      <label className={textSize.sm}>
        <span style={{ marginRight: 6 }}>{project.name}</span>
        <select
          name="group"
          value={shown}
          disabled={pending}
          onChange={(e) => fetcher.submit(e.currentTarget.form)}
          className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
        >
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value="">Remove</option>
        </select>
      </label>
      {error && (
        <span className={textSize.xs} style={{ color: semanticColors.textSubtle, marginLeft: 6 }}>
          {error}
        </span>
      )}
    </fetcher.Form>
  );
}

export default function MakerHumans() {
  const { people, groups } = useLoaderData<typeof loader>();
  const subtle = { color: semanticColors.textSubtle };
  return (
    <AppLayout>
      <CenterContent maxWidth={1080}>
        <Stack gap={6} className={sprinkles({ mb: 8 })}>
          <Link to="/maker" className={`${link} ${textSize.xs}`}>
            ← Maker
          </Link>
          <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>Humans</h1>

          <Surface className={sprinkles({ p: 4 })} data-groups>
            <Stack gap={2}>
              {groups.map((g) => (
                <p key={g.name} className={textSize.sm}>
                  <strong>{g.name}</strong> <span style={subtle}>gets {g.features.join(", ")}</span>
                </p>
              ))}
            </Stack>
          </Surface>

          {people.map((person) => (
            <Surface key={person.id} className={sprinkles({ p: 4 })} data-person={person.id}>
              <Stack gap={3}>
                <Cluster gap={3} align="baseline">
                  <span className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`}>{person.name}</span>
                  <span className={textSize.xs} style={subtle}>
                    {person.email}
                  </span>
                  <Badge>{person.role}</Badge>
                </Cluster>
                {person.projects.length === 0 ? (
                  <span className={textSize.sm} style={subtle}>
                    On no project.
                  </span>
                ) : (
                  <Cluster gap={4}>
                    {person.projects.map((p) => (
                      <GroupSelect key={p.id} person={person} project={p} />
                    ))}
                  </Cluster>
                )}
              </Stack>
            </Surface>
          ))}
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
