import { enqueueArchiveJobs } from "#app/features/audio-archive/auto-enqueue.server";

/**
 * Adapter seam for ArchiveJob auto-enqueue during playlist sync.
 * Injected so sync tests do not wake the archive worker.
 */
export interface ArchiveEnqueueAdapter {
  enqueueArchiveJobs(tx: unknown, trackIds: string[]): Promise<void>;
}

export function createProductionArchiveEnqueueAdapter(): ArchiveEnqueueAdapter {
  return {
    enqueueArchiveJobs,
  };
}

export const noopArchiveEnqueueAdapter: ArchiveEnqueueAdapter = {
  async enqueueArchiveJobs() {},
};
