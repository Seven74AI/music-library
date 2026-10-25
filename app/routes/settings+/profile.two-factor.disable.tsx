import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { redirect, useFetcher } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";
import { StatusButton } from "#app/components/ui/status-button.tsx";
import { requireRecentVerification } from "#app/routes/_auth+/verify.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { useDoubleCheck } from "#app/utils/misc.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { type Route } from "./+types/profile.two-factor.disable.ts";
import { type BreadcrumbHandle } from "./profile.tsx";
import { twoFAVerificationType } from "./profile.two-factor.tsx";

const twoFAIndexPath = "/settings/profile/two-factor";

export const handle: BreadcrumbHandle & SEOHandle = {
  breadcrumb: <Icon name="lock-open-1">Disable</Icon>,
  getSitemapEntries: () => null,
};

async function findEnabledTwoFA(userId: string) {
  return prisma.verification.findUnique({
    where: { target_type: { target: userId, type: twoFAVerificationType } },
    select: { id: true },
  });
}

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireRecentVerification(request, url);
  const userId = await requireUserId(request);
  const verification = await findEnabledTwoFA(userId);
  if (!verification) {
    return redirect(twoFAIndexPath);
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  await requireRecentVerification(request);
  const userId = await requireUserId(request);
  // delete() throws P2025 when 2FA was never enabled, and the error boundary
  // renders that Prisma message. deleteMany removes the row when it exists
  // and leaves the page with a redirect when it does not.
  const deleted = await prisma.verification.deleteMany({
    where: { target: userId, type: twoFAVerificationType },
  });
  if (deleted.count === 0) {
    return redirect(twoFAIndexPath);
  }
  return redirectWithToast(twoFAIndexPath, {
    title: "2FA Disabled",
    description: "Two factor authentication has been disabled.",
    type: "message",
  });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export default function TwoFactorDisableRoute() {
  const disable2FAFetcher = useFetcher<typeof action>();
  const dc = useDoubleCheck();

  return (
    <div className="mx-auto max-w-sm">
      <disable2FAFetcher.Form method="POST">
        <p>
          Disabling two factor authentication is not recommended. However, if you would like to do
          so, click here:
        </p>
        <StatusButton
          variant="destructive"
          status={disable2FAFetcher.state === "loading" ? "pending" : "idle"}
          {...dc.getButtonProps({
            className: "mx-auto",
            name: "intent",
            value: "disable",
            type: "submit",
          })}
        >
          {dc.doubleCheck ? "Are you sure?" : "Disable 2FA"}
        </StatusButton>
      </disable2FAFetcher.Form>
    </div>
  );
}
