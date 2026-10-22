/**
 * @vitest-environment jsdom
 */
import { useEffect, useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseString } from "set-cookie-parser";
import { beforeEach, expect, test, vi } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import DuplicatesRoute, { loader } from "./duplicates.tsx";

const { toastSpy, fetcherControls } = vi.hoisted(() => {
  type Snapshot = {
    state: "idle" | "submitting" | "loading";
    data:
      | {
          success?: boolean;
          trackId?: string;
          objectsDeleted?: number;
          objectsPreserved?: number;
        }
      | undefined;
    formData: FormData | undefined;
    submit: ReturnType<typeof vi.fn>;
  };
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = {
    state: "idle",
    data: undefined,
    formData: undefined,
    submit: vi.fn(),
  };
  const publish = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    toastSpy: vi.fn(),
    fetcherControls: {
      get: () => snapshot,
      reset: () => {
        publish({
          state: "idle",
          data: undefined,
          formData: undefined,
          submit: vi.fn(),
        });
      },
      set: (partial: Partial<Omit<Snapshot, "submit">>) => {
        publish({ ...snapshot, ...partial });
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
});

vi.mock("#app/components/ui/use-toast.ts", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("react-router", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => {
      const [, rerender] = React.useState(0);
      React.useEffect(() => fetcherControls.subscribe(() => rerender((count) => count + 1)), []);
      return fetcherControls.get();
    },
  };
});

beforeEach(() => {
  toastSpy.mockClear();
  fetcherControls.reset();
});

const exactGroup = {
  id: "abc123",
  type: "exact" as const,
  contentHash: "abc123",
  tracks: [
    {
      trackId: "t1",
      title: "Original Song",
      artist: "Ada",
      fileSize: 2048,
      contentHash: "abc123",
      fileName: "original.mp3",
      format: "mp3",
      audioFileId: "a1",
    },
    {
      trackId: "t2",
      title: "Copy Song",
      artist: "Ada",
      fileSize: 2048,
      contentHash: "abc123",
      fileName: "copy.mp3",
      format: "mp3",
      audioFileId: "a2",
    },
  ],
};

const similarGroup = {
  id: "similar:a:b",
  type: "similar" as const,
  contentHash: null,
  confidence: 0.9,
  tracks: [
    {
      trackId: "s1",
      title: "Take One",
      artist: "Bea",
      fileSize: 3000,
      contentHash: "h1",
      fileName: "one.mp3",
      format: "mp3",
      audioFileId: "a",
      confidence: 1,
    },
    {
      trackId: "s2",
      title: "Take Two",
      artist: "Bea",
      fileSize: 3100,
      contentHash: "h2",
      fileName: "two.mp3",
      format: "mp3",
      audioFileId: "b",
      confidence: 0.9,
    },
  ],
};

function renderDashboard(
  groups: Array<typeof exactGroup | typeof similarGroup>,
  path = "/music/admin/duplicates",
  groupsRef?: { setGroups?: (next: typeof groups) => void },
) {
  const filter = (new URL(path, "http://localhost").searchParams.get("filter") ?? "all") as
    | "all"
    | "exact"
    | "similar"
    | "intentional";

  function Harness() {
    const [currentGroups, setCurrentGroups] = useState(groups);
    useEffect(() => {
      if (groupsRef) groupsRef.setGroups = setCurrentGroups;
    }, []);
    return (
      <DuplicatesRoute
        loaderData={{
          stats: {
            storageSaved: 2048,
            duplicateGroups: currentGroups.length,
            totalDuplicates: currentGroups.length,
          },
          groups: currentGroups,
          filter,
        }}
        params={{}}
        matches={[] as never}
      />
    );
  }

  const router = createMemoryRouter([{ path: "/music/admin/duplicates", element: <Harness /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

test("enables the similar-audio filter and shows group confidence", async () => {
  renderDashboard([exactGroup, similarGroup]);

  const similarButton = await screen.findByRole("button", { name: /similar audio/i });
  expect(similarButton).toBeEnabled();
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  expect(screen.getAllByText(/90% confidence/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /keep both/i })).toHaveLength(2);
});

test("hides keep both when viewing intentional groups", async () => {
  renderDashboard([exactGroup], "/music/admin/duplicates?filter=intentional");

  expect(await screen.findByRole("button", { name: /intentional/i })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /keep both/i })).not.toBeInTheDocument();
});

test("track title and View open the library track page", async () => {
  renderDashboard([exactGroup]);

  expect(await screen.findByRole("link", { name: "Original Song" })).toHaveAttribute(
    "href",
    "/library/t1",
  );
  expect(screen.getByRole("link", { name: "Copy Song" })).toHaveAttribute("href", "/library/t2");

  const viewLinks = screen.getAllByRole("link", { name: "View" });
  expect(viewLinks.map((link) => link.getAttribute("href"))).toEqual([
    "/library/t1",
    "/library/t2",
  ]);
});

test("shows Track Deleted when deleting the last extra unmounts the group", async () => {
  const user = userEvent.setup();
  const groupsRef: {
    setGroups?: (next: Array<typeof exactGroup | typeof similarGroup>) => void;
  } = {};
  renderDashboard([exactGroup], "/music/admin/duplicates", groupsRef);

  expect(screen.getAllByRole("button", { name: /^delete$/i })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: /^delete$/i }));

  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "Delete Copy Song?" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

  expect(fetcherControls.get().submit).toHaveBeenCalledWith(null, {
    method: "DELETE",
    action: "/api/admin/tracks/t2",
  });

  const success = { success: true, trackId: "t2" };

  // Action data arrives while revalidation is still in flight. The card hides
  // itself (one track left) but stays mounted.
  await act(async () => {
    fetcherControls.set({ state: "loading", data: success });
  });
  expect(screen.queryByRole("heading", { name: "Original Song" })).not.toBeInTheDocument();

  // Revalidation finishes in the same update that drops the group, so the card
  // unmounts without committing an idle render.
  await act(async () => {
    fetcherControls.set({ state: "idle", data: success });
    groupsRef.setGroups?.([]);
  });

  expect(toastSpy).toHaveBeenCalledTimes(1);
  expect(toastSpy).toHaveBeenCalledWith({
    title: "Track deleted",
    description: "Copy Song. It has been removed from the library.",
  });
});

