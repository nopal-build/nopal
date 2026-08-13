import type { ActionFunctionArgs } from "react-router";
import { getTrashedProjectFoldersForCleanup } from "robustness-core/data/projectStatus.server";
import { deleteVaultFolderCascade } from "robustness-core/data/vault.server";

/**
 * POST /api/vault/trash-cleanup
 *
 * Permanently deletes every project folder that has been marked "Trashed"
 * (see the `vault` skill's Projects section, and `projectStatus.server.ts`)
 * for 30 days or more. Protected by the same CRON_SECRET environment
 * variable as `api.vault.archive-cleanup.tsx` — wired into the server's
 * own daily cron (see server.js) right alongside it.
 *
 * You can also trigger it manually:
 *
 *   curl -X POST https://<your-app>.fly.dev/api/vault/trash-cleanup \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("trash-cleanup: CRON_SECRET env var is not set");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const folders = await getTrashedProjectFoldersForCleanup(30);

  let deleted = 0;
  const errors: string[] = [];

  for (const folder of folders) {
    try {
      await deleteVaultFolderCascade(folder._id);
      deleted++;
    } catch (err) {
      const msg = `Failed to delete ${folder._id} (${folder.name}): ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `trash-cleanup: deleted ${deleted}/${folders.length} projects${errors.length ? `, ${errors.length} errors` : ""}`,
  );

  return Response.json({ deleted, total: folders.length, errors });
}
