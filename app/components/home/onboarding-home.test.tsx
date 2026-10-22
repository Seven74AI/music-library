/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { OnboardingHome } from "./onboarding-home.tsx";

type MockParty = {
  room: null | {
    status: string;
    code: string;
    me: { role: "host" | "dj" | "listener" } | null;
  };
  error: string | null;
  apiUnavailable: boolean;
  join: ReturnType<typeof vi.fn>;
};

let mockParty: MockParty | null = null;

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
}));

vi.mock("#app/hooks/use-pwa-install.ts", () => ({
  usePwaInstall: () => ({
    visible: false,
    dismiss: vi.fn(),
    install: vi.fn(),
    isIos: false,
    isAndroid: false,
    canInstallNatively: false,
  }),
}));

beforeEach(() => {
  mockParty = null;
});

function renderOnboarding(youtubeConnected: boolean, isAdmin: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <OnboardingHome youtubeConnected={youtubeConnected} isAdmin={isAdmin} />,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("shows Connect YouTube when YouTube is not connected", () => {
  renderOnboarding(false, false);

  const primaryLink = screen.getByRole("link", { name: /connect youtube/i });
  expect(primaryLink).toHaveAttribute("href", "/music/services/youtube/auth");

  const discoverLink = screen.getByRole("link", { name: /explore global library/i });
  expect(discoverLink).toHaveAttribute("href", "/discover");
});

test("shows Sync a playlist when YouTube is connected", () => {
  renderOnboarding(true, false);

  const primaryLink = screen.getByRole("link", { name: /sync a playlist/i });
  expect(primaryLink).toHaveAttribute("href", "/music/services/youtube/playlists");

  const discoverLink = screen.getByRole("link", { name: /explore global library/i });
  expect(discoverLink).toHaveAttribute("href", "/discover");
});

test("shows upload link for admin users", () => {
  renderOnboarding(false, true);

  const uploadLink = screen.getByRole("link", { name: /upload your files/i });
  expect(uploadLink).toHaveAttribute("href", "/music/services/local/upload");
  expect(screen.getByText(/search for tracks from search/i)).toBeInTheDocument();
});

test("hides upload link for non-admin users", () => {
  renderOnboarding(false, false);

  expect(screen.queryByRole("link", { name: /upload your files/i })).not.toBeInTheDocument();
});

test("shows Got a code? join and create when not seated", () => {
  mockParty = {
    room: null,
    error: null,
    apiUnavailable: false,
    join: vi.fn(),
  };
  renderOnboarding(false, false);

  expect(screen.getByRole("heading", { name: /got a code\?/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/room code or join link/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /join room/i })).toBeInTheDocument();
  const createRoom = screen.getByRole("link", { name: /create room/i });
  expect(createRoom).toHaveAttribute("href", "/rooms");
  expect(screen.queryByRole("link", { name: /open room/i })).not.toBeInTheDocument();
});

test("shows the room code, role, and open room when seated", () => {
  mockParty = {
    room: {
      status: "open",
      code: "AB3K9Q",
      me: { role: "dj" },
    },
    error: null,
    apiUnavailable: false,
    join: vi.fn(),
  };
  renderOnboarding(true, false);

  expect(screen.getByText(/you're in room AB3K9Q/i)).toBeInTheDocument();
  expect(screen.getByText("DJ")).toBeInTheDocument();
  const openRoom = screen.getByRole("link", { name: /open room/i });
  expect(openRoom).toHaveAttribute("href", "/rooms/AB3K9Q");
  expect(screen.queryByRole("heading", { name: /got a code\?/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/room code or join link/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /create room/i })).not.toBeInTheDocument();
});
