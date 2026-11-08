-- Deduplicate concurrent room play events by (roomId, playId, type).
CREATE UNIQUE INDEX "RoomPlayEvent_roomId_playId_type_key" ON "RoomPlayEvent"("roomId", "playId", "type");
