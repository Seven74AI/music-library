import { parseString } from "set-cookie-parser";
import { describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action, loader } from "./profile.index.tsx";

const PATH = "/settings/profile";

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  const session = await prisma.session.create({
    data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
  return { userId: user.id, cookie: `${parsed.name}=${parsed.value}` };
}

function args(request: Request) {
  return {
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: PATH,
  };
}

function submitPrivacy(cookie: string, checked: string[]) {
  const body = new FormData();
  body.set("intent", "privacy-update");
  for (const name of checked) body.set(name, "on");
  return action(
    args(new Request(`http://localhost${PATH}`, { method: "POST", body, headers: { cookie } })),
  );
}

describe("privacy-update action", () => {
  test("an unchecked box persists false; checked boxes persist true", async () => {
    const { userId, cookie } = await createAccount();
    await submitPrivacy(cookie, [
      "showTopTracks",
      "showTotals",
      "showRecentlyPlayed",
      "showPlaylists",
    ]);

    const row = await prisma.profilePrivacy.findUnique({ where: { userId } });
    expect(row).toMatchObject({
      showTopTracks: true,
      showTopArtists: false,
      showTotals: true,
      showHeavyRotation: false,
      showRecentlyPlayed: true,
      showPlaylists: true,
    });

    // Subsequent submit with nothing checked updates all five to false.
    await submitPrivacy(cookie, []);
    const updated = await prisma.profilePrivacy.findUnique({ where: { userId } });
    expect(updated).toMatchObject({
      showTopTracks: false,
      showTopArtists: false,
      showTotals: false,
      showHeavyRotation: false,
      showRecentlyPlayed: false,
      showPlaylists: false,
    });
  });

  test("user A cannot write user B's row", async () => {
    const a = await createAccount();
    const b = await createAccount();
    await prisma.profilePrivacy.create({ data: { userId: b.userId } });

    const body = new FormData();
    body.set("intent", "privacy-update");
    body.set("userId", b.userId); // attacker-supplied field must be ignored
    await action(
      args(
        new Request(`http://localhost${PATH}`, {
          method: "POST",
          body,
          headers: { cookie: a.cookie },
        }),
      ),
    );

    const bRow = await prisma.profilePrivacy.findUnique({ where: { userId: b.userId } });
    expect(bRow).toMatchObject({
      showTopTracks: true,
      showTopArtists: true,
      showTotals: true,
      showHeavyRotation: true,
      showRecentlyPlayed: true,
    });
    const aRow = await prisma.profilePrivacy.findUnique({ where: { userId: a.userId } });
    expect(aRow).toMatchObject({
      showTopTracks: false,
      showTopArtists: false,
      showTotals: false,
      showHeavyRotation: false,
      showRecentlyPlayed: false,
    });
  });

  test("loader returns current settings, defaulting to all-true when no row exists", async () => {
    const { userId, cookie } = await createAccount();
    const request = new Request(`http://localhost${PATH}`, { headers: { cookie } });
    const result = (await loader(args(request) as never)) as {
      profilePrivacy: Record<string, boolean>;
    };
    expect(result.profilePrivacy).toEqual({
      showTopTracks: true,
      showTopArtists: true,
      showTotals: true,
      showHeavyRotation: true,
      showRecentlyPlayed: true,
      showPlaylists: true,
    });

    await prisma.profilePrivacy.create({ data: { userId, showTopArtists: false } });
    const after = (await loader(args(request) as never)) as {
      profilePrivacy: Record<string, boolean>;
    };
    expect(after.profilePrivacy.showTopArtists).toBe(false);
  });
});
