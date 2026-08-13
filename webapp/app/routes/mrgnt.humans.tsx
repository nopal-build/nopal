import { useEffect, useState } from "react";
import {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  redirect,
  Form,
  useActionData,
  useLoaderData,
  useFetcher,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import {
  deleteHuman,
  getHumans,
  updateHuman,
  type Human,
  type Role,
} from "robustness-core/data/humans.server";
import { inviteHuman } from "../data/invites.server";
import { Input } from "../components/Input";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const humans = await getHumans();
  return { humans: humans?.data ?? [] };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create": {
      try {
        const actor = await getUser(request);
        const email = formData.get("email") as string;
        const name = formData.get("name") as string;
        const role = formData.get("role") as Role;
        const result = await inviteHuman(
          {
            email,
            name,
            role,
            invitedByHumanId: actor?._id,
          },
          request,
        );
        if (!result) {
          return {
            ok: false,
            error: "Failed to create human.",
            intent: "create",
          };
        }
        // inviteHuman already provisions the vault + sends the welcome email
        return { ok: true, error: null, intent: "create" };
      } catch (err) {
        console.error(err);
        return {
          ok: false,
          error: "Failed to create human.",
          intent: "create",
        };
      }
    }

    case "update": {
      try {
        const id = formData.get("id") as string;
        const email = formData.get("email") as string;
        const name = formData.get("name") as string;
        const role = formData.get("role") as Role;
        const result = await updateHuman(id, { email, name, role });
        if (!result) {
          return {
            ok: false,
            error: "Failed to update human.",
            intent: "update",
          };
        }
        return { ok: true, error: null, intent: "update" };
      } catch (err) {
        console.error(err);
        return {
          ok: false,
          error: "Failed to update human.",
          intent: "update",
        };
      }
    }

    case "delete": {
      try {
        const id = formData.get("id") as string;
        await deleteHuman(id);
        return { ok: true, error: null, intent: "delete" };
      } catch (err) {
        console.error(err);
        return {
          ok: false,
          error: "Failed to delete human.",
          intent: "delete",
        };
      }
    }

    default:
      return { ok: false, error: "Unknown intent.", intent: "" };
  }
}

const ROLES: Role[] = ["Super", "Admin", "Human"];

export default function MrgntHumans() {
  const { humans } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedHuman, setSelectedHuman] = useState<Human | null>(null);
  const deleteFetcher = useFetcher<typeof action>();

  // Clear selection after a successful delete
  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      setSelectedHuman(null);
    }
  }, [deleteFetcher.data]);

  const isEditing = selectedHuman !== null;

  return (
    <div className="flex flex-row gap-8">
      {/* ── Left column: human list ── */}
      <div className="flex flex-col gap-2" style={{ minWidth: "200px" }}>
        <h2 className="purple-light-text text-xl mb-1">Humans</h2>

        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => setSelectedHuman(null)}
        >
          + New Human
        </button>

        <ul className="flex flex-col gap-1 mt-2">
          {humans.length === 0 && (
            <li className="text-sm opacity-50">No humans yet.</li>
          )}
          {humans.map((human) => {
            const isSelected = selectedHuman?._id === human._id;
            return (
              <li key={human._id}>
                <button
                  type="button"
                  onClick={() => setSelectedHuman(human)}
                  className="w-full text-left rounded px-3 py-2 text-sm"
                  style={{
                    background: isSelected
                      ? "rgba(128,0,128,0.08)"
                      : "transparent",
                    border: isSelected
                      ? "1px solid #baa9c0"
                      : "1px solid transparent",
                  }}
                >
                  <div className="font-semibold">{human.name}</div>
                  <div className="text-xs" style={{ opacity: 0.6 }}>
                    {human.email}
                  </div>
                  <div className="text-xs" style={{ opacity: 0.4 }}>
                    {human.role}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Right column: create / edit form ── */}
      <div className="flex flex-col gap-4 flex-1" style={{ maxWidth: "400px" }}>
        <h2 className="purple-light-text text-xl">
          {isEditing ? "Edit Human" : "New Human"}
        </h2>

        {/* Success messages (create / update via main form) */}
        {actionData?.ok && actionData.intent === "create" && (
          <p className="text-sm" style={{ color: "var(--green)" }}>
            Human created successfully.
          </p>
        )}
        {actionData?.ok && actionData.intent === "update" && (
          <p className="text-sm" style={{ color: "var(--green)" }}>
            Human updated successfully.
          </p>
        )}

        {/* Success message (delete via fetcher) */}
        {deleteFetcher.data?.ok && (
          <p className="text-sm" style={{ color: "var(--green)" }}>
            Human deleted successfully.
          </p>
        )}

        {/* Error messages */}
        {actionData && !actionData.ok && actionData.error && (
          <p className="text-red-500 text-sm">{actionData.error}</p>
        )}
        {deleteFetcher.data &&
          !deleteFetcher.data.ok &&
          deleteFetcher.data.error && (
            <p className="text-red-500 text-sm">{deleteFetcher.data.error}</p>
          )}

        {/*
          key=... forces React to remount the form whenever the selection
          changes so that defaultValue props are applied fresh each time.
        */}
        <Form
          key={selectedHuman?._id ?? "new"}
          method="post"
          className="flex flex-col gap-4"
        >
          <input
            type="hidden"
            name="intent"
            value={isEditing ? "update" : "create"}
          />
          {isEditing && (
            <input type="hidden" name="id" value={selectedHuman._id} />
          )}

          <Input
            label="Name"
            name="name"
            defaultValue={selectedHuman?.name ?? ""}
            required
          />

          <Input
            label="Email"
            name="email"
            defaultValue={selectedHuman?.email ?? ""}
            required
          />

          <div className="flex flex-col">
            <label className="text-sm" htmlFor="role">
              Role
            </label>
            <select
              name="role"
              id="role"
              defaultValue={selectedHuman?.role ?? "Human"}
              className="rounded"
              style={{
                padding: "8px",
                background: "white",
                border: "1px solid #baa9c0",
                outline: "none",
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button type="submit" className="btn-primary">
              {isEditing ? "Update" : "Save"}
            </button>
          </div>
        </Form>

        {isEditing && (
          <deleteFetcher.Form
            method="post"
            className="flex flex-row gap-4 items-center"
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={selectedHuman._id} />
            <button
              type="submit"
              className="text-red-500 text-sm underline hover:no-underline"
            >
              Delete
            </button>
          </deleteFetcher.Form>
        )}
      </div>
    </div>
  );
}
