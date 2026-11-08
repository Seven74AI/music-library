-- Deduplicate concurrent room play events by (roomId, playId, type).
-- Drop duplicate historical rows before adding the unique index (retain oldest id per key).
DELETE FROM "RoomPlayEvent"
WHERE "playId" IS NOT NULL
  AND "id" IN (
    SELECT e1."id"
    FROM "RoomPlayEvent" e1
    JOIN "RoomPlayEvent" e2
      ON e2."roomId" = e1."roomId"
      AND e2."playId" = e1."playId"
      AND e2."type" = e1."type"
      AND e2."id" < e1."id"
  );

CREATE UNIQUE INDEX "RoomPlayEvent_roomId_playId_type_key" ON "RoomPlayEvent"("roomId", "playId", "type");
