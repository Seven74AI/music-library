import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpenImgContextProvider } from "openimg/react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  data,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useMatches,
  useRouteLoaderData,
} from "react-router";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { useToast } from "#app/components/toaster.tsx";
import { useServiceWorkerUpdateToast } from "#app/hooks/use-service-worker-update-toast.tsx";
import { initCuratorSync, cleanupCuratorSync } from "#app/features/curator/sync.client.ts";
import { SessionRecoveryPrompt } from "#app/components/session-recovery-prompt.tsx";
import { userIsCuratorOrAdmin } from "#app/utils/user.ts";
import { type Route } from "./+types/root.ts";
import appleTouchIconAssetUrl from "./assets/favicons/apple-touch-icon.png";
import faviconAssetUrl from "./assets/favicons/favicon.svg";
import { InRoomChip } from "./components/party-room/in-room-chip.tsx";
import { AudioPlayerProvider, useAudioPlayer } from "./components/audio-player-provider";
import { roomChromeScrollClearance } from "./components/pwa/install-app-banner.tsx";
import { AutoplayGuideDialog } from "./components/autoplay-guide-dialog";
import { BottomNav } from "./components/bottom-nav.tsx";
import { DesktopNav } from "./components/desktop-nav.tsx";
import { RootErrorBoundary } from "./components/root-error-boundary.tsx";
import { OfflineStatusBanner } from "./components/offline/offline-status-banner.tsx";
import { PullToRefreshProvider } from "./components/pull-to-refresh.tsx";
import { EpicProgress } from "./components/progress-bar.tsx";
import { RouteHydrateFallback } from "./components/route-hydrate-fallback.tsx";
import { href as iconsHref } from "./components/ui/icon.tsx";
import { Icon } from "./components/ui/icon.tsx";
import { DuplicatePlaylistDialogProvider } from "./components/duplicate-playlist-dialog.tsx";
import { Toaster } from "./components/ui/toaster.tsx";
import { maybeRedirectLoggedOutGuestToOpenRoom } from "./features/party-room/guest-return.server.ts";
import { PartyRoomProvider } from "./features/party-room/party-room-provider.tsx";
import { RoomSpeakerBridge } from "./components/party-room/room-speaker-bridge.tsx";
import { offlineClientMiddleware } from "./middleware/offline-client.middleware.client.ts";
import { ThemeSwitch, useOptionalTheme } from "./routes/resources+/theme-switch.tsx";
import tailwindStyleSheetUrl from "./styles/tailwind.css?url";
import { getUserId, logout } from "./utils/auth.server.ts";
import { ClientHintCheck, getHints } from "./utils/client-hints.tsx";
import { prisma } from "./utils/db.server.ts";
import { getEnv } from "./utils/env.server.ts";
import { pipeHeaders } from "./utils/headers.server.ts";
import { honeypot } from "./utils/honeypot.server.ts";
import { combineHeaders, getDomainUrl, getImgSrc } from "./utils/misc.tsx";
import { useNonce } from "./utils/nonce-provider.ts";
import {
  getRecentNotifications,
  getUnreadNotificationCount,
} from "./utils/notifications.server.ts";
import { type Theme, getTheme } from "./utils/theme.server.ts";
import { makeTimings, time } from "./utils/timing.server.ts";
import { getToast } from "./utils/toast.server.ts";
import { useOptionalUser } from "./utils/user.ts";

// Lazy-loaded components — reduces initial bundle by deferring non-critical UI
// UserDropdown: ~87KB (dropdown-menu 66KB + select 21KB from Radix primitives)
const LazyUserDropdown = lazy(() =>
  import("./components/user-dropdown.tsx").then((m) => ({
    default: m.UserDropdown,
  })),
);

const LazyHeaderRoleMenus = lazy(() =>
  import("./components/header-role-menus.tsx").then((m) => ({
    default: m.HeaderRoleMenus,
  })),
);

const LazyNotificationBell = lazy(() =>
  import("./components/notification-bell.tsx").then((m) => ({
    default: m.NotificationBell,
  })),
);

export const links: Route.LinksFunction = () => {
  return [
    // Preload svg sprite as a resource to avoid render blocking
    // Use fetchpriority="high" to ensure it loads early
    { rel: "preload", href: iconsHref, as: "image/svg+xml", fetchPriority: "high" as const },
    {
      rel: "icon",
      href: "/favicon.ico",
      sizes: "48x48",
    },
    { rel: "icon", type: "image/svg+xml", href: faviconAssetUrl },
    { rel: "apple-touch-icon", href: appleTouchIconAssetUrl },
    {
      rel: "manifest",
      href: "/site.webmanifest",
      crossOrigin: "use-credentials",
    } as const, // necessary to make typescript happy
    { rel: "stylesheet", href: tailwindStyleSheetUrl },
  ].filter(Boolean);
};

