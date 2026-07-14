import { data } from 'react-router'
import { YOUTUBE_SERVICE } from '#app/constants/services'
import { hasServiceConnection } from '#app/features/service-connection/service-connection.server'
import { createServicePlaylistService } from '#app/features/service-playlist/service-playlist.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { buildLibraryUserTracksWhere } from '#app/utils/library-user-tracks.server.ts'

export type HomeMode = 'marketing' | 'onboarding' | 'gray' | 'listening'

export type HomeMarketingData = { mode: 'marketing' }

export type HomeOnboardingData = {
	mode: 'onboarding'
	youtubeConnected: boolean
	isAdmin: boolean
}

export type HomeRecentTrack = {
	id: string
	createdAt: Date
	track: {
		id: string
		title: string
		duration: number | null
		serviceUrl: string | null
		artist: { id: string; name: string }
		coverImage: { objectKey: string } | null
		service: { name: string; displayName: string; logoUrl: string | null } | null
		audioFiles: Array<{ id: string; format: string | null; objectKey: string }>
	}
}

export type HomeRecentPlaylist = {
	id: string
	title: string
	description: string | null
	createdAt: Date
	updatedAt: Date
	tracks: Array<{
		id: string
		track: {
			id: string
			title: string
			artist: { id: string; name: string }
			duration: number | null
			coverImage: { objectKey: string } | null
		}
	}>
}

export type HomeYoutubeData = {
	hasYouTubeConnection: boolean
	youtubeStats: {
		totalPlaylists: number
		lastSync: Date | null
	} | null
	youtubePlaylists: Array<{
		id: string
		title: string
		itemCount: number
	}>
}

export type HomeListeningData = {
	mode: 'gray' | 'listening'
	totalTracks: number
	playableTracks: number
	archivingCount: number
	stats: {
		totalTracks: number
		totalPlaylists: number
	}
	recentTracks: HomeRecentTrack[]
	recentPlaylists: HomeRecentPlaylist[]
	youtubeData: Promise<HomeYoutubeData>
}

export type HomeData = HomeMarketingData | HomeOnboardingData | HomeListeningData

export function resolveHomeMode(
	totalTracks: number,
	playableTracks: number,
): Exclude<HomeMode, 'marketing'> {
	if (totalTracks === 0) return 'onboarding'
	if (playableTracks === 0) return 'gray'
	return 'listening'
}

const recentTrackInclude = {
	track: {
		include: {
			artist: {
				select: {
					id: true,
					name: true,
				},
			},
			coverImage: {
				select: {
					objectKey: true,
				},
			},
			service: {
				select: {
					name: true,
					displayName: true,
					logoUrl: true,
				},
			},
			audioFiles: {
				select: {
					id: true,
					format: true,
					objectKey: true,
				},
			},
		},
	},
} as const

async function loadYoutubeData(userId: string): Promise<HomeYoutubeData> {
	const youtubeService = await prisma.service.findUnique({
		where: { name: YOUTUBE_SERVICE.NAME },
	})

	if (!youtubeService) {
		return {
			hasYouTubeConnection: false,
			youtubeStats: null,
			youtubePlaylists: [],
		}
	}

	const servicePlaylistService = createServicePlaylistService()

	try {
		const [syncedPlaylists, hasValidOAuth] = await Promise.all([
			servicePlaylistService.getSyncedPlaylists(YOUTUBE_SERVICE.NAME, userId),
			hasServiceConnection(YOUTUBE_SERVICE.NAME, userId),
		])

		return {
			hasYouTubeConnection: hasValidOAuth,
			youtubeStats: {
				totalPlaylists: syncedPlaylists.length,
				lastSync: syncedPlaylists.length > 0 ? syncedPlaylists[0]?.updatedAt ?? null : null,
			},
			youtubePlaylists: syncedPlaylists.slice(0, 3).map((playlist) => ({
				id: playlist.id,
				title: playlist.title,
				itemCount: playlist.itemCount,
			})),
		}
	} catch (error) {
		console.error('Error fetching YouTube data:', error)
		return {
			hasYouTubeConnection: false,
			youtubeStats: null,
			youtubePlaylists: [],
		}
	}
}

export async function loadHomeData(request: Request) {
	const userId = await getUserId(request)

	if (!userId) {
		return data<HomeMarketingData>({ mode: 'marketing' })
	}

	const baseWhere = buildLibraryUserTracksWhere({ userId, hasAudioOnly: false })
	const playableWhere = buildLibraryUserTracksWhere({ userId, hasAudioOnly: true })

	const [totalTracks, playableTracks] = await Promise.all([
		prisma.userTrack.count({ where: baseWhere }),
		prisma.userTrack.count({ where: playableWhere }),
	])

	const mode = resolveHomeMode(totalTracks, playableTracks)

	if (mode === 'onboarding') {
		const [youtubeConnected, adminUser] = await Promise.all([
			hasServiceConnection(YOUTUBE_SERVICE.NAME, userId),
			prisma.user.findFirst({
				select: { id: true },
				where: { id: userId, roles: { some: { name: 'admin' } } },
			}),
		])
		return data<HomeOnboardingData>({
			mode: 'onboarding',
			youtubeConnected,
			isAdmin: adminUser !== null,
		})
	}

	const [totalPlaylists, recentTracks, recentPlaylists] = await Promise.all([
		prisma.userPlaylist.count({ where: { ownerId: userId } }),
		prisma.userTrack.findMany({
			where: baseWhere,
			include: recentTrackInclude,
			orderBy: { createdAt: 'desc' },
			take: 8,
		}),
		prisma.userPlaylist.findMany({
			where: { ownerId: userId },
			select: {
				id: true,
				title: true,
				description: true,
				createdAt: true,
				updatedAt: true,
				tracks: {
					select: {
						id: true,
						track: {
							select: {
								id: true,
								title: true,
								artist: {
									select: {
										id: true,
										name: true,
									},
								},
								duration: true,
								coverImage: {
									select: {
										objectKey: true,
									},
								},
							},
						},
					},
					orderBy: { position: 'asc' },
					take: 5,
				},
			},
			orderBy: { updatedAt: 'desc' },
			take: 5,
		}),
	])

	return data<HomeListeningData>({
		mode,
		totalTracks,
		playableTracks,
		archivingCount: totalTracks - playableTracks,
		stats: {
			totalTracks,
			totalPlaylists,
		},
		recentTracks,
		recentPlaylists,
		// YouTube data is only needed for the listening-hub view (not gray zone)
		youtubeData: mode === 'listening' ? loadYoutubeData(userId) : Promise.resolve({
			hasYouTubeConnection: false,
			youtubeStats: null,
			youtubePlaylists: [],
		}),
	})
}
