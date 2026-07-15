import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getLegalDocumentById } from "../data/legalDocuments.server";
import { getPresignedViewUrl } from "../data/file.server";

/**
 * GET /api/legal-documents/view/:docId
 *
 * Redirects (302) to a short-lived presigned S3 URL for a signed legal
 * document (e.g. the WC waiver PDF). These are stored with a private ACL
 * (see uploadFileToS3 in file.server.ts) rather than a permanent public
 * link, so every view goes through here and gets ownership-checked first.
 *
 * Allowed viewers:
 *   - The human whose account email matches the document (self-service,
 *     e.g. from their /fruits/profile page).
 *   - Staff (Admin/Super), since the admin-notification email links here.
 *
 * The contractor's own copy of the email intentionally does NOT link
 * here — they may not have a Nopal account at all, so their email instead
 * relies solely on the PDF attachment (see docs.wc-waiver.tsx).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { docId } = params;
  if (!docId) {
    return Response.json({ error: "docId required" }, { status: 400 });
  }

  const doc = await getLegalDocumentById(docId);
  if (!doc) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = doc.email.toLowerCase() === user.email.toLowerCase();
  const isStaff = user.role === "Admin" || user.role === "Super";
  if (!isOwner && !isStaff) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!doc.s3_key) {
    return Response.json({ error: "No viewable file attached" }, { status: 400 });
  }

  try {
    const url = await getPresignedViewUrl(doc.s3_key);
    return redirect(url);
  } catch (err) {
    console.error("Presign legal document view error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate view URL" },
      { status: 500 },
    );
  }
}
