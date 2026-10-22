/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog.tsx";

function UnmountOnClose() {
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button">Library</button>;
  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Editor</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}

test("unmounting a dialog restores clicks on the page", async () => {
  const user = userEvent.setup();
  render(<UnmountOnClose />);
  expect(await screen.findByRole("dialog", { name: "Editor" })).toBeTruthy();
  document.body.style.pointerEvents = "none";

  await user.keyboard("{Escape}");
  expect(await screen.findByRole("button", { name: "Library" })).toBeTruthy();

  await waitFor(() => {
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
