import { useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";

type Props = {
  trackId: string;
  /** Desktop dropdown vs mobile sheet styling */
  variant?: "dropdown" | "sheet";
  onDone?: () => void;
};

/**
 * Track `…` menu action: Add to room queue when participant role allows.
 */
export function AddToRoomQueueAction({ trackId, variant = "dropdown", onDone }: Props) {
  const party = useOptionalPartyRoom();
  const [busy, setBusy] = useState(false);

  if (!party?.room || party.room.status !== "open" || !party.canAddTracks) {
    return null;
  }

  const onClick = async () => {
    setBusy(true);
    try {
      await party.addTrack(trackId);
      toast({
        title: "Added to room queue",
        description: `Room ${party.room!.code}`,
      });
      onDone?.();
    } catch (err) {
      toast({
        title: "Could not add to room",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (variant === "sheet") {
    return (
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-2"
        disabled={busy}
        onClick={() => {
          void onClick();
        }}
      >
        <Icon name="speaker-wave" className="h-4 w-4" />
        {busy ? "Adding…" : "Add to room queue"}
      </Button>
    );
  }

  return (
    <button
      type="button"
      className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        void onClick();
      }}
    >
      <Icon name="speaker-wave" className="mr-2 h-4 w-4" />
      {busy ? "Adding…" : "Add to room queue"}
    </button>
  );
}
