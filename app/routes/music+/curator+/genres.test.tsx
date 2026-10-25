/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { afterEach, expect, test, vi } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { default as GenresPage, loader, ErrorBoundary } from "./genres.tsx";

const genres = [
  {
    id: "genre-jazz",
    name: "Jazz",
    trackCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "genre-rock",
    name: "Rock",
    trackCount: 1,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

function renderGenres(actions?: { create?: () => unknown; update?: () => unknown }) {
  const App = createRoutesStub([
    {
      path: "/music/curator/genres",
      Component: GenresPage,
      loader: () => ({ genres }),
      HydrateFallback: () => <div>Loading...</div>,
    },
    {
      path: "/api/genres",
      action: () => actions?.create?.() ?? { error: "Genre already exists" },
    },
    {
      path: "/api/genres/:id",
      action: () => actions?.update?.() ?? { error: "A genre with this name already exists" },
    },
  ]);

  render(<App initialEntries={["/music/curator/genres"]} />);
}

test("genre name links to the library filtered by that genre", async () => {
  renderGenres();

  const link = await screen.findByRole("link", { name: "Jazz" });
  expect(link).toHaveAttribute("href", "/library?genre=genre-jazz");
  expect(screen.queryByRole("button", { name: "Jazz" })).not.toBeInTheDocument();
});

test("creating a duplicate genre shows the 409 message on the form", async () => {
  const user = userEvent.setup();
  renderGenres();

  await user.click(await screen.findByRole("button", { name: "Add Genre" }));
  await user.type(screen.getByLabelText("Genre Name"), "Jazz");
  await user.click(screen.getByRole("button", { name: "Create" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Genre already exists");
  // The dialog marks the page inert, so the heading is present but not exposed.
  expect(
    screen.getByRole("heading", { name: "Genre Management", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Create New Genre" })).toBeInTheDocument();
  expect(screen.queryByText(/^409/)).not.toBeInTheDocument();
});

test("a unique genre create closes the dialog and stays on the page", async () => {
  const user = userEvent.setup();
  renderGenres({
    create: () => ({
      genre: {
        id: "genre-house",
        name: "House",
        trackCount: 0,
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    }),
  });

  await user.click(await screen.findByRole("button", { name: "Add Genre" }));
  await user.type(screen.getByLabelText("Genre Name"), "House");
  await user.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Create New Genre" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("heading", { name: "Genre Management" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("renaming a genre to an existing name shows the 409 message on the form", async () => {
  const user = userEvent.setup();
  renderGenres();

  await user.click(await screen.findByRole("button", { name: "Edit Rock" }));
  const name = screen.getByLabelText("Genre Name");
  await user.clear(name);
  await user.type(name, "Jazz");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A genre with this name already exists",
  );
  // The dialog marks the page inert, so the heading is present but not exposed.
  expect(
    screen.getByRole("heading", { name: "Genre Management", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Edit Genre" })).toBeInTheDocument();
  expect(screen.queryByText(/^409/)).not.toBeInTheDocument();
});

test("a unique rename closes the dialog and stays on the page", async () => {
  const user = userEvent.setup();
  renderGenres({
    update: () => ({
      genre: {
        id: "genre-rock",
        name: "Rock & Roll",
        trackCount: 1,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    }),
  });

  await user.click(await screen.findByRole("button", { name: "Edit Rock" }));
  const name = screen.getByLabelText("Genre Name");
  await user.clear(name);
  await user.type(name, "Rock & Roll");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Edit Genre" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("heading", { name: "Genre Management" })).toBeInTheDocument();
});

// --- loader tests ---

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createSession(role?: "admin" | "curator") {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      ...(role
        ? {
            roles: {
              connectOrCreate: {
                where: { name: role },
                create: { name: role },
              },
            },
          }
        : {}),
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
}

function trustedOrigin() {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

function renderGenresRoute(cookieHeader: string) {
  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "music/curator/genres",
          Component: GenresPage,
          ErrorBoundary,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/music/curator/genres"]} />);
}

const genresPayload = {
  genres: [
    {
      id: "genre-jazz",
      name: "Jazz",
      trackCount: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "genre-rock",
      name: "Rock",
      trackCount: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
};

test("genre lookups use a trusted origin and only the session cookie", async () => {
  const cookieHeader = await createSession("curator");
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(genresPayload),
  );
  vi.stubGlobal("fetch", fetchMock);

  const request = new Request("http://evil.example/music/curator/genres", {
    headers: {
      cookie: `${cookieHeader}; theme=dark`,
      authorization: "Bearer leaked-token",
      "x-forwarded-host": "evil.example",
    },
  });

  const result = await loader({ request } as never);

  expect(result).toEqual({ genres: genresPayload.genres });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toBe(`${trustedOrigin()}/api/genres`);

  const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit | undefined)?.headers);
  expect(headers.get("cookie")).toBe(cookieHeader);
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-forwarded-host")).toBeNull();
});

test("a failed genre lookup throws instead of crashing at render", async () => {
  const cookieHeader = await createSession("curator");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("boom", { status: 500 })),
  );

  const request = new Request("http://localhost/music/curator/genres", {
    headers: { cookie: cookieHeader },
  });

  const error = await loader({ request } as never).catch((e) => e);
  expect(error).toMatchObject({
    type: "DataWithResponseInit",
    init: { status: 500 },
    data: { error: "Failed to load genres" },
  });
});

test("a genre payload without a genres array is an error", async () => {
  const cookieHeader = await createSession("curator");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ notGenres: true })),
  );

  const request = new Request("http://localhost/music/curator/genres", {
    headers: { cookie: cookieHeader },
  });

  const error = await loader({ request } as never).catch((e) => e);
  expect(error).toMatchObject({
    type: "DataWithResponseInit",
    init: { status: 500 },
    data: { error: "Failed to load genres" },
  });
});

test("a signed-in non-curator sees the curators-only 403", async () => {
  consoleError.mockImplementation(() => {});
  const cookieHeader = await createSession();
  const fetchMock = vi.fn(async () => Response.json(genresPayload));
  vi.stubGlobal("fetch", fetchMock);

  renderGenresRoute(cookieHeader);

  await screen.findByRole("heading", { name: "Curators only" }, { timeout: 5000 });
  expect(
    screen.getByText("You need the curator or admin role to view genre management."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Genre Management" })).not.toBeInTheDocument();
  expect(screen.queryByText(/403/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Unauthorized/)).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a non-JSON genre response is an error", async () => {
  const cookieHeader = await createSession("curator");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not json", { status: 200 })),
  );

  const request = new Request("http://localhost/music/curator/genres", {
    headers: { cookie: cookieHeader },
  });

  const error = await loader({ request } as never).catch((e) => e);
  expect(error).toMatchObject({
    type: "DataWithResponseInit",
    init: { status: 500 },
    data: { error: "Failed to load genres" },
  });
});
