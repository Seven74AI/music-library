import { data } from "react-router";
import { requireUserId } from "./auth.server.ts";
import { prisma } from "./db.server.ts";

export async function requireCuratorOrAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: {
      id: userId,
      roles: {
        some: {
          name: { in: ["admin", "curator"] },
        },
      },
    },
  });

  if (!user) {
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

export async function userIsCuratorOrAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: {
      id: userId,
      roles: {
        some: {
          name: { in: ["admin", "curator"] },
        },
      },
    },
  });

  return !!user;
}
