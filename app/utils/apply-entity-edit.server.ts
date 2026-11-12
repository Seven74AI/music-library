import { data } from "react-router";
import { type z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import {
  assertEditLockInTransaction,
  EditLockTransactionError,
  editLockConflictCopyForEntity,
  getLockStatus,
  releaseLock,
  throwEditLockTransactionError,
  type EntityType,
  type LockInfo,
} from "#app/utils/locks.server.ts";
import { type Prisma } from "#prisma/client.js";

type ApplyEntityEditOptions<
  TType extends EntityType,
  TSchema extends z.ZodType,
  TBefore,
  TPrepared,
  TEdit,
  TUpdated,
> = {
  request: Request;
  entityType: TType;
  entityId: string;
  userId: string;
  schema: TSchema;
  /** How validation failures are reported in the 400 body. */
  validationErrorStyle: "issues" | "fieldErrors";
  /** Existence checks etc. Runs after validation and before the lock check; throw `data(...)` to reject. */
  verify: (editData: z.infer<TSchema>) => Promise<void>;
  /** Optional work that runs after the lock check and before the transaction (e.g. genre resolution). */
  prepare?: (editData: z.infer<TSchema>) => Promise<TPrepared>;
  /** Read the pre-write snapshot source inside the transaction. Return null if the entity vanished. */
  loadBeforeWrite: (tx: Prisma.TransactionClient) => Promise<TBefore | null>;
  notFoundMessage: string;
  /** Create the edit-history row from the pre-write state. */
  createEdit: (
    tx: Prisma.TransactionClient,
    before: TBefore,
    editData: z.infer<TSchema>,
  ) => Promise<TEdit>;
  /** Apply the update. Per-field merge semantics live with the caller. */
  update: (
    tx: Prisma.TransactionClient,
    before: TBefore,
    editData: z.infer<TSchema>,
    prepared: TPrepared,
  ) => Promise<TUpdated>;
};

/** Transaction result, keyed by entity type (`{ track, edit }`, `{ album, edit }`, ...). */
type EntityEditResult<TType extends EntityType, TUpdated, TEdit> = {
  [K in TType]: TUpdated;
} & { edit: TEdit };

/**
 * Shared orchestration for entity edit routes (ADR-032):
 * JSON parse → safeParse → verify → getLockStatus → prepare → transaction
 * (assert lock → snapshot → edit-create → update) → release lock.
 */
export async function applyEntityEdit<
  TType extends EntityType,
  TSchema extends z.ZodType,
  TBefore,
  TEdit,
  TUpdated,
  TPrepared = undefined,
>(
  options: ApplyEntityEditOptions<TType, TSchema, TBefore, TPrepared, TEdit, TUpdated>,
): Promise<EntityEditResult<TType, TUpdated, TEdit>> {
  const { entityType, entityId, userId } = options;

  let body;
  try {
    body = await options.request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = options.schema.safeParse(body);
  if (!parseResult.success) {
    throw data(
      {
        error: "Validation failed",
        ...(options.validationErrorStyle === "fieldErrors"
          ? { details: parseResult.error.flatten().fieldErrors }
          : { issues: parseResult.error.issues }),
      },
      { status: 400 },
    );
  }
  const editData = parseResult.data as z.infer<TSchema>;

  await options.verify(editData);

  const lock: LockInfo | null = await getLockStatus(entityType, entityId);
  if (lock && lock.lockedBy !== userId) {
    throw data(
      {
        error: "Locked",
        message: `${lock.lockedByName} is currently editing this ${entityType}`,
      },
      { status: 409 },
    );
  }

  const prepared = (await options.prepare?.(editData)) as TPrepared;

  let result: EntityEditResult<TType, TUpdated, TEdit>;
  try {
    result = await prisma.$transaction(async (tx) => {
      await assertEditLockInTransaction(tx, entityType, entityId, userId, lock);

      const before = await options.loadBeforeWrite(tx);
      if (!before) {
        throw data({ error: options.notFoundMessage }, { status: 404 });
      }

      const edit = await options.createEdit(tx, before, editData);
      const updated = await options.update(tx, before, editData, prepared);
      return { [entityType]: updated, edit } as EntityEditResult<TType, TUpdated, TEdit>;
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      throwEditLockTransactionError(error, editLockConflictCopyForEntity(entityType));
    }
    throw error;
  }

  // Release the lock on successful save (ADR-032).
  if (lock) {
    await releaseLock(entityType, entityId, userId, {
      lockId: lock.id,
      acquiredAt: lock.acquiredAt,
    });
  }

  return result;
}
