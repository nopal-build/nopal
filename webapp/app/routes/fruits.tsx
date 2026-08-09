// app/routes/fruits.tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Link } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "../components/Badge";
import { ensureVaultRootFolders, listFolderChildren } from "../data/vault.server";
import type { VaultFolder } from "../data/vault.types";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const roots = await ensureVaultRootFolders(user._id);
  const projectsRoot = roots.find((r) => r.vault_root_key === "projects");
  const projects: VaultFolder[] = projectsRoot
    ? (await listFolderChildren(user._id, projectsRoot._id)).folders
    : [];

  return { user, projects };
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="good-box p-5 block hover:opacity-80 transition-opacity"
      style={{ maxWidth: "420px", textDecoration: "none", color: "inherit" }}
    >
      <span className="font-bold text-sm">{label}</span>
    </Link>
  );
}

export default function Fruits() {
  const { user, projects } = useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12">
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="font-bold text-2xl mb-1">
            Hello, {user.name ?? user.email}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
            Welcome back.
          </p>
        </div>

        {/* In-development note */}
        <div className="good-box p-5 mb-10" style={{ maxWidth: "640px" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-bold text-sm">Status</span><Badge variant="warning">In Development</Badge>
          </div>
          <p className="text-sm subtle-text mb-3">
            This app seeks to answer the question &ldquo;how much project
            management can be done entirely by letting you journal about
            your day?&rdquo;
          </p>
          <p className="text-sm subtle-text mb-3">
            If you have feedback, please reach out to me directly at{" "}
            <a
              href="mailto:gerald@nopal.build"
              className="underline"
              style={{ color: "inherit" }}
            >
              gerald@nopal.build
            </a>
          </p>
          <p className="text-sm subtle-text mb-3">
                      Cheers,
                      <br />
                      -Gerald, Nopal Co-Founder and Engineer
                    </p>

                    <hr style={{ borderColor: "currentColor", opacity: 0.12 }} />

                    <details className="mt-3">
                      <summary className="text-sm font-bold cursor-pointer select-none">
                        Current Detailed Status
                      </summary>
                      <ul className="mt-3 text-sm subtle-text space-y-2">
                        <li>
                          <div className="flex items-center gap-2">
                            <Badge variant="danger">Unstable</Badge>
                            <span>Projects: Rework in progress.</span>
                          </div>
                        </li>
                      </ul>
                      <ul className="mt-8 text-sm subtle-text space-y-2">
                        <li className="flex items-center gap-2">
                          <Badge variant="success">Stable</Badge>
                          <span>Daily Logs: Journal on!</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Badge variant="success">Stable</Badge>
                          <span>Profile</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Badge variant="success">Stable</Badge>
                          <span>Security: You're safe</span>
                        </li>
                      </ul>
                    </details>
                  </div>

        {/* Quick links */}
        <div className="flex flex-col gap-4 mb-10">
          <QuickLink to="/fruits/daily-log" label="Daily Log" />
        </div>

        {/* Projects */}
        {projects.length > 0 && (
          <div>
            <h2 className="font-bold text-sm mb-3 subtle-text uppercase tracking-wide">
              Projects
            </h2>
            <div className="flex flex-col gap-3" style={{ maxWidth: "420px" }}>
              {projects.map((project) => (
                <QuickLink
                  key={project._id}
                  to={`/fruits/newspaper/${project._id}`}
                  label={project.name}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
