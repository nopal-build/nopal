import type { ActionFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFileRefById } from "robustness-core/data/vault.server";
import {
  setWebsitePagePublish,
  type WebsitePublishStatus,
} from "robustness-core/data/website.server";

/**
 * PUT /api/vault/website-pages/:fileId/publish — flips a website page's
 * `publish` front matter (see `website.server.ts`'s `withWebsitePublish`).
 * Gated by the ordinary Sharing-Roles owner-tier check
 * (`canActAsProjectOwner`, inside `setWebsitePagePublish`), same as any
 * other website content write — no platform Admin/Super role involved.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { fileId } = params;
  if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 });

  const file = await getFileRefById(fileId);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as { publish?: WebsitePublishStatus };
  if (body.publish !== "draft" && body.publish !== "published") {
    return Response.json(
      { error: 'publish must be "draft" or "published"' },
      { status: 400 },
    );
  }

  const result = await setWebsitePagePublish(user._id, file, body.publish);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }
  return Response.json({ publish: result.publish });
}
