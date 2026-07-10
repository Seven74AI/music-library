/** Stay under SQLite's 999 bind-parameter limit (with room for other params). */
export const SQLITE_IN_CHUNK_SIZE = 500

/**
 * Split an array into fixed-size chunks for batched Prisma `IN` queries.
 */
export function chunkArray<T>(
	items: T[],
	size: number = SQLITE_IN_CHUNK_SIZE,
): T[][] {
	if (size <= 0) {
		throw new Error('chunk size must be positive')
	}
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}