export const meta: Route.MetaFunction = ({ loaderData }) => {
  return [
    { title: loaderData ? "Music Library" : "Error | Music Library" },
    { name: "description", content: `Your personal music library` },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    { name: "apple-mobile-web-app-title", content: "Music Library" },
  ];
};

export async function loader({ request, url }: Route.LoaderArgs) {
  const timings = makeTimings("root loader");
  const userId = await time(() => getUserId(request), {
    timings,
    type: "getUserId",
    desc: "getUserId in root",
  });

  // Same browser, open guest seat: re-enter the room without a Room Code.
  if (!userId) {
    await maybeRedirectLoggedOutGuestToOpenRoom(request);
  }

  const user = userId
    ? await time(
        () =>
          prisma.user.findUnique({
            select: {
              id: true,
              name: true,
              username: true,
              image: { select: { objectKey: true } },
              roles: {
                select: {
                  name: true,
                  permissions: {
                    select: { entity: true, action: true, access: true },
                  },
                },
              },
            },
            where: { id: userId },
          }),
        { timings, type: "find user", desc: "find user in root" },
      )
    : null;
  if (userId && !user) {
    console.info("something weird happened");
    // something weird happened... The user is authenticated but we can't find
    // them in the database. Maybe they were deleted? Let's log them out.
    await logout({ request, redirectTo: "/" });
  }
  const { toast, headers: toastHeaders } = await getToast(request);
  const honeyProps = await honeypot.getInputProps();
  const notifications = userId ? await getRecentNotifications(userId) : [];
  const unreadNotificationCount = userId ? await getUnreadNotificationCount(userId) : 0;

  return data(
    {
      user,
      notifications,
      unreadNotificationCount,
      requestInfo: {
        hints: getHints(request),
        origin: getDomainUrl(request),
        path: url.pathname,
        userPrefs: {
          theme: getTheme(request),
        },
      },
      ENV: getEnv(),
      toast,
      honeyProps,
    },
    {
      headers: combineHeaders({ "Server-Timing": timings.toString() }, toastHeaders),
    },
  );
}

export function HydrateFallback() {
  return <RouteHydrateFallback />;
}

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [offlineClientMiddleware];

export const headers: Route.HeadersFunction = pipeHeaders;

const EMPTY_ENV: Record<string, string | undefined> = {};

