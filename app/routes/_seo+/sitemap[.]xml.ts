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

  // TODO: This is typeerror is coming up since of the remix-run/server-runtime package. We might need to remove/update that one.
  // @ts-expect-error
  return generateSitemap(request, build.routes, {
    siteUrl: getDomainUrl(request),
    headers: {
      "Cache-Control": `public, max-age=${60 * 5}`,
    },
  });
}
