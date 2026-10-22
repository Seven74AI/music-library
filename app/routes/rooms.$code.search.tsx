/**
 * Party-room catalog shell: search, album, and artist pages share one seat gate,
 * and audition keeps playing as the guest moves between them.
 */

import { Outlet, useLoaderData } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { RoomCatalogActionsProvider } from "#app/components/party-room/room-catalog-actions.tsx";
import { canAddTracks, isRoomRole } from "#app/features/party-room/capabilities.ts";
import { requireRoomCatalogSeat } from "#app/features/party-room/room-catalog.server.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";

export async function loader({ request, params }: { request: Request; params: { code?: string } }) {
  const seat = await requireRoomCatalogSeat(request, params.code ?? "");
  return {
    code: seat.code,
    role: seat.participant.role,
    canAddTracks: seat.canAddTracks,
    displayName: seat.participant.displayName,
  };
}

export default function GuestSearchLayout() {
  const { code, canAddTracks: loaderCanAdd } = useLoaderData<typeof loader>();
  const party = useOptionalPartyRoom();
  const liveRole = party?.room?.code === code ? party.room.me?.role : undefined;
  const canAdd = liveRole && isRoomRole(liveRole) ? canAddTracks(liveRole) : loaderCanAdd;

  return (
    <RoomCatalogActionsProvider code={code} canAdd={canAdd}>
      <Outlet />
    </RoomCatalogActionsProvider>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
