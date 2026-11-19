/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { parseString } from "set-cookie-parser";
import { expect, test, vi } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import ProfileIndexRoute, { action } from "./profile.index.tsx";

vi.mock("openimg/react", () => ({
  Img: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
}));

const loaderData = {
  user: {
    id: "user-1",
    name: "QA-settings Renamed",
    username: "qasetbn693z350",
    email: "qa@example.com",
    image: null,
    _count: { sessions: 1 },
  },
  hasPassword: true,
  isTwoFactorEnabled: false,
  profilePrivacy: {
    showTopTracks: true,
    showTopArtists: false,
    showTotals: true,
    showHeavyRotation: true,
    showRecentlyPlayed: false,
    showPlaylists: false,
  },
};

function renderProfile() {
  const router = createMemoryRouter(
    [
      {
        path: "/settings/profile",
        element: (
          <ProfileIndexRoute loaderData={loaderData as never} params={{}} matches={[] as never} />
        ),
      },
    ],
    { initialEntries: ["/settings/profile"] },
  );
  return render(<RouterProvider router={router} />);
}

test("stacks username and name on small screens and uses two columns from md", async () => {
  renderProfile();

  const username = await screen.findByRole("textbox", { name: /^username$/i });
  const name = screen.getByRole("textbox", { name: /^name$/i });
  expect(username).toHaveValue("qasetbn693z350");
  expect(name).toHaveValue("QA-settings Renamed");

  const usernameField = username.parentElement;
  const nameField = name.parentElement;
  const grid = usernameField?.parentElement;
  expect(grid).toBeTruthy();
  expect(grid).toBe(nameField?.parentElement);
  expect(grid).toHaveClass("grid", "grid-cols-1", "gap-x-10", "md:grid-cols-2");
  expect(grid).not.toHaveClass("grid-cols-6");
  expect(usernameField).not.toHaveClass("col-span-3");
  expect(nameField).not.toHaveClass("col-span-3");

  const save = screen.getByRole("button", { name: /save changes/i });
  expect(save).toHaveAttribute("type", "submit");
  expect(save).toHaveAttribute("name", "intent");
  expect(save).toHaveAttribute("value", "update-profile");
});

test("renders profile privacy toggles reflecting settings and a public-by-default notice", async () => {
  renderProfile();

  expect(await screen.findByText(/public by default/i)).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: /show top tracks/i })).toBeChecked();
  expect(screen.getByRole("switch", { name: /show top artists/i })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: /show listening totals/i })).toBeChecked();
  expect(screen.getByRole("switch", { name: /show heavy rotation/i })).toBeChecked();
  expect(screen.getByRole("switch", { name: /show recently played/i })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: /show playlists/i })).not.toBeChecked();

  const save = screen.getByRole("button", { name: /save privacy settings/i });
  expect(save).toHaveAttribute("name", "intent");
  expect(save).toHaveAttribute("value", "privacy-update");
});

test("toggling a switch and submitting the real form flips the ProfilePrivacy row", async () => {
  const user = await prisma.user.create({ data: createUser() });
  const session = await prisma.session.create({
    data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    select: { id: true },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
  const cookie = `${parsed.name}=${parsed.value}`;

  const router = createMemoryRouter(
    [
      {
        path: "/settings/profile",
        action: async ({ request }) => {
          request.headers.set("cookie", cookie);
          return action({
            request,
            params: {},
            context: {} as never,
            url: new URL(request.url),
            pattern: "/settings/profile",
          } as never);
        },
        element: (
          <ProfileIndexRoute
            loaderData={
              {
                ...loaderData,
                user: { ...loaderData.user, id: user.id },
                profilePrivacy: {
                  showTopTracks: true,
                  showTopArtists: true,
                  showTotals: true,
                  showHeavyRotation: true,
                  showRecentlyPlayed: true,
                  showPlaylists: true,
                },
              } as never
            }
            params={{}}
            matches={[] as never}
          />
        ),
      },
    ],
    { initialEntries: ["/settings/profile"] },
  );
  render(<RouterProvider router={router} />);

  const heavy = await screen.findByRole("switch", { name: /show heavy rotation/i });
  await userEvent.click(heavy);
  expect(heavy).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: /save privacy settings/i }));

  await waitFor(async () => {
    const row = await prisma.profilePrivacy.findUnique({ where: { userId: user.id } });
    expect(row).toMatchObject({
      showTopTracks: true,
      showTopArtists: true,
      showTotals: true,
      showHeavyRotation: false,
      showRecentlyPlayed: true,
      showPlaylists: true,
    });
  });
});
