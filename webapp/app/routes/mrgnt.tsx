import {
  Link,
  Outlet,
  data,
  redirect,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import mrgntStyles from "../styles/mrgnt.css?url";
import { LinksFunction, LoaderFunctionArgs } from "react-router";
import { getUser } from "../modules/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  if (user.role != "Admin" && user.role != "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return null;
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: mrgntStyles },
];

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <>
        <div className="mdid">MRGNT No.0</div>
        <div className="notions">
          <div
            className="notions-box"
            style={{ flexDirection: "column", gap: "20px", maxWidth: "360px" }}
          >
            <div>
              <span
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.1em",
                  color: "var(--text-subtle)",
                }}
              >
                ERROR
              </span>
              <div
                style={{
                  fontSize: "36px",
                  fontWeight: "bold",
                  lineHeight: 1,
                  color: "var(--red)",
                  marginTop: "4px",
                }}
              >
                403
              </div>
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              <div style={{ fontWeight: "bold" }}>Access Denied</div>
              <div style={{ color: "var(--text-subtle)", fontSize: "14px" }}>
                Your account doesn't have permission to enter this area. Only{" "}
                <span style={{ color: "var(--purple-light)" }}>Admin</span> and{" "}
                <span style={{ color: "var(--purple-light)" }}>Super</span>{" "}
                roles are allowed.
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid currentColor",
                opacity: 0.15,
                margin: "0 -16px",
              }}
            />

            <div style={{ display: "flex", gap: "20px", fontSize: "14px" }}>
              <Link to="/logout" className="link">
                ← logout
              </Link>
              <Link to="/" className="link">
                ← home
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mdid">MRGNT No.0</div>
      <div className="notions">
        <div
          className="notions-box"
          style={{ flexDirection: "column", gap: "12px", maxWidth: "360px" }}
        >
          <div style={{ fontWeight: "bold" }}>Something went wrong</div>
          <div style={{ color: "var(--text-subtle)", fontSize: "14px" }}>
            {isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
              ? error.message
              : "An unexpected error occurred."}
          </div>
          <Link to="/mrgnt" className="link" style={{ fontSize: "14px" }}>
            ← back
          </Link>
        </div>
      </div>
    </>
  );
}

export default function Mrgnt() {
  return (
    <>
      <div className="mdid">MRGNT No.0</div>
      <div className="notions">
        <div>
          <div className="notions-box">
            <ul>
              <li>
                <Link to="/mrgnt/gbs" className="link">
                  +Materials & Assemblies
                </Link>
              </li>
              <li>
                <Link to="/mrgnt/humans" className="link">
                  +Humans
                </Link>
              </li>

            </ul>
          </div>
        </div>
        <Outlet />
      </div>
    </>
  );
}
