import { prisma } from "#app/utils/db.server.ts";

const SINGLETON_ID = "singleton";

export type PersistedOnRepeatSchedulerState = {
  lastSuccessYearMonth: string | null;
  nextRetryAt: number | null;
};

export async function loadPersistedOnRepeatSchedulerState(): Promise<PersistedOnRepeatSchedulerState> {
  const row = await prisma.onRepeatSnapshotSchedulerState.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return {
    lastSuccessYearMonth: row.lastSuccessYearMonth,
    nextRetryAt: row.nextRetryAt?.getTime() ?? null,
  };
}

export async function persistOnRepeatSchedulerState(
  snapshot: PersistedOnRepeatSchedulerState,
): Promise<void> {
  await prisma.onRepeatSnapshotSchedulerState.upsert({
    where: { id: SINGLETON_ID },
    update: {
      lastSuccessYearMonth: snapshot.lastSuccessYearMonth,
      nextRetryAt: snapshot.nextRetryAt !== null ? new Date(snapshot.nextRetryAt) : null,
    },
    create: {
      id: SINGLETON_ID,
      lastSuccessYearMonth: snapshot.lastSuccessYearMonth,
      nextRetryAt: snapshot.nextRetryAt !== null ? new Date(snapshot.nextRetryAt) : null,
    },
  });
}

export async function clearPersistedOnRepeatSchedulerStateForTests(): Promise<void> {
  await prisma.onRepeatSnapshotSchedulerState.upsert({
    where: { id: SINGLETON_ID },
    update: {
      lastSuccessYearMonth: null,
      nextRetryAt: null,
    },
    create: { id: SINGLETON_ID },
  });
}
