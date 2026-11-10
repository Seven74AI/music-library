/**
 * Resolve merged-away artists/albums to their living canonical row.
 * Broken chains and cycles surface as {@link MergedEntityResolutionError} (no entity ids in the message).
 */
export class MergedEntityResolutionError extends Error {
  constructor() {
    super("Merged entity could not be resolved");
    this.name = "MergedEntityResolutionError";
  }
}

type MergedIntoRow = {
  id: string;
  mergedIntoId: string | null;
};

export async function followMergedIntoIdChain<T extends MergedIntoRow>(
  start: T,
  fetchByMergedIntoId: (mergedIntoId: string) => Promise<T | null>,
): Promise<T> {
  const seen = new Set<string>();
  let current = start;

  while (current.mergedIntoId) {
    if (seen.has(current.id)) {
      throw new MergedEntityResolutionError();
    }
    seen.add(current.id);

    const next = await fetchByMergedIntoId(current.mergedIntoId);
    if (!next) {
      throw new MergedEntityResolutionError();
    }
    current = next;
  }

  return current;
}

export async function resolveCanonicalIdFromStartId(
  startId: string,
  fetchById: (id: string) => Promise<MergedIntoRow | null>,
): Promise<string> {
  const seen = new Set<string>();
  let currentId = startId;

  for (;;) {
    if (seen.has(currentId)) {
      throw new MergedEntityResolutionError();
    }
    seen.add(currentId);

    const row = await fetchById(currentId);
    if (!row) {
      throw new MergedEntityResolutionError();
    }
    if (!row.mergedIntoId) {
      return row.id;
    }
    currentId = row.mergedIntoId;
  }
}

export function mergedEntityNotFoundResponse(entityLabel: "Album" | "Artist"): Response {
  return new Response(`${entityLabel} not found`, { status: 404 });
}
