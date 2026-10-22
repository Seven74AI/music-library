/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ReportIssueDialog } from "./report-issue-dialog";

const mockSubmit = vi.fn();
const mockFetcher = {
  state: "idle" as "idle" | "submitting" | "loading",
  data: undefined as { success?: boolean; error?: string } | undefined,
  submit: mockSubmit,
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => mockFetcher,
  };
});

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

vi.mock("#app/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="Issue type"
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">Select</option>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

beforeEach(() => {
  mockFetcher.state = "idle";
  mockFetcher.data = undefined;
  mockSubmit.mockReset();
});

function renderReport(track: { id: string; title: string }) {
  return (
    <ReportIssueDialog trackId={track.id} trackTitle={track.title} open onOpenChange={() => {}} />
  );
}

test("clears the previous track's report and posts the new track id", async () => {
  const user = userEvent.setup();
  const { rerender } = render(renderReport({ id: "track-a", title: "So What" }));

  await user.selectOptions(screen.getByRole("combobox", { name: "Issue type" }), "wrong_metadata");
  await user.type(screen.getByLabelText(/Description/), "So What is mistitled");
  mockFetcher.data = { error: "Could not report So What" };

  rerender(renderReport({ id: "track-b", title: "Blue in Green" }));

  expect(screen.getByText(/Blue in Green/)).toBeInTheDocument();
  expect(screen.queryByText(/So What/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Description/)).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Issue type" })).toHaveValue("");
  expect(screen.queryByText("Could not report So What")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Issue type" }), "low_quality");
  await user.type(screen.getByLabelText(/Description/), "Audio drops out");
  await user.click(screen.getByRole("button", { name: "Submit Report" }));

  const formData = mockSubmit.mock.calls[0]?.[0] as FormData;
  expect(formData.get("trackId")).toBe("track-b");
  expect(formData.get("issueType")).toBe("low_quality");
  expect(formData.get("description")).toBe("Audio drops out");
  expect(mockSubmit.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    action: "/api/curator/queue/report",
  });
});
