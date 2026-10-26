/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  document.body.style.setProperty("--install-banner-height", "133px");
  document.body.style.setProperty("--bottom-bar-height", "64px");
  document.body.style.setProperty("--player-error-height", "0px");
});

afterEach(() => {
  document.body.style.removeProperty("--install-banner-height");
  document.body.style.removeProperty("--bottom-bar-height");
  document.body.style.removeProperty("--player-error-height");
});

test("portaled menus clear the install banner", () => {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>One</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  const menu = screen.getByRole("menu");
  const fiberKey = Object.keys(menu).find((key) => key.startsWith("__reactFiber"));
  if (!fiberKey) throw new Error("menu fiber missing");
  type Fiber = {
    memoizedProps?: { collisionPadding?: { bottom?: number } };
    return?: Fiber | null;
  };
  let fiber: Fiber | null = (menu as unknown as Record<string, Fiber>)[fiberKey] ?? null;
  let padding: { bottom?: number } | undefined;
  while (fiber) {
    padding = fiber.memoizedProps?.collisionPadding;
    if (padding) break;
    fiber = fiber.return ?? null;
  }

  expect(padding?.bottom).toBeGreaterThanOrEqual(133 + 64);
});
