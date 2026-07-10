import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { type FullTrack } from '#app/types/frontend/shared'
import { AudioPlayer } from './audio-player'

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
					url = `/api/user-tracks?limit=${limit}&fields=full${cursor ? `&cursor=${cursor}` : ''}`
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

		return allTracks
	}, [])

	const playTrackAtIndex = useCallback((tracks: Track[], index: number) => {
		const track = tracks[index]
		if (!track) return
		beginPlayback()
		setCurrentIndex(index)
		setCurrentTrack(track)
	}, [beginPlayback])

	const playTrack = useCallback(async (track: Track, context: PlaylistContext, index?: number) => {
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
		if (playContext && (
			playContext.type !== context.type ||
			playContext.playlistId !== context.playlistId
		)) {
			setPlaylist([])
		}

		setPlaylist(tracks)
		setPlayContext(context)
		setIsPlayerVisible(true)
		playTrackAtIndex(tracks, startIndex)
	}, [playContext, playTrackAtIndex])

	const addTrackToPlaylist = useCallback((track: Track, position: 'next' | 'end' = 'end') => {
		if (position === 'next') {
			setPlaylist(prev => {
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
		const findNextTrack = (startIndex: number) => {
			if (startIndex + 1 < playlist.length) {
				return startIndex + 1
			}
			return -1
		}

		if (loopMode === 'one') {
			playTrackAtIndex(playlist, currentIndex)
			return
		}

		if (isShuffleEnabled && playlist.length > 1) {
			let nextTrack: Track | undefined
			do {
				nextTrack = playlist[Math.floor(Math.random() * playlist.length)]
			} while (nextTrack?.id === playlist[currentIndex]?.id)

			if (nextTrack) {
				const nextIndex = playlist.findIndex(t => t.id === nextTrack.id)
				if (nextIndex !== -1) {
					playTrackAtIndex(playlist, nextIndex)
				}
			}
			return
		}

		const nextIndex = findNextTrack(currentIndex)

		if (nextIndex !== -1) {
			playTrackAtIndex(playlist, nextIndex)
		} else if (loopMode === 'all' && playlist.length > 0) {
			playTrackAtIndex(playlist, 0)
		}
	}, [currentIndex, playlist, loopMode, isShuffleEnabled, playTrackAtIndex])

	const playPrevious = useCallback(() => {
		if (loopMode === 'one') {
			playTrackAtIndex(playlist, currentIndex)
			return
		}

		const findPreviousTrack = (startIndex: number) => {
			if (startIndex > 0) {
				return startIndex - 1
			}
			return -1
		}

		const prevIndex = findPreviousTrack(currentIndex)

		if (prevIndex !== -1) {
			playTrackAtIndex(playlist, prevIndex)
		} else if (loopMode === 'all' && playlist.length > 0) {
			playTrackAtIndex(playlist, playlist.length - 1)
		}
	}, [currentIndex, playlist, loopMode, playTrackAtIndex])

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
