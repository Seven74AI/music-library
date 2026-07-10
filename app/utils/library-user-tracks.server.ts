export function parseHasAudioOnlyParam(searchParams: URLSearchParams): boolean {
	return searchParams.get('hasAudio') === '1'
}

export function buildLibraryUserTracksWhere({
	userId,
	hasAudioOnly,
}: {
	userId: string
	hasAudioOnly: boolean
}) {
	return {
		userId,
		isActive: true,
		deletedAt: null,
		...(hasAudioOnly ? { track: { audioFiles: { some: {} } } } : {}),
	}
}
