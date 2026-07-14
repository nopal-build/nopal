// app/routes/fruits_.profile.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  Form,
  Link,
} from "react-router";
import { getUser, updateUserSession } from "../modules/auth/auth.server";
import { getHumanByEmail, updateHuman } from "../data/humans.server";
import {
  getLegalDocumentsByEmail,
  type LegalDocumentRecord,
} from "../data/legalDocuments.server";
import { AppLayout } from "../components/AppLayout";
import { Input } from "../components/Input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const waivers = await getLegalDocumentsByEmail(user.email);
  return { user, waivers };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!name) return data({ error: "Name is required." }, { status: 400 });
  if (!email || !EMAIL_RE.test(email)) {
    return data({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (email !== user.email) {
    const existing = await getHumanByEmail(email);
    if (existing && existing._id !== user._id) {
      return data(
        { error: "That email is already in use by another account." },
        { status: 400 },
      );
    }
  }

  const updated = await updateHuman(user._id, {
    name,
    email,
    role: user.role,
  });
  if (!updated) {
    return data({ error: "Failed to update profile." }, { status: 500 });
  }

  const setCookie = await updateUserSession(request, updated);
  return data(
    { success: true, user: updated },
    { headers: { "Set-Cookie": setCookie } },
  );
}

function formatSignedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function WaiverCard({ doc }: { doc: LegalDocumentRecord }) {
  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-bold">Signed workers' comp waiver</div>
        <div style={{ color: "var(--text-subtle)" }}>
          Signed {formatSignedAt(doc.signed_at)}
        </div>
      </div>
      <a
        href={doc.s3_url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-mono purple-light-text shrink-0"
        style={{ textDecoration: "none" }}
      >
        Download →
      </a>
    </div>
  );
}

export default function Profile() {
  const { user, waivers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const displayUser =
    actionData && "success" in actionData ? actionData.user : user;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
        <h1 className="font-bold text-2xl mb-1">Personal Profile</h1>
        <p className="text-sm mb-8" style={{ color: "var(--text-subtle)" }}>
          Update your name and email address.
        </p>

        <Form method="post" className="flex flex-col gap-4 good-box p-4">
          <Input
            label="Name"
            name="name"
            defaultValue={displayUser.name}
            required
            placeholder="Your name"
          />
          <Input
            label="Email"
            name="email"
            defaultValue={displayUser.email}
            required
            placeholder="you@nature.yeah"
          />

          {actionData && "error" in actionData && (
            <div className="red-text text-sm">{actionData.error}</div>
          )}
          {actionData && "success" in actionData && (
            <div className="text-sm" style={{ color: "var(--green)" }}>
              Profile updated.
            </div>
          )}

          <div className="text-right">
            <button className="btn-secondary" type="submit">
              Save Changes
            </button>
          </div>
        </Form>

        <div className="mt-10">
          <h2 className="font-bold text-lg mb-1">Workers' Comp Waiver</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-subtle)" }}>
            {waivers.length > 0
              ? "Here's your signed waiver. You can sign a new one at any time."
              : "You haven't signed a workers' compensation waiver yet."}
          </p>

          {waivers.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {waivers.map((doc) => (
                <WaiverCard key={doc.s3_key} doc={doc} />
              ))}
            </div>
          )}

          <Link
            to={`/docs/wc-waiver?name=${encodeURIComponent(
              displayUser.name,
            )}&email=${encodeURIComponent(displayUser.email)}`}
            className="text-sm font-mono purple-light-text"
          >
            Sign a new waiver →
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
