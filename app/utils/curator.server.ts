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
        error: "Forbidden",
        message: "Only curators and admins can edit track metadata",
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
