// app/routes/fruits.tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Link } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
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

        {/* Quick links */}
        <div className="flex flex-col gap-4 mb-10">
          <QuickLink to="/fruits/daily-log" label="Daily Log" />
          <QuickLink to="/fruits/daily-log-v2" label="Daily Log v2 (cards mockup)" />
          <QuickLink to="/fruits/vault" label="Vault" />
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
                  to={`/fruits/projects/${project._id}`}
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
