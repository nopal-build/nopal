// app/routes/camp.$campFolderId.tsx
//
// One Camp's detail page: its statement + target arrival (front matter),
// its freely-editable main content (`README.md`'s body — "no limit on
// edits," Gerald), Observations (the one thing that marks it complete),
// and its own Log Book. See `garden/3-growing/camps-and-log-books.md`.
//
// Gated the same two-tier way every other `api.vault.camps.*` route is:
// `canViewFolderOrgAware` to see it at all, `canActAsProjectOwner` (which
// already covers project Sharing Role, org Guide, or plain ownership —
// see `projectSharing.server.ts`) to edit it.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById, canViewFolderOrgAware } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import {
  getCamp,
  getLogBookFolder,
  listLogEntries,
  recordCampObservations,
  setCamp,
} from "robustness-core/data/camps.server";
import { AppLayout } from "../components/AppLayout";
import { LogBook, type LogBookEntrySummary } from "../components/LogBook";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Input } from "stamps/Input";
import { button } from "stamps/button.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.camp.statement ?? data.camp.name} · O.No` : "Camp · O.No" },
];

/** Walks up two levels (`camp-N` → `Camps` → the real anchor) to find
 * where "back" should go — the anchor itself, not the `Camps` grouping
 * folder in between. */
async function resolveBackLink(campFolder: { parent_folder_id?: string | null }) {
  const campsFolder = campFolder.parent_folder_id ? await getFolderById(campFolder.parent_folder_id) : undefined;
  const anchor = campsFolder?.parent_folder_id ? await getFolderById(campsFolder.parent_folder_id) : undefined;
  if (!anchor) return null;
  if (anchor.vault_root_key === "org") return "/org";
  if (anchor.folder_type === "project-n02") return `/newspaper/${anchor._id}`;
  return null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const campFolderId = params.campFolderId;
  if (!campFolderId) throw new Response("Not found", { status: 404 });

  const folder = await getFolderById(campFolderId);
  if (!folder) throw new Response("Not found", { status: 404 });
  if (!(await canViewFolderOrgAware(user._id, folder))) throw new Response("Not found", { status: 404 });

  const camp = await getCamp(campFolderId);
  if (!camp) throw new Response("Not found", { status: 404 });

  const canWrite = await canActAsProjectOwner(user._id, folder.human_id, folder._id);
  const backLink = await resolveBackLink(folder);

  const logBookFolder = await getLogBookFolder(folder);
  const entries: LogBookEntrySummary[] = logBookFolder
    ? (await listLogEntries(logBookFolder)).map((e) => ({
        folderId: e.folder._id,
        name: e.name,
        statement: e.statement,
        entryDate: e.entryDate,
        editedDate: e.editedDate,
      }))
    : [];

  return {
    camp: {
      folderId: camp.folder._id,
      name: camp.name,
      statement: camp.statement,
      targetArrival: camp.targetArrival,
      body: camp.body,
      completed: camp.completed,
      observations: camp.observations,
    },
    canWrite,
    backLink,
    entries,
  };
}

type ActionResult = { ok: true; intent: string } | { ok: false; intent: string; error: string };

export async function action({ request, params }: ActionFunctionArgs): Promise<ActionResult> {
  const user = await getUser(request);
  if (!user) return { ok: false, intent: "", error: "Not authenticated" };

  const campFolderId = params.campFolderId;
  if (!campFolderId) return { ok: false, intent: "", error: "Not found" };

  const folder = await getFolderById(campFolderId);
  if (!folder) return { ok: false, intent: "", error: "Not found" };
  if (!(await canActAsProjectOwner(user._id, folder.human_id, folder._id))) {
    return { ok: false, intent: "", error: "Not found" };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "update-camp") {
    const statement = String(form.get("statement") ?? "").trim();
    const targetArrival = String(form.get("targetArrival") ?? "").trim();
    const body = String(form.get("body") ?? "");
    if (!statement) return { ok: false, intent, error: "A statement is required" };
    if (!targetArrival) return { ok: false, intent, error: "A target arrival date is required" };
    await setCamp(campFolderId, { statement, targetArrival, body });
    return { ok: true, intent };
  }

  if (intent === "record-observations") {
    const statement = String(form.get("statement") ?? "").trim();
    const arrivalDate = String(form.get("arrivalDate") ?? "").trim();
    if (!statement) return { ok: false, intent, error: "A statement is required" };
    if (!arrivalDate) return { ok: false, intent, error: "An arrival date is required" };
    await recordCampObservations(campFolderId, statement, arrivalDate);
    return { ok: true, intent };
  }

  return { ok: false, intent, error: "Unknown intent" };
}

