// app/components/ProjectPeople.tsx
// Who is on one project and how they get there (ADR-026): the people on
// it, each with their group changed in place; a search underneath to add
// anyone the viewer may pick from, in a group chosen as they're added; a
// whole email nobody has yet invites them. A pending invite shows like
// anyone else and can be withdrawn. Rendered by the project's page in the
// Maker and, one control at a time, by the admins' Humans page. Every
// form posts to `action`, whose server side is `peopleAction`.
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Group } from "robustness-core/data/features";
import { Badge } from "stamps/Badge";
import { Cluster } from "stamps/Cluster";
import { Input } from "stamps/Input";
import { Modal } from "stamps/Modal";
import { SearchCollection } from "stamps/SearchCollection";
import { Select } from "stamps/Select";
import { Stack } from "stamps/Stack";
import { copyButton } from "stamps/copyField.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import { textSize } from "stamps/typography.css";
import type { PeopleActionResult, PeopleProject, PersonRow } from "../data/projectPeople.server";

/** The stamp `CopyField` action and a quiet link, as on the pen. */
const ACT = `btn-secondary ${copyButton}`;
const subtle = { color: semanticColors.textSubtle };

/** A name, and the email beside it unless the name is the email (someone
 * who hasn't set one). */
export function NameAndEmail({ name, email }: { name: string; email: string }) {
  return (
    <span className={textSize.sm}>
      {name}
      {name !== email && (
        <>
          {" "}
          <span className={textSize.xs} style={subtle}>
            {email}
          </span>
        </>
      )}
    </span>
  );
}

const groupOptions = (groups: readonly Group[]) => groups.map((g) => ({ value: g, label: g }));

/** One person's group on one project, changed in place. Taking them off
 * asks first, and says what goes with them: removal scraps what they
 * wrote on the project in the last day, and that can't be undone. A group
 * the viewer can't give (Guide, for a Guide who isn't an admin) isn't
 * offered, but stays shown when it's what they already are. */
export function GroupSelect({
  humanId,
  projectId,
  group,
  personName,
  projectName,
  groups,
  action,
}: {
  humanId: string;
  projectId: string;
  group: string;
  personName: string;
  projectName: string;
  groups: readonly Group[];
  action: string;
}) {
  const fetcher = useFetcher<PeopleActionResult>();
  const [confirming, setConfirming] = useState(false);
  const pending = fetcher.state !== "idle";
  const shown = pending ? String(fetcher.formData?.get("group") ?? group) : group;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const submit = (next: string) => fetcher.submit({ humanId, projectId, group: next }, { method: "post", action });
  const options = [
    ...(groups.includes(group as Group) ? [] : [{ value: group, label: group, disabled: true }]),
    ...groupOptions(groups),
    { value: "", label: "Remove" },
  ];
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
          options={options}
          onChange={(e) => (e.target.value === "" ? setConfirming(true) : submit(e.target.value))}
        />
        {error && (
          <span className={textSize.xs} style={subtle}>
            {error}
          </span>
        )}
      </Cluster>
      <Modal open={confirming} onClose={() => setConfirming(false)} title={`Take ${personName} off ${projectName}?`}>
        <Stack gap={4}>
          <p className={textSize.sm}>
            Their last day's Card and notes go with them. This can't be undone.
          </p>
          <Cluster gap={3} align="center" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className={`${link} ${textSize.sm}`}
              style={{ background: "none", border: 0, cursor: "pointer" }}
              onClick={() => setConfirming(false)}
            >
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

/** A pending invite, withdrawn: off the project, and their link stops
 * working. Asks first. */
function WithdrawInvite({
  humanId,
  projectId,
  personName,
  action,
}: {
  humanId: string;
  projectId: string;
  personName: string;
  action: string;
}) {
  const fetcher = useFetcher<PeopleActionResult>();
  const [confirming, setConfirming] = useState(false);
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <>
      <Cluster gap={2} align="center">
        <Badge>Invited</Badge>
        <button
          type="button"
          className={`${link} ${textSize.xs}`}
          style={{ background: "none", border: 0, cursor: "pointer" }}
          disabled={fetcher.state !== "idle"}
          onClick={() => setConfirming(true)}
          data-withdraw={humanId}
        >
          Withdraw
        </button>
        {error && (
          <span className={textSize.xs} style={subtle}>
            {error}
          </span>
        )}
      </Cluster>
      <Modal open={confirming} onClose={() => setConfirming(false)} title={`Withdraw ${personName}'s invite?`}>
        <Stack gap={4}>
          <p className={textSize.sm}>Their invite link stops working.</p>
          <Cluster gap={3} align="center" style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className={`${link} ${textSize.sm}`}
              style={{ background: "none", border: 0, cursor: "pointer" }}
              onClick={() => setConfirming(false)}
            >
              Keep the invite
            </button>
            <button
              type="button"
              className={ACT}
              data-confirm-withdraw
              onClick={() => {
                setConfirming(false);
                fetcher.submit({ intent: "withdraw", humanId, projectId }, { method: "post", action });
              }}
            >
              Withdraw
            </button>
          </Cluster>
        </Stack>
      </Modal>
    </>
  );
}

