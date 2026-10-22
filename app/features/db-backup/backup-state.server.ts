import { prisma } from "#app/utils/db.server.ts";

export const BackupStatus = {
  RUNNING: "running",
  SUCCESS: "success",
  FAILURE: "failure",
} as const;

export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

export type BackupStateResult = {
  lastStatus: BackupStatus | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastObjectKey: string | null;
  updatedAt: Date;
};

function reshape(state: {
  lastStatus: string | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastObjectKey: string | null;
  updatedAt: Date;
}): BackupStateResult {
  return {
    lastStatus: (state.lastStatus as BackupStatus | null) ?? null,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastObjectKey: state.lastObjectKey,
    updatedAt: state.updatedAt,
  };
}

export async function getBackupState(): Promise<BackupStateResult> {
  const state = await prisma.backupState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  return reshape(state);
}

export async function markBackupRunning(): Promise<BackupStateResult> {
  const now = new Date();
  const state = await prisma.backupState.upsert({
    where: { id: "singleton" },
    update: {
      lastStatus: BackupStatus.RUNNING,
      lastAttemptAt: now,
      lastError: null,
    },
    create: {
      id: "singleton",
      lastStatus: BackupStatus.RUNNING,
      lastAttemptAt: now,
    },
  });
  return reshape(state);
}

export async function markBackupSuccess(objectKey: string): Promise<BackupStateResult> {
  const now = new Date();
  const state = await prisma.backupState.upsert({
    where: { id: "singleton" },
    update: {
      lastStatus: BackupStatus.SUCCESS,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: null,
      lastObjectKey: objectKey,
    },
    create: {
      id: "singleton",
      lastStatus: BackupStatus.SUCCESS,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastObjectKey: objectKey,
    },
  });
  return reshape(state);
}

export async function markBackupFailure(error: string): Promise<BackupStateResult> {
  const now = new Date();
  const state = await prisma.backupState.upsert({
    where: { id: "singleton" },
    update: {
      lastStatus: BackupStatus.FAILURE,
      lastAttemptAt: now,
      lastError: error.slice(0, 2000),
    },
    create: {
      id: "singleton",
      lastStatus: BackupStatus.FAILURE,
      lastAttemptAt: now,
      lastError: error.slice(0, 2000),
    },
  });
  return reshape(state);
}
