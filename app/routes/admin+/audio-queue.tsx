// TEST FILE — see audio-queue.test.tsx for unit tests
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Form, useSearchParams } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary'
import { Spacer } from '#app/components/spacer.tsx'
import { Badge } from '#app/components/ui/badge.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '#app/components/ui/card.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusBadge } from '#app/components/ui/status-badge.tsx'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '#app/components/ui/table.tsx'
import { computeArchiveQueueSuccessRate } from '#app/features/audio-archive/queue-stats'
import { isRecoverableArchiveFailure } from '#app/features/audio-archive/recoverable-failure.ts'
import { scheduleQueueTick, resetCookieFailureStreak, getCurrentlyProcessingJobs } from '#app/features/audio-archive/worker.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { type Route } from './+types/audio-queue.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const PAGE_SIZE = 20

const STATUS_FILTERS = ['all', 'pending', 'processing', 'completed', 'failed'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

interface JobWithTrack {
	id: string
	status: string
	priority: boolean
	retryCount: number
	errorHistory: string
	lastAttemptAt: Date | null
	createdAt: Date
	track: {
		id: string
		title: string
		artist: { id: string; name: string }
		service: { id: string; name: string; displayName: string }
	}
}

interface LoaderData {
	workerState: {
		status: string
		lastQueueRun: string | null
		nextLongBreakAt: string | null
		lastStateChange: string
	}
	queueStats: {
		pending: number
		processing: number
		completed: number
		failed: number
		total: number
		successRate: number
		recoverableFailed: number
	}
	jobs: Array<{
		id: string
		status: string
		priority: boolean
		retryCount: number
		errorHistory: string
		lastAttemptAt: string | null
		createdAt: string
		trackTitle: string
		trackId: string
		artistName: string
		serviceDisplayName: string
	}>
	currentlyProcessingTrack: {
		id: string
		title: string
		artistName: string
	} | null
	filter: StatusFilter
	page: number
	totalPages: number
}

export async function loader({ request, url }: Route.LoaderArgs): Promise<LoaderData> {
	await requireUserWithRole(request, 'admin')

	
	const filterParam = url.searchParams.get('status') ?? 'all'
	const filter: StatusFilter = STATUS_FILTERS.includes(filterParam as StatusFilter)
		? (filterParam as StatusFilter)
		: 'all'
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))

	// Get worker state (ADR-002: Prisma directly, not via import)
	const workerState = await prisma.workerState.upsert({
		where: { id: 'singleton' },
		update: {},
		create: { id: 'singleton', status: 'running' },
	})

	// Queue stats
	const [pending, processing, completed, failed] = await Promise.all([
		prisma.archiveJob.count({ where: { status: 'pending' } }),
		prisma.archiveJob.count({ where: { status: 'processing' } }),
		prisma.archiveJob.count({ where: { status: 'completed' } }),
		prisma.archiveJob.count({ where: { status: 'failed' } }),
	])
	const total = pending + processing + completed + failed
	const successRate = computeArchiveQueueSuccessRate(completed, failed)

	const failedJobsForRetry = failed
		? await prisma.archiveJob.findMany({
				where: { status: 'failed' },
				select: { errorHistory: true },
			})
		: []
	const recoverableFailed = failedJobsForRetry.filter((job) =>
		isRecoverableArchiveFailure(job.errorHistory),
	).length

	// Jobs for the track table with pagination
	const whereClause = filter === 'all' ? {} : { status: filter }
	const totalFiltered = await prisma.archiveJob.count({ where: whereClause })
	const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))

	const jobs = await prisma.archiveJob.findMany({
		where: whereClause,
		orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
		skip: (page - 1) * PAGE_SIZE,
		take: PAGE_SIZE,
		include: {
			track: {
				select: {
					id: true,
					title: true,
					artist: { select: { id: true, name: true } },
					service: { select: { id: true, name: true, displayName: true } },
				},
			},
		},
	})

	// Currently processing track details — from in-memory set (avoids DB writes per job)
	let currentlyProcessingTrack: LoaderData['currentlyProcessingTrack'] = null
	const activeJobIds = getCurrentlyProcessingJobs()
	if (activeJobIds.length > 0) {
		// Show the first active job (most concurrent runs process 1-2 jobs)
		const job = await prisma.archiveJob.findUnique({
			where: { id: activeJobIds[0] },
			include: {
				track: {
					select: {
						id: true,
						title: true,
						artist: { select: { name: true } },
					},
				},
			},
		})
		if (job) {
			currentlyProcessingTrack = {
				id: job.track.id,
				title: job.track.title,
				artistName: job.track.artist.name,
			}
		}
	}

	return {
		workerState: {
			status: workerState.status,
			nextLongBreakAt: workerState.nextLongBreakAt?.toISOString() ?? null,
			lastStateChange: workerState.lastStateChange.toISOString(),
			lastQueueRun: workerState.lastQueueRun?.toISOString() ?? null,
		},
		queueStats: { pending, processing, completed, failed, total, successRate, recoverableFailed },
		jobs: jobs.map((j) => ({
			id: j.id,
			status: j.status,
			priority: j.priority,
			retryCount: j.retryCount,
			errorHistory: j.errorHistory,
			lastAttemptAt: j.lastAttemptAt?.toISOString() ?? null,
			createdAt: j.createdAt.toISOString(),
			trackTitle: j.track.title,
			trackId: j.track.id,
			artistName: j.track.artist.name,
			serviceDisplayName: j.track.service.displayName || j.track.service.name,
		})),
		currentlyProcessingTrack,
		filter,
		page,
		totalPages,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserWithRole(request, 'admin')

	const formData = await request.formData()
	const intent = formData.get('intent')

	switch (intent) {
		case 'pause': {
			// ADR-002: Write directly to WorkerState table
			await prisma.workerState.upsert({
				where: { id: 'singleton' },
				update: { status: 'paused', lastStateChange: new Date() },
				create: { id: 'singleton', status: 'paused' },
			})
			return data({ success: true, action: 'pause' })
		}

		case 'resume': {
			await prisma.workerState.upsert({
				where: { id: 'singleton' },
				update: {
					status: 'running',
					nextLongBreakAt: null,
					lastStateChange: new Date(),
				},
				create: { id: 'singleton', status: 'running' },
			})
			resetCookieFailureStreak()
			scheduleQueueTick()
			return data({ success: true, action: 'resume' })
		}

		case 'long-break': {
			const durationMs = Number(formData.get('durationMs') ?? '21600000') // 6h default
			const nextLongBreakAt = new Date(Date.now() + durationMs)
			await prisma.workerState.upsert({
				where: { id: 'singleton' },
				update: {
					status: 'long_break',
					nextLongBreakAt,
					lastStateChange: new Date(),
				},
				create: {
					id: 'singleton',
					status: 'long_break',
					nextLongBreakAt,
				},
			})
			return data({ success: true, action: 'long-break' })
		}

		case 'retry-recoverable-failures': {
			const failedJobs = await prisma.archiveJob.findMany({
				where: { status: 'failed' },
				select: { id: true, errorHistory: true },
			})
			const recoverableIds = failedJobs
				.filter((job) => isRecoverableArchiveFailure(job.errorHistory))
				.map((job) => job.id)

			if (recoverableIds.length > 0) {
				await prisma.archiveJob.updateMany({
					where: { id: { in: recoverableIds } },
					data: {
						status: 'pending',
						priority: true,
						retryCount: 0,
						errorHistory: '[]',
					},
				})
			}

			scheduleQueueTick()
			return data({
				success: true,
				action: 'retry-recoverable-failures',
				count: recoverableIds.length,
			})
		}

		case 'retry': {
			const jobId = formData.get('jobId')
			if (typeof jobId !== 'string') {
				return data({ success: false, error: 'Missing jobId' }, { status: 400 })
			}
			const existing = await prisma.archiveJob.findUnique({
				where: { id: jobId },
				select: { status: true, errorHistory: true },
			})
			if (!existing || (existing.status !== 'failed' && existing.status !== 'processing')) {
				return data({ success: false, error: 'Job cannot be retried' }, { status: 400 })
			}

			if (existing.status === 'failed') {
				await prisma.archiveJob.update({
					where: { id: jobId },
					data: {
						status: 'pending',
						priority: true,
						retryCount: 0,
						errorHistory: '[]',
					},
				})
			} else {
				let errorHistory: unknown[] = []
				try {
					errorHistory = JSON.parse(existing.errorHistory) as unknown[]
				} catch {
					errorHistory = []
				}
				errorHistory.push({
					category: 'UNKNOWN',
					message: 'Manually reset from processing by admin',
					timestamp: new Date().toISOString(),
				})
				await prisma.archiveJob.update({
					where: { id: jobId },
					data: {
						status: 'pending',
						priority: true,
						errorHistory: JSON.stringify(errorHistory),
					},
				})
			}
			scheduleQueueTick()
			return data({ success: true, action: 'retry', jobId })
		}

		case 'enqueue': {
			const trackId = formData.get('trackId')
			if (typeof trackId !== 'string') {
				return data({ success: false, error: 'Missing trackId' }, { status: 400 })
			}
			// Enqueue a track that doesn't have an ArchiveJob yet
			await prisma.archiveJob.create({
				data: {
					trackId,
					status: 'pending',
					priority: true,
				},
			})
			scheduleQueueTick()
			return data({ success: true, action: 'enqueue', trackId })
		}

		default: {
			return data({ success: false, error: `Unknown intent: ${intent}` }, { status: 400 })
		}
	}
}

