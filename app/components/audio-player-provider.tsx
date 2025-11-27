import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { type QueueTrack, type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayer } from './audio-player'

// Use FullTrack as the main Track type for compatibility
type Track = FullTrack

interface UserTrack {
	id: string
	createdAt: string
	track: Track | QueueTrack
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
	tracks: Track[] | QueueTrack[]
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
	playlist: (Track | QueueTrack)[]
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
	const [playlist, setPlaylist] = useState<(Track | QueueTrack)[]>([])
	const [currentIndex, setCurrentIndex] = useState(0)
	const [playContext, setPlayContext] = useState<PlaylistContext | null>(null)
	const [loopMode, setLoopMode] = useState<LoopMode>('off')
	const [isShuffleEnabled, setIsShuffleEnabled] = useState(false)
	const [isLoadingNext, setIsLoadingNext] = useState(false)
	
	// Cache for full track data
	const fullTrackCache = useRef<Map<string, Track>>(new Map())

	/**
	 * Check if a track has full data (is a FullTrack)
	 */
	const isFullTrack = (track: Track | QueueTrack): track is Track => {
		return 'audioFiles' in track || 'thumbnailUrl' in track || 'duration' in track
	}

	/**
	 * Fetch minimal tracks from API based on context with pagination
	 * Fetches ALL tracks, not just first 50
	 * 
	 * @param context - The playlist context (library, playlist, etc.)
	 * @returns Promise resolving to array of minimal tracks
	 */
	const fetchAllTracks = useCallback(async (context: PlaylistContext): Promise<QueueTrack[]> => {
		const allTracks: QueueTrack[] = []
		let cursor: string | null = null
		let hasNext = true
		const limit = 100 // Use max limit for efficiency

		while (hasNext) {
			try {
				let url = ''
				if (context.type === 'library') {
					url = `/api/user-tracks?limit=${limit}&fields=minimal${cursor ? `&cursor=${cursor}` : ''}`
				} else if (context.type === 'playlist' && context.playlistId) {
					url = `/api/playlist-tracks?playlistId=${context.playlistId}&limit=${limit}&fields=minimal${cursor ? `&cursor=${cursor}` : ''}`
				}
			
				if (!url) break
				
				const response = await fetch(url)
				
				if (!response.ok) {
					console.error('Failed to fetch tracks:', response.status, response.statusText)
					break
				}
				
				let data: UserTracksResponse | PlaylistTracksResponse
				if (context.type === 'library') {
					data = await response.json() as UserTracksResponse
					const tracks = data.userTracks.map(userTrack => ({
						id: userTrack.track.id,
						title: userTrack.track.title,
						artist: userTrack.track.artist,
					}))
					allTracks.push(...tracks)
				} else {
					data = await response.json() as PlaylistTracksResponse
					const tracks = data.tracks.map(track => ({
						id: track.id,
						title: track.title,
						artist: track.artist,
					}))
					allTracks.push(...tracks)
				}
				
				hasNext = data.pagination.hasNext
				cursor = data.pagination.nextCursor
			} catch (error) {
				console.error('Failed to fetch tracks:', error)
				break
			}
		}

		return allTracks
	}, [])

	/**
	 * Load full track data for a specific track
	 * Uses cache if available, otherwise fetches from API in batches
	 * Fetches a batch and caches all tracks in that batch for efficiency
	 */
	const loadFullTrackData = useCallback(async (trackId: string, context: PlaylistContext, index?: number): Promise<Track | null> => {
		// Check cache first
		if (fullTrackCache.current.has(trackId)) {
			return fullTrackCache.current.get(trackId) || null
		}

		try {
			// Find the track's position in the queue to fetch a batch around it
			const queueIndex = index !== undefined ? index : playlist.findIndex(t => t.id === trackId)
			if (queueIndex === -1) return null

			// Fetch a batch of full tracks starting from a position before the target
			// This allows us to cache multiple tracks at once
			const batchSize = 20

			// For library context, we need to calculate cursor position
			// For playlist, we can use position directly
			let url = ''
			if (context.type === 'library') {
				// For library, we'll fetch from the beginning and skip to batchStart
				// This is not ideal but works with current API
				url = `/api/user-tracks?limit=${batchSize}&fields=full`
			} else if (context.type === 'playlist' && context.playlistId) {
				// For playlist, we can fetch by position range
				url = `/api/playlist-tracks?playlistId=${context.playlistId}&limit=${batchSize}&fields=full`
			}

			if (!url) return null

			// Fetch multiple batches if needed to find the track
			let cursor: string | null = null
			let found = false
			let track: Track | null = null

			for (let i = 0; i < 5 && !found; i++) { // Limit to 5 batches to avoid infinite loops
				const batchUrl = cursor ? url + `&cursor=${cursor}` : url
				const response = await fetch(batchUrl)
				if (!response.ok) break

				let data: UserTracksResponse | PlaylistTracksResponse
				if (context.type === 'library') {
					data = await response.json() as UserTracksResponse
					const tracks = data.userTracks.map(ut => ut.track)
					
					// Cache all tracks in batch
					tracks.forEach(t => {
						if (isFullTrack(t)) {
							fullTrackCache.current.set(t.id, t)
						}
					})

					// Check if our target track is in this batch
					const foundTrack = tracks.find(t => t.id === trackId)
					if (foundTrack && isFullTrack(foundTrack)) {
						track = foundTrack
						found = true
					}

					cursor = data.pagination.nextCursor
					if (!data.pagination.hasNext) break
				} else {
					data = await response.json() as PlaylistTracksResponse
					const tracks = data.tracks
					
					// Cache all tracks in batch
					tracks.forEach(t => {
						if (isFullTrack(t)) {
							fullTrackCache.current.set(t.id, t)
						}
					})

					// Check if our target track is in this batch
					const foundTrack = tracks.find(t => t.id === trackId)
					if (foundTrack && isFullTrack(foundTrack)) {
						track = foundTrack
						found = true
					}

					cursor = data.pagination.nextCursor
					if (!data.pagination.hasNext) break
				}
			}

			return track
		} catch (error) {
			console.error('Failed to load full track data:', error)
		}

		return null
	}, [playlist])

