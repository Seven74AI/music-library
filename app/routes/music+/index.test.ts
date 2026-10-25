import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { createStaticHandler, isRouteErrorResponse, type RouteObject } from "react-router";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as musicLayoutLoader } from "../music.tsx";

const MUSIC_INDEX_FILE = "routes/music+/index.tsx";

type RouteNode = {
  id?: string;
  path?: string;
  index?: boolean;
  file: string;
  children?: RouteNode[];
};

type MusicIndexModule = {
  loader: (args: { request: Request }) => unknown;
};

const userIds: string[] = [];

afterEach(async () => {
  if (userIds.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

async function routeConfig() {
  const module = await import("#app/routes.ts");
  return (await module.default) as RouteNode[];
}

function findRoute(entries: RouteNode[], file: string): RouteNode | undefined {
  for (const entry of entries) {
    if (entry.file === file) return entry;
    if (entry.children) {
      const match = findRoute(entry.children, file);
      if (match) return match;
    }
  }
  return undefined;
}

async function musicLayoutRoute() {
  const music = findRoute(await routeConfig(), "routes/music.tsx");
  expect(music, "music layout route").toBeDefined();
  return music!;
}

async function loadMusicIndex(): Promise<MusicIndexModule> {
  return import("./index.tsx") as Promise<MusicIndexModule>;
}

async function loggedInRequest(url: string) {
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
  userIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expirationDate: getSessionExpirationDate(),
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader);
  if (!parsedCookie) throw new Error("session cookie was not set");
  return new Request(url, {
    headers: { cookie: `${parsedCookie.name}=${parsedCookie.value}` },
  });
}

async function thrownResponse(run: () => unknown) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("expected a thrown Response");
}

function toRouteObject(entry: RouteNode, indexLoader: MusicIndexModule["loader"]): RouteObject {
  const loader =
    entry.file === MUSIC_INDEX_FILE
      ? indexLoader
      : entry.file === "routes/music.tsx"
        ? musicLayoutLoader
        : () => ({ file: entry.file });

  if (entry.index) {
    return {
      id: entry.id,
      index: true,
      loader,
      // The real index module exports ErrorBoundary, so the 404 stays on this route.
      ...(entry.file === MUSIC_INDEX_FILE ? { ErrorBoundary: () => null } : {}),
    };
  }

  return {
    id: entry.id,
    path: entry.path,
    loader,
    children: entry.children?.map((child) => toRouteObject(child, indexLoader)),
  };
}

async function queryMusic(request: Request, indexLoader: MusicIndexModule["loader"]) {
  const music = await musicLayoutRoute();
  const { query } = createStaticHandler([toRouteObject(music, indexLoader)]);
  const result = await query(request);
  expect(result).not.toBeInstanceOf(Response);
  return result as {
    statusCode: number;
    errors: Record<string, unknown> | null;
    loaderData: Record<string, unknown>;
  };
}

describe("bare /music", () => {
  test("is an index route under the music layout", async () => {
    const music = await musicLayoutRoute();
    expect(music.path).toBe("music");

    const indexRoute = music.children?.find((child) => child.index);
    expect(indexRoute?.file).toBe(MUSIC_INDEX_FILE);
    expect(indexRoute?.id).toBe("routes/music+/index");
    expect(indexRoute?.path).toBeUndefined();
  });

  test("keeps child routes addressable", async () => {
    const music = await musicLayoutRoute();
    const services = music.children?.find((child) => child.file === "routes/music+/services.tsx");
    expect(services?.path).toBe("services");
    expect(services?.index).toBeUndefined();

    const servicesIndex = findRoute(services?.children ?? [], "routes/music+/services+/index.tsx");
    expect(servicesIndex?.index).toBe(true);

    expect(findRoute(music.children ?? [], "routes/music+/services+/youtube.tsx")?.path).toBe(
      "youtube",
    );
    expect(findRoute(music.children ?? [], "routes/music+/services+/local+/upload.tsx")?.path).toBe(
      "local/upload",
    );
    expect(findRoute(music.children ?? [], "routes/music+/admin+/duplicates.tsx")?.path).toBe(
      "admin/duplicates",
    );
    expect(findRoute(music.children ?? [], "routes/music+/curator+/dashboard.tsx")?.path).toBe(
      "curator/dashboard",
    );
  });

  test("loader throws 404 for anonymous and logged-in requests", async () => {
    const { loader } = await loadMusicIndex();
    const anonymous = await thrownResponse(() =>
      loader({ request: new Request("http://localhost/music") }),
    );
    const loggedInRequestForIndex = await loggedInRequest("http://localhost/music");
    const loggedIn = await thrownResponse(() => loader({ request: loggedInRequestForIndex }));

    expect(anonymous.status).toBe(404);
    expect(await anonymous.text()).toBe("Not found");
    expect(anonymous.headers.get("Location")).toBeNull();

    expect(loggedIn.status).toBe(404);
    expect(await loggedIn.text()).toBe("Not found");
    expect(loggedIn.headers.get("Location")).toBeNull();
  });

  test("document request is 404 only for the index", async () => {
    const { loader } = await loadMusicIndex();
    const anonymous = await queryMusic(new Request("http://localhost/music"), loader);
    const loggedIn = await queryMusic(
      await loggedInRequest("http://localhost/music?from=bookmark"),
      loader,
    );
    const services = await queryMusic(new Request("http://localhost/music/services"), loader);
    const youtube = await queryMusic(
      new Request("http://localhost/music/services/youtube"),
      loader,
    );
    const upload = await queryMusic(
      new Request("http://localhost/music/services/local/upload"),
      loader,
    );

    for (const context of [anonymous, loggedIn]) {
      expect(context.statusCode).toBe(404);
      const error = context.errors?.["routes/music+/index"];
      expect(isRouteErrorResponse(error)).toBe(true);
      if (isRouteErrorResponse(error)) expect(error.status).toBe(404);
    }

    expect(services.statusCode).toBe(200);
    expect(services.errors).toBeNull();
    expect(services.loaderData["routes/music+/index"]).toBeUndefined();
    expect(services.loaderData["routes/music+/services+/index"]).toEqual({
      file: "routes/music+/services+/index.tsx",
    });

    expect(youtube.statusCode).toBe(200);
    expect(youtube.loaderData["routes/music+/services+/youtube"]).toEqual({
      file: "routes/music+/services+/youtube.tsx",
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.loaderData["routes/music+/services+/local+/upload"]).toEqual({
      file: "routes/music+/services+/local+/upload.tsx",
    });
  });
});
