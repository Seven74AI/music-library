import { useCallback, useEffect, useRef, useState } from "react";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import {
  computePlaylistDownloadStatus,
  type PlaylistDownloadStatus,
} from "#app/features/offline-storage/playlist-download-status.ts";

type Phase = "checking" | "ready";

type State = {
  phase: Phase;
  status: PlaylistDownloadStatus;
};

const KEY_SEPARATOR = "\u0000";

function initialState(ids: string[]): State {
  return { phase: "checking", status: computePlaylistDownloadStatus(ids, []) };
}

export function useOfflinePlaylistDownloadStatus(playlistId: string, playableTrackIds: string[]) {
  // Callers build a fresh array every render, so depend on a stable key instead.
  const key = playableTrackIds.join(KEY_SEPARATOR);
  const [state, setState] = useState<State>(() => initialState(playableTrackIds));
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const ids = key === "" ? [] : key.split(KEY_SEPARATOR);
    const requestId = ++latestRequest.current;
    let next: State;
    try {
      const summaries = await getOfflineStorage().listForPlaylist(playlistId);
      next = { phase: "ready", status: computePlaylistDownloadStatus(ids, summaries) };
    } catch {
      next = { phase: "ready", status: computePlaylistDownloadStatus(ids, []) };
    }
    if (requestId === latestRequest.current) setState(next);
  }, [playlistId, key]);

  useEffect(() => {
    setState(initialState(key === "" ? [] : key.split(KEY_SEPARATOR)));
    void refresh();
    return () => {
      // Invalidate in-flight requests for the previous playlist/key.
      latestRequest.current += 1;
    };
  }, [refresh, key]);

  return { phase: state.phase, status: state.status, refresh };
}
