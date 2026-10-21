/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { FlagForReviewDialog } from "./flag-for-review-dialog";

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

function renderFlag(entity: { id: string; name: string }) {
  return (
    <FlagForReviewDialog
      entityType="album"
      entityId={entity.id}
      entityName={entity.name}
      open
      onOpenChange={() => {}}
    />
  );
}

test("clears the previous entity's flag draft and posts the new id", async () => {
  const user = userEvent.setup();
  const { rerender } = render(renderFlag({ id: "album-a", name: "Kind of Blue" }));

  await user.selectOptions(screen.getByRole("combobox", { name: "Issue type" }), "wrong_metadata");
  await user.type(screen.getByLabelText(/Comment/), "Wrong year on Kind of Blue");
  mockFetcher.data = { error: "Could not flag Kind of Blue" };

  rerender(renderFlag({ id: "album-b", name: "Blue Train" }));

  expect(screen.getByText(/Blue Train/)).toBeInTheDocument();
  expect(screen.queryByText(/Kind of Blue/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Comment/)).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Issue type" })).toHaveValue("");
  expect(screen.queryByText("Could not flag Kind of Blue")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Issue type" }), "missing_info");
  await user.type(screen.getByLabelText(/Comment/), "Missing cover");
  await user.click(screen.getByRole("button", { name: "Flag for Review" }));

  const formData = mockSubmit.mock.calls[0]?.[0] as FormData;
  expect(formData.get("entityId")).toBe("album-b");
  expect(formData.get("entityType")).toBe("album");
  expect(formData.get("issueType")).toBe("missing_info");
  expect(formData.get("comment")).toBe("Missing cover");
  expect(mockSubmit.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    action: "/api/curator/queue/flag",
  });
});
