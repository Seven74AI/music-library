/**
 * Guest Shell Search tab — has-audio catalog via participant-gated API.
 * Audition plays one track at a time on this device (not the room speaker).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useLoaderData } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { canAddTracks, isRoomRole } from "#app/features/party-room/capabilities.ts";
import { parseRoomCodeInput } from "#app/features/party-room/codes.ts";
import { resolveRoomParticipantByCode } from "#app/features/party-room/participant-seat.server.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { type SearchResult } from "#app/types/search.ts";

export async function loader({ request, params }: { request: Request; params: { code?: string } }) {
  const code = parseRoomCodeInput(params.code ?? "") ?? (params.code ?? "").toUpperCase();
  const participant = await resolveRoomParticipantByCode(request, code);
  if (!participant) {
    throw new Response(null, { status: 302, headers: { Location: `/rooms/${code}` } });
  }
  return {
    code,
    role: participant.role,
    canAddTracks: canAddTracks(participant.role),
    displayName: participant.displayName,
  };
}

type AuditionState = {
  grantId: string;
  audioUrl: string;
  title: string;
  artistName: string;
} | null;

export default function GuestSearchTab() {
  const { code, canAddTracks: loaderCanAdd } = useLoaderData<typeof loader>();
  const party = useOptionalPartyRoom();
  const liveRole = party?.room?.code === code ? party.room.me?.role : undefined;
  const canAdd = liveRole && isRoomRole(liveRole) ? canAddTracks(liveRole) : loaderCanAdd;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [audition, setAudition] = useState<AuditionState>(null);
  const [auditionError, setAuditionError] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await fetch(
            `/api/rooms/${encodeURIComponent(code)}/search?q=${encodeURIComponent(q)}&type=all&limit=30`,
            { credentials: "same-origin" },
          );
          if (res.status === 401) {
            setError("Join the room to search");
            setResults([]);
            return;
          }
          if (res.status === 429) {
            setError("Too many searches — wait a moment");
            return;
          }
          if (!res.ok) {
            setError("Search failed");
            return;
          }
          const body = (await res.json()) as { results?: SearchResult[] };
          setResults(body.results ?? []);
          setError(null);
        } catch {
          setError("Search failed");
        }
      });
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, code]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audition) return;
    el.src = audition.audioUrl;
    void el.play().catch(() => {
      setAuditionError("Tap play to start audition (browser blocked autoplay)");
    });
  }, [audition]);

  async function startAudition(track: Extract<SearchResult, { type: "track" }>) {
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
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setAudition({
        grantId: body.grantId,
        audioUrl: body.audioUrl,
        title: body.track.title,
        artistName: body.track.artistName,
      });
    } catch {
      setAuditionError("Could not start audition");
    }
  }

  function stopAudition() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
    setAudition(null);
  }

  async function addToQueue(track: Extract<SearchResult, { type: "track" }>) {
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
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Search</h2>
        <p className="text-sm text-muted-foreground">
          Full catalog with audio only
          {canAdd
            ? ". Add to queue from your role."
            : ". Audition to preview — add requires DJ/Host."}
        </p>
      </div>

      <div className="relative">
        <Icon
          name="magnifying-glass"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists, albums, tracks…"
          className="pl-9"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {isPending && query.trim() ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : null}

      <ul className="divide-y divide-border/60">
        {results.map((result) => (
          <li key={`${result.type}-${result.id}`} className="py-3">
            {result.type === "track" ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{result.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {result.artistName}
                    {result.albumName ? ` · ${result.albumName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canAdd ? (
                    <button
                      type="button"
                      onClick={() => void addToQueue(result)}
                      disabled={addingTrackId === result.id}
                      className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {addingTrackId === result.id ? "Adding…" : "Add"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void startAudition(result)}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  >
                    Audition
                  </button>
                </div>
              </div>
            ) : result.type === "album" ? (
              <div>
                <p className="font-medium">{result.name}</p>
                <p className="text-sm text-muted-foreground">{result.artistName}</p>
              </div>
            ) : result.type === "artist" ? (
              <div>
                <p className="font-medium">{result.name}</p>
                <p className="text-sm text-muted-foreground">Artist</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!isPending && query.trim() && results.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No has-audio matches.</p>
      ) : null}
      {addMessage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {addMessage}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {audition ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{audition.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {audition.artistName} · Audition
                </p>
              </div>
              <audio ref={audioRef} controls className="h-8 max-w-[50%] flex-1" />
              <button
                type="button"
                onClick={stopAudition}
                className="text-xs text-muted-foreground underline"
              >
                Stop
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Audition plays one track on this device.
            </p>
          )}
        </div>
        {auditionError ? (
          <p className="mx-auto mt-1 max-w-lg text-xs text-destructive">{auditionError}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
