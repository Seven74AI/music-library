import { type FullTrack, type QueueTrack } from "#app/types/frontend/shared.ts";

export class AuthExpiredError extends Error {
  constructor() {
    super("Auth session expired");
    this.name = "AuthExpiredError";
  }
}

export type QueueSpineContext =
  | { type: "library" }
  | { type: "playlist"; playlistId: string }
  | { type: "artist"; artistId: string }
  | { type: "album"; albumId: string }
  | { type: "track"; trackId: string };

export type QueueSpineResponse = {
  tracks: QueueTrack[];
  total: number;
};

export async function fetchQueueSpine(context: QueueSpineContext): Promise<QueueSpineResponse> {
  let url: string;

  if (context.type === "library") {
    url = "/api/queue-spine?context=library&hasAudio=1";
  } else if (context.type === "playlist") {
    url = `/api/queue-spine?context=playlist&playlistId=${encodeURIComponent(context.playlistId)}`;
  } else if (context.type === "artist") {
    url = `/api/queue-spine?context=artist&artistId=${encodeURIComponent(context.artistId)}`;
  } else if (context.type === "album") {
    url = `/api/queue-spine?context=album&albumId=${encodeURIComponent(context.albumId)}`;
  } else {
    url = `/api/queue-spine?context=track&trackId=${encodeURIComponent(context.trackId)}`;
  }

  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const response = await fetch(`${base}${url}`, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new AuthExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch queue spine: ${response.status}`);
  }

  return response.json() as Promise<QueueSpineResponse>;
}

export function queueTrackFromFullTrack(track: FullTrack): QueueTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
  };
}

export function fullTrackStubFromQueueTrack(track: QueueTrack): FullTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: null,
    coverImage: null,
    audioFiles: [],
  };
}
