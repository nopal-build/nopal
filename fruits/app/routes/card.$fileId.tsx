// app/routes/card.$fileId.tsx
// Public view of a shared markdown card — no authentication required.

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getFileRefById } from "robustness-core/data/vault.server";
import type { FileRef } from "robustness-core/data/vault.types";
import { AuthShell } from "../components/AuthShell";
import OxRenderer from "../components/OxRenderer";
import "../styles/vault.css";

export async function loader({ params }: LoaderFunctionArgs) {
  const { fileId } = params;
  if (!fileId) throw new Response("Not Found", { status: 404 });

  const file = await getFileRefById(fileId);
  if (!file || file.content_type !== "text/markdown" || !file.is_public) {
    throw new Response("Not Found", { status: 404 });
  }

  return { file };
}

export default function PublicCardPage() {
  const { file } = useLoaderData<{ file: FileRef }>();

  return (
    <AuthShell title={file.name.replace(/\.md$/i, "")} maxWidth="760px">
      <div className="vault-readme-section">
        <OxRenderer markdown={file.content ?? ""} />
      </div>
    </AuthShell>
  );
}
