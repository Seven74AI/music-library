-- CreateTable
CREATE TABLE "ProfilePrivacy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "showTopTracks" BOOLEAN NOT NULL DEFAULT true,
    "showTopArtists" BOOLEAN NOT NULL DEFAULT true,
    "showTotals" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProfilePrivacy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePrivacy_userId_key" ON "ProfilePrivacy"("userId");
