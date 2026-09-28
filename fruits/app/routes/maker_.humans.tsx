// app/routes/maker_.humans.tsx
// Everyone, in one list (Austin, 2026-09-25): each person's human role,
// their group on every project, and what that group gets. An admin changes
// a group here instead of hunting through each project's share modal,
// which is how a client gets missed. By project first: who is on each,
// with a search to add anyone else (Austin, 2026-09-28); by person below. Admin/Super only, like the rest of
// the Maker. Every change goes through `setProjectSharing`, the same
// checked path the share modal uses.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, data, redirect, useFetcher, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getHumans } from "robustness-core/data/humans.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { inviteToProject } from "../data/projectInvites.server";
import { Modal } from "stamps/Modal";
import { Input } from "stamps/Input";
import { getProjectSharing, listEveryProject, setProjectSharing } from "robustness-core/data/projectSharing.server";
import { GROUPS, GROUP_FEATURES, groupOf } from "robustness-core/data/features";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { link } from "stamps/link.css";
import { copyButton } from "stamps/copyField.css";
import { Grid } from "stamps/Grid";
import { SearchCollection } from "stamps/SearchCollection";
import { Select } from "stamps/Select";
import { useEffect, useState } from "react";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
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
  const byId = new Map((humans?.data ?? []).map((h) => [h._id as string, h]));
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
    // By project (Austin, 2026-09-28): who is on each, to pick from.
    projects: projects.map(({ folder, sharing }) => ({
      id: folder._id,
      name: folder.name,
      href: isWebsiteFolder(folder) ? `/vault?folder=${folder._id}` : `/newspaper/${folder._id}`,
      members: sharing.flatMap((e) => {
        const h = byId.get(e.human);
        return h ? [{ id: e.human, name: h.name || h.email, email: h.email, group: e.role }] : [];
      }),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  if (!isStaff(user.role)) throw data("Forbidden", { status: 403 });

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");

  // Someone with no account yet: invited onto the project as Client (the
  // welcome email and their account; `inviteToProject` checks first).
  if (form.get("intent") === "invite") {
    const project = projectId ? await getFolderById(projectId) : undefined;
    if (!project) return { error: "Not found" };
    const result = await inviteToProject(
      user,
      { email: String(form.get("email") ?? ""), name: String(form.get("name") ?? ""), project, role: "Client" },
      request,
    );
    return result.ok ? { ok: true, invited: result.human.email } : { error: result.error };
  }

  const humanId = String(form.get("humanId") ?? "");
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
type Project = ReturnType<typeof useLoaderData<typeof loader>>["projects"][number];

/** A name, and the email beside it unless the name is the email (someone
 * who hasn't set one). */
function NameAndEmail({ name, email }: { name: string; email: string }) {
  return (
    <span className={textSize.sm}>
      {name}
      {name !== email && (
        <>
          {" "}
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {email}
          </span>
        </>
      )}
    </span>
  );
}

/** The groups, and taking someone off, as the stamp dropdown's options. */
const GROUP_OPTIONS = [...GROUPS.map((g) => ({ value: g, label: g })), { value: "", label: "Remove" }];

/** The stamp `CopyField` action and a quiet link, as on the pen. */
const ACT = `btn-secondary ${copyButton}`;

/** One person's group on one project, changed in place. Taking them off
 * asks first, and says what goes with them: removal scraps what they
 * wrote on the project in the last day, and that can't be undone. */
function GroupSelect({
  humanId,
  projectId,
  group,
  personName,
  projectName,
}: {
  humanId: string;
  projectId: string;
  group: string;
  personName: string;
  projectName: string;
}) {
  const fetcher = useFetcher<typeof action>();
  const [confirming, setConfirming] = useState(false);
  const pending = fetcher.state !== "idle";
  const shown = pending ? String(fetcher.formData?.get("group") ?? group) : group;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const submit = (next: string) => fetcher.submit({ humanId, projectId, group: next }, { method: "post" });
  return (
    <div data-membership={`${humanId}:${projectId}`}>
      <Cluster gap={2} align="center">
        <Select
          label={`${personName} on ${projectName}`}
          hideLabel
          size="small"
          name="group"
          value={shown}
          disabled={pending}
          options={GROUP_OPTIONS}
          onChange={(e) => (e.target.value === "" ? setConfirming(true) : submit(e.target.value))}
        />
        {error && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {error}
          </span>
        )}
      </Cluster>
      <Modal open={confirming} onClose={() => setConfirming(false)} title={`Take ${personName} off ${projectName}?`}>
        <Stack gap={4}>
          <p className={textSize.sm}>
            What they wrote on {projectName} in the last day goes with them: their Card and their notes. Older days
            stay. This can't be undone.
          </p>
          <Cluster gap={3} align="center" style={{ justifyContent: "flex-end" }}>
            <button type="button" className={`${link} ${textSize.sm}`} style={{ background: "none", border: 0, cursor: "pointer" }} onClick={() => setConfirming(false)}>
              Keep them on
            </button>
            <button
              type="button"
              className={ACT}
              data-confirm-remove
              onClick={() => {
                setConfirming(false);
                submit("");
              }}
            >
              Take them off
            </button>
          </Cluster>
        </Stack>
      </Modal>
    </div>
  );
}

/** Someone with no account yet, typed in full: invited onto the project as
 * Client. They get the welcome email and an account. */
function InviteRow({ email, projectId, onInvited }: { email: string; projectId: string; onInvited: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const invited = !!fetcher.data && "invited" in fetcher.data;
  useEffect(() => {
    if (invited) onInvited();
  }, [invited, onInvited]);
  return (
    <fetcher.Form method="post" data-invite={projectId}>
      <input type="hidden" name="intent" value="invite" />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="email" value={email} />
      <Stack gap={2}>
        <span className={textSize.sm}>
          Nobody has <strong>{email}</strong> yet. Invite them as a Client:
        </span>
        <Cluster gap={2} align="center">
          <div style={{ flex: "1 1 160px" }}>
            <Input label="Their name" hideLabel name="name" placeholder="Their name" required />
          </div>
          <button type="submit" disabled={fetcher.state !== "idle"} className={ACT}>
            Invite
          </button>
        </Cluster>
        {error && (
          <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
            {error}
          </span>
        )}
      </Stack>
    </fetcher.Form>
  );
}

/** Someone found by the search, not on the project yet: added as Client,
 * the group that reaches least, then changed in the list if need be. */
function AddRow({ person, projectId, onAdded }: { person: Person; projectId: string; onAdded: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const added = !!fetcher.data && "ok" in fetcher.data;
  useEffect(() => {
    if (added) onAdded();
  }, [added, onAdded]);
  return (
    <fetcher.Form method="post" data-add={`${person.id}:${projectId}`}>
      <input type="hidden" name="humanId" value={person.id} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="group" value="Client" />
      <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
        <NameAndEmail name={person.name} email={person.email} />
        <Cluster gap={2} align="center">
          {error && (
            <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
              {error}
            </span>
          )}
          <button type="submit" disabled={fetcher.state !== "idle"} className={ACT}>
            Add
          </button>
        </Cluster>
      </Cluster>
    </fetcher.Form>
  );
}

/**
 * Who is on one project, as the stamp `SearchCollection`: the people on
 * it, each with their group, and the search underneath to find anyone
 * else and add them.
 */
function ProjectPeople({ project, everyone }: { project: Project; everyone: Person[] }) {
  const [query, setQuery] = useState("");
  const on = new Set(project.members.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? everyone.filter((p) => !on.has(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
    : [];
  // A whole email nobody has yet: offer the invite.
  const newEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) && !everyone.some((p) => p.email.toLowerCase() === q) ? q : null;
  const clear = () => setQuery("");
  const subtle = { color: semanticColors.textSubtle };
  return (
    <Stack gap={2} data-project={project.id}>
      <Link to={project.href} className={`${textSize.base} ${sprinkles({ fontWeight: "semibold" })}`} style={{ color: "inherit" }}>
        {project.name}
      </Link>
      <SearchCollection
        height={Math.min(280, 24 + Math.max(project.members.length, matches.length, 1) * 44)}
        searchInputProps={{
          label: `Add someone to ${project.name}`,
          name: `add-${project.id}`,
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "Add someone, or invite by email…",
        }}
        resultsSlot={
          q ? (
            <>
              {matches.map((p) => (
                <AddRow key={p.id} person={p} projectId={project.id} onAdded={clear} />
              ))}
              {newEmail && <InviteRow email={newEmail} projectId={project.id} onInvited={clear} />}
              {matches.length === 0 && !newEmail && (
                <p className={textSize.sm} style={subtle}>
                  Nobody else by that name or email. Type their whole email to invite them.
                </p>
              )}
            </>
          ) : project.members.length === 0 ? (
            <p className={textSize.sm} style={subtle}>
              Nobody yet.
            </p>
          ) : (
            project.members.map((m) => (
              <Cluster key={m.id} gap={3} align="center" style={{ justifyContent: "space-between" }}>
                <NameAndEmail name={m.name} email={m.email} />
                <GroupSelect humanId={m.id} projectId={project.id} group={m.group} personName={m.name} projectName={project.name} />
              </Cluster>
            ))
          )
        }
      />
    </Stack>
  );
}

export default function MakerHumans() {
  const { people, groups, projects } = useLoaderData<typeof loader>();
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

          <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>Projects</h2>
          <Grid minColumnWidth={340} gap={6}>
            {projects.map((p) => (
              <ProjectPeople key={p.id} project={p} everyone={people} />
            ))}
          </Grid>

          <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}>People</h2>
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
                      <Cluster key={p.id} gap={2} align="center">
                        <span className={textSize.sm}>{p.name}</span>
                        <GroupSelect humanId={person.id} projectId={p.id} group={p.group} personName={person.name} projectName={p.name} />
                      </Cluster>
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
