import { prisma } from "#app/utils/db.server.ts";

const SINGLETON_ID = "singleton";

export type PersistedSchedulerState = {
  lastSuccessDay: string | null;
  attemptsToday: number;
  attemptDay: string | null;
  nextRetryAt: number | null;
};

export async function loadPersistedSchedulerState(): Promise<PersistedSchedulerState> {
  const row = await prisma.backupState.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return {
    lastSuccessDay: row.schedulerLastSuccessDay,
    attemptsToday: row.schedulerAttemptsToday,
    attemptDay: row.schedulerAttemptDay,
    nextRetryAt: row.schedulerNextRetryAt?.getTime() ?? null,
  };
}

export async function persistSchedulerState(snapshot: PersistedSchedulerState): Promise<void> {
  await prisma.backupState.upsert({
    where: { id: SINGLETON_ID },
    update: {
      schedulerLastSuccessDay: snapshot.lastSuccessDay,
      schedulerAttemptDay: snapshot.attemptDay,
      schedulerAttemptsToday: snapshot.attemptsToday,
      schedulerNextRetryAt: snapshot.nextRetryAt !== null ? new Date(snapshot.nextRetryAt) : null,
    },
    create: {
      id: SINGLETON_ID,
      schedulerLastSuccessDay: snapshot.lastSuccessDay,
      schedulerAttemptDay: snapshot.attemptDay,
      schedulerAttemptsToday: snapshot.attemptsToday,
      schedulerNextRetryAt: snapshot.nextRetryAt !== null ? new Date(snapshot.nextRetryAt) : null,
    },
  });
}

export async function clearPersistedSchedulerStateForTests(): Promise<void> {
  await prisma.backupState.upsert({
    where: { id: SINGLETON_ID },
    update: {
      schedulerLastSuccessDay: null,
      schedulerAttemptDay: null,
      schedulerAttemptsToday: 0,
      schedulerNextRetryAt: null,
    },
    create: { id: SINGLETON_ID },
  });
}
