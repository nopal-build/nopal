// app/routes/org.tsx
//
// The Org tab: observed holidays, and named "meeting schedulers" built
// from one or more people's own "professor's hours"
// (`garden/3-growing/professors-hours-and-schedulers.md`). Office hours
// used to live here too, org-wide — superseded 2026-11-03: each Human
// now sets their own weekly availability on their own Profile page
// (`profile.tsx`'s Availability section, `humans.server.ts`'s
// `availability`/`setHumanAvailability`) instead of one shared schedule
// for the whole org. Holidays stay org-wide on purpose (everyone's
// closed the same days); a scheduler composes several people's own
// availability into one named, bookable set (e.g. "Potential Lead" =
// Lucas + Austin). Nothing computes real bookable slots yet — this page
// is purely where holidays/schedulers are defined and edited, feeding
// the larger scheduler chain (`garden/1-seeds/call-scheduler-test.md`,
// the `meet-a-guide-scheduler` bed).
//
// Gated the same way `guide-projects.tsx` gates "All Projects": a
// platform Admin/Super, or a Human who's specifically a Guide on the
// Nopal Organization (not just anyone guiding one project) — see
// `requireOrgAccess` below. The nav tab itself (`AppLayout.tsx`'s
// `showOrg`) uses the identical rule, fed by `navFor`'s `orgGuide` flag,
// so the tab and the page can't drift apart.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getHumans, isStaff, type Human } from "robustness-core/data/humans.server";
import {
  getOrganization,
  getOrganizationMembers,
  getOrganizationRole,
  setOrganizationHolidays,
  setOrganizationMemberRole,
  setOrganizationSchedulers,
  NOPAL_ORGANIZATION_ID,
  type MeetingScheduler,
  type OrganizationHoliday,
} from "robustness-core/data/organizations.server";
import { getOrgRootFolder } from "robustness-core/data/vault.server";
import { getCampsFolder, getFocusedCampFolderId, listCampsForAnchor } from "robustness-core/data/camps.server";
import { CampMap, type CampMapEntry } from "../components/CampMap";
import { newRecordId } from "robustness-core/data/generic.server";
import { withRequestPerf } from "robustness-core/data/requestPerf.server";
import type { Group } from "robustness-core/data/features";
import { navFor } from "../data/nav.server";
import { AppLayout } from "../components/AppLayout";
import { NameAndEmail } from "../components/ProjectPeople";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Surface } from "stamps/Surface";
import { Input } from "stamps/Input";
import { Select, type SelectOption } from "stamps/Select";
import { Badge } from "stamps/Badge";
import { Modal } from "stamps/Modal";
import { button } from "stamps/button.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import { ORG_TERM, ORG_TERM_SHORT } from "../data/orgBranding";

