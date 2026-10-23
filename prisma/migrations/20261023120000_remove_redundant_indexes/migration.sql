-- Drop redundant non-unique indexes that duplicate a UNIQUE index on the same
-- column(s). A UNIQUE index already serves equality lookups, so the extra index
-- only doubles write cost and storage.

-- CoverImage.contentHash: covered by the unique CoverImage_contentHash_key.
DROP INDEX "CoverImage_contentHash_idx";

-- Service.name: covered by the unique Service_name_key.
DROP INDEX "Service_name_idx";

-- Note: Track.serviceId+externalId's redundant Track_serviceId_externalId_idx is
-- already absent from the database (dropped during the serviceId/externalId NOT
-- NULL table rebuild in 20251202140000). Removing the stale @@index declaration
-- from schema.prisma re-syncs the schema with the DB; no DROP INDEX needed here.