test("shows Track Deleted once when the group stays mounted after delete", async () => {
  const user = userEvent.setup();
  const copy = exactGroup.tracks[1];
  if (!copy) throw new Error("expected a duplicate track");
  const triple = {
    ...exactGroup,
    tracks: [
      ...exactGroup.tracks,
      {
        ...copy,
        trackId: "t3",
        title: "Third Copy",
        fileName: "third.mp3",
        audioFileId: "a3",
      },
    ],
  };
  renderDashboard([triple]);

  const deleteButton = screen.getAllByRole("button", { name: /^delete$/i })[0];
  if (!deleteButton) throw new Error("expected a delete button");
  await user.click(deleteButton);
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

  const success = { success: true, trackId: "t2" };
  await act(async () => {
    fetcherControls.set({ state: "loading", data: success });
  });
  await act(async () => {
    fetcherControls.set({ state: "idle", data: success });
  });

  expect(screen.getByRole("heading", { name: "Original Song" })).toBeInTheDocument();
  expect(screen.queryByText("Copy Song")).not.toBeInTheDocument();
  expect(toastSpy).toHaveBeenCalledTimes(1);
  expect(toastSpy).toHaveBeenCalledWith({
    title: "Track deleted",
    description: "Copy Song. It has been removed from the library.",
  });
});

test("cancel on Delete track does not send DELETE", async () => {
  const user = userEvent.setup();
  renderDashboard([exactGroup]);

  await user.click(screen.getByRole("button", { name: /^delete$/i }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

  expect(fetcherControls.get().submit).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByText("Copy Song")).toBeInTheDocument();
});

async function createAdminSession() {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
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

test("duplicates lookup uses a trusted origin and only the session cookie", async () => {
  const cookieHeader = await createAdminSession();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      stats: { storageSaved: 0, duplicateGroups: 0, totalDuplicates: 0 },
      groups: [],
      filter: "all",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const request = new Request("http://evil.example/music/admin/duplicates?filter=intentional", {
    headers: {
      cookie: `${cookieHeader}; theme=dark`,
      authorization: "Bearer leaked-token",
      "x-forwarded-host": "evil.example",
    },
  });

  await loader({ request, url: new URL(request.url) } as never);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [fetchedUrl, init] = fetchMock.mock.calls[0]!;
  expect(String(fetchedUrl)).toBe(`${trustedOrigin()}/api/admin/duplicates?filter=intentional`);
  const headers = new Headers(init?.headers);
  expect(headers.get("cookie")).toBe(cookieHeader);
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-forwarded-host")).toBeNull();
});
