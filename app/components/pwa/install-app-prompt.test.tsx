/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { InstallAppPrompt } from "./install-app-prompt.tsx";

describe("InstallAppPrompt", () => {
  test("renders Android install button when native install is available", async () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();

    render(
      <InstallAppPrompt
        layout="banner"
        isIos={false}
        canInstallNatively
        onInstall={onInstall}
        onDismiss={onDismiss}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /install app/i }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  test("renders iOS instructions when on Safari", () => {
    render(
      <InstallAppPrompt
        layout="banner"
        isIos
        canInstallNatively={false}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install app/i })).not.toBeInTheDocument();
  });

  test("calls onDismiss when close is clicked", async () => {
    const onDismiss = vi.fn();

    render(
      <InstallAppPrompt
        layout="card"
        isIos={false}
        canInstallNatively={false}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
