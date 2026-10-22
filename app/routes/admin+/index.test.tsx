/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { expect, test } from "vitest";
import { getHealthColor } from "#app/features/admin/database-quality.server.ts";
import { isFailedLoginBadgeActive } from "#app/features/security/suspicious-activity.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { adminNavSections, default as AdminOverviewRoute, loader } from "./index.tsx";

async function createAdminCookie() {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

test("admin overview loader returns totals and 30-day series", async () => {
  const cookie = await createAdminCookie();
  const request = new Request("http://localhost/admin", {
    headers: { cookie },
  });

  const data = await loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin",
  });

  expect(data.totals.users).toBeGreaterThanOrEqual(1);
  expect(data.series.signups).toHaveLength(30);
  expect(data.series.dau).toHaveLength(30);
  expect(data.series.playsStarted).toHaveLength(30);
  expect(data.series.playsCompleted).toHaveLength(30);
  expect(data.series.libraryAdds).toHaveLength(30);
  expect(data.series.logins).toHaveLength(30);

  const sum = (series: Array<{ value: number }>) =>
    series.reduce((total, point) => total + point.value, 0);
  expect(data.totals.signups30d).toBe(sum(data.series.signups));
  expect(data.totals.playsStarted30d).toBe(sum(data.series.playsStarted));
  expect(data.totals.playsCompleted30d).toBe(sum(data.series.playsCompleted));
  expect(data.totals.libraryAdds30d).toBe(sum(data.series.libraryAdds));
  expect(data.totals.logins30d).toBe(sum(data.series.logins));
  expect(data.health.score).toBeGreaterThanOrEqual(0);
  expect(data.health.score).toBeLessThanOrEqual(100);
  expect(data.health.color).toBe(getHealthColor(data.health.score));
  expect(data.health.securityAlert).toBe(isFailedLoginBadgeActive(data.health.failedLogins24h));
  expect(data.health.missingAudio).toBeGreaterThanOrEqual(0);
  expect(data.health.missingCovers).toBeGreaterThanOrEqual(0);
  expect(data.health.storageBytes).toBeGreaterThanOrEqual(0);
});

test("health colors match the database quality thresholds", () => {
  expect(getHealthColor(90)).toBe("green");
  expect(getHealthColor(89)).toBe("yellow");
  expect(getHealthColor(70)).toBe("yellow");
  expect(getHealthColor(69)).toBe("red");
});

test("admin overview links health, content, users, security, and settings", async () => {
  const cookie = await createAdminCookie();
  const App = createRoutesStub([
    {
      path: "/admin",
      Component: AdminOverviewRoute,
      HydrateFallback: () => null,
      loader: async (args) => {
        args.request.headers.set("cookie", cookie);
        return loader({ ...args, context: args.context });
      },
    },
  ]);

  render(<App initialEntries={["/admin"]} />);

  expect(await screen.findByRole("heading", { name: "Admin overview" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /signups/i })).toBeInTheDocument();

  for (const name of [/signups/i, /dau/i, /plays started/i, /library adds/i]) {
    const chart = screen.getByRole("img", { name });
    const bars = chart.querySelectorAll<HTMLElement>("[title]");
    expect(bars).toHaveLength(30);
    for (const bar of bars) {
      expect(bar.getAttribute("style") ?? "").toMatch(/min-height:\s*2px/);
    }
  }

  const score = screen.getByTestId("health-score");
  const scoreValue = Number(score.textContent?.replace("%", ""));
  expect(score.className).toContain(
    getHealthColor(scoreValue) === "green"
      ? "text-green-600"
      : getHealthColor(scoreValue) === "yellow"
        ? "text-yellow-600"
        : "text-red-600",
  );

  for (const section of adminNavSections) {
    expect(screen.getAllByText(section.title).length).toBeGreaterThan(0);
    for (const link of section.links) {
      const matches = screen.getAllByRole("link", { name: link.label });
      expect(matches.some((element) => element.getAttribute("href") === link.to)).toBe(true);
    }
  }

  expect(screen.getByRole("link", { name: "Trigger FTS Reindex" })).toHaveAttribute(
    "href",
    "/admin/fts-index",
  );
  expect(screen.getByRole("link", { name: "View Failed Logins" })).toHaveAttribute(
    "href",
    "/admin/security-events?tab=failed",
  );
  expect(screen.getByRole("link", { name: "Clean Up Orphaned Files" })).toHaveAttribute(
    "href",
    "/admin/orphaned-tracks",
  );
});
