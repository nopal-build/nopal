// app/routes/public.deliverable.$fileId.tsx
// The public letter page's old address. "Deliverables" became "Letters"
// on 2026-10-27, in the UI and the code, and every link already in a
// client's or contractor's hands says `/public/deliverable/<id>`. The
// id is the same file, so this sends them to `/public/letter/<id>` for
// good (301). Nothing is resolved here: the letter's page decides
// whether the link is on, the same as before.
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(`/public/letter/${params.fileId}`, 301);
}
