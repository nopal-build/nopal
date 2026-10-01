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
 * refuses them. Pages a client can reach (`/daily-log`, `/profile`, their
 * project) return `vaultHidden` (`navFor`). */
export function useVaultHidden(): boolean {
  return useMatches().some((m) => (m.data as { vaultHidden?: boolean } | null | undefined)?.vaultHidden === true);
}

/** True when the page's loader said this person guides a project
 * (`navFor`): the nav then offers the Maker, where they start projects
 * and run their people. An admin gets the Maker regardless. */
export function useMaker(): boolean {
  return useMatches().some((m) => (m.data as { maker?: boolean } | null | undefined)?.maker === true);
}

/** The first tab: My Project (straight to it) for someone on one active
 * project, My Projects otherwise. Pages that don't say (`navFor`) get My
 * Projects, and `/` sends a one-project person on. */
export function useHome(): { plural: boolean; projectId: string | null } {
  for (const m of useMatches()) {
    const home = (m.data as { home?: { plural: boolean; projectId: string | null } } | null | undefined)?.home;
    if (home) return home;
  }
  return { plural: true, projectId: null };
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
