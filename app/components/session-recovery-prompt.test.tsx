/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { SessionRecoveryPrompt } from "./session-recovery-prompt.tsx";
import { discardSession, saveSessionState } from "#app/features/curator/session-recovery.client.ts";

beforeEach(() => {
  discardSession();
});

function renderPrompt(props?: { onRestore?: (states: unknown[]) => void; onDiscard?: () => void }) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <SessionRecoveryPrompt {...props} />,
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

test("asks to restore a saved session and discard clears it", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  saveSessionState({
    type: "selection",
    trackIds: ["track-1", "track-2"],
    context: "library",
    timestamp: Date.now(),
  });

  renderPrompt({ onDiscard });

  expect(await screen.findByRole("dialog", { name: "Restore previous session?" })).toBeTruthy();
  expect(screen.getByText("2 tracks selected")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.localStorage.getItem("curator-session-selection")).toBeNull();
});

test("restore returns the saved state and leaves storage for the next crash", async () => {
  const user = userEvent.setup();
  const onRestore = vi.fn();
  saveSessionState({
    type: "dialogs",
    openDialogs: [
      { dialogType: "track-edit", entityId: "track-9", unsavedChanges: { title: "Draft" } },
    ],
    timestamp: Date.now(),
  });

  renderPrompt({ onRestore });
  await user.click(await screen.findByRole("button", { name: "Restore" }));
  expect(onRestore).toHaveBeenCalledOnce();
  const states = onRestore.mock.calls[0]?.[0] as Array<{ type: string }>;
  expect(states[0]?.type).toBe("dialogs");
  expect(window.localStorage.getItem("curator-session-dialogs")).toContain("track-9");
});

test("Escape dismisses the prompt without discarding the session", async () => {
  const user = userEvent.setup();
  saveSessionState({
    type: "selection",
    trackIds: ["track-1"],
    context: "library",
    timestamp: Date.now(),
  });
  renderPrompt();
  expect(await screen.findByRole("dialog")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.localStorage.getItem("curator-session-selection")).toContain("track-1");
});
