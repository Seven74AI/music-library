import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { offlineSummaryToFullTrack } from '#app/features/offline-storage/offline-track-summary.client.ts'
import {
	advanceAfterPlay,
	buildFlatQueueView,
	findSpinePositionForTrackId,
	flatIndexForSpinePosition,
	getTrackAtTarget,
	hasNextTrack,
	hasPreviousTrack,
	resolveNextTrack,
	resolvePreviousTrack,
	type QueueNavigationState,
} from '#app/features/queue/queue-navigation.ts'
import {
	collectHydrationIds,
	PlaybackHydrationCache,
	resolveFullTrack,
	resolveFullTracks,
} from '#app/features/queue/queue-hydration.ts'
import {
	createShuffledOrder,
	reshuffleFromCurrent,
} from '#app/features/queue/queue-shuffle.ts'
import {
	fetchQueueSpine,
	queueTrackFromFullTrack,
	type QueueSpineContext,
} from '#app/features/queue/queue-spine.ts'
import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared'
import { isOfflineEnvironment } from '#app/features/offline-app/is-offline-environment.client.ts'
import { isPlayableTrack } from '#app/utils/playable-track'
import { AudioPlayer } from './audio-player'
import { InstallAppBanner } from './pwa/install-app-banner'

type Track = FullTrack

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

function toQueueSpineContext(context: PlaylistContext): QueueSpineContext | null {
	if (context.type === 'library') return { type: 'library' }
	if (context.type === 'playlist' && context.playlistId) {
		return { type: 'playlist', playlistId: context.playlistId }
	}
	return null
}

