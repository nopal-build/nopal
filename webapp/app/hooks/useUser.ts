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
