// app/routes/pay.$chargeId_.file.$fileId.tsx → /pay/:chargeId/file/:fileId (the underscore keeps the pay page's loader from running too)
// A receipt or PDF the guide attached to a bill, for the people who may
// pay it (payments seed, 2026-11-03). A Client can't open the project's
// cost files otherwise (`rowsForReader`: no receipt for a Client), so this
// is the bill's own gate: the file has to be on this bill, and the viewer
// a Client on its project, logged in or through their signed link (the
// pay page carries `for` and `sig` onto these links). Redirects to a
// short-lived presigned URL, as `/api/vault/view/:fileId` does.
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { isClientOn, personFromPayLink } from "../data/payments.server";
import { getCharge } from "robustness-core/data/billing.server";
import { getFileRefById, getFolderById } from "robustness-core/data/vault.server";
import { getPresignedViewUrl } from "robustness-core/data/file.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const chargeId = params.chargeId ?? "";
  const viewer = (await personFromPayLink(chargeId, url)) ?? (await getUser(request));
  if (!viewer) throw data("Not found", { status: 404 });

  const charge = await getCharge(chargeId);
  const attached = charge?.attachments?.find((a) => a.fileId === params.fileId);
  const folder = charge ? await getFolderById(charge.project_folder_id) : undefined;
  if (!charge || !attached || !folder || !(await isClientOn(folder, viewer._id))) {
    throw data("Not found", { status: 404 });
  }
  const file = await getFileRefById(attached.fileId);
  if (!file?.s3_key) throw data("Not found", { status: 404 });
  return redirect(await getPresignedViewUrl(file.s3_key, 900, file.content_type));
}
