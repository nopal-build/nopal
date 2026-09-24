// app/hooks/useUser.ts
import { useMatches } from "react-router";
import type { Human } from "robustness-core/data/humans.server";

export function useUser(): Human | null {
  const matches = useMatches();
  for (const match of [...matches].reverse()) {
    const data = match.data as Record<string, unknown> | null | undefined;
    if (data && typeof data === "object" && "user" in data && data.user) {
      return data.user as Human;
    }
  }
  return null;
}

/** True when the page's loader said this person is a Client on every
 * project they're on (ADR-023): the nav then offers no Vault, and `/vault`
 * refuses them. Pages a client can reach (`/`, `/daily-log`, `/profile`)
 * return `vaultHidden`. */
export function useVaultHidden(): boolean {
  return useMatches().some((m) => (m.data as { vaultHidden?: boolean } | null | undefined)?.vaultHidden === true);
}

function isSuper(user: Human | null): boolean {
  return user?.role === "Super";
}

function isAdmin(user: Human | null): boolean {
  return user?.role === "Admin" || isSuper(user);
}

function isHuman(user: Human | null): boolean {
  return user?.role === "Human";
}

export const permissions = {
  isSuper,
  isAdmin,
  isHuman,
};
