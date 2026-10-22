export function parseHasAudioOnlyParam(searchParams: URLSearchParams): boolean {
  return searchParams.get("hasAudio") === "1";
}

export function parseLibraryGenreParam(searchParams: URLSearchParams): string | null {
  const genreId = searchParams.get("genre")?.trim() ?? "";
  return genreId.length > 0 ? genreId : null;
}

export function buildLibraryUserTracksWhere({
  userId,
  hasAudioOnly,
  genreId = null,
}: {
  userId: string;
  hasAudioOnly: boolean;
  genreId?: string | null;
}) {
  const normalizedGenreId = genreId?.trim() || null;
  const track = {
    ...(hasAudioOnly ? { audioFiles: { some: {} } } : {}),
    ...(normalizedGenreId ? { genres: { some: { id: normalizedGenreId } } } : {}),
  };

  return {
    userId,
    isActive: true,
    deletedAt: null,
    ...(Object.keys(track).length > 0 ? { track } : {}),
  };
}
