/**
 * Guest join + Room tab — join form or live guest room session.
 */

import { useEffect, useRef } from "react";
import { redirect, useFetcher, useLoaderData, useOutletContext } from "react-router";
import {
  GUEST_DISPLAY_NAME_MAX,
  GUEST_DISPLAY_NAME_MIN,
  type RoomRole,
} from "#app/features/party-room/constants.ts";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { GuestRoomLivePanel } from "#app/components/party-room/guest-room-live-panel.tsx";
import {
  readGuestToken,
  serializeGuestTokenCookie,
} from "#app/features/party-room/guest-token.server.ts";
import { parseRoomCodeInput } from "#app/features/party-room/codes.ts";
import { resolveRoomParticipantByCode } from "#app/features/party-room/participant-seat.server.ts";
import { joinRoom, PartyRoomError } from "#app/features/party-room/party-room.server.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/rooms.$code._index.ts";

export type GuestRoomOutletContext = {
  role?: RoomRole;
  displayName?: string;
  onLeaveStart?: () => void;
};

export async function loader({ request, params }: { request: Request; params: { code?: string } }) {
  const code = parseRoomCodeInput(params.code ?? "") ?? (params.code ?? "").toUpperCase();
  const participant = await resolveRoomParticipantByCode(request, code);
  return { code, seated: Boolean(participant), participant };
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request, params }: { request: Request; params: { code?: string } }) {
  const code = parseRoomCodeInput(params.code ?? "") ?? (params.code ?? "").toUpperCase();
  const formData = await request.formData();
  const displayName = String(formData.get("displayName") ?? "");
  const guestToken = await readGuestToken(request);

  try {
    const result = await joinRoom({
      code,
      actor: { type: "guest", displayName, guestToken },
    });
    const headers = result.guestToken
      ? { "Set-Cookie": await serializeGuestTokenCookie(result.guestToken) }
      : undefined;
    return redirect(`/rooms/${result.code}`, { headers });
  } catch (error) {
    if (error instanceof PartyRoomError) {
      const message =
        error.code === "invalid_display_name"
          ? `Name must be ${GUEST_DISPLAY_NAME_MIN}–${GUEST_DISPLAY_NAME_MAX} characters`
          : error.code === "not_found"
            ? "Room not found"
            : error.code === "room_ended"
              ? "This room has ended."
              : error.code === "room_full"
                ? "Room is full"
                : error.message;
      return { error: message };
    }
    throw error;
  }
}

export function GuestJoinForm({ code, notice }: { code: string; notice?: string | null }) {
  const fetcher = useFetcher<typeof action>();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = fetcher.state !== "idle";
  const actionError = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Join party</p>
        <h1 className="font-mono text-3xl font-semibold tracking-widest">{code}</h1>
        <p className="text-sm text-muted-foreground">
          Pick a display name to enter the guest shell.
        </p>
      </div>
      {notice ? (
        <p className="text-center text-sm text-destructive" role="alert">
          {notice}
        </p>
      ) : null}
      <fetcher.Form method="post" action={`/rooms/${code}?index`} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <p id="displayName-hint" className="text-xs text-muted-foreground">
            {GUEST_DISPLAY_NAME_MIN}–{GUEST_DISPLAY_NAME_MAX} characters
          </p>
          <Input
            ref={inputRef}
            id="displayName"
            name="displayName"
            minLength={GUEST_DISPLAY_NAME_MIN}
            maxLength={GUEST_DISPLAY_NAME_MAX}
            aria-describedby="displayName-hint"
            autoComplete="nickname"
            placeholder="Your name"
            required
            disabled={busy}
          />
        </div>
        {actionError ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Joining…" : "Join room"}
        </Button>
      </fetcher.Form>
    </div>
  );
}

export default function GuestJoinOrRoom() {
  const { seated, participant, code } = useLoaderData<typeof loader>();
  const outlet = useOutletContext<GuestRoomOutletContext | null>();

  if (seated && participant) {
    return (
      <GuestRoomLivePanel
        code={code}
        role={outlet?.role ?? participant.role}
        displayName={outlet?.displayName ?? participant.displayName}
        onLeaveStart={outlet?.onLeaveStart}
      />
    );
  }

  return <GuestJoinForm code={code} />;
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
