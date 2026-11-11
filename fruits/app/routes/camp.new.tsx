// app/routes/camp.new.tsx
//
// New Camp: a statement + target arrival date, anchored to an
// Organization, a project, or Personal (`?anchor=<folderId>`, required
// — a Camp always belongs to something, see
// `garden/3-growing/camps-and-log-books.md`). Creates the camp, then
// sends the human straight to its detail page.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { canActAsProjectOwner } from "robustness-core/data/projectSharing.server";
import { getOrganization } from "robustness-core/data/organizations.server";
import { createCamp } from "robustness-core/data/camps.server";
import { AppLayout } from "../components/AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { Input } from "stamps/Input";
import { button } from "stamps/button.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import { ORG_TERM } from "../data/orgBranding";

export const meta: MetaFunction = () => [{ title: "New Camp · O.No" }];

async function anchorLabel(anchor: { vault_root_key?: string | null; organization_id?: string | null; name: string }): Promise<string> {
  if (anchor.vault_root_key === "org" && anchor.organization_id) {
    const org = await getOrganization(anchor.organization_id);
    return `${org?.name ?? "Org"} ${ORG_TERM}`;
  }
  if (anchor.vault_root_key === "personal") return "Personal";
  return anchor.name;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const url = new URL(request.url);
  const anchorFolderId = url.searchParams.get("anchor");
  if (!anchorFolderId) throw new Response("Provide an anchor — an Organization, project, or Personal", { status: 400 });

  const anchor = await getFolderById(anchorFolderId);
  if (!anchor) throw new Response("Not found", { status: 404 });
  if (!(await canActAsProjectOwner(user._id, anchor.human_id, anchor._id))) {
    throw new Response("Not found", { status: 404 });
  }

  return { anchorFolderId, label: await anchorLabel(anchor) };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const form = await request.formData();
  const anchorFolderId = String(form.get("anchorFolderId") ?? "");
  const statement = String(form.get("statement") ?? "").trim();
  const targetArrival = String(form.get("targetArrival") ?? "").trim();
  if (!anchorFolderId) return { ok: false, error: "Missing anchor" };
  if (!statement) return { ok: false, error: "A statement is required" };
  if (!targetArrival) return { ok: false, error: "A target arrival date is required" };

  const anchor = await getFolderById(anchorFolderId);
  if (!anchor) return { ok: false, error: "Anchor not found" };
  if (!(await canActAsProjectOwner(user._id, anchor.human_id, anchor._id))) {
    return { ok: false, error: "Anchor not found" };
  }

  const camp = await createCamp(anchor, statement, targetArrival);
  return redirect(`/camp/${camp._id}`);
}

export default function NewCamp() {
  const { anchorFolderId, label } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";

  return (
    <AppLayout>
      <CenterContent maxWidth={520}>
        <Stack gap={5}>
          <Stack gap={1}>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>New Camp</h1>
            <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
              For {label} — a place you're headed to.
            </p>
          </Stack>
          <Form method="post">
            <input type="hidden" name="anchorFolderId" value={anchorFolderId} />
            <Stack gap={4}>
              <Input type="textarea" label="Statement" name="statement" placeholder="What is this camp about?" required />
              <Input type="date" label="Target arrival" name="targetArrival" required />
              <Stack gap={2}>
                <button type="submit" className={button({ variant: "primary" })} disabled={pending}>
                  {pending ? "Setting camp…" : "Set Camp"}
                </button>
                {actionData && !actionData.ok && (
                  <p className={textSize.xs} style={{ color: semanticColors.textDanger }}>
                    {actionData.error}
                  </p>
                )}
              </Stack>
            </Stack>
          </Form>
          <Link to={`/org`} className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            ← Back
          </Link>
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
