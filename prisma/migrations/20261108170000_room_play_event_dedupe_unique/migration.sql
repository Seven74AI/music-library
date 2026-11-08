-- Deduplicate concurrent room play events by (roomId, playId, type) for rows
-- with a non-null playId. SQLite treats NULL playId as distinct in unique indexes,
-- so only non-null playIds are enforced here.
DELETE FROM "RoomPlayEvent"
WHERE "playId" IS NOT NULL
  AND "rowid" NOT IN (
    SELECT MIN("rowid")
    FROM "RoomPlayEvent"
    WHERE "playId" IS NOT NULL
    GROUP BY "roomId", "playId", "type"
  );

CREATE UNIQUE INDEX "RoomPlayEvent_roomId_playId_type_key"
ON "RoomPlayEvent"("roomId", "playId", "type")
WHERE "playId" IS NOT NULL;
