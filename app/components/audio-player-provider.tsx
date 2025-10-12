import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { AudioPlayer } from './audio-player'

interface Track {
	id: string
	title: string
	artist: string
	duration: number | null
	thumbnailUrl: string | null
	audioFile?: {
		objectKey: string | null
		fileSize: number | null
		status: string
	} | null
}

interface UserTrack {
	id: string
	createdAt: string
	track: Track
}

interface UserTracksResponse {
	userTracks: UserTrack[]
	pagination: {
		hasNext: boolean
		nextCursor: string | null
		limit: number
	}
}

interface PlaylistTracksResponse {
	tracks: Track[]
	pagination: {
		hasNext: boolean
		nextCursor: string | null
		limit: number
	}
}

type PlayContext = 'library' | 'playlist' | 'music'

interface PlaylistContext {
	type: PlayContext
	playlistId?: string // For playlist context
	cursor?: string // Current position cursor
}

type LoopMode = 'off' | 'all' | 'one'

interface AudioPlayerContextType {
	currentTrack: Track | null
	isPlayerVisible: boolean
	playlist: Track[]
	currentIndex: number
	playContext: PlaylistContext | null
	loopMode: LoopMode
	isShuffleEnabled: boolean
	playTrack: (track: Track, context: PlaylistContext, index?: number) => void
	playPlaylist: (tracks: Track[], context: PlaylistContext, startIndex?: number) => void
	playNext: () => void
	playPrevious: () => void
	toggleLoop: () => void
	toggleShuffle: () => void
	closePlayer: () => void
	hasNext: boolean
	hasPrevious: boolean
	isLoadingNext: boolean
	isLoadingPrevious: boolean
	// New playlist management functions
	addTrackToPlaylist: (track: Track, position?: 'next' | 'end') => void
	removeTrackFromPlaylist: (index: number) => void
	playNextTrack: (track: Track) => void
	addToCurrentPlaylist: (track: Track) => void
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined)

interface AudioPlayerProviderProps {
	children: ReactNode
}

