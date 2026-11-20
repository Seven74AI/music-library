import { data, type LoaderFunctionArgs } from "react-router";
import {
  jsonError,
  loadEditorVersion,
} from "#app/features/karaoke-generation/versions.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";

/** GET ?trackId=…&versionId=… → ONE version's full content for the editor. */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserId(request);
  const params = new URL(request.url).searchParams;
  const trackId = params.get("trackId");
  const versionId = params.get("versionId");
  if (!trackId || !versionId) {
    return jsonError("trackId and versionId are required", 400);
  }
  const version = await loadEditorVersion(trackId, versionId);
  if (!version) return jsonError("Version not found", 404);
  return data({ success: true, version });
}
