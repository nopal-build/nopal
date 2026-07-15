// app/routes/fruits.tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Link } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  return { user };
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
  const { user } = useLoaderData<typeof loader>();

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
        <div className="flex flex-col gap-4">
          <QuickLink to="/fruits/daily-log" label="Daily Log" />
          <QuickLink to="/fruits/vault" label="Vault" />
        </div>
      </div>
    </AppLayout>
  );
}
