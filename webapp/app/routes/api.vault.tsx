import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import {
  createFileRef,
  getFileRefsByHuman,
  getFoldersByHuman,
  getSharedFoldersForHuman,
  getFileRefsByFolderIds,
} from "robustness-core/data/vault.server";
import { getHumansById } from "robustness-core/data/humans.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [myFiles, myFolders, sharedFolders] = await Promise.all([
    getFileRefsByHuman(user._id),
    getFoldersByHuman(user._id),
    getSharedFoldersForHuman(user._id),
  ]);

  const sharedFolderIds = sharedFolders.map((f) => f._id);
  const sharedFiles = await getFileRefsByFolderIds(sharedFolderIds);

  const ownerIds = [...new Set(sharedFolders.map((f) => f.human_id))];
  const owners = await getHumansById(ownerIds);
  const ownerMap = Object.fromEntries(owners.map((o) => [o._id, o]));

  const sharedFoldersWithOwner = sharedFolders.map((f) => ({
    ...f,
    ownerName:
      ownerMap[f.human_id]?.name ?? ownerMap[f.human_id]?.email ?? "Unknown",
    ownerHumanId: f.human_id,
  }));

  return Response.json({
    myFiles,
    myFolders,
    sharedFolders: sharedFoldersWithOwner,
    sharedFiles,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as {
    name?: string;
    s3_url?: string;
    s3_key?: string;
    content?: string;
    content_type?: string;
    folder_id?: string | null;
    size?: number | null;
  };

  const { name, s3_url, s3_key, content, content_type, folder_id, size } = body;

  if (!name || !content_type) {
    return Response.json(
      { error: "name and content_type are required" },
      { status: 400 },
    );
  }

  // .md and .csv files store their content inline (no S3 object).
  const lowerName = name.toLowerCase();
  const isInlineContent =
    content_type === "text/markdown" ||
    content_type === "text/csv" ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv");

  if (isInlineContent && content === undefined) {
    return Response.json(
      { error: "content is required for .md/.csv files" },
      { status: 400 },
    );
  }

  if (!isInlineContent && !s3_url) {
    return Response.json(
      { error: "s3_url is required for non-text files" },
      { status: 400 },
    );
  }

  const fileRef = await createFileRef({
    human_id: user._id,
    name,
    s3_url: isInlineContent ? null : s3_url,
    s3_key: isInlineContent ? null : s3_key,
    content: isInlineContent ? content : null,
    content_type,
    folder_id: folder_id ?? null,
    size: size ?? null,
  });

  return Response.json({ fileRef }, { status: 201 });
}