	/**
	 * Play a track with optional position index for duplicate track support
	 * Resets queue and loads all tracks from context
	 * 
	 * @param track - The track to play (should be FullTrack)
	 * @param context - The playlist context
	 * @param index - Optional position index (used for duplicate track support)
	 */
	const playTrack = useCallback(async (track: Track, context: PlaylistContext, index?: number) => {
		// Reset queue and cache when context changes
		if (playContext && (
			playContext.type !== context.type ||
			playContext.playlistId !== context.playlistId
		)) {
			fullTrackCache.current.clear()
			setPlaylist([])
		}

		setPlayContext(context)
		setIsPlayerVisible(true)

		// Load all tracks with minimal data
		setIsLoadingNext(true)
		const allTracks = await fetchAllTracks(context)
		setIsLoadingNext(false)

		setPlaylist(allTracks)

		// Cache the current track's full data
		if (isFullTrack(track)) {
			fullTrackCache.current.set(track.id, track)
		}

		setCurrentTrack(track)
		
		// If index is explicitly provided, use it (for duplicate track support)
		// Otherwise, find the track by ID
		const calculatedIndex = index !== undefined ? index : allTracks.findIndex(t => t.id === track.id)
		setCurrentIndex(calculatedIndex >= 0 ? calculatedIndex : 0)
	}, [fetchAllTracks, playContext])

	/**
	 * Play multiple tracks directly (bypassing API fetch)
	 * 
	 * @param tracks - Array of tracks to play
	 * @param context - The playlist context
	 * @param startIndex - Index to start playing from (default: 0)
	 */
	const playPlaylist = useCallback((tracks: Track[], context: PlaylistContext, startIndex: number = 0) => {
		// Reset cache when context changes
		if (playContext && (
			playContext.type !== context.type ||
			playContext.playlistId !== context.playlistId
		)) {
			fullTrackCache.current.clear()
		}

		// Cache all full tracks
		tracks.forEach(track => {
			if (isFullTrack(track)) {
				fullTrackCache.current.set(track.id, track)
			}
		})

		setPlaylist(tracks)
		setPlayContext(context)
		setCurrentIndex(startIndex)
		setCurrentTrack(tracks[startIndex] || null)
		setIsPlayerVisible(true)
	}, [playContext])

