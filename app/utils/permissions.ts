/**
 * Canonical, isomorphic permission model (single source of truth).
 *
 * - Role names and role-set semantics ("curator or admin") live here.
 * - Pure helpers work on whatever role shape the caller has: an array of names
 *   (`["admin"]`) or role objects (`[{ name: "admin" }]`).
 * - DB-backed enforcement (`requireUserWithRole`, `requireCuratorOrAdmin`, ...)
 *   lives in `permissions.server.ts` and is built on these constants.
 * - Identity (session -> userId) stays in `auth.server.ts`; it is a different
 *   concern from permission.
 */

export const ROLES = {
  admin: "admin",
  curator: "curator",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

/** Roles that satisfy "curator or admin". Admin implies curator access. */
export const CURATOR_OR_ADMIN_ROLES: Array<RoleName> = [ROLES.admin, ROLES.curator];

type RoleLike = string | { name: string };
type WithRoles = { roles: ReadonlyArray<RoleLike> };

function roleName(role: RoleLike) {
  return typeof role === "string" ? role : role.name;
}

export function hasRole(user: WithRoles | null | undefined, role: string): boolean {
  if (!user) return false;
  return user.roles.some((r) => roleName(r) === role);
}

export function isAdmin(user: WithRoles | null | undefined): boolean {
  return hasRole(user, ROLES.admin);
}

export function isCuratorOrAdmin(user: WithRoles | null | undefined): boolean {
  return CURATOR_OR_ADMIN_ROLES.some((role) => hasRole(user, role));
}

// --- Fine-grained permission strings (role.permissions) ---

type Action = "create" | "read" | "update" | "delete" | "merge" | "restore";
type Entity = "user" | "note" | "metadata" | "artist" | "album";
type Access = "own" | "any" | "own,any" | "any,own" | "history";
export type PermissionString = `${Action}:${Entity}` | `${Action}:${Entity}:${Access}`;

export function parsePermissionString(permissionString: PermissionString) {
  const [action, entity, access] = permissionString.split(":") as [
    Action,
    Entity,
    Access | undefined,
  ];
  return {
    action,
    entity,
    access: access ? (access.split(",") as Array<Access>) : undefined,
  };
}

export function userHasPermission(
  user:
    | {
        roles: ReadonlyArray<{
          permissions: ReadonlyArray<{ entity: string; action: string; access: string }>;
        }>;
      }
    | null
    | undefined,
  permission: PermissionString,
) {
  if (!user) return false;
  const { action, entity, access } = parsePermissionString(permission);
  return user.roles.some((role) =>
    role.permissions.some(
      (rolePermission) =>
        rolePermission.entity === entity &&
        rolePermission.action === action &&
        (!access || access.includes(rolePermission.access)),
    ),
  );
}
