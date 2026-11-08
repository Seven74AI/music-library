import { data } from "react-router";
import { requireUserId } from "./auth.server.ts";
import { requireCuratorOrAdmin } from "./curator.server.ts";
import { prisma } from "./db.server.ts";
export async function requireUserWithRole(request: Request, name: string) {
  const userId = await requireUserId(request);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: { id: userId, roles: { some: { name } } },
  });
  if (!user) {
    throw data(
      {
        error: "Unauthorized",
        requiredRole: name,
        message: `Unauthorized: required role: ${name}`,
      },
      { status: 403 },
    );
  }
  return user.id;
}

export async function requireCuratorRole(request: Request) {
  return requireCuratorOrAdmin(request);
}
