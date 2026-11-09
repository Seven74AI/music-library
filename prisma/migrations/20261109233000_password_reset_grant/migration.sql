-- CreateTable
CREATE TABLE "PasswordResetGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetGrant_tokenHash_key" ON "PasswordResetGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetGrant_userId_idx" ON "PasswordResetGrant"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetGrant_expiresAt_idx" ON "PasswordResetGrant"("expiresAt");
