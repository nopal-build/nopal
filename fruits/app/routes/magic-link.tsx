import type { LoaderFunctionArgs } from "react-router";
import { authenticator } from "../modules/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Strategy handles magic link validation, sets session, and redirects
  await authenticator.authenticate("TOTP", request);
}