function CampDetailsForm({ camp, canWrite }: { camp: ReturnType<typeof useLoaderData<typeof loader>>["camp"]; canWrite: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const [statement, setStatement] = useState(camp.statement ?? "");
  const [targetArrival, setTargetArrival] = useState(camp.targetArrival ?? "");
  const [body, setBody] = useState(camp.body ?? "");
  const result = fetcher.data?.intent === "update-camp" ? fetcher.data : null;

  if (!canWrite) {
    return (
      <Stack gap={3}>
        <p className={`${textSize.base} ${sprinkles({ m: 0 })}`}>{camp.statement}</p>
        <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Target arrival: {camp.targetArrival ?? "?"}
        </span>
        {camp.body.trim() && (
          <p className={textSize.sm} style={{ whiteSpace: "pre-wrap" }}>
            {camp.body}
          </p>
        )}
      </Stack>
    );
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="update-camp" />
      <Stack gap={4}>
        <Input type="textarea" label="Statement" name="statement" value={statement} onChange={(e) => setStatement(e.target.value)} required />
        <Input type="date" label="Target arrival" name="targetArrival" value={targetArrival} onChange={(e) => setTargetArrival(e.target.value)} required />
        <Input type="textarea" label="Content" name="body" value={body} onChange={(e) => setBody(e.target.value)} />
        <Cluster gap={3} align="center">
          <button type="submit" className={button({ variant: "secondary" })} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {result && !result.ok && (
            <span className={textSize.xs} style={{ color: semanticColors.textDanger }}>
              {result.error}
            </span>
          )}
        </Cluster>
      </Stack>
    </fetcher.Form>
  );
}

function ObservationsSection({
  camp,
  canWrite,
}: {
  camp: ReturnType<typeof useLoaderData<typeof loader>>["camp"];
  canWrite: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const [open, setOpen] = useState(false);
  const result = fetcher.data?.intent === "record-observations" ? fetcher.data : null;
  const formRef = useRef<HTMLFormElement>(null);
  const succeeded = result?.ok === true;
  useEffect(() => {
    if (succeeded) setOpen(false);
  }, [succeeded]);

  return (
    <Surface className={sprinkles({ p: 5 })}>
      <Stack gap={3}>
        <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
          <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Observations</h2>
          {camp.completed && <Badge variant="success">Arrived</Badge>}
        </Cluster>
        {camp.observations ? (
          <Stack gap={1}>
            <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`}>{camp.observations.statement}</p>
            <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
              Arrived: {camp.observations.arrivalDate ?? "?"}
            </span>
          </Stack>
        ) : (
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            Not recorded yet — a camp is "complete" once Observations are recorded.
          </p>
        )}
        {canWrite && !open && (
          <div>
            <button type="button" className={`${button({ variant: "outline" })} ${textSize.xs}`} onClick={() => setOpen(true)}>
              {camp.observations ? "Edit Observations" : "Record Observations"}
            </button>
          </div>
        )}
        {canWrite && open && (
          <fetcher.Form method="post" ref={formRef}>
            <input type="hidden" name="intent" value="record-observations" />
            <Stack gap={3}>
              <Input
                type="textarea"
                label="Statement"
                name="statement"
                defaultValue={camp.observations?.statement ?? ""}
                required
              />
              <Input type="date" label="Arrival date" name="arrivalDate" defaultValue={camp.observations?.arrivalDate ?? ""} required />
              <Cluster gap={3} align="center">
                <button type="submit" className={button({ variant: "secondary" })} disabled={pending}>
                  {pending ? "Saving…" : "Save Observations"}
                </button>
                <button type="button" className={`${button({ variant: "quiet" })} ${textSize.xs}`} onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </Cluster>
              {result && !result.ok && (
                <span className={textSize.xs} style={{ color: semanticColors.textDanger }}>
                  {result.error}
                </span>
              )}
            </Stack>
          </fetcher.Form>
        )}
      </Stack>
    </Surface>
  );
}

export default function CampDetail() {
  const { camp, canWrite, backLink, entries } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  return (
    <AppLayout>
      <CenterContent maxWidth={880}>
        <Stack gap={6}>
          <Stack gap={2}>
            {backLink && (
              <Link to={backLink} className={textSize.xs} style={{ color: semanticColors.textSubtle, textDecoration: "none" }}>
                ← Back
              </Link>
            )}
            <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
              <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>{camp.statement ?? camp.name}</h1>
              {camp.completed && <Badge variant="success">Arrived</Badge>}
            </Cluster>
          </Stack>

          <Surface className={sprinkles({ p: 5 })}>
            <CampDetailsForm camp={camp} canWrite={canWrite} />
          </Surface>

          <ObservationsSection camp={camp} canWrite={canWrite} />

          <Stack gap={3}>
            <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Log Book</h2>
            <LogBook campFolderId={camp.folderId} entries={entries} canWrite={canWrite} onEntryAdded={() => revalidator.revalidate()} />
          </Stack>
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
