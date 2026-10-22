-- CreateTable
CREATE TABLE "DuplicateIntentionalGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupKey" TEXT NOT NULL,
    "groupType" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateIntentionalGroup_groupKey_key" ON "DuplicateIntentionalGroup"("groupKey");

-- CreateIndex
CREATE INDEX "DuplicateIntentionalGroup_groupType_idx" ON "DuplicateIntentionalGroup"("groupType");