const DEFAULT_TITLE_NAME = ORG_TERM_SHORT;

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.organizationName} ${ORG_TERM}` : `${DEFAULT_TITLE_NAME} ${ORG_TERM}` },
];

const subtle = { color: semanticColors.textSubtle };
const subtleText = `${textSize.sm} ${sprinkles({ m: 0 })}`;

async function requireOrgAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  const allowed = isStaff(user) || (await getOrganizationRole(user._id)) === "Guide";
  if (!allowed) throw data("Forbidden — Guides only", { status: 403 });
  return user;
}

type OrgMember = { id: string; name: string; email: string; role: Group };
type SchedulerView = { id: string; name: string; members: OrgMember[] };

function asOrgMember(human: Human, role: Group): OrgMember {
  return { id: human._id, name: human.name || human.email, email: human.email, role };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireOrgAccess(request);
  const url = new URL(request.url);
  return withRequestPerf(
    { app: "fruits", route: url.pathname, method: request.method, humanId: user._id },
    async () => {
      const nav = await navFor(user._id);
      const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
      const holidays = [...(organization?.holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date));

      // Every Human, not just current org members — the "Add a Guide"
      // control needs to offer someone who isn't an org member at all yet
      // too (`setOrganizationMemberRole` adds them on the spot, same as
      // the backfill script's own one-time pass did for everyone else).
      const allHumans = (await getHumans())?.data ?? [];
      const humanById = new Map(allHumans.map((h) => [h._id, h]));

      const orgMemberships = await getOrganizationMembers(NOPAL_ORGANIZATION_ID);
      const roleByHumanId = new Map(orgMemberships.map((m) => [m.human_id, m.role]));
      const members: OrgMember[] = orgMemberships
        .map((m) => {
          const human = humanById.get(m.human_id);
          return human ? asOrgMember(human, m.role) : null;
        })
        .filter((m): m is OrgMember => !!m)
        .sort((a, b) => a.name.localeCompare(b.name));

      // Only a Guide reaches every project automatically and is eligible
      // for a meeting scheduler (see `action`'s own `add-scheduler-member`
      // guard) — everyone else on a scheduler would be a silent no-op for
      // booking purposes, so they're never offered there.
      const guides = members.filter((m) => m.role === "Guide");
      const guideIds = new Set(guides.map((g) => g.id));
      const addGuideCandidates: SelectOption[] = allHumans
        .filter((h) => !guideIds.has(h._id))
        .map((h) => ({ value: h._id, label: h.name ? `${h.name} (${h.email})` : h.email }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const schedulers: SchedulerView[] = (organization?.schedulers ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        members: s.humanIds
          .map((id) => humanById.get(id))
          .filter((h): h is Human => !!h)
          .map((h) => asOrgMember(h, roleByHumanId.get(h._id) ?? "Client")),
      }));

      // Camp Map (garden/3-growing/camps-and-log-books.md) — `null`
      // anchor/entries when the `org` Vault Root hasn't been provisioned
      // yet (the "Ensure Org Kanban Board" admin script hasn't run),
      // rather than failing the whole page.
      const orgRootFolder = await getOrgRootFolder(NOPAL_ORGANIZATION_ID);
      const camps = orgRootFolder ? await listCampsForAnchor(orgRootFolder) : [];
      const campsFolder = orgRootFolder ? await getCampsFolder(orgRootFolder) : undefined;
      const focusedCampFolderId = campsFolder ? await getFocusedCampFolderId(campsFolder) : null;
      const campMapEntries: CampMapEntry[] = camps.map((c) => ({
        folderId: c.folder._id,
        name: c.name,
        statement: c.statement,
        targetArrival: c.targetArrival,
        completed: c.completed,
      }));

      return {
        user: { name: user.name ?? null, email: user.email, role: user.role },
        ...nav,
        organizationName: organization?.name ?? DEFAULT_TITLE_NAME,
        isAdmin: isStaff(user),
        holidays,
        members,
        guides,
        addGuideCandidates,
        schedulers,
        campMapEntries,
        focusedCampFolderId,
        campsAnchorFolderId: orgRootFolder?._id ?? null,
        isGuide: guides.some((g) => g.id === user._id),
      };
    },
  );
}

type ActionResult =
  | {
      ok: true;
      intent:
        | "add-holiday"
        | "remove-holiday"
        | "create-scheduler"
        | "delete-scheduler"
        | "add-scheduler-member"
        | "remove-scheduler-member"
        | "add-guide"
        | "remove-guide";
    }
  | { ok: false; intent: string; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  const user = await requireOrgAccess(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "add-holiday") {
    const date = String(form.get("date") ?? "").trim();
    const endDate = String(form.get("endDate") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    if (!ISO_DATE.test(date)) return { ok: false, intent, error: "Pick a date" };
    if (endDate && !ISO_DATE.test(endDate)) return { ok: false, intent, error: "Pick a valid end date" };
    if (endDate && endDate < date) return { ok: false, intent, error: "End date must be on or after the start date" };
    if (!name) return { ok: false, intent, error: "Name the holiday" };
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const holidays: OrganizationHoliday[] = (organization?.holidays ?? []).filter((h) => h.date !== date);
    holidays.push({ date, name, ...(endDate && endDate !== date ? { endDate } : {}) });
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    await setOrganizationHolidays(holidays);
    return { ok: true, intent: "add-holiday" };
  }

  if (intent === "remove-holiday") {
    const date = String(form.get("date") ?? "");
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const holidays = (organization?.holidays ?? []).filter((h) => h.date !== date);
    await setOrganizationHolidays(holidays);
    return { ok: true, intent: "remove-holiday" };
  }

  if (intent === "create-scheduler") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { ok: false, intent, error: "Name the scheduler" };
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const schedulers: MeetingScheduler[] = [...(organization?.schedulers ?? []), { id: newRecordId(), name, humanIds: [] }];
    await setOrganizationSchedulers(schedulers);
    return { ok: true, intent: "create-scheduler" };
  }

  if (intent === "delete-scheduler") {
    const id = String(form.get("id") ?? "");
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const schedulers = (organization?.schedulers ?? []).filter((s) => s.id !== id);
    await setOrganizationSchedulers(schedulers);
    return { ok: true, intent: "delete-scheduler" };
  }

  if (intent === "add-scheduler-member") {
    const id = String(form.get("id") ?? "");
    const humanId = String(form.get("humanId") ?? "");
    if (!humanId) return { ok: false, intent, error: "Pick a person" };
    // Re-checked here, not just left to the UI only offering Guides in its
    // own dropdown (`AddSchedulerMemberForm`'s `options`) — only a Guide
    // reaches every project automatically and is meant to be bookable.
    if ((await getOrganizationRole(humanId, NOPAL_ORGANIZATION_ID)) !== "Guide") {
      return { ok: false, intent, error: "Only a Guide can be added to a scheduler" };
    }
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const schedulers = (organization?.schedulers ?? []).map((s) =>
      s.id === id && !s.humanIds.includes(humanId) ? { ...s, humanIds: [...s.humanIds, humanId] } : s,
    );
    await setOrganizationSchedulers(schedulers);
    return { ok: true, intent: "add-scheduler-member" };
  }

  if (intent === "remove-scheduler-member") {
    const id = String(form.get("id") ?? "");
    const humanId = String(form.get("humanId") ?? "");
    const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
    const schedulers = (organization?.schedulers ?? []).map((s) =>
      s.id === id ? { ...s, humanIds: s.humanIds.filter((h) => h !== humanId) } : s,
    );
    await setOrganizationSchedulers(schedulers);
    return { ok: true, intent: "remove-scheduler-member" };
  }

  if (intent === "add-guide" || intent === "remove-guide") {
    // Org-wide Guide is the single most powerful role here — it reaches
    // every project in the Organization automatically with no `sharing`
    // entry needed (Phase C, `garden/4-harvested/organizations.md`).
    // Same restriction project-level Sharing Roles already apply to
    // Guide specifically (ADR-024, `promotionRefusal` in
    // `projectSharing.server.ts`): only an admin grants or revokes it.
    if (!isStaff(user)) return { ok: false, intent, error: "Only an admin can add or remove a Guide" };
    const humanId = String(form.get("humanId") ?? "");
    if (!humanId) return { ok: false, intent, error: "Pick a person" };
    const role: Group = intent === "add-guide" ? "Guide" : "Client";
    await setOrganizationMemberRole(humanId, role, NOPAL_ORGANIZATION_ID);
    if (intent === "remove-guide") {
      // Keeps "only Guides are on a scheduler" true going forward — a
      // demoted Guide would otherwise linger on any scheduler they were
      // already added to.
      const organization = await getOrganization(NOPAL_ORGANIZATION_ID);
      const schedulers = (organization?.schedulers ?? []).map((s) => ({
        ...s,
        humanIds: s.humanIds.filter((id) => id !== humanId),
      }));
      await setOrganizationSchedulers(schedulers);
    }
    return { ok: true, intent };
  }

  return { ok: false, intent, error: "Unknown intent" };
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** A holiday's own date, or (optional) range — "November 27, 2026" or
 * "November 27, 2026 – November 29, 2026" when `endDate` differs. */
function formatHolidayRange(holiday: OrganizationHoliday): string {
  const end = holiday.endDate && holiday.endDate !== holiday.date ? holiday.endDate : null;
  return end ? `${formatDate(holiday.date)} – ${formatDate(end)}` : formatDate(holiday.date);
}

function HolidayRow({ holiday }: { holiday: OrganizationHoliday }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  return (
    <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
      <span className={textSize.sm}>
        {formatHolidayRange(holiday)} — {holiday.name}
      </span>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove-holiday" />
        <input type="hidden" name="date" value={holiday.date} />
        <button type="submit" className={`${button({ variant: "quiet" })} ${textSize.xs}`} disabled={pending}>
          Remove
        </button>
      </fetcher.Form>
    </Cluster>
  );
}

function AddHolidayForm() {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const result = fetcher.data?.intent === "add-holiday" ? fetcher.data : null;
  const error = result && !result.ok ? result.error : null;
  const added = result?.ok === true;
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (added) formRef.current?.reset();
  }, [added]);
  return (
    <fetcher.Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="add-holiday" />
      <Cluster gap={2} align="center">
        <Input type="date" label="Date" name="date" required />
        <span className={textSize.sm} style={subtle}>
          to
        </span>
        <Input type="date" label="End date (optional)" name="endDate" />
        <div style={{ flex: "1 1 160px" }}>
          <Input label="Holiday" name="name" placeholder="e.g. New Year's Day" required />
        </div>
        <button type="submit" className={button({ variant: "secondary", size: "compact" })} disabled={pending}>
          Add holiday
        </button>
      </Cluster>
      {error && (
        <p className={`${textSize.xs} ${sprinkles({ mt: 1.5 })}`} style={subtle}>
          {error}
        </p>
      )}
    </fetcher.Form>
  );
}

function SchedulerMemberRow({ schedulerId, member }: { schedulerId: string; member: OrgMember }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  return (
    <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
      <NameAndEmail name={member.name} email={member.email} />
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove-scheduler-member" />
        <input type="hidden" name="id" value={schedulerId} />
        <input type="hidden" name="humanId" value={member.id} />
        <button type="submit" className={`${button({ variant: "quiet" })} ${textSize.xs}`} disabled={pending}>
          Remove
        </button>
      </fetcher.Form>
    </Cluster>
  );
}

function AddSchedulerMemberForm({ schedulerId, options }: { schedulerId: string; options: SelectOption[] }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const [humanId, setHumanId] = useState("");
  const added = fetcher.data?.intent === "add-scheduler-member" && fetcher.data.ok === true;
  useEffect(() => {
    if (added) setHumanId("");
  }, [added]);
  if (options.length === 0) return null;
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="add-scheduler-member" />
      <input type="hidden" name="id" value={schedulerId} />
      <Cluster gap={2} align="center">
        <Select
          label="Add a person"
          hideLabel
          size="small"
          name="humanId"
          value={humanId}
          onChange={(e) => setHumanId(e.target.value)}
          placeholder="Add a person…"
          options={options}
        />
        <button type="submit" className={button({ variant: "secondary", size: "compact" })} disabled={pending || !humanId}>
          Add
        </button>
      </Cluster>
    </fetcher.Form>
  );
}

function SchedulerCard({ scheduler, guides }: { scheduler: SchedulerView; guides: OrgMember[] }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const memberIds = new Set(scheduler.members.map((m) => m.id));
  const options: SelectOption[] = guides
    .filter((m) => !memberIds.has(m.id))
    .map((m) => ({ value: m.id, label: m.name }));

  return (
    <Surface className={sprinkles({ p: 5 })}>
      <Stack gap={3}>
        <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
          <span className={`${textSize.base} ${sprinkles({ fontWeight: "bold" })}`}>{scheduler.name}</span>
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              if (!window.confirm(`Delete the "${scheduler.name}" scheduler? This can't be undone.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete-scheduler" />
            <input type="hidden" name="id" value={scheduler.id} />
            <button type="submit" className={`${button({ variant: "quiet" })} ${textSize.xs}`} disabled={pending}>
              Delete scheduler
            </button>
          </fetcher.Form>
        </Cluster>
        <Stack gap={2}>
          {scheduler.members.length === 0 ? (
            <p className={subtleText} style={subtle}>
              Nobody yet.
            </p>
          ) : (
            scheduler.members.map((m) => <SchedulerMemberRow key={m.id} schedulerId={scheduler.id} member={m} />)
          )}
        </Stack>
        <AddSchedulerMemberForm schedulerId={scheduler.id} options={options} />
      </Stack>
    </Surface>
  );
}

