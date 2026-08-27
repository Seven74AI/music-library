-- Make ServicePlaylist unique per user, not globally.
-- Two users syncing the same external playlist previously collided on the
-- [serviceId, externalId] key, so the second user's upsert overwrote the first
-- user's row (reassigning ownerId).

-- DropIndex
DROP INDEX "ServicePlaylist_serviceId_externalId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlaylist_serviceId_externalId_ownerId_key" ON "ServicePlaylist"("serviceId", "externalId", "ownerId");
