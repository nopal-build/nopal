// app/routes/maker_.projects_.$folderId_.billing.tsx → /maker/projects/:id/billing
// A project's billing, for its Guide (payments seed): raise a one-time
// charge for someone on the project, copy its pay link to send them, see
// whether it's paid, withdraw one nobody has paid. The guide sends the
// link; O.No doesn't email it, so the ask comes from a person. Same
// access as the people page: the project's Guide or an admin, else 404.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, redirect, useFetcher, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { peopleOn, runsPeople } from "../data/projectPeople.server";
import { navFor } from "../data/nav.server";
import {
  cancelCharge,
  createCharge,
  getCharge,
  listChargesForProject,
  type BillingCharge,
} from "robustness-core/data/billing.server";
import {
  ONE_TIME_KINDS,
  ONE_TIME_LABELS,
  formatUsd,
  isOneTimeKind,
  parseUsdToCents,
} from "robustness-core/data/billingRules";
import { stripeConfigured } from "robustness-core/data/stripe.server";
import { AppLayout } from "../components/AppLayout";
import { MakerErrorBoundary } from "../components/MakerErrorBoundary";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { CopyField } from "stamps/CopyField";
import { Input } from "stamps/Input";
import { Select } from "stamps/Select";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { button } from "stamps/button.css";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · Billing" }];

async function guidedFolder(request: Request, folderId: string | undefined) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  const folder = folderId ? await getFolderById(folderId) : undefined;
  if (!folder || !(await runsPeople(user, folder))) throw data("Not found", { status: 404 });
  return { user, folder };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, folder } = await guidedFolder(request, params.folderId);
  const [project, charges, nav] = await Promise.all([
    peopleOn(folder),
    listChargesForProject(folder._id),
    navFor(user._id),
  ]);
  const names = new Map(project.members.map((m) => [m.id, m.name]));
  const origin = new URL(request.url).origin;
  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    ...nav,
    project: { id: project.id, name: project.name },
    // Anyone on the project can be the one who pays; Clients first.
    payers: [...project.members]
      .sort((a, b) => Number(b.group === "Client") - Number(a.group === "Client"))
      .map((m) => ({ value: m.id, label: `${m.name} (${m.group})` })),
    charges: charges.map((c) => ({
      id: c._id,
      label: c.label,
      amount: formatUsd(c.amount_cents),
      status: c.status,
      payer: names.get(c.payer_human_id) ?? "someone no longer on the project",
      payLink: `${origin}/pay/${c._id}`,
      createdAt: c.created_at,
    })),
    configured: stripeConfigured(),
  };
}

type ActionResult = { ok: true } | { error: string };

export async function action({ request, params }: ActionFunctionArgs): Promise<ActionResult> {
  const { user, folder } = await guidedFolder(request, params.folderId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "charge") {
    const kind = form.get("kind");
    const payerHumanId = String(form.get("payer") ?? "");
    if (!isOneTimeKind(kind)) return { error: "Pick what the charge is for." };
    const project = await peopleOn(folder);
    if (!project.members.some((m) => m.id === payerHumanId)) return { error: "Pick who pays from the people on this project." };
    let customAmountCents: number | null = null;
    if (kind === "custom") {
      customAmountCents = parseUsdToCents(String(form.get("amount") ?? ""));
      if (!customAmountCents) return { error: "Type an amount in dollars, like 1000." };
    }
    try {
      await createCharge({
        projectFolderId: folder._id,
        payerHumanId,
        createdBy: user._id,
        kind,
        customAmountCents,
        note: String(form.get("note") ?? ""),
      });
    } catch (err) {
      console.error("billing: create charge failed", err);
      return { error: "Stripe didn't take that. Check the setup and try again." };
    }
    return { ok: true };
  }

  if (intent === "withdraw") {
    const charge = await getCharge(String(form.get("chargeId") ?? ""));
    if (!charge || charge.project_folder_id !== folder._id) return { error: "That charge isn't on this project." };
    try {
      await cancelCharge(charge);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't withdraw it." };
    }
    return { ok: true };
  }

  return { error: "Unknown action." };
}

export function ErrorBoundary() {
  return <MakerErrorBoundary notFound="Not a project you guide." backTo={{ to: "/maker/projects", label: "← Projects and humans" }} />;
}

const STATUS_LABEL: Record<BillingCharge["status"], string> = {
  open: "Waiting",
  processing: "Paying (bank transfer clears in a few days)",
  paid: "Paid",
  failed: "Payment failed",
  canceled: "Withdrawn",
};

function NewCharge({ payers }: { payers: { value: string; label: string }[] }) {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="charge" />
      <Stack gap={3}>
        <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Charge once</h2>
        <Select label="Who pays" name="payer" options={payers} placeholder="Someone on the project" required />
        <Select
          label="For"
          name="kind"
          options={ONE_TIME_KINDS.map((k) => ({ value: k, label: ONE_TIME_LABELS[k] }))}
          defaultValue="custom"
          required
        />
        <Input label="Amount, for a custom charge (dollars)" name="amount" placeholder="1000" />
        <Input label="What it's for, as they'll see it (optional)" name="note" placeholder="Attic assembly report" />
        {error && (
          <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
            {error}
          </p>
        )}
        <Cluster gap={3}>
          <button type="submit" className={button({ variant: "secondary" })} disabled={busy}>
            {busy ? "Making the link…" : "Make a pay link"}
          </button>
        </Cluster>
      </Stack>
    </fetcher.Form>
  );
}

function ChargeRow({ charge }: { charge: ReturnType<typeof useLoaderData<typeof loader>>["charges"][number] }) {
  const fetcher = useFetcher<ActionResult>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const unpaid = charge.status === "open" || charge.status === "failed";
  return (
    <Stack gap={2}>
      <Cluster gap={3} align="baseline">
        <strong>{charge.amount}</strong>
        <span>{charge.label}</span>
        <span className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          {charge.payer}
        </span>
        <Badge>{STATUS_LABEL[charge.status]}</Badge>
      </Cluster>
      {unpaid && (
        <Cluster gap={3} align="center">
          <CopyField value={charge.payLink} ariaLabel={`Pay link for ${charge.label}`} copyLabel="Copy link" />
          <button
            type="button"
            className={`${link} ${textSize.xs}`}
            disabled={fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "withdraw", chargeId: charge.id }, { method: "post" })}
          >
            Withdraw
          </button>
        </Cluster>
      )}
      {error && (
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textDanger }}>
          {error}
        </p>
      )}
    </Stack>
  );
}

export default function ProjectBilling() {
  const { project, payers, charges, configured } = useLoaderData<typeof loader>();
  return (
    <AppLayout>
      <CenterContent maxWidth={720}>
        <Stack gap={6} className={sprinkles({ mb: 8 })}>
          <Link to={`/maker/projects/${project.id}`} className={`${link} ${textSize.xs}`}>
            ← {project.name}
          </Link>
          <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Billing</h1>

          {!configured ? (
            <p className={textSize.sm}>Stripe isn't set up on this server yet.</p>
          ) : (
            <Surface className={sprinkles({ p: 4 })}>
              <NewCharge payers={payers} />
            </Surface>
          )}

          {charges.length > 0 && (
            <Stack gap={4}>
              {charges.map((c) => (
                <ChargeRow key={c.id} charge={c} />
              ))}
            </Stack>
          )}
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
