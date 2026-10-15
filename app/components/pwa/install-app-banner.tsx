import { useLayoutEffect, useRef } from "react";
import { usePwaInstall } from "#app/hooks/use-pwa-install.ts";
import { cn } from "#app/utils/misc.tsx";
import { InstallAppPrompt } from "./install-app-prompt.tsx";

type InstallAppBannerProps = {
  playerVisible: boolean;
};

// Mobile nav is fixed at z-51 / h-16. The mini player is z-50 and starts at bottom-16.
// z-51 paints with the nav and after it, so the action row receives the tap, while
// search (z-52) and dialogs stay above the banner.
// Idle clearance is the nav (or 0 in the guest shell). md:bottom-0 drops it to the
// viewport edge where that nav is hidden. With the player open, --toast-bottom-offset
// is the measured chrome height so the banner sits above the mini player and the
// desktop controls instead of covering them.
// --install-banner-height is this banner's own height (0 once dismissed) so the shell
// can scroll room controls clear of the banner, the player, and the nav.
const idleClearance =
  "bottom-[calc(var(--bottom-bar-height,4rem)+env(safe-area-inset-bottom))] md:bottom-0";
const playerClearance =
  "bottom-[var(--toast-bottom-offset,calc(var(--bottom-bar-height,126px)+var(--player-error-height,0px)+env(safe-area-inset-bottom)))]";

export const roomChromeScrollClearance =
  "pb-[calc(var(--bottom-bar-height)+var(--player-error-height,0px)+var(--install-banner-height,0px)+env(safe-area-inset-bottom))] md:pb-[calc(var(--toast-bottom-offset,0px)+var(--install-banner-height,0px))]";

const INSTALL_BANNER_HEIGHT_VAR = "--install-banner-height";

export function InstallAppBanner({ playerVisible }: InstallAppBannerProps) {
  const { visible, dismiss, install, isIos, canInstallNatively } = usePwaInstall();
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = bannerRef.current;
    if (!visible || !node) {
      document.body.style.removeProperty(INSTALL_BANNER_HEIGHT_VAR);
      return;
    }

    const apply = () => {
      document.body.style.setProperty(INSTALL_BANNER_HEIGHT_VAR, `${node.offsetHeight}px`);
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      document.body.style.removeProperty(INSTALL_BANNER_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={bannerRef}
      data-testid="install-app-banner"
      className={cn("fixed left-0 right-0 z-51", playerVisible ? playerClearance : idleClearance)}
    >
      <InstallAppPrompt
        layout="banner"
        isIos={isIos}
        canInstallNatively={canInstallNatively}
        onInstall={() => void install()}
        onDismiss={dismiss}
      />
    </div>
  );
}
