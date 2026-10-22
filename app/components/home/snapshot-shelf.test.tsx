/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { type OnRepeatSnapshotSummary } from "#app/features/on-repeat-snapshots/queries.server.ts";
import { SnapshotShelf } from "./snapshot-shelf.tsx";

vi.mock("#app/components/playlist-cover.tsx", () => ({
  PlaylistCover: () => <div data-testid="playlist-cover" />,
}));

const snapshots: OnRepeatSnapshotSummary[] = [
  {
    id: "s1",
    yearMonth: "2026-08",
    generatedAt: new Date("2026-09-01"),
    trackCount: 12,
    previewTracks: [],
  },
  {
    id: "s2",
    yearMonth: "2026-07",
    generatedAt: new Date("2026-08-01"),
    trackCount: 5,
    previewTracks: [],
  },
];

function renderShelf(props: { snapshots: OnRepeatSnapshotSummary[]; hideWhenEmpty?: boolean }) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <SnapshotShelf {...props} />,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

test("renders latest snapshots with link to history", () => {
  renderShelf({ snapshots });
  expect(screen.getByRole("heading", { name: "On-Repeat" })).toBeInTheDocument();
  expect(screen.getByText("August 2026")).toBeInTheDocument();
  expect(screen.getByText("12 tracks")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/on-repeat");
});

test("hides when empty and hideWhenEmpty is set", () => {
  const { container } = renderShelf({ snapshots: [], hideWhenEmpty: true });
  expect(container.querySelector("section")).toBeNull();
});
