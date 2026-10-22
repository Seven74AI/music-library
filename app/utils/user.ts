import { useRouteLoaderData } from "react-router";
import { type loader as rootLoader } from "#app/root.tsx";

function isUser(user: any): user is Awaited<ReturnType<typeof rootLoader>>["data"]["user"] {
  return user && typeof user === "object" && typeof user.id === "string";
}

export function useOptionalUser() {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  if (!data || !isUser(data.user)) {
    return undefined;
  }
  return data.user;
}

export function useUser() {
  const maybeUser = useOptionalUser();
  if (!maybeUser) {
    throw new Error(
      "No user found in root loader, but user is required by useUser. If user is optional, try useOptionalUser instead.",
    );
  }
  return maybeUser;
}

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
  user: Pick<ReturnType<typeof useUser>, "roles"> | null | undefined,
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

export function userHasRole(user: Pick<ReturnType<typeof useUser>, "roles"> | null, role: string) {
  if (!user) return false;
  return user.roles.some((r) => r.name === role);
}

export function userIsCuratorOrAdmin(
  user: Pick<ReturnType<typeof useUser>, "roles"> | null | undefined,
) {
  return userHasRole(user ?? null, "curator") || userHasRole(user ?? null, "admin");
}
