import { useLoaderData } from "react-router";
import { ListeningHome } from "#app/components/home/listening-home.tsx";
import { MarketingHome } from "#app/components/home/marketing-home.tsx";
import { OnboardingHome } from "#app/components/home/onboarding-home.tsx";
import { OfflineHome } from "#app/components/offline/offline-home.tsx";
import { RouteHydrateFallback } from "#app/components/route-hydrate-fallback.tsx";
import { defineOfflineClientLoader } from "#app/features/offline-app/define-offline-client-loader.ts";
import { type ServerLoaderData } from "#app/features/offline-app/offline-loader.client.ts";
import { type HomeOfflineLoaderData } from "#app/features/offline-app/offline-route-policies.client.ts";
import { loadHomeData } from "#app/utils/home.server.ts";
import { type Route } from "./+types/index.ts";

export const meta: Route.MetaFunction = () => [{ title: "Music Library" }];

export async function loader({ request }: Route.LoaderArgs) {
  return loadHomeData(request);
}

export const clientLoader = defineOfflineClientLoader<
  ServerLoaderData<typeof loader>,
  HomeOfflineLoaderData
>("routes/_marketing+/index");

export function HydrateFallback() {
  return <RouteHydrateFallback />;
}

export default function Index() {
  const data = useLoaderData<typeof loader | { mode: "offline" }>();

  if ("mode" in data && data.mode === "offline") {
    return <OfflineHome />;
  }

  switch (data.mode) {
    case "marketing":
      return <MarketingHome />;
    case "onboarding":
      return <OnboardingHome youtubeConnected={data.youtubeConnected} isAdmin={data.isAdmin} />;
    case "gray":
      return <ListeningHome {...data} showArchivingBanner />;
    case "listening":
      return <ListeningHome {...data} showArchivingBanner={false} />;
  }
}
