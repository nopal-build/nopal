import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import {
  getWebsiteSettings,
  setWebsiteSettings,
  type WebsiteSettings,
} from "robustness-core/data/website.server";

/**
 * GET/PUT /api/vault/website/:folderId/settings — a `website` project's
 * `_site-settings.json` (nav + footer config for the public `/v2/*`
 * routes). Same owner-tier Sharing-Roles gate as any other website write
 * (`canActAsProjectOwner`, inside `setWebsiteSettings`).
 */

async function loadWebsiteFolder(folderId: string) {
  const folder = await getFolderById(folderId);
  if (!folder) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  if (folder.folder_type !== "website" || !folder.is_folder_type_root) {
    return {
      error: Response.json(
        { error: "Site settings only apply to a website project's own anchor folder" },
        { status: 400 },
      ),
    };
  }
  return { folder };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadWebsiteFolder(folderId);
  if ("error" in ctx) return ctx.error;

  return Response.json({ settings: await getWebsiteSettings(ctx.folder) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const { folderId } = params;
  if (!folderId) return Response.json({ error: "folderId required" }, { status: 400 });

  const ctx = await loadWebsiteFolder(folderId);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json()) as { settings?: WebsiteSettings };
  if (!body.settings) {
    return Response.json({ error: "settings required" }, { status: 400 });
  }

  const result = await setWebsiteSettings(user._id, ctx.folder, body.settings);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }
  return Response.json({ settings: result.settings });
}
