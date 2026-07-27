import { useEffect, useState } from "react";

const AUTOPLAY_FAILURES_KEY = "autoplay-failures";
const AUTOPLAY_GUIDE_DISMISSED_KEY = "autoplay-guide-dismissed";

function getStoredFailures(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(AUTOPLAY_FAILURES_KEY)) || 0;
  } catch {
    return 0;
  }
}

function isGuideDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(AUTOPLAY_GUIDE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist dismissal so the guide never shows again. */
export function dismissAutoplayGuide() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTOPLAY_GUIDE_DISMISSED_KEY, "1");
  } catch {
    // storage unavailable — ignore
  }
}

/** Call every time autoplay is blocked by the browser. */
export function recordAutoplayFailure() {
  if (typeof window === "undefined") return;
  try {
    const current = getStoredFailures();
    localStorage.setItem(AUTOPLAY_FAILURES_KEY, String(current + 1));
  } catch {
    // storage unavailable — ignore
  }
}

type AutoplayPolicy = "allowed" | "allowed-muted" | "disallowed" | null;

function detectPolicy(): AutoplayPolicy {
  if (typeof navigator === "undefined") return null;

  // Chrome 100+ / Edge 100+ — the Autoplay Policy Detection API
  if ("getAutoplayPolicy" in navigator) {
    try {
      const policy = (
        navigator as Navigator & {
          getAutoplayPolicy: (type: string) => "allowed" | "allowed-muted" | "disallowed";
        }
      ).getAutoplayPolicy("mediaelement");
      return policy;
    } catch {
      // API exists but threw — browser may not fully support it yet
      return null;
    }
  }

  // Safari / Firefox don't expose a policy API, so we rely on the
  // failure counter (incremented each time play() is rejected).
  return null;
}

export function useAutoplayGuide() {
  const [showGuide, setShowGuide] = useState(false);
  const [policy, setPolicy] = useState<AutoplayPolicy>(null);

  useEffect(() => {
    const detected = detectPolicy();
    setPolicy(detected);

    if (isGuideDismissed()) return;

    const failures = getStoredFailures();

    // Show when the browser explicitly says autoplay is disallowed,
    // or after 2+ blocked play() attempts.
    if (detected === "disallowed" || failures >= 2) {
      setShowGuide(true);
    }
  }, []);

  return {
    showGuide,
    /** Dismiss permanently — sets localStorage flag. */
    dismissGuide: () => {
      dismissAutoplayGuide();
      setShowGuide(false);
    },
    policy,
  };
}
