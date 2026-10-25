/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { action, default as YouTubeAuthPage } from "./auth";

vi.mock("#app/utils/auth.server", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}));

const originalEnv = {
  YOUTUBE_MOCKS: process.env.YOUTUBE_MOCKS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  SITE_URL: process.env.SITE_URL,
};

function setEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function restoreEnv() {
  for (const name of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    setEnv(name, originalEnv[name]);
  }
}

function renderAuthPage(search = "") {
  const App = createRoutesStub([
    {
      path: "/music/services/youtube/auth",
      Component: YouTubeAuthPage,
    },
  ]);

  render(<App initialEntries={[`/music/services/youtube/auth${search}`]} />);
}

async function postConnect() {
  return action({
    request: new Request("http://localhost:3000/music/services/youtube/auth", { method: "POST" }),
    params: {},
    context: {},
  } as never);
}

describe("YouTube auth page", () => {
  beforeEach(() => {
    setEnv("YOUTUBE_MOCKS", undefined);
    setEnv("GOOGLE_CLIENT_ID", "");
    setEnv("GOOGLE_CLIENT_SECRET", "");
    setEnv("SITE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    restoreEnv();
  });

  test("renders the error query so oauth_error is visible", async () => {
    renderAuthPage("?error=oauth_error");

    expect(await screen.findByRole("heading", { name: /connect youtube account/i })).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("oauth_error");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not start the YouTube connection.");
  });

  test("renders other auth error query values", async () => {
    renderAuthPage("?error=already_connected");

    expect(await screen.findByRole("alert")).toHaveTextContent("already_connected");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That YouTube account is already connected to another user.",
    );
  });

  test("does not show an error when the error query is absent", async () => {
    renderAuthPage();

    expect(await screen.findByRole("heading", { name: /connect youtube account/i })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("connect redirects to the mock callback when YouTube mocks are on and Google credentials are empty", async () => {
    consoleError.mockImplementation(() => {});
    setEnv("YOUTUBE_MOCKS", "true");

    const response = (await postConnect()) as Response;
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(`${url.origin}${url.pathname}`).toBe(
      "http://localhost:3000/music/services/youtube/callback",
    );
    expect(url.searchParams.get("code")).toBe("mock-auth-code");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(location).not.toContain("error=oauth_error");
    expect(response.headers.get("set-cookie")).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("connect still redirects to oauth_error when mocks are off and Google credentials are empty", async () => {
    consoleError.mockImplementation(() => {});
    setEnv("YOUTUBE_MOCKS", "false");

    const response = (await postConnect()) as Response;

    expect(response.headers.get("Location")).toBe("/music/services/youtube/auth?error=oauth_error");
  });
});
