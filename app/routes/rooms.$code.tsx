/**
 * Smart join via `/rooms/:code` (ADR-030).
 * - Logged-in → Party Room hub (client join + RoomsHub)
 * - Logged-out → Guest Shell layout (Room + Search tabs)
 */

import { useCallback, useEffect, useRef } from "react";
import { data, Link, NavLink, Outlet, useLoaderData, useNavigate, useParams } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { formatRoomRole } from "#app/components/party-room/guest-room-live-panel.tsx";
import { RoomsHub } from "#app/components/party-room/rooms-hub.tsx";
import { canAddTracks } from "#app/features/party-room/capabilities.ts";
import {
  isValidRoomCode,
  normalizeRoomCode,
  parseRoomCodeInput as parseRoomCodeInputClient,
} from "#app/features/party-room/code.ts";
import { ROOM_STATUS } from "#app/features/party-room/constants.ts";
import { parseRoomCodeInput } from "#app/features/party-room/codes.ts";
import {
  resolveRoomParticipantByCode,
  type SeatedParticipant,
} from "#app/features/party-room/participant-seat.server.ts";
import { getRoomSnapshotByCode } from "#app/features/party-room/party-room.server.ts";
import {
  useOptionalPartyRoom,
  usePartyRoom,
} from "#app/features/party-room/party-room-provider.tsx";
import { resolveOptionalUserId } from "#app/features/party-room/request.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { cn } from "#app/utils/misc.tsx";
import { type Route } from "./+types/rooms.$code.ts";
import { GuestJoinForm, type GuestRoomOutletContext } from "./rooms.$code._index.tsx";

const ROOM_ENDED_COPY = "This room has ended.";
const ROOM_NOT_FOUND_COPY = "Room not found";
const GUEST_REMOVED_COPY = "The host removed you from this room.";
const ROOM_CODE_ALPHABET_COPY = "Codes use A–Z and 1–9, without 0, O, or I.";

function isInvalidRoomCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return !parseRoomCodeInput(trimmed) && !parseRoomCodeInputClient(trimmed);
}

type GuestLoaderData = {
  mode: "guest";
  guestShell: true;
  code: string;
  room: {
    id: string;
    code: string;
    status: string;
    defaultJoinRole: string;
    currentIndex: number;
    roomVersion: number;
    isPlaying: boolean;
  } | null;
  ended: boolean;
  invalidCode: boolean;
  participant: SeatedParticipant | null;
  canAddTracks: boolean;
  queue: Array<{
    id: string;
    position: number;
    track?: { title?: string; artist?: { name?: string } | null } | null;
  }>;
};

type UserLoaderData = {
  mode: "user";
  guestShell: false;
  code: string;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const raw = params.code ?? "";
  const code = parseRoomCodeInput(raw) ?? parseRoomCodeInputClient(raw);
  const userId = await resolveOptionalUserId(request);

  if (!code) {
    if (userId) {
      return data({
        mode: "user",
        guestShell: false,
        code: raw.toUpperCase(),
      } satisfies UserLoaderData);
    }
    return data({
      mode: "guest",
      guestShell: true,
      code: raw.toUpperCase(),
      room: null,
      ended: false,
      invalidCode: true,
      participant: null,
      canAddTracks: false,
      queue: [],
    } satisfies GuestLoaderData);
  }

  if (userId) {
    return data({
      mode: "user",
      guestShell: false,
      code,
    } satisfies UserLoaderData);
  }

  let snapshot: Awaited<ReturnType<typeof getRoomSnapshotByCode>> | null = null;
  try {
    snapshot = await getRoomSnapshotByCode(code);
  } catch {
    snapshot = null;
  }

  if (!snapshot) {
    const endedRoom = await prisma.room.findFirst({
      where: { code, status: ROOM_STATUS.ended },
      select: { id: true },
    });
    return data({
      mode: "guest",
      guestShell: true,
      code,
      room: null,
      ended: Boolean(endedRoom),
      invalidCode: false,
      participant: null,
      canAddTracks: false,
      queue: [],
    } satisfies GuestLoaderData);
  }

  const participant = await resolveRoomParticipantByCode(request, snapshot.code);
  return data({
    mode: "guest",
    guestShell: true,
    code: snapshot.code,
    room: {
      id: snapshot.roomId,
      code: snapshot.code,
      status: snapshot.status,
      defaultJoinRole: snapshot.defaultJoinRole,
      currentIndex: snapshot.currentIndex,
      roomVersion: snapshot.roomVersion,
      isPlaying: snapshot.isPlaying,
    },
    ended: snapshot.status === ROOM_STATUS.ended,
    invalidCode: false,
    participant,
    canAddTracks: participant ? canAddTracks(participant.role) : false,
    queue: snapshot.queue,
  } satisfies GuestLoaderData);
}

