import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { isOfflineEnvironment } from '#app/features/offline-app/is-offline-environment.client.ts'
import { getOfflineStorage } from '#app/features/offline-storage/offline-storage.client.ts'
import { offlineSummaryToFullTrack } from '#app/features/offline-storage/offline-track-summary.client.ts'
import {
	collectHydrationIds,
	hydratePlaybackCacheInBatches,
	PlaybackHydrationCache,
	resolveFullTrack,
	resolveFullTracks,
} from '#app/features/queue/queue-hydration.ts'
import {
	advanceAfterPlay,
	buildFlatQueueView,
	findSpinePositionForTrackId,
	flatIndexForSpinePosition,
	getTrackAtTarget,
	getQueueSpineDisplayTracks,
	hasNextTrack,
	hasPreviousTrack,
	resolveNextTrack,
	resolvePreviousTrack,
	type QueueNavigationState,
	type QueueTarget,
} from '#app/features/queue/queue-navigation.ts'
import {
	createShuffledOrder,
	reshuffleFromCurrent,
} from '#app/features/queue/queue-shuffle.ts'
import {
	AuthExpiredError,
	fetchQueueSpine,
	queueTrackFromFullTrack,
	type QueueSpineContext,
} from '#app/features/queue/queue-spine.ts'
import { type FullTrack, type QueueTrack } from '#app/types/frontend/shared'
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
	upNext: Track[]
	spine: Track[]
	spineTotal: number
	spinePosition: number
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
	startQueuePlayback: () => void
	hasQueuedPlayback: boolean
	hasNext: boolean
	hasPrevious: boolean
	isLoadingNext: boolean
	addTrackToPlaylist: (track: Track, position?: 'next' | 'end') => void
	removeTrackFromPlaylist: (target: QueueTarget) => void
	removeCurrentFromQueue: () => void
	playNextTrack: (track: Track) => void
	addToUpNext: (track: Track) => void
	addToQueue: (track: Track) => void
	hydrateTracksForDisplay: (ids: string[]) => void
	/** @deprecated Use addToUpNext instead */
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
	const [upNextPlayNextCount, setUpNextPlayNextCount] = useState(0)
	const [spine, setSpine] = useState<QueueTrack[]>([])
	const [spineTotal, setSpineTotal] = useState(0)
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
	const upNextPlayNextCountRef = useRef(0)

	// Throttle scroll-driven hydration: accumulate IDs during rapid scrolling,
	// flush as a single batch 300ms after the last scroll event.
	const pendingHydrationIdsRef = useRef(new Set<string>())
	const hydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

	const upNextView = useMemo(() => {
		void cacheVersion
		return resolveFullTracks(playbackCacheRef.current, upNext)
	}, [upNext, cacheVersion])

	const spineView = useMemo(() => {
		void cacheVersion
		return resolveFullTracks(
			playbackCacheRef.current,
			getQueueSpineDisplayTracks(navigationState, currentTrack !== null),
		)
	}, [navigationState, cacheVersion, currentTrack])

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
		// Cancel any pending scroll hydration from a previous queue
		if (hydrationTimerRef.current) {
			clearTimeout(hydrationTimerRef.current)
			hydrationTimerRef.current = null
		}
		pendingHydrationIdsRef.current.clear()
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

	const hydrateTracksForDisplay = useCallback((ids: string[]) => {
		if (ids.length === 0 || isOfflineEnvironment()) return

		for (const id of ids) {
			const cached = playbackCacheRef.current.get(id)
			if (!cached?.coverImage) {
				pendingHydrationIdsRef.current.add(id)
			}
		}

		if (pendingHydrationIdsRef.current.size === 0) return

		// Reset the debounce timer — flush 300ms after the last scroll event
		if (hydrationTimerRef.current) {
			clearTimeout(hydrationTimerRef.current)
		}

		hydrationTimerRef.current = setTimeout(() => {
			const needsHydration = [...pendingHydrationIdsRef.current]
			pendingHydrationIdsRef.current.clear()

			void (async () => {
				const updated = await hydratePlaybackCacheInBatches(
					playbackCacheRef.current,
					needsHydration,
					{ refetchIncomplete: true },
				)
				if (updated > 0) {
					setCacheVersion(version => version + 1)
				}
			})()
		}, 300)
	}, [])

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
		async (context: PlaylistContext): Promise<{ tracks: QueueTrack[]; total: number }> => {
			const spineContext = toQueueSpineContext(context)

			if (spineContext) {
				try {
					const result = await fetchQueueSpine(spineContext)
					if (result.tracks.length > 0) return result
				} catch (error) {
					if (error instanceof AuthExpiredError) {
						window.location.href = '/login'
						return { tracks: [], total: 0 }
					}
					console.error('Failed to fetch queue spine:', error)
				}
			}

			const offlineTracks = await fetchOfflineTracks(context)
			for (const track of offlineTracks) {
				playbackCacheRef.current.set(track)
			}
			setCacheVersion(version => version + 1)
			const tracks = offlineTracks.map(queueTrackFromFullTrack)
			return { tracks, total: tracks.length }
		},
		[fetchOfflineTracks],
	)

	const resetQueueState = useCallback(() => {
		setUpNext([])
		setUpNextPlayNextCount(0)
		upNextPlayNextCountRef.current = 0
		setSpine([])
		setSpineTotal(0)
		setSpineOrder([])
		setSpinePosition(0)
		playbackCacheRef.current.clear()
		setCacheVersion(version => version + 1)
		// Cancel any pending scroll hydration from the old queue
		if (hydrationTimerRef.current) {
			clearTimeout(hydrationTimerRef.current)
			hydrationTimerRef.current = null
		}
		pendingHydrationIdsRef.current.clear()
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

				const order = createShuffledOrder(loadedSpine.tracks.length, isShuffleEnabled)
				const resolvedPosition = (() => {
					if (
						explicitIndex !== undefined &&
						loadedSpine.tracks[explicitIndex]?.id === track.id
					) {
						return order.findIndex(index => index === explicitIndex)
					}
					return findSpinePositionForTrackId(
						{ upNext: [], spine: loadedSpine.tracks, spineOrder: order, spinePosition: 0, loopMode: 'off' },
						track.id,
					) ?? 0
				})()

				setUpNext([])
				setUpNextPlayNextCount(0)
				upNextPlayNextCountRef.current = 0
				setSpine(loadedSpine.tracks)
				setSpineTotal(loadedSpine.total)
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
			setIsLoadingNext(true)
			try {
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
				setUpNextPlayNextCount(0)
				upNextPlayNextCountRef.current = 0
				setSpine(loadedSpine)
				setSpineTotal(loadedSpine.length)
				setSpineOrder(order)
				setSpinePosition(spinePosition >= 0 ? spinePosition : 0)
				setPlayContext(context)
				setIsPlayerVisible(true)
				beginPlayback()
				setCurrentTrack(startTrack)
				void hydrateAround(startTrack.id)
			} finally {
				setIsLoadingNext(false)
			}
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
			if (loadedSpine.tracks.length === 0) return

			const order = createShuffledOrder(loadedSpine.tracks.length, isShuffleEnabled)
			const firstQueueTrack = loadedSpine.tracks[order[0] ?? 0]
			if (!firstQueueTrack) return

			setUpNext([])
			setUpNextPlayNextCount(0)
			upNextPlayNextCountRef.current = 0
			setSpine(loadedSpine.tracks)
			setSpineTotal(loadedSpine.total)
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
				if (loadedSpine.tracks.length === 0) return

				const order = createShuffledOrder(loadedSpine.tracks.length, isShuffleEnabled)
				const firstQueueTrack = loadedSpine.tracks[order[0] ?? 0]
				if (!firstQueueTrack) return

				setUpNext([])
				setUpNextPlayNextCount(0)
				upNextPlayNextCountRef.current = 0
				setSpine(loadedSpine.tracks)
				setSpineTotal(loadedSpine.total)
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
		(track: Track, position: 'next' | 'upNext' | 'end' = 'end') => {
			if (!isPlayableTrack(track)) return

			const queueTrack = queueTrackFromFullTrack(track)
			rememberTrack(track)

			if (position === 'next') {
				const nextCount = upNextPlayNextCountRef.current + 1
				upNextPlayNextCountRef.current = nextCount
				setUpNextPlayNextCount(nextCount)
				setUpNext(prev => {
					const next = [...prev]
					next.splice(0, 0, queueTrack)
					return next
				})
				return
			}

			if (position === 'upNext') {
				setUpNext(prev => [...prev, queueTrack])
				return
			}

		setSpine(prev => [...prev, queueTrack])
		setSpineOrder(prev => [...prev, prev.length])
		setSpineTotal(total => total + 1)
		},
		[rememberTrack],
	)

	const openPlayerWithoutAutoplay = useCallback(() => {
		wantsAutoPlayRef.current = false
		setIsPlayerVisible(true)
	}, [])

	const isWarmPlayback = isPlayerVisible && currentTrack !== null

	const removeTrackFromPlaylist = useCallback(
		(target: QueueTarget) => {
			if (target.zone === 'upNext') {
				setUpNext(prev => prev.filter((_, itemIndex) => itemIndex !== target.index))
				if (target.index < upNextPlayNextCount) {
					setUpNextPlayNextCount(count => {
						const next = Math.max(0, count - 1)
						upNextPlayNextCountRef.current = next
						return next
					})
				}
				return
			}

			const orderIndex = target.index
			if (orderIndex < 0 || orderIndex >= spineOrder.length) return

			const spineIndexToRemove = spineOrder[orderIndex]
			if (spineIndexToRemove === undefined) return

			setSpine(prev => prev.filter((_, itemIndex) => itemIndex !== spineIndexToRemove))
			setSpineOrder(prev =>
				prev
					.filter((_, itemIndex) => itemIndex !== orderIndex)
					.map(spineIndex => (spineIndex > spineIndexToRemove ? spineIndex - 1 : spineIndex)),
			)
			setSpineTotal(total => Math.max(0, total - 1))

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
		[navigationState, playResolvedTrack, spineOrder, spinePosition, upNextPlayNextCount],
	)

	const removeCurrentFromQueue = useCallback(() => {
		if (!currentTrack) return

		const upNextIndex = upNext.findIndex(track => track.id === currentTrack.id)
		if (upNextIndex >= 0) {
			removeTrackFromPlaylist({ zone: 'upNext', index: upNextIndex })
			return
		}

		if (findSpinePositionForTrackId(navigationState, currentTrack.id) === spinePosition) {
			removeTrackFromPlaylist({ zone: 'spine', index: spinePosition })
			return
		}

		const nextTarget = resolveNextTrack(navigationState)
		if (nextTarget) {
			const queueTrack = getTrackAtTarget(navigationState, nextTarget)
			if (!queueTrack) return

			const nextState = advanceAfterPlay(navigationState, nextTarget)
			setUpNext(nextState.upNext)
			if (nextTarget.zone === 'upNext' && nextTarget.index < upNextPlayNextCount) {
				setUpNextPlayNextCount(count => {
					const next = Math.max(0, count - 1)
					upNextPlayNextCountRef.current = next
					return next
				})
			}
			setSpinePosition(nextState.spinePosition)
			void playResolvedTrack(queueTrack)
			return
		}

		setCurrentTrack(null)
	}, [
		currentTrack,
		navigationState,
		playResolvedTrack,
		removeTrackFromPlaylist,
		spinePosition,
		upNext,
		upNextPlayNextCount,
	])

	const playNextTrack = useCallback(
		(track: Track) => {
			if (!isPlayableTrack(track)) return

			const activeQueueSession =
				isPlayerVisible &&
				(currentTrack !== null ||
					upNext.length > 0 ||
					getTrackAtTarget(navigationState, { zone: 'spine', index: spinePosition }) !==
						null)

			if (activeQueueSession) {
				addTrackToPlaylist(track, 'next')
				return
			}

			rememberTrack(track)
			wantsAutoPlayRef.current = false
			setCurrentTrack(track)
			setIsPlayerVisible(true)
		},
		[
			addTrackToPlaylist,
			currentTrack,
			isPlayerVisible,
			navigationState,
			rememberTrack,
			spinePosition,
			upNext.length,
		],
	)

	const addToUpNext = useCallback(
		(track: Track) => {
			if (!isPlayableTrack(track)) return

			addTrackToPlaylist(track, 'upNext')

			if (!isWarmPlayback) {
				openPlayerWithoutAutoplay()
			}
		},
		[addTrackToPlaylist, isWarmPlayback, openPlayerWithoutAutoplay],
	)

	const addToQueue = useCallback(
		(track: Track) => {
			if (!isPlayableTrack(track)) return

			addTrackToPlaylist(track, 'end')

			if (!isWarmPlayback) {
				openPlayerWithoutAutoplay()
			}
		},
		[addTrackToPlaylist, isWarmPlayback, openPlayerWithoutAutoplay],
	)

	const addToCurrentPlaylist = useCallback(
		(track: Track) => {
			addToUpNext(track)
		},
		[addToUpNext],
	)

	const advanceToTarget = useCallback(
		(target: QueueTarget) => {
			const queueTrack = getTrackAtTarget(navigationState, target)
			if (!queueTrack) return

			const nextState = advanceAfterPlay(navigationState, target)
			setUpNext(nextState.upNext)
			if (target.zone === 'upNext' && target.index < upNextPlayNextCount) {
				setUpNextPlayNextCount(count => {
					const next = Math.max(0, count - 1)
					upNextPlayNextCountRef.current = next
					return next
				})
			}
			setSpinePosition(nextState.spinePosition)
			void playResolvedTrack(queueTrack)
		},
		[navigationState, playResolvedTrack, upNextPlayNextCount],
	)

	const playNext = useCallback(() => {
		const target = resolveNextTrack(navigationState)
		if (!target) return
		advanceToTarget(target)
	}, [advanceToTarget, navigationState])

	const startQueuePlayback = useCallback(() => {
		if (currentTrack) return

		if (upNext.length > 0) {
			advanceToTarget({ zone: 'upNext', index: 0 })
			return
		}

		const queueTrack = getTrackAtTarget(navigationState, {
			zone: 'spine',
			index: spinePosition,
		})
		if (queueTrack) {
			void playResolvedTrack(queueTrack)
		}
	}, [
		advanceToTarget,
		currentTrack,
		navigationState,
		playResolvedTrack,
		spinePosition,
		upNext.length,
	])

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

	const hasQueuedPlayback =
		upNext.length > 0 ||
		getTrackAtTarget(navigationState, { zone: 'spine', index: spinePosition }) !==
			null
	const hasNext = hasNextTrack(navigationState)
	const hasPrevious = hasPreviousTrack(navigationState)

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
				upNext: upNextView,
				spine: spineView,
				spineTotal,
				spinePosition,
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
				startQueuePlayback,
				hasQueuedPlayback,
				hasNext,
				hasPrevious,
				isLoadingNext,
				addTrackToPlaylist,
				removeTrackFromPlaylist,
				removeCurrentFromQueue,
				playNextTrack,
				addToUpNext,
				addToQueue,
				hydrateTracksForDisplay,
				addToCurrentPlaylist,
			}}
		>
			{children}
			<InstallAppBanner playerVisible={isPlayerVisible} />
			<AudioPlayer
				track={currentTrack}
				isVisible={isPlayerVisible}
				onClose={closePlayer}
				onStartQueuePlayback={startQueuePlayback}
				hasQueuedPlayback={hasQueuedPlayback}
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