export function AudioPlayerProvider({ children }: AudioPlayerProviderProps) {
	const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
	const [isPlayerVisible, setIsPlayerVisible] = useState(false)
	const [playlist, setPlaylist] = useState<Track[]>([])
	const [currentIndex, setCurrentIndex] = useState(0)
	const [playContext, setPlayContext] = useState<PlaylistContext | null>(null)
	const [loopMode, setLoopMode] = useState<LoopMode>('off')
	const [isShuffleEnabled, setIsShuffleEnabled] = useState(false)
	const [isLoadingNext] = useState(false)
	const [isLoadingPrevious] = useState(false)

	/**
	 * Fetch tracks from API based on context
	 * 
	 * @param context - The playlist context (library, playlist, etc.)
	 * @param cursor - Optional cursor for pagination
	 * @returns Promise resolving to array of tracks
	 */
	const fetchTracks = useCallback(async (context: PlaylistContext, cursor?: string): Promise<Track[]> => {
		try {
			let url = ''
			if (context.type === 'library') {
				url = `/api/user-tracks?limit=50${cursor ? `&cursor=${cursor}` : ''}`
			} else if (context.type === 'playlist' && context.playlistId) {
				url = `/api/playlist-tracks?playlistId=${context.playlistId}&limit=50${cursor ? `&cursor=${cursor}` : ''}`
			}
		
			if (!url) return []
			
			const response = await fetch(url)
			
			if (!response.ok) {
				console.error('Failed to fetch tracks:', response.status, response.statusText)
				return []
			}
			
			if (context.type === 'library') {
				const data = await response.json() as UserTracksResponse
				return data.userTracks.map(userTrack => userTrack.track)
			} else {
				const data = await response.json() as PlaylistTracksResponse
				return data.tracks
			}
		} catch (error) {
			console.error('Failed to fetch tracks:', error)
			return []
		}
	}, [])

	/**
	 * Play a track with optional position index for duplicate track support
	 * 
	 * @param track - The track to play
	 * @param context - The playlist context
	 * @param index - Optional position index (used for duplicate track support)
	 */
	const playTrack = useCallback(async (track: Track, context: PlaylistContext, index?: number) => {
		setCurrentTrack(track)
		setIsPlayerVisible(true)
		setPlayContext(context)
		
		// Always fetch tracks from API for consistency and pagination support
		const tracks = await fetchTracks(context)
		
		setPlaylist(tracks)
		// If index is explicitly provided, use it (for duplicate track support)
		// Otherwise, find the track by ID (fallback for API-fetched playlists)
		const calculatedIndex = index !== undefined ? index : tracks.findIndex(t => t.id === track.id)
		setCurrentIndex(calculatedIndex)
	}, [fetchTracks])

	/**
	 * Play multiple tracks directly (bypassing API fetch)
	 * 
	 * @param tracks - Array of tracks to play
	 * @param context - The playlist context
	 * @param startIndex - Index to start playing from (default: 0)
	 */
	const playPlaylist = useCallback((tracks: Track[], context: PlaylistContext, startIndex: number = 0) => {
		setPlaylist(tracks)
		setPlayContext(context)
		setCurrentIndex(startIndex)
		setCurrentTrack(tracks[startIndex] || null)
		setIsPlayerVisible(true)
	}, [])

	// Add track to current playlist
	const addTrackToPlaylist = useCallback((track: Track, position: 'next' | 'end' = 'end') => {
		if (position === 'next') {
			// Insert after current track
			const newPlaylist = [...playlist]
			newPlaylist.splice(currentIndex + 1, 0, track)
			setPlaylist(newPlaylist)
		} else {
			// Add to end
			setPlaylist(prev => [...prev, track])
		}
	}, [playlist, currentIndex])

	/**
	 * Remove track from playlist by position index (supports duplicate tracks)
	 * 
	 * @param index - The position index of the track to remove
	 */
	const removeTrackFromPlaylist = useCallback((index: number) => {
		setPlaylist(prev => {
			const newPlaylist = [...prev]
			newPlaylist.splice(index, 1)  // Remove only at specific index
			
			// Adjust current index if needed
			if (index < currentIndex) {
				setCurrentIndex(prevIndex => prevIndex - 1)
			} else if (index === currentIndex && newPlaylist.length > 0) {
				// If current track was removed, play the next available track at same position
				const nextIndex = Math.min(currentIndex, newPlaylist.length - 1)
				setCurrentIndex(nextIndex)
				const nextTrack = newPlaylist[nextIndex]
				if (nextTrack) {
					setCurrentTrack(nextTrack)
				}
			}
			return newPlaylist
		})
	}, [currentIndex])

	// Play next track (YouTube-style "Play next")
	const playNextTrack = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'next')
		// Don't play immediately - just queue it for next
	}, [addTrackToPlaylist])

	// Add to current playlist (YouTube-style "Add to queue")
	const addToCurrentPlaylist = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'end')
	}, [addTrackToPlaylist])

	const playNext = useCallback(() => {
		// Helper function to check if a track has playable audio
		const hasPlayableAudio = (track: Track) => {
			return track.audioFile?.objectKey && track.audioFile.status === 'completed'
		}

		// Helper function to find next completed track
		const findNextCompletedTrack = (startIndex: number) => {
			for (let i = startIndex + 1; i < playlist.length; i++) {
				const track = playlist[i]
				if (track && hasPlayableAudio(track)) {
					return i
				}
			}
			return -1
		}

		if (loopMode === 'one') {
			// Loop one: restart current track
			const currentTrack = playlist[currentIndex]
			if (currentTrack) {
				setCurrentTrack(currentTrack)
			}
			return
		}

		if (isShuffleEnabled && playlist.length > 0) {
			// Pick random track that's not the current one
			const playableTracks = playlist.filter(hasPlayableAudio)
			if (playableTracks.length > 1) {
				let nextTrack: Track | undefined
				do {
					nextTrack = playableTracks[Math.floor(Math.random() * playableTracks.length)]
				} while (nextTrack?.id === playlist[currentIndex]?.id)
				
				if (nextTrack) {
					const nextIndex = playlist.findIndex(t => t.id === nextTrack.id)
					if (nextIndex !== -1) {
						setCurrentIndex(nextIndex)
						setCurrentTrack(nextTrack)
					}
				}
			}
			return
		}
		
		const nextIndex = findNextCompletedTrack(currentIndex)
		
		if (nextIndex !== -1) {
			const nextTrack = playlist[nextIndex]
			if (nextTrack) {
				setCurrentIndex(nextIndex)
				setCurrentTrack(nextTrack)
			}
		} else if (loopMode === 'all') {
			// Wrap around to first track
			const firstIndex = findNextCompletedTrack(-1)
			if (firstIndex !== -1) {
				const firstTrack = playlist[firstIndex]
				if (firstTrack) {
					setCurrentIndex(firstIndex)
					setCurrentTrack(firstTrack)
				}
			}
		}
		// If loopMode is 'off' and no next track, do nothing (stop playback)
	}, [currentIndex, playlist, loopMode, isShuffleEnabled])

	const playPrevious = useCallback(() => {
		// Helper function to check if a track has playable audio
		const hasPlayableAudio = (track: Track) => {
			return track.audioFile?.objectKey && track.audioFile.status === 'completed'
		}

		// Helper function to find previous completed track
		const findPreviousCompletedTrack = (startIndex: number) => {
			for (let i = startIndex - 1; i >= 0; i--) {
				const track = playlist[i]
				if (track && hasPlayableAudio(track)) {
					return i
				}
			}
			return -1
		}

		const prevIndex = findPreviousCompletedTrack(currentIndex)
		
		if (prevIndex !== -1) {
			const prevTrack = playlist[prevIndex]
			if (prevTrack) {
				setCurrentIndex(prevIndex)
				setCurrentTrack(prevTrack)
			}
		} else if (loopMode === 'all') {
			// Only wrap around to last track when loop all is enabled
			const lastIndex = findPreviousCompletedTrack(playlist.length)
			if (lastIndex !== -1) {
				const lastTrack = playlist[lastIndex]
				if (lastTrack) {
					setCurrentIndex(lastIndex)
					setCurrentTrack(lastTrack)
				}
			}
		}
		// If loopMode is 'off' and no previous track, do nothing
	}, [currentIndex, playlist, loopMode])

	const toggleLoop = useCallback(() => {
		setLoopMode(prev => {
			switch (prev) {
				case 'off': return 'all'
				case 'all': return 'one'
				case 'one': return 'off'
				default: return 'off'
			}
		})
	}, [])

	const toggleShuffle = useCallback(() => {
		setIsShuffleEnabled(prev => !prev)
	}, [])

	const closePlayer = useCallback(() => {
		setIsPlayerVisible(false)
		setCurrentTrack(null)
		setPlaylist([])
		setCurrentIndex(0)
		setPlayContext(null)
	}, [])

	// Allow navigation based on loop mode
	// Helper function to check if a track has playable audio
	const hasPlayableAudio = (track: Track) => {
		return track.audioFile?.objectKey && track.audioFile.status === 'completed'
	}

	// Helper function to find next completed track
	const findNextCompletedTrack = (startIndex: number) => {
		for (let i = startIndex + 1; i < playlist.length; i++) {
			const track = playlist[i]
			if (track && hasPlayableAudio(track)) {
				return i
			}
		}
		return -1
	}

	// Helper function to find previous completed track
	const findPreviousCompletedTrack = (startIndex: number) => {
		for (let i = startIndex - 1; i >= 0; i--) {
			const track = playlist[i]
			if (track && hasPlayableAudio(track)) {
				return i
			}
		}
		return -1
	}

	const hasNext = playlist.length > 0 && (
		loopMode === 'one' || // Always true for loop one (restart current track)
		loopMode === 'all' || // Always true for loop all (will wrap around)
		isShuffleEnabled || // Always true for shuffle (will pick random track)
		findNextCompletedTrack(currentIndex) !== -1 // Check if there's a next playable track
	)
	
	const hasPrevious = playlist.length > 0 && (
		loopMode === 'one' || // Always true for loop one (restart current track)
		loopMode === 'all' || // Always true for loop all (will wrap around)
		isShuffleEnabled || // Always true for shuffle (will pick random track)
		findPreviousCompletedTrack(currentIndex) !== -1 // Check if there's a previous playable track
	)

	return (
		<AudioPlayerContext.Provider
			value={{
				currentTrack,
				isPlayerVisible,
				playlist,
				currentIndex,
				playContext,
				loopMode,
				isShuffleEnabled,
				playTrack,
				playPlaylist,
				playNext,
				playPrevious,
				toggleLoop,
				toggleShuffle,
				closePlayer,
				hasNext,
				hasPrevious,
				isLoadingNext,
				isLoadingPrevious,
				addTrackToPlaylist,
				removeTrackFromPlaylist,
				playNextTrack,
				addToCurrentPlaylist,
			}}
		>
			{children}
			<AudioPlayer
				track={currentTrack}
				isVisible={isPlayerVisible}
				onClose={closePlayer}
				onNext={playNext}
				onPrevious={playPrevious}
				onToggleLoop={toggleLoop}
				onToggleShuffle={toggleShuffle}
				hasNext={hasNext}
				hasPrevious={hasPrevious}
				loopMode={loopMode}
				isShuffleEnabled={isShuffleEnabled}
			/>
		</AudioPlayerContext.Provider>
	)
}

export function useAudioPlayer() {
	const context = useContext(AudioPlayerContext)
	if (context === undefined) {
		throw new Error('useAudioPlayer must be used within an AudioPlayerProvider')
	}
	return context
}
