import { createContext, useContext, type ReactNode } from "react";
import { type RoomAutoplayOutcome } from "#app/components/audio-player-room-playback.ts";
import { type RoomTransportAction } from "#app/features/party-room/types.ts";
import { type PlayerStateData } from "#app/features/player-state/player-state.ts";
import {
  type LoopMode,
  type QueueNavigationState,
  type QueueTarget,
  type QueueZone,
} from "#app/features/queue/queue-navigation.ts";
import { type LibrarySortOption } from "#app/features/listening-insights/heavy-rotation.ts";
import { type FullTrack } from "#app/types/frontend/shared";
import { type PlaylistTrackSortOption } from "#app/utils/playlist-track-sort.ts";
import { type PlaylistContext } from "./audio-player-play-context";

type Track = FullTrack;

export interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlayerVisible: boolean;
  playlist: Track[];
  upNext: Track[];
  /** How many leading Up Next rows came from Play next (FIFO play-next prefix). */
  upNextPlayNextCount: number;
  spine: Track[];
  spineTotal: number;
  spinePosition: number;
  /** Queue zone the current audible track was started from (spine vs up next). */
  audibleSourceZone: QueueZone | null;
  /** Raw queue navigation state (spine order, Up Next rows, loop). */
  queueNavigationState: QueueNavigationState;
  currentIndex: number;
  playContext: PlaylistContext | null;
  loopMode: LoopMode;
  isShuffleEnabled: boolean;
  playTrack: (track: Track, context: PlaylistContext, index?: number) => void;
  playPlaylist: (tracks: Track[], context: PlaylistContext, startIndex?: number) => void;
  playLibrary: (sort?: LibrarySortOption) => Promise<void>;
  playUserPlaylist: (playlistId: string, sort?: PlaylistTrackSortOption) => Promise<void>;
  playNext: () => void;
  playPrevious: () => void;
  toggleLoop: () => void;
  toggleShuffle: () => void;
  closePlayer: () => void;
  startQueuePlayback: () => void;
  hasQueuedPlayback: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  isLoadingNext: boolean;
  /** True only while the media element is actually playing. */
  isPlaying: boolean;
  /** Pause the current track without restarting spine playback or clearing Up Next. */
  pauseTrack: () => void;
  /** Resume the current track from its paused position without re-running spine playback. */
  resumeTrack: () => void;
  addTrackToPlaylist: (track: Track, position?: "next" | "end") => void;
  removeTrackFromPlaylist: (target: QueueTarget) => void;
  removeCurrentFromQueue: () => void;
  playNextTrack: (track: Track) => void;
  addToUpNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  playQueueTrack: (target: QueueTarget) => void;
  hydrateTracksForDisplay: (ids: string[]) => void;
  /** @deprecated Use addToUpNext instead */
  addToCurrentPlaylist: (track: Track) => void;
  /** Party Room: stop writing personal PlayerState while this device is speaker. */
  suspendPersonalPersistence: () => void;
  resumePersonalPersistence: () => void;
  getPersonalPlayerSnapshot: () => PlayerStateData;
  restorePersonalPlayerSnapshot: (snapshot: PlayerStateData, wasVisible: boolean) => Promise<void>;
  /**
   * Party Room host: show the room queue on this device.
   * An empty room hides the player so a personal queue is not left on screen.
   * The same room track does not restart when only the upcoming list changes.
   */
  syncRoomSpeakerQueue: (options: {
    roomId: string;
    code: string;
    nowPlaying: Track | null;
    upcoming: Track[];
    onEnded?: () => void;
    /**
     * Kept for callers. Play/pause is `setRoomPlaybackPlaying`; this does not
     * arm the personal autoplay path.
     */
    autoplay?: boolean;
  }) => void;
  /** Party Room host: play a room-queue track; personal UsageEvents suppressed. */
  playRoomSpeakerTrack: (
    track: Track,
    options: { roomId: string; code: string; onEnded?: () => void },
  ) => void;
  setRoomPlaybackPlaying: (playing: boolean) => void;
  /**
   * Room speaker: hear when the media element accepts or rejects play().
   * A blocked outcome means the room must stay paused.
   */
  subscribeRoomAutoplay: (listener: (outcome: RoomAutoplayOutcome) => void) => () => void;
  /** Active room speaker session (null when not speaking for a room). */
  roomSpeaker: { roomId: string; code: string } | null;
  /**
   * Host speaker: set by RoomSpeakerBridge so user play/pause updates room
   * transport instead of only the local element.
   */
  roomTransportRef: React.MutableRefObject<
    | ((action: Extract<RoomTransportAction, { action: "play" } | { action: "pause" }>) => void)
    | null
  >;
}

export const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);
  if (context === undefined) {
    throw new Error("useAudioPlayer must be used within an AudioPlayerProvider");
  }
  return context;
}