/** One row of the combined Organization members list: name/email, their
 * role as a `Badge`, and — for an admin viewing a current Guide — a
 * "Remove as Guide" action right there inline, rather than a second,
 * separate Guides-only list. `action`'s own `remove-guide` re-checks
 * `isStaff` regardless of whether this button is even rendered. */
function MemberRow({ member, isAdmin }: { member: OrgMember; isAdmin: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  return (
    <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
      <NameAndEmail name={member.name} email={member.email} />
      <Cluster gap={3} align="center">
        <Badge variant={member.role === "Guide" ? "accent" : "neutral"}>{member.role}</Badge>
        {isAdmin && member.role === "Guide" && (
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              if (!window.confirm(`Remove ${member.name} as a Guide? They'll come off every meeting scheduler too.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="remove-guide" />
            <input type="hidden" name="humanId" value={member.id} />
            <button type="submit" className={`${button({ variant: "quiet" })} ${textSize.xs}`} disabled={pending}>
              Remove as Guide
            </button>
          </fetcher.Form>
        )}
      </Cluster>
    </Cluster>
  );
}

/** Every current org member, combined into one listing — directly
 * answers "it's not clear who is currently a part of an organization",
 * and (for an admin) doubles as where a Guide gets removed; adding one
 * happens from the page header's "Add a Guide" button/modal instead,
 * since it can name someone not on this list at all yet. */
function MembersList({ members, isAdmin }: { members: OrgMember[]; isAdmin: boolean }) {
  if (members.length === 0) {
    return (
      <p className={subtleText} style={subtle}>
        None yet.
      </p>
    );
  }
  return (
    <Stack gap={2}>
      {members.map((m) => (
        <MemberRow key={m.id} member={m} isAdmin={isAdmin} />
      ))}
    </Stack>
  );
}

/** The page header's "Add a Guide" modal content — every Human not
 * already a Guide (including someone not an org member at all yet;
 * `setOrganizationMemberRole` adds them on the spot), picked from a
 * `Select` since the roster is small. Closes its own modal via `onAdded`
 * once the add actually succeeds. */
function AddGuideForm({ options, onAdded }: { options: SelectOption[]; onAdded: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const [humanId, setHumanId] = useState("");
  const result = fetcher.data?.intent === "add-guide" ? fetcher.data : null;
  const error = result && !result.ok ? result.error : null;
  const added = result?.ok === true;
  useEffect(() => {
    if (added) {
      setHumanId("");
      onAdded();
    }
  }, [added, onAdded]);
  if (options.length === 0) {
    return (
      <p className={subtleText} style={subtle}>
        Everyone is already a Guide.
      </p>
    );
  }
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="add-guide" />
      <Stack gap={3}>
        <Select
          label="Person"
          name="humanId"
          value={humanId}
          onChange={(e) => setHumanId(e.target.value)}
          placeholder="Pick a person…"
          options={options}
        />
        <Cluster gap={3} align="center">
          <button type="submit" className={button({ variant: "primary" })} disabled={pending || !humanId}>
            {pending ? "Adding…" : "Make Guide"}
          </button>
          {error && (
            <span className={textSize.xs} style={subtle}>
              {error}
            </span>
          )}
        </Cluster>
      </Stack>
    </fetcher.Form>
  );
}

function CreateSchedulerForm() {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const result = fetcher.data?.intent === "create-scheduler" ? fetcher.data : null;
  const error = result && !result.ok ? result.error : null;
  const added = result?.ok === true;
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (added) formRef.current?.reset();
  }, [added]);
  return (
    <fetcher.Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="create-scheduler" />
      <Cluster gap={2} align="center">
        <div style={{ flex: "1 1 220px" }}>
          <Input label="Scheduler name" hideLabel name="name" placeholder="e.g. Potential Lead" required />
        </div>
        <button type="submit" className={button({ variant: "secondary", size: "compact" })} disabled={pending}>
          New scheduler
        </button>
      </Cluster>
      {error && (
        <p className={`${textSize.xs} ${sprinkles({ mt: 1.5 })}`} style={subtle}>
          {error}
        </p>
      )}
    </fetcher.Form>
  );
}

export default function Org() {
  const {
    organizationName,
    isAdmin,
    isGuide,
    holidays,
    members,
    guides,
    addGuideCandidates,
    schedulers,
    campMapEntries,
    focusedCampFolderId,
    campsAnchorFolderId,
  } = useLoaderData<typeof loader>();

  const [addGuideOpen, setAddGuideOpen] = useState(false);
  const canManageCamps = isAdmin || isGuide;

  return (
    <AppLayout>
      <CenterContent maxWidth={680}>
        <Stack gap={8}>
          <Cluster gap={4} align="flex-start" style={{ justifyContent: "space-between" }}>
              <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>
                {organizationName} {ORG_TERM}
              </h1>
            {isAdmin && (
              <button type="button" className={button({ variant: "secondary" })} onClick={() => setAddGuideOpen(true)}>
                Add a Guide
              </button>
            )}
          </Cluster>

          {campsAnchorFolderId && (
            <CampMap
              camps={campMapEntries}
              focusedCampFolderId={focusedCampFolderId}
              newCampHref={canManageCamps ? `/camp/new?anchor=${campsAnchorFolderId}` : undefined}
            />
          )}

          <Modal open={addGuideOpen} onClose={() => setAddGuideOpen(false)} title="Add a Guide">
            <Stack gap={3}>
              <p className={subtleText} style={subtle}>
                A Guide reaches every project in {organizationName} automatically, and is the only role
                eligible for a meeting scheduler.
              </p>
              <AddGuideForm options={addGuideCandidates} onAdded={() => setAddGuideOpen(false)} />
            </Stack>
          </Modal>

          <Stack gap={3}>
            <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Members</h2>
            <Surface className={sprinkles({ p: 5 })}>
              <MembersList members={members} isAdmin={isAdmin} />
            </Surface>
          </Stack>

          <Stack gap={3}>
            <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Holidays</h2>
            <Surface className={sprinkles({ p: 5 })}>
              <Stack gap={4}>
                <Stack gap={2}>
                  {holidays.length === 0 ? (
                    <p className={subtleText} style={subtle}>
                      None yet.
                    </p>
                  ) : (
                    holidays.map((h) => <HolidayRow key={h.date} holiday={h} />)
                  )}
                </Stack>
                <AddHolidayForm />
              </Stack>
            </Surface>
          </Stack>

          <Stack gap={3}>
            <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Meeting schedulers</h2>
            <Stack gap={3}>
              {schedulers.map((s) => (
                <SchedulerCard key={s.id} scheduler={s} guides={guides} />
              ))}
              <CreateSchedulerForm />
            </Stack>
          </Stack>
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
