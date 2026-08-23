/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToastAction, ToastProvider, ToastViewport } from "#app/components/ui/toast.tsx";
import { Toaster } from "#app/components/ui/toaster.tsx";
import { resetToastsForTests, toast } from "#app/components/ui/use-toast.ts";

afterEach(() => {
  resetToastsForTests();
});

describe("ToastViewport", () => {
  test("uses pointer-events-none so empty viewport area does not block clicks", () => {
    render(
      <ToastProvider>
        <ToastViewport data-testid="toast-viewport" />
      </ToastProvider>,
    );

    expect(screen.getByTestId("toast-viewport")).toHaveClass("pointer-events-none");
  });
});

describe("Toaster", () => {
  test("clicking toast body dismisses the toast", async () => {
    render(<Toaster />);

    toast({ title: "Saved", description: "Your changes were saved." });

    expect(await screen.findByText("Saved")).toBeVisible();

    fireEvent.click(screen.getByText("Your changes were saved."));

    await waitFor(() => {
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });
  });

  test("clicking toast action button runs the action without using body dismiss", async () => {
    const onAction = vi.fn();
    render(<Toaster />);

    toast({
      title: "Update available",
      description: "A new version is ready.",
      duration: Infinity,
      action: (
        <ToastAction altText="Reload" onClick={onAction}>
          Reload
        </ToastAction>
      ),
    });

    expect(await screen.findByText("Update available")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(onAction).toHaveBeenCalledOnce();
  });
});
