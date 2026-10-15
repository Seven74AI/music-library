import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { removeRoomQueueItem } from "#app/features/party-room/api.client.ts";
import {
  canEditOthersUpcoming,
  canRemoveOwnQueueItem,
  splitRoomQueue,
} from "#app/features/party-room/index.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { type RoomQueueItemDto, type RoomSnapshot } from "#app/features/party-room/types.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { cn } from "#app/utils/misc.tsx";

function trackCountLabel(count: number) {
  return count === 1 ? "1 track" : `${count} tracks`;
}

/** Hosts can add a playlist. Listeners and DJs who cannot are told who adds tracks. */
function emptyQueueCopy(canAddPlaylist: boolean) {
  return canAddPlaylist
    ? "Queue is empty — add tracks from the library or a playlist."
    : "Queue is empty — a host or DJ adds tracks.";
}

function QueueRow({
  item,
  label,
  canRemove,
  onRemove,
  isCurrent,
  isPlaying,
  dragHandle,
}: {
  item: RoomQueueItemDto;
  label?: string;
  canRemove: boolean;
  onRemove: () => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
  dragHandle?: ReactNode;
}) {
  return (
    <li
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 border-b border-border/60 px-2 py-2 last:border-b-0",
        isCurrent && "bg-primary/10",
      )}
    >
      {dragHandle}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {isCurrent && isPlaying ? "▶ " : null}
          {item.track.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.track.artistName}
          {label ? ` · ${label}` : null}
          {item.track.duration != null ? ` · ${formatDuration(item.track.duration)}` : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">Added by {item.addedByDisplayName}</p>
      </div>
      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove from queue"
          onClick={onRemove}
        >
          <Icon name="trash" className="h-4 w-4" />
        </Button>
      ) : null}
    </li>
  );
}

function SortableUpcomingRow({
  item,
  index,
  canRemove,
  onRemove,
}: {
  item: RoomQueueItemDto;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && "relative z-10 opacity-80 shadow-md")}
    >
      <QueueRow
        item={item}
        canRemove={canRemove}
        onRemove={onRemove}
        dragHandle={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 w-8 shrink-0 cursor-grab p-0 active:cursor-grabbing"
            aria-label={`Drag to reorder ${item.track.title}. Position ${index + 1}.`}
            {...attributes}
            {...listeners}
          >
            <Icon name="drag-handle-dots-2" className="h-4 w-4 text-muted-foreground" />
          </Button>
        }
      />
    </div>
  );
}

function RoomQueuePanelBody({
  room,
  party,
}: {
  room: RoomSnapshot;
  party: NonNullable<ReturnType<typeof useOptionalPartyRoom>>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const role = room.me?.role;
  const { history, upcoming, nowPlaying } = splitRoomQueue(room);
  const canEditOthers = role ? canEditOthersUpcoming(role) : false;
  const canRemoveOwn = role ? canRemoveOwnQueueItem(role) : false;

  const [upcomingOrder, setUpcomingOrder] = useState(upcoming);
  // Resync from server snapshot only when roomVersion (or upcoming id set) changes —
  // not on every render, so optimistic drag order is not clobbered mid-gesture.
  const upcomingSyncKey = `${room.roomVersion}:${upcoming.map((i) => i.id).join(",")}`;
  useEffect(() => {
    setUpcomingOrder(upcoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by upcomingSyncKey
  }, [upcomingSyncKey]);

  const removeItem = (item: RoomQueueItemDto) => {
    const isOwn = room.me?.id === item.addedByParticipantId;
    if (!canEditOthers && !(canRemoveOwn && isOwn)) return;
    void removeRoomQueueItem(room.code, item.id, room.me?.userId)
      .then(() => {
        void party.refresh();
        toast({ title: "Removed from queue" });
      })
      .catch((err: unknown) => {
        toast({
          title: "Could not remove",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      });
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!canEditOthers) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = upcomingOrder.findIndex((item) => item.id === active.id);
    const newIndex = upcomingOrder.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(upcomingOrder, oldIndex, newIndex);
    const previous = upcomingOrder;
    setUpcomingOrder(next);

    void party
      .reorderUpcoming(next.map((item) => item.id))
      .then(() => {
        toast({ title: "Queue reordered" });
      })
      .catch((err: unknown) => {
        setUpcomingOrder(previous);
        toast({
          title: "Could not reorder",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Room queue</h2>
        <span className="text-xs text-muted-foreground">{trackCountLabel(room.queue.length)}</span>
      </div>

      {history.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Played
          </h3>
          <ul className="rounded-md border border-border">
            {history.map((item) => (
              <QueueRow key={item.id} item={item} canRemove={false} onRemove={() => {}} />
            ))}
          </ul>
        </section>
      ) : null}

      {nowPlaying ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {room.playback.isPlaying ? "Now playing" : "Ready"}
          </h3>
          <ul className="rounded-md border border-primary/40">
            <QueueRow
              item={nowPlaying}
              isCurrent
              isPlaying={room.playback.isPlaying}
              label={room.playback.isPlaying ? undefined : "Paused"}
              canRemove={false}
              onRemove={() => {}}
            />
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          {emptyQueueCopy(role === "host" || Boolean(party.canManage))}
        </p>
      )}

      {upcomingOrder.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Up next
            {canEditOthers ? (
              <span className="ml-2 font-normal normal-case tracking-normal">
                · drag to reorder
              </span>
            ) : null}
          </h3>
          {canEditOthers ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={upcomingOrder.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="rounded-md border border-border">
                  {upcomingOrder.map((item, index) => {
                    const isOwn = room.me?.id === item.addedByParticipantId;
                    return (
                      <SortableUpcomingRow
                        key={item.id}
                        item={item}
                        index={index}
                        canRemove={canEditOthers || (canRemoveOwn && isOwn)}
                        onRemove={() => removeItem(item)}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="rounded-md border border-border">
              {upcomingOrder.map((item) => {
                const isOwn = room.me?.id === item.addedByParticipantId;
                return (
                  <QueueRow
                    key={item.id}
                    item={item}
                    canRemove={canRemoveOwn && isOwn}
                    onRemove={() => removeItem(item)}
                  />
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {party.isHost && party.canTransport && room.queue.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void party.transport(
                room.playback.isPlaying ? { action: "pause" } : { action: "play" },
              );
            }}
          >
            <Icon name={room.playback.isPlaying ? "pause" : "play"} className="mr-1 h-4 w-4" />
            {room.playback.isPlaying ? "Pause" : "Play"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void party.transport({ action: "skip" });
            }}
          >
            <Icon name="forward" className="mr-1 h-4 w-4" />
            Skip
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RoomQueuePanel() {
  const party = useOptionalPartyRoom();
  if (!party?.room) return null;
  return <RoomQueuePanelBody room={party.room} party={party} />;
}
