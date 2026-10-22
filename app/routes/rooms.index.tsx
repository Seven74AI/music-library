import { RoomsHub } from "#app/components/party-room/rooms-hub.tsx";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { requireUserId } from "#app/utils/auth.server.ts";
import { type Route } from "./+types/rooms.index.ts";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return {};
}

export default function RoomsIndex() {
  return <RoomsHub />;
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
