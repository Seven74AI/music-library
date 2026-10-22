/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "#app/components/ui/dialog";
import { Toaster } from "#app/components/ui/toaster.tsx";
import { resetToastsForTests } from "#app/components/ui/use-toast.ts";
import { UndoToast } from "./undo-toast";

afterEach(() => {
  resetToastsForTests();
  vi.unstubAllGlobals();
});

function installPointerCapture() {
  const proto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
}

type Submission = { editId: string | undefined; body: unknown };

function EditorHarness() {
  const [open, setOpen] = useState(true);
  if (!open) return <Toaster />;
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Edit track</DialogTitle>
          <DialogDescription>Metadata editor</DialogDescription>
        </DialogContent>
      </Dialog>
      <UndoToast open onOpenChange={() => {}} trackId="track-1" />
      <Toaster />
    </>
  );
}

test("pointer click on Undo opens confirm and posts the restore while the editor stays open", async () => {
  installPointerCapture();
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
  const submissions: Submission[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/metadata/tracks/track-1/history") {
        return { json: async () => ({ history: [{ id: "edit-9" }] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  const router = createMemoryRouter(
    [
      { path: "/", element: <EditorHarness /> },
      {
        path: "/api/metadata/tracks/:trackId/restore/:editId",
        action: async ({ request, params }) => {
          submissions.push({
            editId: params.editId,
            body: (await request.json()) as unknown,
          });
          return { ok: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByText("Changes saved successfully")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Edit track" })).toBeTruthy();

  const undo = screen.getByRole("button", { name: "Undo", hidden: true });
  await user.click(undo);

  expect(await screen.findByRole("heading", { name: "Undo Changes?" })).toBeTruthy();
  // The confirm dialog hides the editor from the accessibility tree; it stays mounted.
  expect(screen.getByRole("heading", { name: "Edit track", hidden: true })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Undo Changes" }));

  await waitFor(() => {
    expect(submissions).toEqual([
      {
        editId: "edit-9",
        body: { comment: "Quick undo within 5 minutes of edit" },
      },
    ]);
  });
  expect(screen.getByRole("heading", { name: "Edit track", hidden: true })).toBeTruthy();
});