	// Add track to current playlist
	const addTrackToPlaylist = useCallback((track: Track, position: 'next' | 'end' = 'end') => {
		// Cache full track data
		if (isFullTrack(track)) {
			fullTrackCache.current.set(track.id, track)
		}

		if (position === 'next') {
			// Insert after current track
			setPlaylist(prev => {
				const newPlaylist = [...prev]
				newPlaylist.splice(currentIndex + 1, 0, track)
				return newPlaylist
			})
		} else {
			// Add to end
			setPlaylist(prev => [...prev, track])
		}
	}, [currentIndex])

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
					// Load full data if needed
					if (!isFullTrack(nextTrack) && playContext) {
						void loadFullTrackData(nextTrack.id, playContext).then(fullTrack => {
							if (fullTrack) {
								setCurrentTrack(fullTrack)
								// Update playlist with full track
								setPlaylist(prev => {
									const updated = [...prev]
									updated[nextIndex] = fullTrack
									return updated
								})
							}
						})
					} else {
						setCurrentTrack(nextTrack as Track)
					}
				}
			}
			return newPlaylist
		})
	}, [currentIndex, playContext, loadFullTrackData])

	// Play next track (YouTube-style "Play next")
	const playNextTrack = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'next')
		// Don't play immediately - just queue it for next
	}, [addTrackToPlaylist])

	// Add to current playlist (YouTube-style "Add to queue")
	const addToCurrentPlaylist = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'end')
	}, [addTrackToPlaylist])

	const playNext = useCallback(async () => {
		// Helper function to find next track
		const findNextTrack = (startIndex: number) => {
			if (startIndex + 1 < playlist.length) {
				return startIndex + 1
			}
			return -1
		}

		if (loopMode === 'one') {
			// Loop one: restart current track
			const currentTrack = playlist[currentIndex]
			if (currentTrack) {
				// Ensure we have full track data
				if (isFullTrack(currentTrack)) {
					setCurrentTrack(currentTrack)
				} else if (playContext) {
					const fullTrack = await loadFullTrackData(currentTrack.id, playContext)
					if (fullTrack) {
						setCurrentTrack(fullTrack)
					}
				}
			}
			return
		}

		if (isShuffleEnabled && playlist.length > 0) {
			// Pick random track that's not the current one
			if (playlist.length > 1) {
				let nextTrack: Track | QueueTrack | undefined
				do {
					nextTrack = playlist[Math.floor(Math.random() * playlist.length)]
				} while (nextTrack?.id === playlist[currentIndex]?.id)
				
				if (nextTrack) {
					const nextIndex = playlist.findIndex(t => t.id === nextTrack.id)
					if (nextIndex !== -1) {
						setCurrentIndex(nextIndex)
						// Load full data if needed
						if (isFullTrack(nextTrack)) {
							setCurrentTrack(nextTrack)
						} else if (playContext) {
							const fullTrack = await loadFullTrackData(nextTrack.id, playContext)
							if (fullTrack) {
								setCurrentTrack(fullTrack)
							}
						}
					}
				}
			}
			return
		}
		
		const nextIndex = findNextTrack(currentIndex)
		
		if (nextIndex !== -1) {
			const nextTrack = playlist[nextIndex]
			if (nextTrack) {
				setCurrentIndex(nextIndex)
				// Load full data if needed
				if (isFullTrack(nextTrack)) {
					setCurrentTrack(nextTrack)
				} else if (playContext) {
					const fullTrack = await loadFullTrackData(nextTrack.id, playContext, nextIndex)
					if (fullTrack) {
						setCurrentTrack(fullTrack)
						// Update playlist with full track
						setPlaylist(prev => {
							const updated = [...prev]
							updated[nextIndex] = fullTrack
							return updated
						})
					}
				}
			}
		} else if (loopMode === 'all') {
			// Wrap around to first track
			if (playlist.length > 0 && playlist[0]) {
				setCurrentIndex(0)
				const firstTrack = playlist[0]
				if (isFullTrack(firstTrack)) {
					setCurrentTrack(firstTrack)
				} else if (playContext) {
					const fullTrack = await loadFullTrackData(firstTrack.id, playContext)
					if (fullTrack) {
						setCurrentTrack(fullTrack)
					}
				}
			}
		}
		// If loopMode is 'off' and no next track, do nothing (stop playback)
	}, [currentIndex, playlist, loopMode, isShuffleEnabled, playContext, loadFullTrackData])

	const playPrevious = useCallback(async () => {
		// Helper function to find previous track
		const findPreviousTrack = (startIndex: number) => {
			if (startIndex > 0) {
				return startIndex - 1
			}
			return -1
		}

		const prevIndex = findPreviousTrack(currentIndex)
		
		if (prevIndex !== -1) {
			const prevTrack = playlist[prevIndex]
			if (prevTrack) {
				setCurrentIndex(prevIndex)
				// Load full data if needed
				if (isFullTrack(prevTrack)) {
					setCurrentTrack(prevTrack)
				} else if (playContext) {
					const fullTrack = await loadFullTrackData(prevTrack.id, playContext, prevIndex)
					if (fullTrack) {
						setCurrentTrack(fullTrack)
						// Update playlist with full track
						setPlaylist(prev => {
							const updated = [...prev]
							updated[prevIndex] = fullTrack
							return updated
						})
					}
				}
			}
		} else if (loopMode === 'all') {
			// Only wrap around to last track when loop all is enabled
			if (playlist.length > 0) {
				const lastIndex = playlist.length - 1
				const lastTrack = playlist[lastIndex]
				if (lastTrack) {
					setCurrentIndex(lastIndex)
					if (isFullTrack(lastTrack)) {
						setCurrentTrack(lastTrack)
					} else if (playContext) {
						const fullTrack = await loadFullTrackData(lastTrack.id, playContext)
						if (fullTrack) {
							setCurrentTrack(fullTrack)
						}
					}
				}
			}
		}
		// If loopMode is 'off' and no previous track, do nothing
	}, [currentIndex, playlist, loopMode, playContext, loadFullTrackData])

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
		fullTrackCache.current.clear()
	}, [])

	// Allow navigation based on loop mode
	const hasNext = playlist.length > 0 && (
		loopMode === 'one' || // Always true for loop one (restart current track)
		loopMode === 'all' || // Always true for loop all (will wrap around)
		isShuffleEnabled || // Always true for shuffle (will pick random track)
		currentIndex < playlist.length - 1 // Check if there's a next track
	)
	
	const hasPrevious = playlist.length > 0 && (
		loopMode === 'one' || // Always true for loop one (restart current track)
		loopMode === 'all' || // Always true for loop all (will wrap around)
		isShuffleEnabled || // Always true for shuffle (will pick random track)
		currentIndex > 0 // Check if there's a previous track
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
