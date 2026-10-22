// TEST FILE — see db-backup.test.tsx for unit tests
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, useActionData, useNavigation } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Alert, AlertDescription } from "#app/components/ui/alert.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { runBackup } from "#app/features/db-backup/backup.server.ts";
import { getBackupState } from "#app/features/db-backup/backup-state.server.ts";
import { isBackupBucketConfigured } from "#app/features/db-backup/backup-storage.server.ts";
import { getBackupHourUtc } from "#app/features/db-backup/scheduler.server.ts";
import { ensurePrimary } from "#app/utils/litefs.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/db-backup.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

interface LoaderData {
  configured: boolean;
  backupHourUtc: number;
  state: {
    lastStatus: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastObjectKey: string | null;
  };
}

export async function loader({ request }: Route.LoaderArgs): Promise<LoaderData> {
  await requireUserWithRole(request, "admin");
  const state = await getBackupState();
  return {
    configured: isBackupBucketConfigured(),
    backupHourUtc: getBackupHourUtc(),
    state: {
      lastStatus: state.lastStatus,
      lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
      lastError: state.lastError,
      lastObjectKey: state.lastObjectKey,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireUserWithRole(request, "admin");
  await ensurePrimary();

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "backup-now") {
    return data({ ok: false as const, error: "Unknown intent" }, { status: 400 });
  }

  if (!isBackupBucketConfigured()) {
    return data(
      { ok: false as const, error: "BACKUP_BUCKET_NAME is not configured" },
      { status: 400 },
    );
  }

  const result = await runBackup({
    skipPrimaryCheck: true,
    attemptCount: 1,
    notifyOnFailure: true,
  });

  if (!result.ok) {
    return data({ ok: false as const, error: result.error }, { status: 500 });
  }

  return data({
    ok: true as const,
    dailyKey: result.dailyKey,
    weeklyKey: result.weeklyKey,
  });
}

export default function DbBackupAdminRoute({ loaderData }: Route.ComponentProps) {
  const { configured, backupHourUtc, state } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isBackingUp =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "backup-now";

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-h1">Database Backups</h1>
      <p className="text-body-md text-muted-foreground mt-2">
        Off-volume SQLite snapshots via <code>litefs export</code> to a dedicated Tigris backup
        bucket. Restore is ops-only (see production database docs).
      </p>
      <Spacer size="md" />

      {!configured && (
        <Alert className="mb-6">
          <AlertDescription>
            Backups are disabled until <code>BACKUP_BUCKET_NAME</code> is set on the app.
          </AlertDescription>
        </Alert>
      )}

      {actionData?.ok === true && (
        <Alert className="mb-6">
          <AlertDescription>
            Backup uploaded: <code>{actionData.dailyKey}</code> (weekly:{" "}
            <code>{actionData.weeklyKey}</code>)
          </AlertDescription>
        </Alert>
      )}
      {actionData?.ok === false && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{actionData.error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Scheduled around {String(backupHourUtc).padStart(2, "0")}:00 UTC on the LiteFS primary.
            Retention: 7 dailies + 4 weeklies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-muted-foreground">Last status</span>
            <Badge variant={state.lastStatus === "success" ? "default" : "secondary"}>
              {state.lastStatus ?? "never"}
            </Badge>
          </div>
          <p className="text-body-sm">
            <span className="text-muted-foreground">Last success: </span>
            {state.lastSuccessAt ?? "—"}
          </p>
          <p className="text-body-sm">
            <span className="text-muted-foreground">Last attempt: </span>
            {state.lastAttemptAt ?? "—"}
          </p>
          <p className="text-body-sm break-all">
            <span className="text-muted-foreground">Last object key: </span>
            {state.lastObjectKey ?? "—"}
          </p>
          {state.lastError && (
            <p className="text-body-sm text-destructive break-all">
              <span className="font-medium">Last error: </span>
              {state.lastError}
            </p>
          )}

          <Form method="POST" className="pt-2">
            <input type="hidden" name="intent" value="backup-now" />
            <Button type="submit" disabled={!configured || isBackingUp}>
              {isBackingUp ? "Backing up…" : "Backup now"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}

export function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}
