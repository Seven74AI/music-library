import { useState, useMemo, useCallback, useEffect } from 'react'
import { useFetcher } from 'react-router'
import { Button } from './ui/button'
import { Icon } from './ui/icon'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from './ui/dialog'

interface Playlist {
	id: string
	title: string
	description: string | null
	_count: { tracks: number }
}

type ConvertResponse = {
	status: string
	message?: string
	addedCount?: number
	skippedCount?: number
	playlist?: { id: string; title: string }
	existingTitle?: string
}

interface ConvertPlaylistDialogProps {
	/** The service playlist ID to convert */
	playlistId: string
	/** Title of the service playlist (pre-filled for create new) */
	playlistTitle: string
}

/**
 * Dialog for converting a service playlist into a user playlist.
 *
 * Two modes:
 * - "Create New": pre-fills the service playlist title, creates a new user playlist
 *   with all active tracks.
 * - "Add to Existing": searchable picker of the user's existing playlists, bulk-adds
 *   tracks (duplicates silently skipped).
 */
export function ConvertPlaylistDialog({ playlistId, playlistTitle }: ConvertPlaylistDialogProps) {
	const [open, setOpen] = useState(false)
	const [mode, setMode] = useState<'menu' | 'create' | 'add'>('menu')
	const [newTitle, setNewTitle] = useState(playlistTitle)
	const [createError, setCreateError] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState('')

	const convertFetcher = useFetcher<ConvertResponse>()
	const playlistsFetcher = useFetcher<{ playlists: Playlist[] }>()

	// Fetch playlists for "Add to Existing" mode
	useEffect(() => {
		if (mode === 'add' && playlistsFetcher.state === 'idle' && !playlistsFetcher.data) {
			playlistsFetcher.load('/resources/playlists')
		}
	}, [mode, playlistsFetcher])

	const playlists = playlistsFetcher.data?.playlists ?? []

	const filteredPlaylists = useMemo(() => {
		if (!searchQuery) return playlists
		return playlists.filter((p) =>
			p.title.toLowerCase().includes(searchQuery.toLowerCase()),
		)
	}, [playlists, searchQuery])

	// Handle convert fetcher responses
	useEffect(() => {
		if (convertFetcher.state === 'idle' && convertFetcher.data) {
			if (convertFetcher.data.status === 'success') {
				setOpen(false)
				resetState()
			} else if (convertFetcher.data.status === 'duplicate_title') {
				setCreateError(
					convertFetcher.data.message ??
						`You already have a playlist named "${convertFetcher.data.existingTitle ?? ''}"`,
				)
			}
		}
	}, [convertFetcher.state, convertFetcher.data])

	const resetState = useCallback(() => {
		setMode('menu')
		setNewTitle(playlistTitle)
		setCreateError(null)
		setSearchQuery('')
	}, [playlistTitle])

	const handleOpenChange = useCallback(
		(open: boolean) => {
			setOpen(open)
			if (!open) resetState()
		},
		[resetState],
	)

	const handleCreate = useCallback(() => {
		const trimmed = newTitle.trim()
		if (!trimmed) {
			setCreateError('Playlist name is required')
			return
		}
		setCreateError(null)
		void convertFetcher.submit(
			{ playlistId, action: 'create', title: trimmed },
			{
				method: 'POST',
				action: '/resources/service-playlist-to-user-playlist',
			},
		)
	}, [convertFetcher, newTitle, playlistId])

	const handleAdd = useCallback(
		(targetId: string) => {
			void convertFetcher.submit(
				{ playlistId, action: 'add', targetPlaylistId: targetId },
				{
					method: 'POST',
					action: '/resources/service-playlist-to-user-playlist',
				},
			)
		},
		[convertFetcher, playlistId],
	)

	const isBusy = convertFetcher.state !== 'idle'

	const handleBackToMenu = () => {
		setMode('menu')
		setCreateError(null)
		setNewTitle(playlistTitle)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" aria-label={`More actions for ${playlistTitle}`}>
					<Icon name="dots-horizontal" className="h-4 w-4" />
				</Button>
			</DialogTrigger>

			<DialogContent className="sm:max-w-sm">
				{mode === 'menu' && (
					<>
						<DialogHeader>
							<DialogTitle>{playlistTitle}</DialogTitle>
							<DialogDescription>Convert to user playlist</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-2 mt-2">
							<Button
								variant="outline"
								className="justify-start"
								onClick={() => setMode('create')}
								disabled={isBusy}
							>
								<Icon name="plus" className="h-4 w-4 mr-2" />
								Create New Playlist
							</Button>
							<Button
								variant="outline"
								className="justify-start"
								onClick={() => setMode('add')}
								disabled={isBusy}
							>
								<Icon name="update" className="h-4 w-4 mr-2" />
								Add to Existing Playlist
							</Button>
						</div>
					</>
				)}

				{mode === 'create' && (
					<>
						<DialogHeader>
							<DialogTitle>Create New Playlist</DialogTitle>
							<DialogDescription>
								All tracks from "{playlistTitle}" will be added to the new playlist.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 mt-2">
							<label htmlFor="new-playlist-title" className="sr-only">
								Playlist name
							</label>
							<Input
								id="new-playlist-title"
								placeholder="Playlist name"
								value={newTitle}
								onChange={(e) => {
									setNewTitle(e.target.value)
									setCreateError(null)
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault()
										handleCreate()
									}
								}}
								autoFocus
								disabled={isBusy}
								aria-invalid={!!createError}
								aria-describedby={createError ? 'new-playlist-error' : undefined}
							/>
							{createError && (
								<p id="new-playlist-error" className="text-xs text-destructive" role="alert">
									{createError}
								</p>
							)}
							<div className="flex gap-2">
								<Button
									onClick={handleCreate}
									disabled={isBusy}
									className="flex-1"
								>
									{isBusy ? 'Creating...' : 'Create Playlist'}
								</Button>
								<Button
									variant="outline"
									onClick={handleBackToMenu}
									disabled={isBusy}
								>
									Back
								</Button>
							</div>
						</div>
					</>
				)}

				{mode === 'add' && (
					<>
						<DialogHeader>
							<DialogTitle>Add to Existing Playlist</DialogTitle>
							<DialogDescription>
								Select a playlist to add all tracks from "{playlistTitle}". Duplicates will be skipped.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 mt-2">
							<label htmlFor="playlist-search" className="sr-only">
								Search playlists
							</label>
							<Input
								id="playlist-search"
								placeholder="Search playlists..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								autoFocus
								disabled={isBusy}
							/>
							<ScrollArea className="h-48">
								{playlistsFetcher.state === 'loading' ? (
									<div className="py-8 text-center text-sm text-muted-foreground">
										Loading playlists...
									</div>
								) : filteredPlaylists.length === 0 ? (
									<div className="py-8 text-center text-sm text-muted-foreground">
										{searchQuery ? 'No playlists found' : 'No playlists yet'}
									</div>
								) : (
									<div className="space-y-1">
										{filteredPlaylists.map((playlist) => (
											<button
												key={playlist.id}
												type="button"
												onClick={() => handleAdd(playlist.id)}
												disabled={isBusy}
												className="w-full text-left px-3 py-2 rounded hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
											>
												<div className="font-medium text-sm">{playlist.title}</div>
												<div className="text-xs text-muted-foreground">
													{playlist._count.tracks}{' '}
													{playlist._count.tracks === 1 ? 'track' : 'tracks'}
												</div>
											</button>
										))}
									</div>
								)}
							</ScrollArea>
							<div className="flex gap-2">
								<Button variant="outline" onClick={handleBackToMenu} disabled={isBusy}>
									Back
								</Button>
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
