// app/routes/maker_.payments.tsx → /maker/payments
// A guide's ledger of payments (payments seed, Austin 2026-11-03: "a
// ledger of recent payments and where they went"): what needs them, what's
// due in the next 60 days, and what came in, newest first. Read only: each
// row links to its project's Maker page, the one place a guide acts on
// billing. A Guide sees the projects they guide; an admin sees every
// project. Anyone else is refused, as on the Maker list.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { guidesAny, listEveryProject, listProjectsFor, resolveRole } from "robustness-core/data/projectSharing.server";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
import { listChargesForProjects } from "robustness-core/data/billing.server";
import { formatUsd } from "robustness-core/data/billingRules";
import { listPlans } from "robustness-core/data/billingPlans.server";
import { billingDate } from "../data/billingNotices.server";
import { loadLedger, UPCOMING_DAYS } from "../data/paymentsLedger.server";
import type { LedgerRow, LedgerState } from "../data/paymentsLedger.server";
import { navFor } from "../data/nav.server";
import { isStaff } from "../data/projectPeople.server";
import { AppLayout } from "../components/AppLayout";
import { MakerErrorBoundary } from "../components/MakerErrorBoundary";
import { Badge } from "stamps/Badge";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export const meta: MetaFunction = () => [{ title: "O.No · M.Payments" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const staff = isStaff(user);
  const memberships = await listProjectsFor(user._id);
  if (!staff && !guidesAny(memberships)) throw data("Forbidden", { status: 403 });

  const folders = (staff ? await listEveryProject() : memberships.filter((m) => resolveRole(m.role).guiding))
    .map((p) => p.folder)
    .filter((f) => !isWebsiteFolder(f));
  const ids = folders.map((f) => f._id);
  const [charges, plans] = await Promise.all([listChargesForProjects(ids), listPlans(ids)]);
  const ledger = await loadLedger({ projects: folders.map((f) => ({ id: f._id, name: f.name })), charges, plans });
  const view = (r: LedgerRow) => ({ ...r, date: billingDate(r.at), amount: r.amountCents == null ? null : formatUsd(r.amountCents) });

  return {
    user: { name: user.name ?? null, email: user.email, role: user.role },
    ...(await navFor(user._id)),
    needsYou: ledger.needsYou.map(view),
    upcoming: ledger.upcoming.map(view),
    recent: ledger.recent.map(view),
    upcomingDays: UPCOMING_DAYS,
  };
}

export function ErrorBoundary() {
  return <MakerErrorBoundary notFound="Nothing here." backTo={{ to: "/maker", label: "← Maker" }} />;
}

const STATE_LABEL: Record<LedgerState, string> = {
  hold: "Work on hold",
  failed: "Didn't go through",
  resume: "Approve on the project",
  waiting: "Sent, waiting",
  due: "Debit due",
  awaiting_bank: "Waiting for a bank link",
  paid: "Paid",
  clearing: "Clearing",
};

type RowView = LedgerRow & { date: string; amount: string | null };

function Section({ title, rows, empty }: { title: string; rows: RowView[]; empty: string | null }) {
  const subtle = { color: semanticColors.textSubtle };
  if (rows.length === 0 && empty === null) return null;
  return (
    <Stack gap={3}>
      <h2 className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>{title}</h2>
      {rows.length === 0 ? (
        <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={subtle}>
          {empty}
        </p>
      ) : (
        <Surface className={sprinkles({ p: 4 })}>
          <Stack gap={3}>
            {rows.map((r) => (
              <Cluster key={r.key} gap={3} align="baseline" style={{ justifyContent: "space-between" }}>
                <Cluster gap={3} align="baseline">
                  <span className={textSize.sm} style={{ ...subtle, minWidth: "5.5em" }}>
                    {r.date}
                  </span>
                  <Link to={`/maker/projects/${r.projectId}`} className={`${link} ${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>
                    {r.project}
                  </Link>
                  <span className={textSize.sm}>{r.what}</span>
                  {r.note && (
                    <span className={textSize.sm} style={subtle}>
                      {r.note}
                    </span>
                  )}
                  {r.who && (
                    <span className={textSize.sm} style={subtle}>
                      {r.state === "paid" || r.state === "clearing" ? `paid by ${r.who}` : r.who}
                    </span>
                  )}
                </Cluster>
                <Cluster gap={3} align="baseline">
                  <Badge>{STATE_LABEL[r.state]}</Badge>
                  {r.amount && <strong className={textSize.sm}>{r.amount}</strong>}
                </Cluster>
              </Cluster>
            ))}
          </Stack>
        </Surface>
      )}
    </Stack>
  );
}

export default function MakerPayments() {
  const { needsYou, upcoming, recent, upcomingDays } = useLoaderData<typeof loader>();
  return (
    <AppLayout>
      <CenterContent maxWidth={820}>
        <Stack gap={6} className={sprinkles({ mb: 8 })}>
          <Stack gap={1}>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>Payments</h1>
            <p className={`${textSize.sm} ${sprinkles({ m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
              To bill a project or change its plan, open it.
            </p>
          </Stack>
          <Section title="Needs you" rows={needsYou} empty={null} />
          <Section title="Upcoming" rows={upcoming} empty={`Nothing due in the next ${upcomingDays} days.`} />
          <Section title="Recent" rows={recent} empty="No payments yet." />
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