/** Someone with no account yet, typed in full: invited onto the project in
 * the group chosen. They get the welcome email and an account. (An email
 * that does have an account, outside the viewer's list, is just added.) */
function InviteRow({
  email,
  projectId,
  groups,
  action,
  onInvited,
}: {
  email: string;
  projectId: string;
  groups: readonly Group[];
  action: string;
  onInvited: () => void;
}) {
  const fetcher = useFetcher<PeopleActionResult>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const invited = !!fetcher.data && "invited" in fetcher.data;
  useEffect(() => {
    if (invited) onInvited();
  }, [invited, onInvited]);
  return (
    <fetcher.Form method="post" action={action} data-invite={projectId}>
      <input type="hidden" name="intent" value="invite" />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="email" value={email} />
      <Stack gap={2}>
        <span className={textSize.sm}>
          Invite <strong>{email}</strong> as:
        </span>
        <Cluster gap={2} align="center">
          <div style={{ flex: "1 1 160px" }}>
            <Input label="Their name" hideLabel name="name" placeholder="Their name" required />
          </div>
          <Select label="Their group" hideLabel size="small" name="group" defaultValue="Client" options={groupOptions(groups)} />
          <button type="submit" disabled={fetcher.state !== "idle"} className={ACT}>
            Invite
          </button>
        </Cluster>
        {error && (
          <span className={textSize.xs} style={subtle}>
            {error}
          </span>
        )}
      </Stack>
    </fetcher.Form>
  );
}

/** Someone found by the search, not on the project yet: added in the
 * group chosen beside the button. Client, the group that reaches least,
 * is the default. */
function AddRow({
  person,
  projectId,
  groups,
  action,
  onAdded,
}: {
  person: PersonRow;
  projectId: string;
  groups: readonly Group[];
  action: string;
  onAdded: () => void;
}) {
  const fetcher = useFetcher<PeopleActionResult>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const added = !!fetcher.data && "ok" in fetcher.data;
  useEffect(() => {
    if (added) onAdded();
  }, [added, onAdded]);
  return (
    <fetcher.Form method="post" action={action} data-add={`${person.id}:${projectId}`}>
      <input type="hidden" name="humanId" value={person.id} />
      <input type="hidden" name="projectId" value={projectId} />
      <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
        <NameAndEmail name={person.name} email={person.email} />
        <Cluster gap={2} align="center">
          {error && (
            <span className={textSize.xs} style={subtle}>
              {error}
            </span>
          )}
          <Select
            label={`${person.name}'s group`}
            hideLabel
            size="small"
            name="group"
            defaultValue="Client"
            options={groupOptions(groups)}
          />
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
 * else and add them. `groups` is what this viewer may give.
 */
export function ProjectPeople({
  project,
  everyone,
  groups,
  action,
}: {
  project: PeopleProject;
  everyone: PersonRow[];
  groups: readonly Group[];
  action: string;
}) {
  const [query, setQuery] = useState("");
  const on = new Set(project.members.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? everyone.filter((p) => !on.has(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
    : [];
  // A whole email nobody in the list has: offer the invite.
  const newEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) && !everyone.some((p) => p.email.toLowerCase() === q) ? q : null;
  const clear = () => setQuery("");
  return (
    <Stack gap={2} data-project={project.id}>
      <SearchCollection
        // Sized to what's showing: the members, or the matches (an invite
        // row is two lines), never the taller of the two.
        height={Math.min(320, 24 + Math.max(q ? matches.length + (newEmail ? 2 : 0) : project.members.length, 1) * 48)}
        searchInputProps={{
          label: `Add someone to ${project.name}`,
          name: `add-${project.id}`,
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "Add or invite by email…",
        }}
        resultsSlot={
          q ? (
            <>
              {matches.map((p) => (
                <AddRow key={p.id} person={p} projectId={project.id} groups={groups} action={action} onAdded={clear} />
              ))}
              {newEmail && <InviteRow email={newEmail} projectId={project.id} groups={groups} action={action} onInvited={clear} />}
              {matches.length === 0 && !newEmail && (
                <p className={textSize.sm} style={subtle}>
                  No match. Type a full email to invite someone.
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
                <Cluster gap={3} align="center">
                  {m.invited && <WithdrawInvite humanId={m.id} projectId={project.id} personName={m.name} action={action} />}
                  <GroupSelect
                    humanId={m.id}
                    projectId={project.id}
                    group={m.group}
                    personName={m.name}
                    projectName={project.name}
                    groups={groups}
                    action={action}
                  />
                </Cluster>
              </Cluster>
            ))
          )
        }
      />
    </Stack>
  );
}
