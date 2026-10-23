import { faker } from "@faker-js/faker";
import { hashSync } from "bcryptjs";
import { UniqueEnforcer } from "enforce-unique";
import { prisma } from "#app/utils/db.server.ts";

const uniqueUsernameEnforcer = new UniqueEnforcer();

export function createUser() {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  const username = uniqueUsernameEnforcer.enforce(() => {
    return (
      faker.string.alphanumeric({ length: 2 }) +
      "_" +
      faker.internet.username({
        firstName: firstName.toLowerCase(),
        lastName: lastName.toLowerCase(),
      })
    )
      .slice(0, 20)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_");
  });
  return {
    username,
    name: `${firstName} ${lastName}`,
    email: `${username}@example.com`,
  };
}

export function createPassword(password: string = faker.internet.password()) {
  return {
    hash: hashSync(password, 10),
  };
}

/**
 * Create a `Track` with a unique external id and a fresh artist. Shared by the
 * listening-insights, on-repeat-snapshots, and recently-played test suites
 * (previously each copy-pasted its own helper).
 */
/** Clear usage analytics rows so parallel/isolated tests do not collide on DAU dedupe. */
export async function resetUsageAnalyticsTables() {
  await prisma.usageEvent.deleteMany();
  await prisma.dailyUsageStat.deleteMany();
  await prisma.dailyActiveUser.deleteMany();
}

export async function createTrack(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

let userImages: Array<{ objectKey: string }> | undefined;
export async function getUserImages() {
  if (userImages) return userImages;

  userImages = await Promise.all(
    Array.from({ length: 10 }, (_, index) => ({
      objectKey: `user/${index}.jpg`,
    })),
  );

  return userImages;
}