function Document({
  children,
  nonce,
  theme = "light",
  env = EMPTY_ENV,
}: {
  children: React.ReactNode;
  /** Real nonce on SSR; `""` on the client (matches browser nonce hiding). */
  nonce: string;
  theme?: Theme;
  env?: Record<string, string | undefined>;
}) {
  const allowIndexing = ENV.ALLOW_INDEXING !== "false";
  return (
    <html lang="en" className={`${theme} h-full overflow-x-hidden`}>
      <head>
        <ClientHintCheck nonce={nonce} />
        <Meta />
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,interactive-widget=resizes-content"
        />
        {allowIndexing ? null : <meta name="robots" content="noindex, nofollow" />}
        <Links nonce={nonce} />
      </head>
      <body className="bg-background text-foreground">
        {/* Inject SVG sprite into DOM before React hydrates */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
(function() {
	if (document.getElementById('svg-sprite-container')) return;
	var container = document.createElement('div');
	container.id = 'svg-sprite-container';
	container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
	container.setAttribute('aria-hidden', 'true');
	try {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', '${iconsHref}', false);
		xhr.send();
		if (xhr.status === 200 && xhr.responseText) {
			container.innerHTML = xhr.responseText;
			document.body.insertBefore(container, document.body.firstChild);
		} else {
			console.warn('Sprite injection failed: HTTP ' + xhr.status + ' for ' + '${iconsHref}');
		}
	} catch (e) {
		console.error('Sprite injection failed:', e, 'for', '${iconsHref}');
	}
})();
						`.trim(),
          }}
        />
        {children}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(env)}`,
          }}
        />
        <ScrollRestoration nonce={nonce} />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.__reactRouterHdrActive = true`,
          }}
        />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  // if there was an error running the loader, data could be missing
  const loaderData = useLoaderData<typeof loader | null>();
  const nonce = useNonce();
  const theme = useOptionalTheme();
  return (
    <Document nonce={nonce} theme={theme} env={loaderData?.ENV}>
      {children}
    </Document>
  );
}

/**
 * Inner shell that reads audio player state and sets the --bottom-bar-height
 * CSS custom property so all sheets and content can account for the bottom nav
 * and player mini-bar on mobile.
 *
 * Player idle:  64px  (bottom nav only)
 * Player active: ~126px (bottom nav + mini-bar)
 */
function usePartyRoomGuestShell() {
  // Prefer loader `guestShell` from `/rooms/:code` so logged-in hub is not forced into guest chrome
  // when child guest routes also match the URL. (Do not read `UIMatch.data` — not typed on RR matches.)
  // IMPORTANT: call every hook unconditionally — returning before useMatches() broke Rules of Hooks
  // when navigating /rooms → /rooms/:code after Create room (Safari: "t.length" / Chrome: reading 'length').
  const roomRouteData = useRouteLoaderData("routes/rooms.$code") as
    | { guestShell?: boolean }
    | undefined;
  const matches = useMatches();

  if (roomRouteData?.guestShell === true) return true;
  if (roomRouteData?.guestShell === false) return false;

  return matches.some((match) => {
    const handle = match.handle as { partyRoomGuestShell?: boolean } | undefined;
    return handle?.partyRoomGuestShell === true;
  });
}

function ShellLayout() {
  const guestShell = usePartyRoomGuestShell();
  const { isPlayerVisible } = useAudioPlayer();
  const bottomBarHeight = guestShell ? "0px" : isPlayerVisible ? "126px" : "64px";

  useEffect(() => {
    document.body.style.setProperty("--bottom-bar-height", bottomBarHeight);
    return () => {
      document.body.style.removeProperty("--bottom-bar-height");
    };
  }, [bottomBarHeight]);

  const loaderData = useLoaderData<typeof loader>();
  const user = useOptionalUser();

  // Party Room Guest Shell — minified chrome (Room + Search only); no library nav / personal player.
  if (guestShell) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
        <OfflineStatusBanner />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to content
        </a>
        <div className="flex flex-1 flex-col" id="main-content">
          <Outlet />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <OfflineStatusBanner />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>
      <header className="container py-6" role="banner">
        <nav className="flex items-center justify-between gap-3 md:gap-4">
          <Logo />
          <DesktopNav signedIn={Boolean(user)} />
          <div className="ml-auto hidden min-w-0 max-w-sm flex-1 sm:block">
            <Link
              to="/search"
              className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
            >
              <Icon name="magnifying-glass" className="h-4 w-4 shrink-0" />
              <span className="truncate">Search tracks, albums, artists...</span>
            </Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
            {user ? <InRoomChip /> : null}
            {user ? (
              <Suspense fallback={null}>
                <LazyHeaderRoleMenus />
              </Suspense>
            ) : null}
            <ThemeSwitch userPreference={loaderData.requestInfo.userPrefs.theme} />
            {user ? (
              <Suspense fallback={null}>
                <LazyNotificationBell
                  notifications={loaderData.notifications}
                  unreadCount={loaderData.unreadNotificationCount}
                />
              </Suspense>
            ) : null}
            {user ? (
              <Suspense fallback={null}>
                <LazyUserDropdown />
              </Suspense>
            ) : null}
          </div>
        </nav>
      </header>

      <div className={`flex flex-1 flex-col ${roomChromeScrollClearance}`} id="main-content">
        <div className="container">
          <PullToRefreshProvider>
            <Outlet />
          </PullToRefreshProvider>
        </div>
      </div>

      <BottomNav signedIn={Boolean(user)} />

      <footer
        className="container py-8 pb-[calc(var(--bottom-bar-height)+var(--player-error-height,0px)+2rem+env(safe-area-inset-bottom))] md:pb-8 text-center text-sm text-muted-foreground"
        role="contentinfo"
      >
        <p>&copy; {new Date().getFullYear()} Music Library</p>
      </footer>
    </div>
  );
}

function App() {
  const loaderData = useLoaderData<typeof loader>();
  useServiceWorkerUpdateToast();
  useToast(loaderData.toast);

  // Initialize curator sync on mount
  useEffect(() => {
    initCuratorSync();
    return () => {
      cleanupCuratorSync();
    };
  }, []);

  // Lazy-init so a single QueryClient instance (and its cache) survives
  // re-renders/navigations; a plain `new QueryClient()` here would rebuild
  // an empty cache on every render, defeating staleTime/gcTime.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 10, // 10 minutes
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OpenImgContextProvider optimizerEndpoint="/resources/images" getSrc={getImgSrc}>
        <AudioPlayerProvider userId={loaderData.user?.id ?? null}>
          <PartyRoomProvider enabled>
            <RoomSpeakerBridge />
            <DuplicatePlaylistDialogProvider>
              <ShellLayout />
              {userIsCuratorOrAdmin(loaderData.user) ? <SessionRecoveryPrompt /> : null}
              <Toaster />
              <AutoplayGuideDialog />
              <EpicProgress />
            </DuplicatePlaylistDialogProvider>
          </PartyRoomProvider>
        </AudioPlayerProvider>
      </OpenImgContextProvider>
    </QueryClientProvider>
  );
}

function Logo() {
  return (
    <Link to="/" className="group grid leading-snug">
      <span className="font-light transition group-hover:-translate-x-1">7D</span>
      <span className="font-bold transition group-hover:translate-x-1">Music</span>
    </Link>
  );
}

function AppWithProviders() {
  const loaderData = useLoaderData<typeof loader>();
  return (
    <HoneypotProvider {...loaderData.honeyProps}>
      <App />
    </HoneypotProvider>
  );
}

export default AppWithProviders;

// this is a last resort error boundary. There's not much useful information we
// can offer at this level.
export const ErrorBoundary = RootErrorBoundary;
