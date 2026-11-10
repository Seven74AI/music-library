/**
 * Start/stop in-process background jobs from the Express server bundle so
 * graceful shutdown clears the same interval handles that were registered
 * at startup (see entry.server.tsx vs server/index.ts bundle split).
 */

export function startInProcessJobs(): void {
  if (process.env.AUDIO_ARCHIVE_ENABLED === "true") {
    const intervalMs = Number(process.env.AUDIO_ARCHIVE_INTERVAL_MS) || 120_000;
    void import("../app/features/audio-archive/worker.server.ts").then(
      ({ startAudioArchiveWorker }) => {
        startAudioArchiveWorker(intervalMs);
      },
    );
  }

  if (process.env.BACKUP_BUCKET_NAME) {
    void import("../app/features/db-backup/scheduler.server.ts").then(
      ({ startBackupScheduler }) => {
        startBackupScheduler();
      },
    );
  }

  if (process.env.NODE_ENV !== "test") {
    void import("../app/features/party-room/empty-room-sweeper.server.ts").then(
      ({ startEmptyRoomSweeper }) => {
        startEmptyRoomSweeper();
      },
    );

    void import("../app/utils/quality-check.server.ts").then(({ scheduleQualityCheck }) => {
      scheduleQualityCheck();
    });

    void import("../app/utils/duplicate-detection-scheduler.server.ts").then(
      ({ scheduleDuplicateDetection }) => {
        scheduleDuplicateDetection();
      },
    );

    void import("../app/features/on-repeat-snapshots/scheduler.server.ts").then(
      ({ scheduleOnRepeatSnapshots }) => {
        scheduleOnRepeatSnapshots();
      },
    );

    void import("../app/features/security/retention-sweeper.server.ts").then(
      ({ startSecurityEventSweeper }) => {
        startSecurityEventSweeper();
      },
    );

    void import("../app/features/upload-progress/progress-store.server.ts").then(
      ({ startUploadProgressSweeper }) => {
        startUploadProgressSweeper();
      },
    );
  }
}

export async function stopInProcessJobs(): Promise<void> {
  const { stopAudioArchiveWorker } = await import("../app/features/audio-archive/worker.server.ts");
  stopAudioArchiveWorker();

  const { stopBackupScheduler } = await import("../app/features/db-backup/scheduler.server.ts");
  stopBackupScheduler();

  const { stopEmptyRoomSweeper } =
    await import("../app/features/party-room/empty-room-sweeper.server.ts");
  stopEmptyRoomSweeper();

  const { stopQualityCheckScheduler } = await import("../app/utils/quality-check.server.ts");
  stopQualityCheckScheduler();

  const { stopDuplicateDetectionScheduler } =
    await import("../app/utils/duplicate-detection-scheduler.server.ts");
  stopDuplicateDetectionScheduler();

  const { stopOnRepeatSnapshotScheduler } =
    await import("../app/features/on-repeat-snapshots/scheduler.server.ts");
  stopOnRepeatSnapshotScheduler();

  const { stopSecurityEventSweeper } =
    await import("../app/features/security/retention-sweeper.server.ts");
  stopSecurityEventSweeper();

  const { stopUploadProgressSweeper } =
    await import("../app/features/upload-progress/progress-store.server.ts");
  stopUploadProgressSweeper();
}
