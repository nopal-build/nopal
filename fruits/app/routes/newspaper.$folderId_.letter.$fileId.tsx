// app/routes/newspaper.$folderId_.letter.$fileId.tsx
// The desk, with one letter on it (Austin, 2026-11-06: "The whole letters
// workflow shouldn't go to the vault, it should feel like you are still
// in the project, at the desk and writing a letter"). A page of its own
// with only the letter: the project's name, the way back to the desk,
// and the letter being written, with its talk box, outline, editor and
// Send. No tabs, no mailbox, no file tree. `_` after `$folderId` keeps it
// outside the project page's own route, so none of that page loads here.
//
// Who it opens for is one function's to say (`letterWritingFor`,
// `letterDesk.server.ts`): someone who may write this letter here
// (`mayWriteLetter`: a Guide on the project, or a client for their own).
// Anyone else gets the 404 of
// a letter that isn't there, and nothing of a draft leaves the server
// for them. Everyone the page opens for can write, so there is no
// read-only version of it.
//
// What it does is `LetterWriting`, the component the Vault also mounts.
// Around it here: a save that says so on the page when it fails (the
// Vault's uses an alert), "See it as they will", and Delete on a letter
// that has never gone out.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { navFor } from "../data/nav.server";
import { letterHasGoneOut, letterWritingFor } from "robustness-core/data/letterDesk.server";
import { letterTitle } from "robustness-core/data/letters.server";
import { resolveProjectManifest } from "robustness-core/data/project.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { LetterDesk } from "../components/LetterDesk";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: data ? `O.No · ${data.letter.title}` : "O.No" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const project = params.folderId ? await getFolderById(params.folderId) : null;
  // The gate, before anything of the letter is read for the page.
  const writing = project ? await letterWritingFor(project, params.fileId, user) : null;
  if (!project || !writing) throw new Response("Not found", { status: 404 });
  const { file } = writing;
  const manifest = (await resolveProjectManifest(project.human_id, project)).manifest;
  return {
    // `AppLayout` reads the viewer from the nearest loader that has one.
    user,
    project: { _id: project._id, title: manifest.title ?? project.name },
    letter: {
      _id: file._id,
      folder_id: file.folder_id ?? null,
      updated_at: file.updated_at ?? null,
      content: file.content ?? "",
      purpose: file.purpose ?? null,
      shared_at: file.shared_at ?? null,
      title: letterTitle(file),
      goneOut: letterHasGoneOut(file),
    },
    brief: writing.brief,
    send: writing.send,
    writer: writing.writer,
    ...(await navFor(user._id)),
  };
}

export default function LetterDeskRoute() {
  const { project, letter, brief, send, writer } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  return <LetterDesk project={project} letter={letter} brief={brief} send={send} writer={writer} onSent={() => revalidator.revalidate()} onDeleted={(desk) => navigate(desk)} />;
}
