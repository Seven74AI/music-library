/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { type ActivityResult } from "#app/features/curator/dashboard.ts";
import { ActivityFeed } from "./activity-feed.tsx";

const activity: ActivityResult = {
  items: [
    {
      id: "track:1",
      action: "edited",
      entityType: "track",
      entityId: "track-secret",
      entityName: "So What — Miles Davis",
      summary: "Alice edited 'So What — Miles Davis'",
      message: "unused",
      matter: "Fixed the credit",
      createdAt: new Date().toISOString(),
      curator: { id: "user-1", username: "alice", name: "Alice" },
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  curators: [],
};

test("activity names the track, links it, and shows the edit comment", () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <ActivityFeed url="/api/curator/activity" poll={false} initial={activity} />,
      },
      { path: "/library/:trackId", element: <div>Track</div> },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  expect(screen.getByRole("link", { name: "So What — Miles Davis" })).toHaveAttribute(
    "href",
    "/library/track-secret",
  );
  expect(screen.getByText("Fixed the credit")).toBeInTheDocument();
  expect(screen.getByText(/Alice edited/)).toBeInTheDocument();
  expect(screen.queryByText("track-secret")).not.toBeInTheDocument();
});