export default function RoomByCodeRoute() {
  const loaderData = useLoaderData<typeof loader>();

  if (loaderData.mode === "user") {
    return <LoggedInRoomByCode />;
  }

  return <GuestRoomShell roomShell={loaderData} />;
}

function LoggedInRoomByCode() {
  const { code: rawCode } = useParams();
  const party = usePartyRoom();
  const navigate = useNavigate();
  const code = rawCode ? normalizeRoomCode(rawCode) : "";
  const joinAttemptedForCode = useRef<string | null>(null);

  // Reset attempt when the route code changes
  useEffect(() => {
    joinAttemptedForCode.current = null;
  }, [code]);

  useEffect(() => {
    if (!code || !isValidRoomCode(code)) return;
    if (party.loading) return;
    if (party.room?.code === code) return;
    if (party.apiUnavailable) return;
    if (joinAttemptedForCode.current === code) return;

    joinAttemptedForCode.current = code;
    void party
      .join(code)
      .then((room) => {
        if (room.code !== code) {
          void navigate(`/rooms/${room.code}`, { replace: true });
        }
      })
      .catch(() => {
        // Error surfaced via party.error on hub; do not retry-loop.
      });
  }, [code, party.loading, party.room?.code, party.apiUnavailable, party.join, navigate]);

  if (rawCode && isInvalidRoomCode(rawCode)) {
    return <InvalidRoomCode />;
  }

  return <RoomsHub />;
}

function GuestRoomShell({ roomShell }: { roomShell: GuestLoaderData }) {
  const params = useParams();
  const rawCode = params.code ?? roomShell.code;
  const party = useOptionalPartyRoom();
  const sawThisRoom = useRef(false);
  const dismissal = useRef<null | "kicked" | "ended" | "left">(null);
  const onLeaveStart = useCallback(() => {
    dismissal.current = "left";
  }, []);

  const live = party?.room?.code === roomShell.code ? party.room : null;
  if (live?.status === "open" && live.me) {
    sawThisRoom.current = true;
  }

  const kicked =
    Boolean(roomShell.participant) &&
    live?.status === "open" &&
    !live.me &&
    !live.participants.some((participant) => participant.id === roomShell.participant?.id);
  if (kicked && dismissal.current !== "left") {
    dismissal.current = "kicked";
  }

  const lostLiveRoom =
    Boolean(roomShell.participant) &&
    sawThisRoom.current &&
    !party?.loading &&
    (!live || live.status === "ended");
  if (lostLiveRoom && dismissal.current !== "kicked" && dismissal.current !== "left") {
    dismissal.current = "ended";
  }

  if (roomShell.invalidCode || isInvalidRoomCode(rawCode)) {
    return <InvalidRoomCode />;
  }

  if (dismissal.current === "kicked") {
    return <GuestJoinForm code={roomShell.code} notice={GUEST_REMOVED_COPY} />;
  }

  if (roomShell.ended || dismissal.current === "ended") {
    return <RoomStatusMessage ended />;
  }

  if (!roomShell.room || !roomShell.participant) {
    return roomShell.room ? (
      <GuestJoinForm code={roomShell.code} />
    ) : (
      <RoomStatusMessage ended={false} />
    );
  }

  const displayName = live?.me?.displayName || roomShell.participant.displayName;
  const role = live?.me?.role ?? roomShell.participant.role;
  const outletContext: GuestRoomOutletContext = {
    role,
    displayName,
    onLeaveStart,
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Party Room</p>
            <p className="font-mono text-xl font-semibold tracking-widest">{roomShell.code}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{displayName}</p>
            <p className="text-muted-foreground">{formatRoomRole(role)}</p>
          </div>
        </div>
        <nav
          className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1"
          aria-label="Guest shell"
        >
          <GuestTab to={`/rooms/${roomShell.code}`} end>
            Room
          </GuestTab>
          <GuestTab to={`/rooms/${roomShell.code}/search`}>Search</GuestTab>
        </nav>
      </header>
      <main className="flex-1 px-4 py-4">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}

function RoomStatusMessage({ ended }: { ended: boolean }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-2xl font-semibold tracking-tight">
        {ended ? ROOM_ENDED_COPY : ROOM_NOT_FOUND_COPY}
      </p>
      <p className="text-sm text-muted-foreground">Ask the host for a new code or join link.</p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Back home
      </Link>
    </div>
  );
}

function InvalidRoomCode() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Invalid room code</h1>
      <p className="text-sm text-muted-foreground">{ROOM_CODE_ALPHABET_COPY}</p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Back home
      </Link>
    </div>
  );
}

function GuestTab({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
          isActive
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
