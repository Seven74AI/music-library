/**
 * Audition and add-to-queue actions shared by party-room search, album, and artist pages.
 * Audition keeps playing while the guest opens an album or artist.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type RoomCatalogTrack } from "#app/features/party-room/room-browse.ts";

type AuditionState = {
  grantId: string;
  audioUrl: string;
  title: string;
  artistName: string;
};

type RoomCatalogActionsValue = {
  code: string;
  canAdd: boolean;
  addingTrackId: string | null;
  addToQueue: (track: RoomCatalogTrack) => Promise<void>;
  startAudition: (track: RoomCatalogTrack) => Promise<void>;
};

const RoomCatalogActionsContext = createContext<RoomCatalogActionsValue | null>(null);

export function useRoomCatalogActions() {
  const value = useContext(RoomCatalogActionsContext);
  if (!value) {
    throw new Error("Room catalog actions are only available inside the party room search shell");
  }
  return value;
}

export function RoomCatalogActionsProvider({
  code,
  canAdd,
  children,
}: {
  code: string;
  canAdd: boolean;
  children: ReactNode;
}) {
  const [audition, setAudition] = useState<AuditionState | null>(null);
  const [auditionError, setAuditionError] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audition) return;
    el.src = audition.audioUrl;
    try {
      const playing = el.play();
      if (playing && typeof playing.catch === "function") {
        void playing.catch(() => {
          setAuditionError("Tap play to start audition (browser blocked autoplay)");
        });
      }
    } catch {
      setAuditionError("Tap play to start audition (browser blocked autoplay)");
    }
  }, [audition]);

  const startAudition = useCallback(
    async (track: RoomCatalogTrack) => {
      setAuditionError(null);
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/audition`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId: track.id }),
        });
        if (res.status === 401) {
          setAuditionError("Join the room to audition");
          return;
        }
        if (res.status === 429) {
          setAuditionError("Audition rate limit — try again shortly");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setAuditionError(body?.error ?? "Could not start audition");
          return;
        }
        const body = (await res.json()) as {
          grantId: string;
          audioUrl: string;
          track: { title: string; artistName: string };
        };
        audioRef.current?.pause();
        setAudition({
          grantId: body.grantId,
          audioUrl: body.audioUrl,
          title: body.track.title,
          artistName: body.track.artistName,
        });
      } catch {
        setAuditionError("Could not start audition");
      }
    },
    [code],
  );

  function stopAudition() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
    setAudition(null);
    setAuditionError(null);
  }

  const addToQueue = useCallback(
    async (track: RoomCatalogTrack) => {
      if (!canAdd) return;
      setAddMessage(null);
      setAddingTrackId(track.id);
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/queue`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "add_track", trackId: track.id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setAddMessage(body?.error ?? "Could not add to queue");
          return;
        }
        setAddMessage(`Added “${track.title}” to the room queue`);
      } catch {
        setAddMessage("Could not add to queue");
      } finally {
        setAddingTrackId(null);
      }
    },
    [canAdd, code],
  );

  const actions = useMemo(
    () => ({ code, canAdd, addingTrackId, addToQueue, startAudition }),
    [code, canAdd, addingTrackId, addToQueue, startAudition],
  );

  const showDock = Boolean(audition || auditionError || addMessage);

  return (
    <RoomCatalogActionsContext.Provider value={actions}>
      <div
        className={
          showDock
            ? "pb-[calc(var(--install-banner-height,0px)+8rem)]"
            : "pb-[var(--install-banner-height,0px)]"
        }
      >
        {children}
      </div>
      {showDock ? (
        <div
          data-testid="room-audition-dock"
          className="fixed inset-x-0 z-52 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur"
          style={{ bottom: "var(--install-banner-height, 0px)" }}
        >
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            {addMessage ? (
              <p className="text-sm text-muted-foreground" role="status">
                {addMessage}
              </p>
            ) : null}
            {audition ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{audition.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {audition.artistName} · Audition on this device
                  </p>
                </div>
                <audio ref={audioRef} controls className="h-8 max-w-[46%] flex-1" />
                <button
                  type="button"
                  onClick={stopAudition}
                  className="text-xs text-muted-foreground underline"
                >
                  Stop
                </button>
              </div>
            ) : (
              <audio ref={audioRef} className="hidden" />
            )}
            {auditionError ? <p className="text-xs text-destructive">{auditionError}</p> : null}
          </div>
        </div>
      ) : (
        <audio ref={audioRef} className="hidden" />
      )}
    </RoomCatalogActionsContext.Provider>
  );
}
