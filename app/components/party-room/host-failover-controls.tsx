import { Button } from "#app/components/ui/button.tsx";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { toast } from "#app/components/ui/use-toast.ts";

/**
 * Become host (after the speaker's 30s silence) / Reclaim host (seat that holds the pass).
 */
export function HostFailoverControls() {
  const party = useOptionalPartyRoom();
  if (!party?.room) return null;

  const { showBecomeHost, showReclaimHost, becomeHostNow, reclaimHostNow } = party;
  if (!showBecomeHost && !showReclaimHost) return null;

  return (
    <div className="flex flex-wrap gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      {showBecomeHost ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <p className="text-sm">Host is away. Take over as speaker?</p>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void becomeHostNow()
                .then(() => {
                  toast({ title: "You are now the host" });
                })
                .catch((err: unknown) => {
                  toast({
                    title: "Could not become host",
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                });
            }}
          >
            Become host
          </Button>
        </div>
      ) : null}
      {showReclaimHost ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <p className="text-sm">Reclaim the host seat and speaker?</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void reclaimHostNow()
                .then(() => {
                  toast({ title: "Host reclaimed" });
                })
                .catch((err: unknown) => {
                  toast({
                    title: "Could not reclaim host",
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                });
            }}
          >
            Reclaim host
          </Button>
        </div>
      ) : null}
    </div>
  );
}
