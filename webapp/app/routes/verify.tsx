// app/routes/verify.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { Form, useLoaderData } from "react-router";
import {
  authenticator,
  getUser,
  getAuthError,
  getAuthEmail,
} from "../modules/auth/auth.server";
import { Input } from "stamps/Input";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Link } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) return redirect("/fruits");

  const authEmail = getAuthEmail(request);
  const authError = getAuthError(request);

  if (!authEmail) return redirect("/login");

  return data({ authEmail, authError });
}

export async function action({ request }: ActionFunctionArgs) {
  // Strategy validates the code (or resends if no code), handles all redirects
  await authenticator.authenticate("TOTP", request);
}

export default function Verify() {
  const { authEmail, authError } = useLoaderData<typeof loader>();

  const shouldRequestCode =
    authError?.includes("expired") || authError?.includes("verification");

  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-96 mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-2">
            Verify Login Code
          </h1>
          <p className="italic mb-8">Check your email for "the code"</p>
          <div className="w-auto flex flex-col gap-4 good-box p-4 text-xl">
            <Form method="POST" className="flex flex-col gap-4">
              <input type="hidden" value={authEmail} name="authEmail" />
              <Input
                label="Code"
                name="code"
                required
                placeholder="123456"
              />
              {authError && !shouldRequestCode && (
                <div className="red-text">{authError}</div>
              )}
              <div className="text-right">
                <button className="btn-secondary" type="submit">
                  Continue
                </button>
              </div>
            </Form>
            {authError?.includes("expired") ? (
              <div className="text-lg red-text mt-2">
                That code has expired, when you are ready{" "}
                <Form method="POST" className="inline-flex">
                  <button className="link" type="submit">
                    click here to request a new code
                  </button>
                </Form>
                .
              </div>
            ) : authError?.includes("verification") ? (
              <div className="text-lg red-text mt-2">
                We lost your session, when you are ready{" "}
                <Form method="POST" className="inline-flex">
                  <button className="link" type="submit">
                    click here to request a new code
                  </button>
                </Form>
                .
              </div>
            ) : (
              <div className="text-lg text-right">
                ...or{" "}
                <Form method="POST" className="inline-flex">
                  <button className="link" type="submit">
                    request new code
                  </button>
                </Form>
                .
              </div>
            )}
          </div>
          <div className="mt-8">
            <Link to="/login" className="link">
              ← Back to login
            </Link>
          </div>
        </div>
      </div>
      <Footer></Footer>
    </Layout>
  );
}