function formatDateTime(iso: string | null): string {
	if (!iso) return '—'
	return new Date(iso).toLocaleString()
}

function getLatestError(errorHistoryJson: string): string {
	try {
		const errors = JSON.parse(errorHistoryJson)
		if (Array.isArray(errors) && errors.length > 0) {
			const latest = errors[errors.length - 1] as { message?: string; category?: string }
			return latest.message ?? latest.category ?? 'Unknown'
		}
	} catch {
		// ignore
	}
	return '—'
}

export default function AudioQueueRoute({
	loaderData,
}: Route.ComponentProps) {
	const [searchParams] = useSearchParams()
	const activeFilter = (searchParams.get('status') ?? 'all') as StatusFilter
	const currentPage = Number(searchParams.get('page') ?? '1')

	const { workerState, queueStats, jobs, currentlyProcessingTrack, totalPages } =
		loaderData

	const isPaused = workerState.status === 'paused'
	const isLongBreak = workerState.status === 'long_break'
	const isRunning = workerState.status === 'running'

	return (
		<div className="container">
			<h1 className="text-h1">Audio Archive Queue</h1>
			<Spacer size="2xs" />

			{/* ===== WORKER CONTROL PANEL ===== */}
			<div className="rounded-lg border p-4 mb-6">
				<h2 className="text-h3 mb-3">Worker Control</h2>

				<div className="flex flex-wrap items-center gap-4 mb-4">
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">Status:</span>
						<StatusBadge status={workerState.status} />
					</div>

					<Form method="post" className="flex gap-2">
						{!isPaused && isRunning && (
							<Button type="submit" name="intent" value="pause" variant="outline" size="sm">
								<Icon name="pause" className="mr-1" />
								Pause
							</Button>
						)}
						{(isPaused || isLongBreak) && (
							<Button type="submit" name="intent" value="resume" variant="default" size="sm">
								<Icon name="play" className="mr-1" />
								{isLongBreak ? 'Break Long Pause' : 'Resume'}
							</Button>
						)}
						{isRunning && (
							<Button
								type="submit"
								name="intent"
								value="long-break"
								variant="outline"
								size="sm"
							>
								<Icon name="clock" className="mr-1" />
								Long Break (6h)
							</Button>
						)}
					</Form>
				</div>

				<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
					<div>
						<span className="text-muted-foreground">Currently Processing:</span>{' '}
						{currentlyProcessingTrack ? (
							<span className="font-medium">
								{currentlyProcessingTrack.title} — {currentlyProcessingTrack.artistName}
							</span>
						) : (
							<span className="font-mono text-muted-foreground">idle</span>
						)}
					</div>
					<div>
						<span className="text-muted-foreground">Last Queue Run:</span>{' '}
						<span className="font-mono">{formatDateTime(workerState.lastQueueRun)}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Next Long Break:</span>{' '}
						<span className="font-mono">{formatDateTime(workerState.nextLongBreakAt)}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Last State Change:</span>{' '}
						<span className="font-mono">{formatDateTime(workerState.lastStateChange)}</span>
					</div>
				</div>
			</div>

			{/* ===== QUEUE STATISTICS ===== */}
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Pending</CardDescription>
						<CardTitle className="text-2xl">{queueStats.pending}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Processing</CardDescription>
						<CardTitle className="text-2xl">{queueStats.processing}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Completed</CardDescription>
						<CardTitle className="text-2xl text-green-600">{queueStats.completed}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Failed</CardDescription>
						<CardTitle className="text-2xl text-destructive">{queueStats.failed}</CardTitle>
					</CardHeader>
					{queueStats.recoverableFailed > 0 && (
						<CardContent className="pt-0">
							<Form method="post">
								<Button
									type="submit"
									name="intent"
									value="retry-recoverable-failures"
									variant="outline"
									size="sm"
								>
									<Icon name="arrow-path" className="mr-1" />
									Retry cookie & format failures ({queueStats.recoverableFailed})
								</Button>
							</Form>
						</CardContent>
					)}
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Total</CardDescription>
						<CardTitle className="text-2xl">{queueStats.total}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Success Rate</CardDescription>
						<CardTitle className="text-2xl">{queueStats.successRate}%</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{/* ===== TRACK TABLE ===== */}
			<div className="rounded-lg border p-4">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-4">
					<h2 className="text-h3">Track Queue</h2>
					<div className="flex gap-1">
						{STATUS_FILTERS.map((s) => (
							<Form key={s} method="get" className="inline">
								{s !== 'all' && <input type="hidden" name="status" value={s} />}
								<Button
									type="submit"
									variant={activeFilter === s ? 'default' : 'outline'}
									size="sm"
								>
									{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
								</Button>
							</Form>
						))}
					</div>
				</div>

					<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Track</TableHead>
									<TableHead>Artist</TableHead>
									<TableHead>Service</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Retries</TableHead>
									<TableHead>Latest Error</TableHead>
									<TableHead>Last Attempt</TableHead>
									<TableHead>Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{jobs.length === 0 ? (
									<TableRow>
										<td colSpan={8} className="text-center text-muted-foreground py-8">
											No {activeFilter === 'all' ? '' : activeFilter} jobs found.
										</td>
									</TableRow>
								) : (
									jobs.map((job) => (
										<TableRow key={job.id}>
											<TableCell className="font-medium max-w-[200px] truncate">
												{job.trackTitle}
											</TableCell>
											<TableCell>{job.artistName}</TableCell>
											<TableCell>{job.serviceDisplayName}</TableCell>
											<TableCell>
												<StatusBadge status={job.status} />
												{job.priority && (
													<Badge variant="outline" className="ml-1 text-[10px]">
														PRI
													</Badge>
												)}
											</TableCell>
											<TableCell className="font-mono">{job.retryCount}</TableCell>
											<TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
												{getLatestError(job.errorHistory)}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground font-mono">
												{formatDateTime(job.lastAttemptAt)}
											</TableCell>
											<TableCell>
												<Form method="post" className="inline-flex gap-1">
													{(job.status === 'failed' || job.status === 'processing') && (
														<Button
															type="submit"
															name="intent"
															value="retry"
															variant="outline"
															size="sm"
														>
															<Icon name="arrow-path" className="mr-1" />
															{job.status === 'processing' ? 'Reset' : 'Retry'}
															<input type="hidden" name="jobId" value={job.id} />
														</Button>
													)}
													{job.status === 'completed' || job.status === 'failed' ? null : (
														<Button
															type="submit"
															name="intent"
															value="enqueue"
															variant="ghost"
															size="sm"
															disabled
														>
															<Icon name="download" className="mr-1" />
															Archive
														</Button>
													)}
												</Form>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>

						{/* Pagination */}
						{totalPages > 1 && (
							<div className="flex items-center justify-between mt-4 pt-4 border-t">
								<p className="text-sm text-muted-foreground">
									Page {currentPage} of {totalPages}
								</p>
								<div className="flex gap-1">
									<Form method="get" className="inline">
										{activeFilter !== 'all' && (
											<input type="hidden" name="status" value={activeFilter} />
										)}
										{currentPage > 1 && (
											<input type="hidden" name="page" value={currentPage - 1} />
										)}
										<Button
											type="submit"
											variant="outline"
											size="sm"
											disabled={currentPage <= 1}
										>
											<Icon name="chevron-double-left" />
											Previous
										</Button>
									</Form>
									<Form method="get" className="inline">
										{activeFilter !== 'all' && (
											<input type="hidden" name="status" value={activeFilter} />
										)}
										{currentPage < totalPages && (
											<input type="hidden" name="page" value={currentPage + 1} />
										)}
										<Button
											type="submit"
											variant="outline"
											size="sm"
											disabled={currentPage >= totalPages}
										>
											Next
											<Icon name="chevron-double-right" />
										</Button>
									</Form>
								</div>
							</div>
						)}
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: ({ error }) => (
					<p>You must be an admin to access the audio queue: {error?.data.message}</p>
				),
			}}
		/>
	)
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}
