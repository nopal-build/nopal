import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { sessionStorage } from "../modules/auth/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie")
  );
  return redirect("/", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
