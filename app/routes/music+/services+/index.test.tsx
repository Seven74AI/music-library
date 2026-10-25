/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { LOCAL_SERVICE, YOUTUBE_SERVICE } from "#app/constants/services.ts";
import ServicesHub from "./index.tsx";

const LOCAL_UPLOAD_STATUS = "Upload audio files from your computer";

const now = new Date("2026-10-24T00:00:00.000Z");

const localService = {
  id: "service-local",
  name: LOCAL_SERVICE.NAME,
  displayName: LOCAL_SERVICE.DISPLAY_NAME,
  logoUrl: null,
  baseUrl: "",
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

const youtubeService = {
  id: "service-youtube",
  name: YOUTUBE_SERVICE.NAME,
  displayName: YOUTUBE_SERVICE.DISPLAY_NAME,
  logoUrl: null,
  baseUrl: YOUTUBE_SERVICE.BASE_URL,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

function renderHub(
  youtubeConnectionStatus: {
    connected: boolean;
    syncStatus: { totalPlaylists: number; lastSync: Date | null } | null;
  } | null,
) {
  const router = createMemoryRouter(
    [
      {
        path: "/music/services",
        element: (
          <ServicesHub
            loaderData={{
              services: [localService, youtubeService],
              youtubeConnectionStatus,
            }}
            params={{}}
            matches={[] as never}
          />
        ),
      },
    ],
    { initialEntries: ["/music/services"] },
  );

  return render(<RouterProvider router={router} />);
}

function serviceCard(name: string) {
  const heading = screen.getByRole("heading", { name });
  const card = heading.closest("div.rounded-lg");
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Could not find service card for ${name}`);
  }
  return within(card);
}

test("local upload describes file upload and does not use a connection status", () => {
  renderHub({ connected: false, syncStatus: null });

  const local = serviceCard("Local Upload");
  expect(local.getByText(LOCAL_UPLOAD_STATUS)).toBeInTheDocument();
  expect(local.queryByText("Not connected")).not.toBeInTheDocument();
  expect(local.queryByText("Connected")).not.toBeInTheDocument();
  expect(local.getByRole("link", { name: /upload/i })).toHaveAttribute(
    "href",
    "/music/services/local/upload",
  );

  expect(serviceCard("YouTube").getByText("Not connected")).toBeInTheDocument();
  expect(serviceCard("YouTube").getByRole("link", { name: /connect/i })).toHaveAttribute(
    "href",
    "/music/services/youtube/auth",
  );
});

test("youtube stays connected while local upload keeps its upload label", () => {
  renderHub({
    connected: true,
    syncStatus: { totalPlaylists: 3, lastSync: new Date("2026-10-01T00:00:00.000Z") },
  });

  const local = serviceCard("Local Upload");
  expect(local.getByText(LOCAL_UPLOAD_STATUS)).toBeInTheDocument();
  expect(local.queryByText("Connected")).not.toBeInTheDocument();
  expect(local.queryByText("Not connected")).not.toBeInTheDocument();

  const youtube = serviceCard("YouTube");
  expect(youtube.getByText("Connected")).toBeInTheDocument();
  expect(youtube.getByText("3 playlists synced")).toBeInTheDocument();
  expect(youtube.queryByText("Not connected")).not.toBeInTheDocument();
  expect(youtube.getByRole("link", { name: /manage/i })).toHaveAttribute(
    "href",
    "/music/services/youtube",
  );
});
