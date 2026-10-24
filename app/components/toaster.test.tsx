/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useToast as useServerToast } from "#app/components/toaster.tsx";
import { Toaster } from "#app/components/ui/toaster.tsx";
import { resetToastsForTests } from "#app/components/ui/use-toast.ts";
import { type Toast } from "#app/utils/toast.server.ts";

const emailToast: Toast = {
  id: "email-toast",
  title: "Email Changed",
  description: "Your email has been changed to ada@example.com",
  type: "success",
};

const passwordToast: Toast = {
  id: "password-toast",
  title: "Password Changed",
  description: "Your password has been changed.",
  type: "success",
};

afterEach(() => {
  resetToastsForTests();
  vi.unstubAllGlobals();
});

describe("server toast hook", () => {
  test("a later server toast replaces the one already on screen", async () => {
    const frames: Array<{ id: number; callback: FrameRequestCallback; cancelled: boolean }> = [];
    let nextFrameId = 0;

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.push({ id, callback, cancelled: false });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      const frame = frames.find((entry) => entry.id === id);
      if (frame) frame.cancelled = true;
    });

    function Screen() {
      const [toast, setToast] = useState<Toast | null>(emailToast);
      useServerToast(toast);
      return (
        <>
          <button type="button" onClick={() => setToast(passwordToast)}>
            Show password toast
          </button>
          <Toaster />
        </>
      );
    }

    const router = createMemoryRouter([{ path: "/", element: <Screen /> }]);
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: "Show password toast" }));

    await act(async () => {
      // A stale email frame must not run after the password frame and put the old toast back.
      const pending = frames.splice(0, frames.length).filter((frame) => !frame.cancelled);
      const latest = pending[pending.length - 1];
      const stale = pending.filter((frame) => frame !== latest);
      latest?.callback(0);
      for (const frame of stale) frame.callback(0);
      await flushFrames(frames);
    });

    expect(screen.getByText("Password Changed")).toBeVisible();
    expect(screen.queryByText("Email Changed")).not.toBeInTheDocument();
  });
});

async function flushFrames(
  frames: Array<{ id: number; callback: FrameRequestCallback; cancelled: boolean }>,
) {
  for (let guard = 0; guard < 10; guard += 1) {
    const pending = frames.splice(0, frames.length).filter((frame) => !frame.cancelled);
    if (pending.length === 0) return;
    for (const frame of pending) frame.callback(0);
    await Promise.resolve();
  }
}