export function AudioPlayerProvider({ children }: AudioPlayerProviderProps) {
	const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
	const [isPlayerVisible, setIsPlayerVisible] = useState(false)
	const [upNext, setUpNext] = useState<QueueTrack[]>([])
	const [spine, setSpine] = useState<QueueTrack[]>([])
	const [spineOrder, setSpineOrder] = useState<number[]>([])
	const [spinePosition, setSpinePosition] = useState(0)
	const [playContext, setPlayContext] = useState<PlaylistContext | null>(null)
	const [loopMode, setLoopMode] = useState<LoopMode>('off')
	const [isShuffleEnabled, setIsShuffleEnabled] = useState(false)
	const [isLoadingNext, setIsLoadingNext] = useState(false)
	const [playbackToken, setPlaybackToken] = useState(0)
	const [cacheVersion, setCacheVersion] = useState(0)

	const playbackCacheRef = useRef(new PlaybackHydrationCache())
	const playlistFetchEpochRef = useRef(0)
	const wantsAutoPlayRef = useRef(false)

	const navigationState = useMemo<QueueNavigationState>(
		() => ({
			upNext,
			spine,
			spineOrder,
			spinePosition,
			loopMode,
		}),
		[upNext, spine, spineOrder, spinePosition, loopMode],
	)

	const playlist = useMemo(() => {
		void cacheVersion
		return resolveFullTracks(
			playbackCacheRef.current,
			buildFlatQueueView(navigationState),
		)
	}, [navigationState, cacheVersion])

	const currentIndex = useMemo(() => {
		if (!currentTrack) return -1

		const upNextIndex = upNext.findIndex(track => track.id === currentTrack.id)
		if (upNextIndex >= 0) return upNextIndex

		if (findSpinePositionForTrackId(navigationState, currentTrack.id) !== null) {
			return flatIndexForSpinePosition(navigationState, spinePosition)
		}

		return -1
	}, [currentTrack, upNext, navigationState, spinePosition])

	const beginPlayback = useCallback(() => {
		wantsAutoPlayRef.current = true
		setPlaybackToken(token => token + 1)
	}, [])

	const rememberTrack = useCallback((track: Track) => {
		playbackCacheRef.current.set(track)
		setCacheVersion(version => version + 1)
	}, [])

	const hydrateAround = useCallback(
		async (trackId: string | null) => {
			const ids = collectHydrationIds(navigationState, trackId)
			await playbackCacheRef.current.hydrateMissing(ids)
			setCacheVersion(version => version + 1)
		},
		[navigationState],
	)

	const fetchOfflineTracks = useCallback(async (context: PlaylistContext): Promise<Track[]> => {
		const storage = getOfflineStorage()
		const summaries =
			context.type === 'playlist' && context.playlistId
				? await storage.listForPlaylist(context.playlistId)
				: context.type === 'library'
					? await storage.listPinned()
					: await storage.listDownloaded()

		return summaries
			.map(offlineSummaryToFullTrack)
			.filter(isPlayableTrack)
	}, [])

	const loadSpineForContext = useCallback(
		async (context: PlaylistContext): Promise<QueueTrack[]> => {
			const spineContext = toQueueSpineContext(context)

			if (spineContext) {
				try {
					const result = await fetchQueueSpine(spineContext)
					if (result.tracks.length > 0) return result.tracks
				} catch (error) {
					console.error('Failed to fetch queue spine:', error)
				}
			}

			const offlineTracks = await fetchOfflineTracks(context)
			for (const track of offlineTracks) {
				playbackCacheRef.current.set(track)
			}
			setCacheVersion(version => version + 1)
			return offlineTracks.map(queueTrackFromFullTrack)
		},
		[fetchOfflineTracks],
	)

	const resetQueueState = useCallback(() => {
		setUpNext([])
		setSpine([])
		setSpineOrder([])
		setSpinePosition(0)
		playbackCacheRef.current.clear()
		setCacheVersion(version => version + 1)
	}, [])

	const startSpinePlayback = useCallback(
		async (
			track: Track,
			context: PlaylistContext,
			explicitIndex?: number,
		) => {
			const queueTrack = queueTrackFromFullTrack(track)
			rememberTrack(track)

			beginPlayback()
			setPlayContext(context)
			setIsPlayerVisible(true)
			setCurrentTrack(track)

			const epoch = ++playlistFetchEpochRef.current
			setIsLoadingNext(true)

			try {
				const loadedSpine = await loadSpineForContext(context)
				if (epoch !== playlistFetchEpochRef.current) return

				const order = createShuffledOrder(loadedSpine.length, isShuffleEnabled)
				const resolvedPosition = (() => {
					if (
						explicitIndex !== undefined &&
						loadedSpine[explicitIndex]?.id === track.id
					) {
						return order.findIndex(index => index === explicitIndex)
					}
					return findSpinePositionForTrackId(
						{ upNext: [], spine: loadedSpine, spineOrder: order, spinePosition: 0, loopMode: 'off' },
						track.id,
					) ?? 0
				})()

				setUpNext([])
				setSpine(loadedSpine)
				setSpineOrder(order)
				setSpinePosition(resolvedPosition >= 0 ? resolvedPosition : 0)

				await hydrateAround(track.id)
			} finally {
				if (epoch === playlistFetchEpochRef.current) {
					setIsLoadingNext(false)
				}
			}
		},
		[beginPlayback, hydrateAround, isShuffleEnabled, loadSpineForContext, rememberTrack],
	)

	const playResolvedTrack = useCallback(
		async (queueTrack: QueueTrack) => {
			await hydrateAround(queueTrack.id)
			const fullTrack = resolveFullTrack(playbackCacheRef.current, queueTrack)
			if (!isPlayableTrack(fullTrack)) return

			beginPlayback()
			setCurrentTrack(fullTrack)
		},
		[beginPlayback, hydrateAround],
	)

	const playTrack = useCallback(
		async (track: Track, context: PlaylistContext, index?: number) => {
			if (!isPlayableTrack(track)) return

			if (
				playContext &&
				(playContext.type !== context.type ||
					playContext.playlistId !== context.playlistId)
			) {
				resetQueueState()
			}

			await startSpinePlayback(track, context, index)
		},
		[playContext, resetQueueState, startSpinePlayback],
	)

	const playPlaylist = useCallback(
		(tracks: Track[], context: PlaylistContext, startIndex: number = 0) => {
			const playableTracks = tracks.filter(isPlayableTrack)
			if (playableTracks.length === 0) return

			const requestedTrack = tracks[startIndex]
			const resolvedStartIndex = requestedTrack
				? playableTracks.findIndex(track => track.id === requestedTrack.id)
				: 0

			if (
				playContext &&
				(playContext.type !== context.type ||
					playContext.playlistId !== context.playlistId)
			) {
				resetQueueState()
			}

			const loadedSpine = playableTracks.map(queueTrackFromFullTrack)
			const order = createShuffledOrder(loadedSpine.length, isShuffleEnabled)
			const startTrack = playableTracks[resolvedStartIndex >= 0 ? resolvedStartIndex : 0]
			if (!startTrack) return

			for (const track of playableTracks) {
				playbackCacheRef.current.set(track)
			}
			setCacheVersion(version => version + 1)

			const spinePosition = order.findIndex(
				index => loadedSpine[index]?.id === startTrack.id,
			)

			setUpNext([])
			setSpine(loadedSpine)
			setSpineOrder(order)
			setSpinePosition(spinePosition >= 0 ? spinePosition : 0)
			setPlayContext(context)
			setIsPlayerVisible(true)
			beginPlayback()
			setCurrentTrack(startTrack)
			void hydrateAround(startTrack.id)
		},
		[beginPlayback, hydrateAround, isShuffleEnabled, playContext, resetQueueState],
	)

	const playLibrary = useCallback(async () => {
		setIsLoadingNext(true)
		try {
			if (playContext?.type !== 'library') {
				resetQueueState()
			}

			const loadedSpine = await loadSpineForContext({ type: 'library' })
			if (loadedSpine.length === 0) return

			const order = createShuffledOrder(loadedSpine.length, isShuffleEnabled)
			const firstQueueTrack = loadedSpine[order[0] ?? 0]
			if (!firstQueueTrack) return

			setUpNext([])
			setSpine(loadedSpine)
			setSpineOrder(order)
			setSpinePosition(0)
			setPlayContext({ type: 'library' })
			setIsPlayerVisible(true)

			await hydrateAround(firstQueueTrack.id)
			const fullTrack = resolveFullTrack(
				playbackCacheRef.current,
				firstQueueTrack,
			)
			if (!isPlayableTrack(fullTrack)) return

			beginPlayback()
			setCurrentTrack(fullTrack)
		} finally {
			setIsLoadingNext(false)
		}
	}, [
		beginPlayback,
		hydrateAround,
		isShuffleEnabled,
		loadSpineForContext,
		playContext?.type,
		resetQueueState,
	])

	const playUserPlaylist = useCallback(
		async (playlistId: string) => {
			setIsLoadingNext(true)
			try {
				if (
					playContext?.type !== 'playlist' ||
					playContext.playlistId !== playlistId
				) {
					resetQueueState()
				}

				const loadedSpine = await loadSpineForContext({
					type: 'playlist',
					playlistId,
				})
				if (loadedSpine.length === 0) return

				const order = createShuffledOrder(loadedSpine.length, isShuffleEnabled)
				const firstQueueTrack = loadedSpine[order[0] ?? 0]
				if (!firstQueueTrack) return

				setUpNext([])
				setSpine(loadedSpine)
				setSpineOrder(order)
				setSpinePosition(0)
				setPlayContext({ type: 'playlist', playlistId })
				setIsPlayerVisible(true)

				await hydrateAround(firstQueueTrack.id)
				const fullTrack = resolveFullTrack(
					playbackCacheRef.current,
					firstQueueTrack,
				)
				if (!isPlayableTrack(fullTrack)) return

				beginPlayback()
				setCurrentTrack(fullTrack)
			} finally {
				setIsLoadingNext(false)
			}
		},
		[
			beginPlayback,
			hydrateAround,
			isShuffleEnabled,
			loadSpineForContext,
			playContext?.playlistId,
			playContext?.type,
			resetQueueState,
		],
	)

	const addTrackToPlaylist = useCallback(
		(track: Track, position: 'next' | 'end' = 'end') => {
			if (!isPlayableTrack(track)) return

			const queueTrack = queueTrackFromFullTrack(track)
			rememberTrack(track)

			if (position === 'next') {
				setUpNext(prev => [queueTrack, ...prev])
				return
			}

			setSpine(prev => {
				const nextIndex = prev.length
				setSpineOrder(order => [...order, nextIndex])
				return [...prev, queueTrack]
			})
		},
		[rememberTrack],
	)

	const removeTrackFromPlaylist = useCallback(
		(index: number) => {
			if (index < upNext.length) {
				setUpNext(prev => prev.filter((_, itemIndex) => itemIndex !== index))
				return
			}

			const spineFlatIndex = index - upNext.length
			const orderIndex = spinePosition + spineFlatIndex
			if (orderIndex < 0 || orderIndex >= spineOrder.length) return

			const spineIndexToRemove = spineOrder[orderIndex]
			if (spineIndexToRemove === undefined) return

			setSpine(prev => prev.filter((_, itemIndex) => itemIndex !== spineIndexToRemove))
			setSpineOrder(prev =>
				prev
					.filter((_, itemIndex) => itemIndex !== orderIndex)
					.map(spineIndex => (spineIndex > spineIndexToRemove ? spineIndex - 1 : spineIndex)),
			)

			if (orderIndex < spinePosition) {
				setSpinePosition(position => Math.max(0, position - 1))
			} else if (orderIndex === spinePosition) {
				const nextState = advanceAfterPlay(navigationState, {
					zone: 'spine',
					index: Math.min(spinePosition, spineOrder.length - 2),
				})
				const nextTrack = getTrackAtTarget(nextState, {
					zone: 'spine',
					index: nextState.spinePosition,
				})
				if (nextTrack) {
					void playResolvedTrack(nextTrack)
				} else {
					setCurrentTrack(null)
				}
			}
		},
		[navigationState, playResolvedTrack, spineOrder.length, spinePosition, upNext.length],
	)

	const playNextTrack = useCallback(
		(track: Track) => {
			addTrackToPlaylist(track, 'next')
		},
		[addTrackToPlaylist],
	)

	const addToCurrentPlaylist = useCallback(
		(track: Track) => {
			addTrackToPlaylist(track, 'end')
		},
		[addTrackToPlaylist],
	)

	const playNext = useCallback(() => {
		const target = resolveNextTrack(navigationState)
		if (!target) return

		const queueTrack = getTrackAtTarget(navigationState, target)
		if (!queueTrack) return

		const nextState = advanceAfterPlay(navigationState, target)
		setUpNext(nextState.upNext)
		setSpinePosition(nextState.spinePosition)
		void playResolvedTrack(queueTrack)
	}, [navigationState, playResolvedTrack])

	const playPrevious = useCallback(() => {
		const target = resolvePreviousTrack(navigationState)
		if (!target) return

		const queueTrack = getTrackAtTarget(navigationState, target)
		if (!queueTrack) return

		setSpinePosition(target.index)
		void playResolvedTrack(queueTrack)
	}, [navigationState, playResolvedTrack])

	const toggleLoop = useCallback(() => {
		setLoopMode(prev => {
			switch (prev) {
				case 'off':
					return 'all'
				case 'all':
					return 'one'
				case 'one':
					return 'off'
				default:
					return 'off'
			}
		})
	}, [])

	const toggleShuffle = useCallback(() => {
		setIsShuffleEnabled(prev => {
			const next = !prev

			if (next) {
				setSpineOrder(order =>
					reshuffleFromCurrent(
						order.length === spine.length
							? order
							: createShuffledOrder(spine.length, false),
						spinePosition,
					),
				)
			} else {
				const currentSpineIndex = spineOrder[spinePosition]
				const identityOrder = createShuffledOrder(spine.length, false)
				setSpineOrder(identityOrder)
				if (currentSpineIndex !== undefined) {
					setSpinePosition(currentSpineIndex)
				}
			}

			return next
		})
	}, [spine.length, spineOrder, spinePosition])

	const closePlayer = useCallback(() => {
		playlistFetchEpochRef.current += 1
		wantsAutoPlayRef.current = false
		setIsPlayerVisible(false)
		setCurrentTrack(null)
		resetQueueState()
		setPlayContext(null)
	}, [resetQueueState])

	const hasNext = spine.length > 0 && hasNextTrack(navigationState)
	const hasPrevious = spine.length > 0 && hasPreviousTrack(navigationState)

	useEffect(() => {
		if (!isPlayerVisible || !currentTrack || isOfflineEnvironment()) return

		const storage = getOfflineStorage()

		void (async () => {
			await hydrateAround(currentTrack.id)
			const ids = collectHydrationIds(navigationState, currentTrack.id)

			for (const id of ids) {
				const queueTrack = playbackCacheRef.current.get(id)
				if (!queueTrack || !isPlayableTrack(queueTrack)) continue
				try {
					await storage.cacheQueueTrack(queueTrack)
				} catch (error) {
					console.warn('Queue auto-cache failed:', error)
				}
			}
		})()
	}, [currentTrack?.id, hydrateAround, isPlayerVisible, navigationState])

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
