import { data } from "react-router";
import { requireUserId } from "./auth.server.ts";
import { prisma } from "./db.server.ts";
import { CURATOR_OR_ADMIN_ROLES } from "./permissions.ts";

/** True when the user (by id) holds the given role. */
export async function userHasRoleById(userId: string, name: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: { id: userId, roles: { some: { name } } },
  });
  return !!user;
}

export async function userIsCuratorOrAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: { id: userId, roles: { some: { name: { in: CURATOR_OR_ADMIN_ROLES } } } },
  });
  return !!user;
}

export async function requireUserWithRole(request: Request, name: string) {
  const userId = await requireUserId(request);
  if (!(await userHasRoleById(userId, name))) {
    throw data(
      {
        error: "Unauthorized",
        requiredRole: name,
        message: `Unauthorized: required role: ${name}`,
      },
      { status: 403 },
    );
  }
  return userId;
}

export async function requireCuratorOrAdmin(request: Request) {
  const userId = await requireUserId(request);
  if (!(await userIsCuratorOrAdmin(userId))) {
    throw data(
      {
        error: "Unauthorized",
        requiredRole: "curator or admin",
        message: "Unauthorized: curator or admin role required",
      },
      { status: 403 },
    );
  }
  return userId;
}
