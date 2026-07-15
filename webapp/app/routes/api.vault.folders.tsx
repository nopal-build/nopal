import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getUserFromRequest } from "../modules/auth/auth.server";
import { createVaultFolder, getFoldersByHuman } from "../data/vault.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const folders = await getFoldersByHuman(user._id);
  return Response.json({ folders });
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
    parent_folder_id?: string | null;
  };

  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const folder = await createVaultFolder({
    human_id: user._id,
    name: body.name,
    parent_folder_id: body.parent_folder_id ?? null,
  });

  return Response.json({ folder }, { status: 201 });
}
