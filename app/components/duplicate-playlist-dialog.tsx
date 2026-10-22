import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { buttonVariants } from "./ui/button";

export type DuplicatePlaylistInfo = {
  id: string;
  title: string;
};

export type DuplicateConfirmRequest = {
  trackId: string;
  trackTitle: string;
  playlist: DuplicatePlaylistInfo;
  onSuccess?: () => void;
};

type DuplicatePlaylistDialogContextValue = {
  requestConfirm: (request: DuplicateConfirmRequest) => void;
};

const DuplicatePlaylistDialogContext = createContext<DuplicatePlaylistDialogContextValue | null>(
  null,
);

export function useDuplicatePlaylistDialog() {
  return useContext(DuplicatePlaylistDialogContext);
}

/**
 * Hosts the duplicate-track AlertDialog outside dropdown/sheet trees so it survives
 * Radix menu unmount when focus moves to the dialog (desktop Add to Playlist).
 */
export function DuplicatePlaylistDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DuplicateConfirmRequest | null>(null);
  const [awaitingAction, setAwaitingAction] = useState(false);
  const pendingSuccessRef = useRef<(() => void) | undefined>(undefined);
  const fetcher = useFetcher<{
    status: string;
    message?: string;
    playlistId?: string;
    removedCount?: number;
  }>();
  const { revalidate } = useRevalidator();

  const requestConfirm = useCallback((next: DuplicateConfirmRequest) => {
    setAwaitingAction(false);
    pendingSuccessRef.current = undefined;
    setRequest(next);
  }, []);

  useEffect(() => {
    if (!awaitingAction || fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.status === "success") {
      void revalidate();
      const onSuccess = pendingSuccessRef.current;
      pendingSuccessRef.current = undefined;
      setAwaitingAction(false);
      setRequest(null);
      onSuccess?.();
    } else {
      setAwaitingAction(false);
    }
  }, [awaitingAction, fetcher.state, fetcher.data, revalidate]);

  const beginAction = useCallback(
    (submit: () => void) => {
      if (!request) return;
      pendingSuccessRef.current = request.onSuccess;
      setAwaitingAction(true);
      submit();
    },
    [request],
  );

  const handleRemove = useCallback(() => {
    beginAction(() => {
      void fetcher.submit(
        { trackId: request!.trackId, playlistId: request!.playlist.id },
        { method: "POST", action: "/resources/remove-track-from-playlist" },
      );
    });
  }, [beginAction, fetcher, request]);

  const handleAddDuplicate = useCallback(() => {
    beginAction(() => {
      void fetcher.submit(
        {
          trackId: request!.trackId,
          playlistId: request!.playlist.id,
          forceDuplicate: "true",
        },
        { method: "POST", action: "/resources/add-track-to-playlist" },
      );
    });
  }, [beginAction, fetcher, request]);

  const value = useMemo(() => ({ requestConfirm }), [requestConfirm]);

  return (
    <DuplicatePlaylistDialogContext.Provider value={value}>
      {children}
      <AlertDialog
        open={!!request}
        onOpenChange={(open) => {
          // Allow Action/Cancel to dismiss the UI; keep awaitingAction so success still runs.
          if (!open) setRequest(null);
        }}
      >
        <AlertDialogContent className="z-[9999]">
          <AlertDialogHeader>
            <AlertDialogTitle>Track already in playlist</AlertDialogTitle>
            <AlertDialogDescription>
              The track "{request?.trackTitle}" is already in the playlist "
              {request?.playlist.title}
              ". You can add it again as a duplicate, or remove it from the playlist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={handleRemove}
            >
              Remove from Playlist
            </AlertDialogAction>
            <AlertDialogAction onClick={handleAddDuplicate}>Add Duplicate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DuplicatePlaylistDialogContext.Provider>
  );
}
