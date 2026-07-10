import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { type FullTrack } from '#app/types/frontend/shared'
import { filterPlayableTracks, isPlayableTrack } from '#app/utils/playable-track'
import { AudioPlayer } from './audio-player'
import { InstallAppBanner } from './pwa/install-app-banner'

type Track = FullTrack

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
	playlistId?: string
	cursor?: string
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
	playLibrary: () => Promise<void>
	playUserPlaylist: (playlistId: string) => Promise<void>
	playNext: () => void
	playPrevious: () => void
	toggleLoop: () => void
	toggleShuffle: () => void
	closePlayer: () => void
	hasNext: boolean
	hasPrevious: boolean
	isLoadingNext: boolean
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
	const [isLoadingNext, setIsLoadingNext] = useState(false)
	const [playbackToken, setPlaybackToken] = useState(0)

	const playlistFetchEpochRef = useRef(0)
	const wantsAutoPlayRef = useRef(false)

	const beginPlayback = useCallback(() => {
		wantsAutoPlayRef.current = true
		setPlaybackToken(token => token + 1)
	}, [])

	/**
	 * Fetch full tracks for the queue — same shape the player had before lazy minimal loading.
	 */
	const fetchAllTracks = useCallback(async (context: PlaylistContext): Promise<Track[]> => {
		const allTracks: Track[] = []
		let cursor: string | null = null
		let hasNext = true
		const limit = 100

		while (hasNext) {
			try {
				let url = ''
				if (context.type === 'library') {
					url = `/api/user-tracks?limit=${limit}&fields=full&hasAudio=1${cursor ? `&cursor=${cursor}` : ''}`
				} else if (context.type === 'playlist' && context.playlistId) {
					url = `/api/playlist-tracks?playlistId=${context.playlistId}&limit=${limit}&fields=full${cursor ? `&cursor=${cursor}` : ''}`
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
					allTracks.push(...data.userTracks.map(userTrack => userTrack.track))
				} else {
					data = await response.json() as PlaylistTracksResponse
					allTracks.push(...data.tracks)
				}

				hasNext = data.pagination.hasNext
				cursor = data.pagination.nextCursor
			} catch (error) {
				console.error('Failed to fetch tracks:', error)
				break
			}
		}

		return filterPlayableTracks(allTracks)
	}, [])

	const findNextPlayableIndex = useCallback((tracks: Track[], startIndex: number, direction: 1 | -1) => {
		if (tracks.length === 0) return -1

		for (let step = 1; step <= tracks.length; step++) {
			const index = startIndex + direction * step
			if (index < 0 || index >= tracks.length) break
			if (isPlayableTrack(tracks[index]!)) return index
		}

		return -1
	}, [])

	const playTrackAtIndex = useCallback((tracks: Track[], index: number) => {
		const track = tracks[index]
		if (!track || !isPlayableTrack(track)) return
		beginPlayback()
		setCurrentIndex(index)
		setCurrentTrack(track)
	}, [beginPlayback])

	const playTrack = useCallback(async (track: Track, context: PlaylistContext, index?: number) => {
		if (!isPlayableTrack(track)) return

		if (playContext && (
			playContext.type !== context.type ||
			playContext.playlistId !== context.playlistId
		)) {
			setPlaylist([])
		}

		beginPlayback()
		setPlayContext(context)
		setIsPlayerVisible(true)
		setCurrentTrack(track)
		if (index !== undefined) {
			setCurrentIndex(index)
		}

		const epoch = ++playlistFetchEpochRef.current
		setIsLoadingNext(true)
		try {
			const tracks = await fetchAllTracks(context)
			if (epoch !== playlistFetchEpochRef.current) return

			setPlaylist(tracks)
			const calculatedIndex = (() => {
				if (index !== undefined && tracks[index]?.id === track.id) {
					return index
				}
				const idIndex = tracks.findIndex(t => t.id === track.id)
				return idIndex >= 0 ? idIndex : 0
			})()
			setCurrentIndex(calculatedIndex)
		} finally {
			if (epoch === playlistFetchEpochRef.current) {
				setIsLoadingNext(false)
			}
		}
	}, [fetchAllTracks, playContext, beginPlayback])

	const playPlaylist = useCallback((tracks: Track[], context: PlaylistContext, startIndex: number = 0) => {
		const playableTracks = filterPlayableTracks(tracks)
		if (playableTracks.length === 0) return

		const requestedTrack = tracks[startIndex]
		const resolvedStartIndex = requestedTrack
			? playableTracks.findIndex(track => track.id === requestedTrack.id)
			: 0

		if (playContext && (
			playContext.type !== context.type ||
			playContext.playlistId !== context.playlistId
		)) {
			setPlaylist([])
		}

		setPlaylist(playableTracks)
		setPlayContext(context)
		setIsPlayerVisible(true)
		playTrackAtIndex(playableTracks, resolvedStartIndex >= 0 ? resolvedStartIndex : 0)
	}, [playContext, playTrackAtIndex])

	const playLibrary = useCallback(async () => {
		setIsLoadingNext(true)
		try {
			const tracks = await fetchAllTracks({ type: 'library' })
			playPlaylist(tracks, { type: 'library' }, 0)
		} finally {
			setIsLoadingNext(false)
		}
	}, [fetchAllTracks, playPlaylist])

	const playUserPlaylist = useCallback(async (playlistId: string) => {
		setIsLoadingNext(true)
		try {
			const tracks = await fetchAllTracks({ type: 'playlist', playlistId })
			playPlaylist(tracks, { type: 'playlist', playlistId }, 0)
		} finally {
			setIsLoadingNext(false)
		}
	}, [fetchAllTracks, playPlaylist])

	const addTrackToPlaylist = useCallback((track: Track, position: 'next' | 'end' = 'end') => {
		if (!isPlayableTrack(track)) return

		if (position === 'next') {
			setPlaylist(prev => {
				if (prev.length === 0) return [track]
				const newPlaylist = [...prev]
				newPlaylist.splice(currentIndex + 1, 0, track)
				return newPlaylist
			})
		} else {
			setPlaylist(prev => [...prev, track])
		}
	}, [currentIndex])

	const removeTrackFromPlaylist = useCallback((index: number) => {
		setPlaylist(prev => {
			const newPlaylist = [...prev]
			newPlaylist.splice(index, 1)

			if (index < currentIndex) {
				setCurrentIndex(prevIndex => prevIndex - 1)
			} else if (index === currentIndex && newPlaylist.length > 0) {
				const nextIndex = Math.min(currentIndex, newPlaylist.length - 1)
				const nextTrack = newPlaylist[nextIndex]
				if (nextTrack) {
					playTrackAtIndex(newPlaylist, nextIndex)
				}
			}

			return newPlaylist
		})
	}, [currentIndex, playTrackAtIndex])

	const playNextTrack = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'next')
	}, [addTrackToPlaylist])

	const addToCurrentPlaylist = useCallback((track: Track) => {
		addTrackToPlaylist(track, 'end')
	}, [addTrackToPlaylist])

	const playNext = useCallback(() => {
		if (loopMode === 'one') {
			playTrackAtIndex(playlist, currentIndex)
			return
		}

		if (isShuffleEnabled && playlist.length > 1) {
			const playableIndices = playlist
				.map((track, index) => (isPlayableTrack(track) ? index : -1))
				.filter(index => index !== -1 && index !== currentIndex)

			if (playableIndices.length > 0) {
				const nextIndex = playableIndices[Math.floor(Math.random() * playableIndices.length)]!
				playTrackAtIndex(playlist, nextIndex)
			}
			return
		}

		const nextIndex = findNextPlayableIndex(playlist, currentIndex, 1)

		if (nextIndex !== -1) {
			playTrackAtIndex(playlist, nextIndex)
		} else if (loopMode === 'all' && playlist.length > 0) {
			const firstPlayable = playlist.findIndex(track => isPlayableTrack(track))
			if (firstPlayable !== -1) {
				playTrackAtIndex(playlist, firstPlayable)
			}
		}
	}, [currentIndex, playlist, loopMode, isShuffleEnabled, playTrackAtIndex, findNextPlayableIndex])

	const playPrevious = useCallback(() => {
		if (loopMode === 'one') {
			playTrackAtIndex(playlist, currentIndex)
			return
		}

		const prevIndex = findNextPlayableIndex(playlist, currentIndex, -1)

		if (prevIndex !== -1) {
			playTrackAtIndex(playlist, prevIndex)
		} else if (loopMode === 'all' && playlist.length > 0) {
			for (let index = playlist.length - 1; index >= 0; index--) {
				if (isPlayableTrack(playlist[index]!)) {
					playTrackAtIndex(playlist, index)
					break
				}
			}
		}
	}, [currentIndex, playlist, loopMode, playTrackAtIndex, findNextPlayableIndex])

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
		playlistFetchEpochRef.current += 1
		wantsAutoPlayRef.current = false
		setIsPlayerVisible(false)
		setCurrentTrack(null)
		setPlaylist([])
		setCurrentIndex(0)
		setPlayContext(null)
	}, [])

	const hasNext = playlist.length > 0 && (
		loopMode === 'one' ||
		loopMode === 'all' ||
		isShuffleEnabled ||
		currentIndex < playlist.length - 1
	)

	const hasPrevious = playlist.length > 0 && (
		loopMode === 'one' ||
		loopMode === 'all' ||
		isShuffleEnabled ||
		currentIndex > 0
	)

	useEffect(() => {
		if (!isPlayerVisible || !currentTrack) return

		const storage = getOfflineStorage()
		const lookahead = [currentIndex, currentIndex + 1, currentIndex + 2, currentIndex + 3]

		void (async () => {
			for (const index of lookahead) {
				const queueTrack = playlist[index]
				if (!queueTrack || !isPlayableTrack(queueTrack)) continue
				try {
					await storage.cacheQueueTrack(queueTrack)
				} catch (error) {
					console.warn('Queue auto-cache failed:', error)
				}
			}
		})()
	}, [currentTrack?.id, currentIndex, isPlayerVisible, playlist])

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
				playLibrary,
				playUserPlaylist,
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
			<InstallAppBanner playerVisible={isPlayerVisible} />
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
				playbackToken={playbackToken}
				wantsAutoPlayRef={wantsAutoPlayRef}
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
