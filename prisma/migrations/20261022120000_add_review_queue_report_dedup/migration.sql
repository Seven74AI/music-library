-- ReviewQueueItem: add reportCount for ADR-035 dedup of duplicate user reports,
-- and a partial unique index that prevents more than one open user_report for the
-- same (entityType, entityId, issueType).
--
-- The partial index is intentionally scoped to `source = 'user_report'` and
-- `status = 'open'`. A blanket unique on [entityType, entityId, issueType, status]
-- (the literal ADR-035 wording) is incompatible with the quality-check job, which
-- creates multiple `system` "missing_info" items per track (one per missing field,
-- see app/utils/quality-check.server.ts). Restricting the constraint to open user
-- reports closes the report-spam/DoS vector without collapsing system/curator items.
-- Prisma cannot express partial unique indexes in schema.prisma, so this index lives
-- only in the migration (applied by `prisma migrate deploy`).

ALTER TABLE "ReviewQueueItem" ADD COLUMN "reportCount" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "ReviewQueueItem_open_user_report_key"
ON "ReviewQueueItem"("entityType", "entityId", "issueType")
WHERE "status" = 'open' AND "source" = 'user_report';
