import { generateSitemap } from "@nasa-gcn/remix-seo";
import { getDomainUrl } from "#app/utils/misc.tsx";
import { getServerAppContext } from "#app/utils/router-context.server.ts";
import { type Route } from "./+types/sitemap[.]xml.ts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const serverBuild = await getServerAppContext(context)?.serverBuild;

  if (!serverBuild) {
    throw new Response("Server build unavailable", { status: 500 });
  }

  const { build } = await serverBuild;

  // `generateSitemap` expects `build.routes` as `EntryRoute[]`, but
  // `react-router`'s server build types the routes as `AgnosticRouteObject[]`
  // (an incompatible shape) — hence the suppression below. If this error ever
  // disappears after a react-router upgrade, remove the directive.
  // @ts-expect-error build.routes type mismatch vs generateSitemap's expected route shape
  return generateSitemap(request, build.routes, {
    siteUrl: getDomainUrl(request),
    headers: {
      "Cache-Control": `public, max-age=${60 * 5}`,
    },
  });
}
