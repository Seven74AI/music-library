/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type * as ReactRouter from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { type ReviewQueueListItem } from "#app/features/curator/review-queue.ts";
import { QueueTable } from "./queue-table.tsx";

const mockSubmit = vi.fn();
const mockLoad = vi.fn();
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: mockToast,
}));

vi.mock("#app/features/curator/use-curator-session.ts", () => ({
  useCuratorFilterSession: () => {},
}));

let queueData: {
  items: ReviewQueueListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  currentUserId: string;
};
let actionData: { success?: boolean; error?: string } | undefined;

const queueFetcher = {
  get state() {
    return "idle" as const;
  },
  get data() {
    return queueData;
  },
  load: mockLoad,
};

const actionFetcher = {
  get state() {
    return "idle" as const;
  },
  get data() {
    return actionData;
  },
  submit: mockSubmit,
};

let fetcherCallCount = 0;
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useFetcher: () => {
      fetcherCallCount += 1;
      return fetcherCallCount % 2 === 1 ? queueFetcher : actionFetcher;
    },
  };
});

const trackId = "track-cuid-secret";

function queueItem(overrides: Partial<ReviewQueueListItem> = {}): ReviewQueueListItem {
  return {
    id: "item-1",
    entityType: "track",
    entityId: trackId,
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
    ...overrides,
  };
}

beforeEach(() => {
  fetcherCallCount = 0;
  actionData = undefined;
  mockSubmit.mockClear();
  mockLoad.mockClear();
  mockToast.mockClear();
  queueData = {
    items: [queueItem()],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    currentUserId: "curator-1",
  };
});

test("a report preview shows the entity name and the matter, not the id", () => {
  render(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: "So What — Miles Davis" })).toHaveAttribute(
    "href",
    `/library/${trackId}`,
  );
  expect(screen.getByText("The artist credit is wrong")).toBeInTheDocument();
  expect(screen.getByText("Matter")).toBeInTheDocument();
  expect(screen.queryByText(trackId)).not.toBeInTheDocument();
});

test("claiming a report points the curator at My claims", async () => {
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Claim" }));
  expect(mockSubmit).toHaveBeenCalledWith(expect.any(FormData), {
    method: "POST",
    action: "/api/curator/queue/item-1/claim",
  });

  actionData = { success: true };
  view.rerender(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  expect(mockToast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Claim saved",
      description: expect.stringContaining("So What — Miles Davis"),
    }),
  );
  expect(mockToast.mock.calls[0]?.[0].description).toBe(
    "So What — Miles Davis. Matter: The artist credit is wrong. Find it under My claims.",
  );
  expect(mockLoad).toHaveBeenCalledWith(expect.stringContaining("status=mine"));
});

test("unclaiming a report puts it back on the open list", async () => {
  const user = userEvent.setup();
  queueData = {
    ...queueData,
    items: [
      queueItem({
        status: "claimed",
        claimedBy: "curator-1",
        claimedByUser: { id: "curator-1", username: "ada", name: "Ada" },
      }),
    ],
  };
  const view = render(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "My claims" }));
  await user.click(screen.getByRole("button", { name: "Unclaim" }));

  actionData = { success: true };
  view.rerender(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  expect(mockToast.mock.calls.at(-1)?.[0]).toEqual({
    title: "Claim released",
    description:
      "So What — Miles Davis. Matter: The artist credit is wrong. It's back in the open list.",
  });
  expect(mockLoad.mock.calls.at(-1)?.[0]).toContain("status=open");
});

test("My claims loads only the curator's claimed reports", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <QueueTable />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "My claims" }));

  expect(mockLoad).toHaveBeenCalledWith(expect.stringContaining("status=mine"));
});
