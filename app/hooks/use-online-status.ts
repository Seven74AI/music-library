import { useEffect, useState } from "react";

export function useOnlineStatus() {
  // Always initialise to `true` so the server render and the first client render
  // agree (avoids a hydration mismatch when a user cold-loads while offline).
  // The effect below syncs to the real value immediately after mount.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
