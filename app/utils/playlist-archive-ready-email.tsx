import * as E from '@react-email/components'

export function PlaylistArchiveReadyEmail({
	playlistTitle,
	playlistUrl,
	userName,
}: {
	playlistTitle: string
	playlistUrl: string
	userName: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Your playlist is ready</E.Text>
				</h1>
				<p>
					<E.Text>
						Hi {userName}, all tracks in <strong>{playlistTitle}</strong> have
						been archived and are ready to play in your library.
					</E.Text>
				</p>
				<p>
					<E.Link href={playlistUrl}>Open playlist</E.Link>
				</p>
			</E.Container>
		</E.Html>
	)
}
