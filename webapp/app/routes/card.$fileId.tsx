// app/routes/card.$fileId.tsx
// Public view of a shared markdown card — no authentication required.

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getFileRefById } from "robustness-core/data/vault.server";
import type { FileRef } from "robustness-core/data/vault.types";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import MdxEditorView from "../components/MdxEditorView";
import "../styles/mdxeditor.css";
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
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4" style={{ maxWidth: "760px" }}>
          <h1
            className="font-mono font-bold purple-light-text"
            style={{ fontSize: "1.5rem", margin: "40px 0 24px" }}
          >
            {file.name.replace(/\.md$/i, "")}
          </h1>
          <div className="vault-readme-section">
            <MdxEditorView markdown={file.content ?? ""} />
          </div>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
