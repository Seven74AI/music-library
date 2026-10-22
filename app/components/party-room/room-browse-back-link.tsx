import { Link, useLocation } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";
import { readRoomSearchReturn, roomSearchHref } from "#app/features/party-room/room-browse.ts";

export function RoomBrowseBackLink({ code }: { code: string }) {
  const location = useLocation();
  const href = roomSearchHref(code, readRoomSearchReturn(location.state));

  return (
    <Link
      to={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <Icon name="arrow-left" className="h-4 w-4" />
      Back to search
    </Link>
  );
}
