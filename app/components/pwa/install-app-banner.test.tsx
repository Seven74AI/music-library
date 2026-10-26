/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  InstallAppBanner,
  roomChromeCollisionPadding,
  roomChromeScrollClearance,
} from "./install-app-banner.tsx";

const pwa = vi.hoisted(() => ({
  visible: true,
  dismiss: vi.fn(),
  install: vi.fn(async () => true),
  isIos: false,
  isAndroid: true,
  canInstallNatively: true,
}));

vi.mock("#app/hooks/use-pwa-install.ts", () => ({
  usePwaInstall: () => pwa,
}));

function bannerRoot() {
  const region = screen.getByRole("region", { name: "Install app" });
  const banner = region.parentElement;
  if (!banner) throw new Error("Install banner wrapper missing");
  return banner;
}

describe("InstallAppBanner", () => {
  beforeEach(() => {
    pwa.visible = true;
    pwa.dismiss = vi.fn();
    pwa.install = vi.fn(async () => true);
    pwa.canInstallNatively = true;
  });

  test("renders nothing after the prompt is dismissed", () => {
    pwa.visible = false;
    const { container } = render(<InstallAppBanner playerVisible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("stacks above the mobile nav and rests on the desktop viewport edge", () => {
    render(<InstallAppBanner playerVisible={false} />);

    const banner = bannerRoot();
    expect(banner).toHaveAttribute("data-testid", "install-app-banner");
    expect(banner).toHaveClass("fixed");
    expect(banner).toHaveClass("z-51");
    expect(banner.className).not.toMatch(/(?:^|\s)z-30(?:\s|$)/);
    expect(banner.className).toContain(
      "bottom-[calc(var(--bottom-bar-height,4rem)+env(safe-area-inset-bottom))]",
    );
    expect(banner).toHaveClass("md:bottom-0");
    expect(banner.style.bottom).toBe("");
  });

  test("stacks above the mini player and the desktop player while playback is open", () => {
    render(<InstallAppBanner playerVisible />);

    const banner = bannerRoot();
    expect(banner).toHaveClass("z-51");
    expect(banner.className).toContain("--toast-bottom-offset");
    expect(banner.className).toContain("--player-error-height");
    expect(banner.className).not.toContain("4.5rem");
    expect(banner).not.toHaveClass("md:bottom-0");
    expect(banner.style.bottom).not.toBe("4.5rem");
    expect(banner.style.bottom).not.toBe("0");
  });

  test("Not now dismisses the fixed banner", async () => {
    const user = userEvent.setup();
    render(<InstallAppBanner playerVisible={false} />);

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(pwa.dismiss).toHaveBeenCalledOnce();
  });

  test("scroll clearance still accounts for the player and the nav", () => {
    expect(roomChromeScrollClearance).toContain("--bottom-bar-height");
    expect(roomChromeScrollClearance).toContain("--player-error-height");
    expect(roomChromeScrollClearance).toContain("--toast-bottom-offset");
    expect(roomChromeScrollClearance).toContain("--install-banner-height");
    expect(roomChromeScrollClearance).toContain("env(safe-area-inset-bottom)");
    expect(roomChromeScrollClearance).not.toContain("md:pb-0");
  });

  test("publishes its height so the page can scroll clear of the player and the nav", () => {
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    Object.defineProperty(proto, "offsetHeight", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "install-app-banner" ? 133 : 0;
      },
    });

    try {
      const { rerender } = render(<InstallAppBanner playerVisible />);
      const banner = bannerRoot();
      expect(banner).toHaveClass("z-51");
      expect(banner.className).toContain("--toast-bottom-offset");
      expect(banner.className).toContain("--bottom-bar-height");
      expect(banner.className).toContain("--player-error-height");
      expect(document.body.style.getPropertyValue("--install-banner-height")).toBe("133px");

      pwa.visible = false;
      rerender(<InstallAppBanner playerVisible />);
      expect(document.body.style.getPropertyValue("--install-banner-height")).toBe("");
    } finally {
      if (original) Object.defineProperty(proto, "offsetHeight", original);
      document.body.style.removeProperty("--install-banner-height");
    }
  });
});

describe("roomChromeCollisionPadding", () => {
  const originalMatchMedia = window.matchMedia;

  function mockViewport(desktop: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.style.removeProperty("--install-banner-height");
    document.body.style.removeProperty("--bottom-bar-height");
    document.body.style.removeProperty("--player-error-height");
    document.body.style.removeProperty("--toast-bottom-offset");
  });

  test("keeps portaled menus above the banner and the mobile nav", () => {
    mockViewport(false);
    document.body.style.setProperty("--install-banner-height", "133px");
    document.body.style.setProperty("--bottom-bar-height", "64px");
    document.body.style.setProperty("--player-error-height", "10px");

    expect(roomChromeCollisionPadding().bottom).toBeGreaterThanOrEqual(133 + 64 + 10);
  });

  test("keeps portaled menus above the banner and the desktop player", () => {
    mockViewport(true);
    document.body.style.setProperty("--install-banner-height", "113px");
    document.body.style.setProperty("--toast-bottom-offset", "80px");

    expect(roomChromeCollisionPadding().bottom).toBeGreaterThanOrEqual(113 + 80);
  });
});
