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
import { surfaceBase } from "stamps/surface.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { button } from "stamps/button.css";
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
        <div
          className={sprinkles({ px: 4, py: 12 })}
          style={{ width: "100%", maxWidth: "24rem", margin: "0 auto" }}
        >
          <h1
            className={`${textSize["3xl"]} purple-light-text ${sprinkles({
              fontWeight: "bold",
              mb: 2,
            })}`}
          >
            Verify Login Code
          </h1>
          <p className={sprinkles({ fontStyle: "italic", mb: 8 })}>
            Check your email for "the code"
          </p>
          <div
            className={`${surfaceBase} ${textSize.xl} ${sprinkles({
              display: "flex",
              flexDirection: "column",
              gap: 4,
              p: 4,
            })}`}
            style={{ width: "auto" }}
          >
            <Form
              method="POST"
              className={sprinkles({ display: "flex", flexDirection: "column", gap: 4 })}
            >
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
              <div className={sprinkles({ textAlign: "right" })}>
                <button className={button({ variant: "secondary" })} type="submit">
                  Continue
                </button>
              </div>
            </Form>
            {authError?.includes("expired") ? (
              <div className={`${textSize.lg} red-text ${sprinkles({ mt: 2 })}`}>
                That code has expired, when you are ready{" "}
                <Form method="POST" className={sprinkles({ display: "inline-flex" })}>
                  <button className="link" type="submit">
                    click here to request a new code
                  </button>
                </Form>
                .
              </div>
            ) : authError?.includes("verification") ? (
              <div className={`${textSize.lg} red-text ${sprinkles({ mt: 2 })}`}>
                We lost your session, when you are ready{" "}
                <Form method="POST" className={sprinkles({ display: "inline-flex" })}>
                  <button className="link" type="submit">
                    click here to request a new code
                  </button>
                </Form>
                .
              </div>
            ) : (
              <div className={`${textSize.lg} ${sprinkles({ textAlign: "right" })}`}>
                ...or{" "}
                <Form method="POST" className={sprinkles({ display: "inline-flex" })}>
                  <button className="link" type="submit">
                    request new code
                  </button>
                </Form>
                .
              </div>
            )}
          </div>
          <div className={sprinkles({ mt: 8 })}>
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
