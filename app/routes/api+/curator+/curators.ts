import { data, type LoaderFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { getCuratorsForAutocomplete } from "#app/utils/mention-parser.server.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCuratorOrAdmin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const curators = await getCuratorsForAutocomplete(query);

  return data({ curators });
}
