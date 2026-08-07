// app/routes/login-error.tsx
//
// Landing spot for a login attempt that can't succeed for a reason the
// visitor can't fix themselves — currently just a suspended account (see
// `suspendHuman`/`getUser` in auth.server.ts and the TOTP/passkey login
// checks that redirect here). Deliberately generic/static rather than
// naming the specific reason, so it doesn't confirm to an outside party
// whether a given email is a real, suspended account.
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Link } from "react-router";

export default function LoginError() {
  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-96 mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-4">
            Login Problem
          </h1>
          <div className="good-box p-4 text-lg">
            <p>
              There has been a problem logging in as this user. Please
              contact{" "}
              <a href="mailto:human@nopal.build" className="link">
                human@nopal.build
              </a>{" "}
              for help.
            </p>
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
