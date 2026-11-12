// learn more: https://fly.io/docs/reference/configuration/#services-http_checks
import { prisma } from "#app/utils/db.server.ts";
import { loopbackInternalUrl } from "#app/utils/internal-fetch.server.ts";
import { type Route } from "./+types/healthcheck.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const isNestedHealthcheck = request.headers.get("X-Healthcheck") === "true";
  const selfPath = new URL(request.url).pathname;

  try {
    // Nested probe from the outer healthcheck: DB ping only — no self-fetch.
    if (isNestedHealthcheck) {
      await prisma.user.count();
      return new Response("OK");
    }

    // if we can connect to the database and make a simple query
    // and make a HEAD request to ourselves, then we're good. The target is
    // loopback, NOT SITE_URL: the public URL is unhealthy until this check
    // passes, so using it would deadlock in-place deploys.
    await Promise.all([
      prisma.user.count(),
      fetch(loopbackInternalUrl(selfPath), {
        method: "HEAD",
        headers: { "X-Healthcheck": "true" },
      }).then((r) => {
        if (!r.ok) return Promise.reject(r);
        return new Response("OK");
      }),
    ]);
    return new Response("OK");
  } catch (error: unknown) {
    console.log("healthcheck ❌", { error });
    return new Response("ERROR", { status: 500 });
  }
}
