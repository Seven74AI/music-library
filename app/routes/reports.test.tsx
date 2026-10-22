/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { expect, test } from "vitest";
import ReportsPage from "./reports.tsx";

test("my reports shows the entity name and the matter", async () => {
  const App = createRoutesStub([
    {
      path: "/",
      HydrateFallback: () => null,
      children: [
        {
          path: "reports",
          Component: ReportsPage,
          loader: () => ({
            items: [
              {
                id: "item-1",
                entityType: "track",
                entityId: "track-secret",
                source: "user_report",
                issueType: "wrong_metadata",
                description: "The artist credit is wrong",
                status: "open",
                priority: 1,
                claimedBy: null,
                resolution: null,
                resolutionComment: null,
                createdAt: "2026-10-01T00:00:00.000Z",
                entityDetails: { name: "So What — Miles Davis" },
                reporter: { id: "user-1", username: "kody", name: "Kody" },
                claimedByUser: null,
                resolvedByUser: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
        },
        { path: "library/:trackId", Component: () => null },
      ],
    },
  ]);

  render(<App initialEntries={["/reports"]} />);

  expect(await screen.findByRole("link", { name: /So What — Miles Davis/ })).toHaveAttribute(
    "href",
    "/library/track-secret",
  );
  expect(screen.getByText("The artist credit is wrong")).toBeInTheDocument();
  expect(screen.getByText("Open")).toBeInTheDocument();
  expect(screen.queryByText("track-secret")).not.toBeInTheDocument();
});
