-- AlterTable: Add merge tracking to Artist
ALTER TABLE "Artist" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Artist" ADD COLUMN "mergedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "mergedBy" TEXT;

-- AlterTable: Add merge tracking to Album
ALTER TABLE "Album" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Album" ADD COLUMN "mergedAt" DATETIME;
ALTER TABLE "Album" ADD COLUMN "mergedBy" TEXT;

-- CreateTable: TrackEdit
CREATE TABLE "TrackEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "albumId" TEXT,
    "genre" TEXT,
    "year" INTEGER,
    "trackNumber" INTEGER,
    "albumArtist" TEXT,
    "bpm" INTEGER,
    "label" TEXT,
    "isrc" TEXT,
    "releaseDate" DATETIME,
    "originalDate" DATETIME,
    "originalYear" INTEGER,
    "totalTracks" INTEGER,
    "totalDiscs" INTEGER,
    "lyrics" TEXT,
    CONSTRAINT "TrackEdit_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackEdit_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: ArtistEdit
CREATE TABLE "ArtistEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artistId" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "website" TEXT,
    "genre" TEXT,
    "country" TEXT,
    CONSTRAINT "ArtistEdit_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtistEdit_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: AlbumEdit
CREATE TABLE "AlbumEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "albumId" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "name" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "year" INTEGER,
    "coverImageId" TEXT,
    CONSTRAINT "AlbumEdit_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlbumEdit_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex: Artist merge tracking
CREATE INDEX "Artist_mergedIntoId_idx" ON "Artist"("mergedIntoId");

-- CreateIndex: Album merge tracking
CREATE INDEX "Album_mergedIntoId_idx" ON "Album"("mergedIntoId");

-- CreateIndex: TrackEdit indexes
CREATE INDEX "TrackEdit_trackId_editedAt_idx" ON "TrackEdit"("trackId", "editedAt");
CREATE INDEX "TrackEdit_editedBy_idx" ON "TrackEdit"("editedBy");

-- CreateIndex: ArtistEdit indexes
CREATE INDEX "ArtistEdit_artistId_editedAt_idx" ON "ArtistEdit"("artistId", "editedAt");
CREATE INDEX "ArtistEdit_editedBy_idx" ON "ArtistEdit"("editedBy");

-- CreateIndex: AlbumEdit indexes
CREATE INDEX "AlbumEdit_albumId_editedAt_idx" ON "AlbumEdit"("albumId", "editedAt");
CREATE INDEX "AlbumEdit_editedBy_idx" ON "AlbumEdit"("editedBy");

-- Foreign key constraints for Artist merge self-relation
CREATE INDEX "Artist_mergedIntoId_fkey_idx" ON "Artist"("mergedIntoId");

-- Foreign key constraints for Album merge self-relation
CREATE INDEX "Album_mergedIntoId_fkey_idx" ON "Album"("mergedIntoId");

-- Insert curator role and permissions
INSERT INTO Role VALUES('curator_role_id_00000000000','curator','Trusted user who can edit track/artist/album metadata',strftime('%s','now') * 1000,strftime('%s','now') * 1000);

-- Insert permissions for curator role
INSERT INTO Permission VALUES('perm_metadata_update_any','update','metadata','any','Edit any track/artist/album metadata',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_metadata_history_read','read','metadata-history','any','Read edit history for tracks/artists/albums',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_metadata_restore_any','restore','metadata','any','Restore track/artist/album to previous versions',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_artist_update_any','update','artist','any','Edit any artist metadata',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_artist_merge_any','merge','artist','any','Merge duplicate artists',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_album_update_any','update','album','any','Edit any album metadata',strftime('%s','now') * 1000,strftime('%s','now') * 1000);
INSERT INTO Permission VALUES('perm_album_merge_any','merge','album','any','Merge duplicate albums',strftime('%s','now') * 1000,strftime('%s','now') * 1000);

-- Link permissions to curator role
INSERT INTO _PermissionToRole VALUES('perm_metadata_update_any','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_metadata_history_read','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_metadata_restore_any','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_artist_update_any','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_artist_merge_any','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_album_update_any','curator_role_id_00000000000');
INSERT INTO _PermissionToRole VALUES('perm_album_merge_any','curator_role_id_00000000000');

-- Also link these permissions to admin role
INSERT INTO _PermissionToRole VALUES('perm_metadata_update_any','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_metadata_history_read','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_metadata_restore_any','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_artist_update_any','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_artist_merge_any','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_album_update_any','clnf2zvlw000gpcour6dyyuh6');
INSERT INTO _PermissionToRole VALUES('perm_album_merge_any','clnf2zvlw000gpcour6dyyuh6');
