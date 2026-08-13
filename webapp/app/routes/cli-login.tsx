// app/routes/cli-login.tsx
//
// The browser-side half of `nopal login`'s loopback flow: the CLI opens
// `/cli-login?port=...&state=...&hostname=...` here, we make sure a human
// is signed in (bouncing through /login if not, then straight back here),
// show a plain "authorize this CLI?" prompt, and on approval mint a token
// and redirect the browser to the CLI's own local callback server with a
// short-lived one-time code — never the token itself (see
// api.cli-auth.exchange.tsx, which trades that code for the real token over
// a direct HTTPS call the CLI makes itself).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, Form, useLoaderData, useActionData } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { createApiTokenWithExchangeCode } from "robustness-core/data/apiTokens.server";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";

function parsePort(value: string | null): string | null {
  return value && /^\d{1,5}$/.test(value) ? value : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const port = parsePort(url.searchParams.get("port"));
  const state = url.searchParams.get("state");
  const hostname = url.searchParams.get("hostname")?.slice(0, 200) || "a computer";

  if (!port || !state) {
    return data(
      {
        error:
          "This link is missing information the CLI needs. Go back to your terminal and run `nopal login` again.",
      },
      { status: 400 },
    );
  }

  const user = await getUser(request);
  if (!user) {
    const redirectTo = `/cli-login${url.search}`;
    return redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  return data({ email: user.email, port, state, hostname });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return data(
      { error: "You're no longer signed in — go back to your terminal and try again." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const intent = form.get("intent");
  const port = parsePort(form.get("port") as string | null);
  const state = form.get("state") as string | null;
  const hostname = ((form.get("hostname") as string | null) || "a computer").slice(0, 200);

  if (!port || !state) {
    return data(
      { error: "Missing login details — go back to your terminal and try again." },
      { status: 400 },
    );
  }

  if (intent !== "approve") {
    return data({ denied: true });
  }

  const staged = await createApiTokenWithExchangeCode(user._id, `CLI login on ${hostname}`);
  if (!staged) {
    return data({ error: "Couldn't create a CLI session — please try again." }, { status: 500 });
  }

  const callbackUrl = `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(
    staged.code,
  )}&state=${encodeURIComponent(state)}`;

  return redirect(callbackUrl);
}

export default function CliLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if ("error" in loaderData) {
    return (
      <Layout>
        <div className="scene1">
          <div className="w-full max-w-xl mx-auto px-4 py-12">
            <h1 className="text-3xl purple-light-text font-bold mb-4">CLI Login</h1>
            <div className="red-text">{loaderData.error}</div>
          </div>
        </div>
        <Footer></Footer>
      </Layout>
    );
  }

  const { email, port, state, hostname } = loaderData;

  if (actionData && "denied" in actionData) {
    return (
      <Layout>
        <div className="scene1">
          <div className="w-full max-w-xl mx-auto px-4 py-12">
            <h1 className="text-3xl purple-light-text font-bold mb-4">CLI Login</h1>
            <p>Denied. You can close this tab and return to your terminal.</p>
          </div>
        </div>
        <Footer></Footer>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-xl mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-4">
            Authorize CLI access
          </h1>
          <div className="good-box p-4">
            <p className="mb-4">
              A command-line tool on <strong>{hostname}</strong> wants access to
              your Nopal account (<strong>{email}</strong>).
            </p>
            {actionData && "error" in actionData && (
              <div className="red-text mb-4">{actionData.error}</div>
            )}
            <Form method="POST" className="flex items-center gap-2 justify-end">
              <input type="hidden" name="port" value={port} />
              <input type="hidden" name="state" value={state} />
              <input type="hidden" name="hostname" value={hostname} />
              <button
                className="btn-secondary"
                style={{ "--btn-color": "var(--red)" } as React.CSSProperties}
                type="submit"
                name="intent"
                value="deny"
              >
                Deny
              </button>
              <button
                className="btn-secondary"
                style={{ "--btn-color": "var(--green)" } as React.CSSProperties}
                type="submit"
                name="intent"
                value="approve"
              >
                Authorize
              </button>
            </Form>
          </div>
        </div>
      </div>
      <Footer></Footer>
    </Layout>
  );
}
