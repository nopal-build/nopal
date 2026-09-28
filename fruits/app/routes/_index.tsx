// app/routes/_index.tsx: the dashboard, the screen everyone lands on.
//
// My Projects: the projects, nothing else (Austin, 2026-09-28): the log
// is on the Daily Log page and the meter on each project's page. Each
// project shows what the system gives back, the way the viewer's role
// there shows it (ADR-023). Everything the page shows comes from
// `loadDashboard`; what it leaves out never reaches the browser.
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "stamps/Badge";
import { Chip } from "stamps/Chip";
import { MoreMenu } from "stamps/MoreMenu";
import { DashboardView } from "../components/DashboardView";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { listProjectsFor } from "robustness-core/data/projectSharing.server";
import { navFor } from "../data/nav.server";
import { loadDashboard } from "robustness-core/data/dashboard.server";
import {
  DEFAULT_PROJECT_STATUS,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "robustness-core/data/project.types";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const activeStatus: ProjectStatus = PROJECT_STATUSES.includes(
    statusParam as ProjectStatus,
  )
    ? (statusParam as ProjectStatus)
    : DEFAULT_PROJECT_STATUS;

  // Every project the person holds a role on (ADR-023): what the dashboard
  // arranges.
  const memberships = await listProjectsFor(user._id);
  const nav = await navFor(user._id, memberships);
  // One project: My Project is the project itself.
  if (nav.home.projectId) return redirect(`/newspaper/${nav.home.projectId}`);

  const dashboard = await loadDashboard(user._id, activeStatus, memberships);

  return {
    // `role` too: the nav reads it through `useUser()` (without it the
    // Maker link hid itself for admins here).
    user: { name: user.name ?? null, email: user.email, role: user.role },
    // The nav reads these (`useVaultHidden`, `useHome`).
    ...nav,
    activeStatus,
    dashboard,
  };
}

// ─── App status ─────────────────────────────────────────────────────────────

function AppStatusMenu() {
  const para = textSize.sm;
  const subtle = { color: semanticColors.textSubtle } as const;
  const statusLine = (variant: "danger" | "success", label: string, text: string) => (
    <Cluster gap={2} role="listitem">
      <Badge variant={variant}>{label}</Badge>
      <span>{text}</span>
    </Cluster>
  );
  return (
    <MoreMenu
      label="App status"
      trigger={({ toggle, open }) => (
        <Chip active={open} onClick={toggle} className={sprinkles({ whiteSpace: "nowrap" })}>
          App Status: In Development
        </Chip>
      )}
    >
      {() => (
        <Stack gap={3} style={{ width: "320px", padding: "10px 12px" }}>
          <Cluster gap={2}>
            <Badge variant="warning">In Development</Badge>
            <span className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>Nopal is under active development</span>
          </Cluster>
          <p className={para} style={subtle}>
            This app seeks to answer the question &ldquo;how much project
            management can be done entirely by letting you journal about
            your day?&rdquo;
          </p>
          <p className={para} style={subtle}>
            If you have feedback, please reach out to me directly at{" "}
            <a href="mailto:gerald@nopal.build" style={{ color: "inherit", textDecoration: "underline" }}>
              gerald@nopal.build
            </a>
          </p>
          <p className={para} style={subtle}>
            Cheers,
            <br />
            -Gerald, Nopal Co-Founder and Engineer
          </p>

          <hr style={{ borderColor: "currentColor", opacity: 0.12, margin: "4px 0 0" }} />

          <details>
            <summary
              className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              Current Detailed Status
            </summary>
            <Stack gap={4} className={`${textSize.sm} ${sprinkles({ mt: 3 })}`} style={subtle}>
              <Stack gap={2} role="list">
                {statusLine("danger", "Unstable", "Projects: Rework in progress.")}
              </Stack>
              <Stack gap={2} role="list">
                {statusLine("success", "Stable", "Daily Logs: Journal on!")}
                {statusLine("success", "Stable", "Profile")}
                {statusLine("success", "Stable", "Security: You're safe")}
              </Stack>
            </Stack>
          </details>
        </Stack>
      )}
    </MoreMenu>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, activeStatus, dashboard } = useLoaderData<typeof loader>();
  return (
    <AppLayout>
      <CenterContent maxWidth={860}>
        <Stack gap={8}>
          <Cluster gap={4} align="flex-start" style={{ justifyContent: "space-between" }}>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>
              Hello, {user.name ?? user.email}
            </h1>
            <AppStatusMenu />
          </Cluster>
          <DashboardView activeStatus={activeStatus} dashboard={dashboard} />
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
