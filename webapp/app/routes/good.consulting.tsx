import { redirect } from "react-router";

export function loader() {
  return redirect("/good/guides", { status: 301 });
}
