/**
 * Single source of truth for how an organization member is coloured and
 * labelled, so every Teams view (hierarchy tree, list explorer, simulator,
 * permissions) renders the same person the same way.
 *
 * Colour is derived from the member's ROLE — never from their position in the
 * chart — so a person's avatar cannot change colour when they move between
 * branches of the tree.
 */

const ROLE_AVATAR_STYLES: Record<string, string> = {
  team_leader:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/40",
  admin:
    "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40",
  owner:
    "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40",
  member:
    "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40",
};

const UNKNOWN_ROLE_AVATAR_STYLE = "bg-muted text-muted-foreground border-border";

export type TeamRole = "team_leader" | "admin" | "owner" | "member";

/** Normalises a role coming from the API (which may be null or a node type). */
export function normalizeRole(role?: string | null, nodeType?: string | null): string {
  const value = (role || "").trim().toLowerCase();
  if (value.includes("admin") || value.includes("owner") || value.includes("ceo")) return "admin";
  if (value.includes("leader") || nodeType === "team_leader") return "team_leader";
  return "member";
}

export function getRoleAvatarStyle(role?: string | null, nodeType?: string | null): string {
  return ROLE_AVATAR_STYLES[normalizeRole(role, nodeType)] ?? UNKNOWN_ROLE_AVATAR_STYLE;
}

export function getRoleLabel(role?: string | null, nodeType?: string | null): string {
  const raw = (role || "").trim();
  if (raw) {
    return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (nodeType === "team_leader") return "Team Leader";
  return "Member";
}
