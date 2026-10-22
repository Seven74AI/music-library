import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, Link } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#app/components/ui/table.tsx";
import { SECURITY_EVENT_TYPES, securityEventLabel } from "#app/features/security/event-types.ts";
import {
  forceLogoutSession,
  forceLogoutUserSessions,
  listActiveSessions,
} from "#app/features/security/session-management.server.ts";
import {
  getAccountChanges,
  getFailedLoginReport,
  getSecurityAlerts,
  getSecurityTimeline,
  getSuccessfulLogins,
} from "#app/features/security/suspicious-activity.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { type Route } from "./+types/security-events.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export const SECURITY_TABS = [
  { id: "failed", label: "Failed logins" },
  { id: "success", label: "Successful logins" },
  { id: "accounts", label: "Account changes" },
  { id: "sessions", label: "Active sessions" },
  { id: "timeline", label: "Timeline" },
] as const;

type SecurityTab = (typeof SECURITY_TABS)[number]["id"];

function parseTab(value: string | null): SecurityTab {
  return SECURITY_TABS.some((tab) => tab.id === value) ? (value as SecurityTab) : "failed";
}

function formatWhen(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");
  const url = new URL(request.url);
  const tab = parseTab(url.searchParams.get("tab"));
  const filters = {
    eventType: url.searchParams.get("eventType") ?? "",
    username: url.searchParams.get("username") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };

  const alerts = await getSecurityAlerts();

  return {
    tab,
    filters,
    alerts,
    failed: tab === "failed" ? await getFailedLoginReport() : null,
    successes: tab === "success" ? await getSuccessfulLogins() : null,
    accountChanges: tab === "accounts" ? await getAccountChanges() : null,
    sessions: tab === "sessions" ? await listActiveSessions() : null,
    timeline:
      tab === "timeline"
        ? await getSecurityTimeline({
            eventType: filters.eventType,
            username: filters.username,
            from: filters.from,
            to: filters.to,
          })
        : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const actorId = await requireUserWithRole(request, "admin");
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "logout-session") {
    const sessionId = String(formData.get("sessionId") ?? "");
    if (!sessionId) return data({ error: "Session id required" }, { status: 400 });
    const result = await forceLogoutSession({ sessionId, actorUserId: actorId, request });
    if (!result.ok) return data({ error: result.error }, { status: 404 });
    return redirectWithToast("/admin/security-events?tab=sessions", {
      type: "success",
      title: "Session ended",
      description: "That session was logged out.",
    });
  }

  if (intent === "logout-user") {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return data({ error: "User id required" }, { status: 400 });
    const result = await forceLogoutUserSessions({ userId, actorUserId: actorId, request });
    if (!result.ok) return data({ error: result.error }, { status: 404 });
    return redirectWithToast("/admin/security-events?tab=sessions", {
      type: "success",
      title: "Sessions ended",
      description: `Logged out ${result.count} session${result.count === 1 ? "" : "s"}.`,
    });
  }

  return data({ error: `Unknown intent: ${intent}` }, { status: 400 });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

function Alerts({ alerts }: { alerts: Awaited<ReturnType<typeof loader>>["alerts"] }) {
  if (alerts.length === 0) {
    return <p className="text-muted-foreground text-sm">No active security alerts.</p>;
  }
  return (
    <ul className="space-y-2">
      {alerts.map((alert) => (
        <li
          key={`${alert.kind}:${alert.ipHash ?? ""}:${alert.userId ?? alert.username ?? ""}`}
          className={
            alert.severity === "critical"
              ? "border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm"
              : "rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm"
          }
        >
          {alert.message}
        </li>
      ))}
    </ul>
  );
}

export default function SecurityEventsRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { tab, filters, alerts, failed, successes, accountChanges, sessions, timeline } =
    loaderData;

  return (
    <div className="container py-8">
      <p className="text-muted-foreground mb-2 text-sm">
        <Link to="/admin" className="underline">
          ← Admin overview
        </Link>
      </p>
      <h1 className="text-h1">Security events</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Login activity, account changes, and sessions. Alerts do not block anyone automatically.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {actionData.error}
        </p>
      ) : null}

      <Spacer size="sm" />
      <Alerts alerts={alerts} />
      <Spacer size="sm" />

      <nav aria-label="Security event views" className="flex flex-wrap gap-2">
        {SECURITY_TABS.map((item) => (
          <Link
            key={item.id}
            to={
              item.id === "failed"
                ? "/admin/security-events"
                : `/admin/security-events?tab=${item.id}`
            }
            aria-current={tab === item.id ? "page" : undefined}
            className={
              tab === item.id
                ? "bg-foreground text-background rounded-md px-3 py-1.5 text-sm"
                : "bg-muted text-foreground rounded-md px-3 py-1.5 text-sm"
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Spacer size="sm" />

      {tab === "failed" && failed ? <FailedLogins report={failed} /> : null}
      {tab === "success" && successes ? <SuccessfulLogins rows={successes} /> : null}
      {tab === "accounts" && accountChanges ? <AccountChanges rows={accountChanges} /> : null}
      {tab === "sessions" && sessions ? <ActiveSessions rows={sessions} /> : null}
      {tab === "timeline" && timeline ? <Timeline filters={filters} timeline={timeline} /> : null}
    </div>
  );
}

function FailedLogins({
  report,
}: {
  report: NonNullable<Awaited<ReturnType<typeof loader>>["failed"]>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most targeted accounts</CardTitle>
            <CardDescription>Failed logins in the last 24 hours</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {report.mostTargeted.length === 0 ? (
              <p className="text-muted-foreground">None</p>
            ) : (
              <ul>
                {report.mostTargeted.map((row) => (
                  <li key={row.username}>
                    {row.username}: {row.count}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most active IP hashes</CardTitle>
            <CardDescription>Grouped by hashed address, not the raw IP</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {report.mostActiveIps.length === 0 ? (
              <p className="text-muted-foreground">None</p>
            ) : (
              <ul>
                {report.mostActiveIps.map((row) => (
                  <li key={row.ipHash}>
                    <span className="font-mono">{row.ipHash}</span>: {row.count}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead>IP hash</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Last attempt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>No failed logins in the last 24 hours.</TableCell>
            </TableRow>
          ) : (
            report.groups.map((group) => (
              <TableRow key={`${group.username}:${group.ipHash ?? "none"}`}>
                <TableCell>{group.username}</TableCell>
                <TableCell className="font-mono">{group.ipHash ?? "—"}</TableCell>
                <TableCell>{group.count}</TableCell>
                <TableCell>{formatWhen(group.lastAttempt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SuccessfulLogins({
  rows,
}: {
  rows: NonNullable<Awaited<ReturnType<typeof loader>>["successes"]>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>User</TableHead>
          <TableHead>IP hash</TableHead>
          <TableHead>Device</TableHead>
          <TableHead>Flag</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>No successful logins in the last 7 days.</TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatWhen(row.createdAt)}</TableCell>
              <TableCell>{row.username ?? "—"}</TableCell>
              <TableCell className="font-mono">{row.ipHash ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate">{row.device ?? "—"}</TableCell>
              <TableCell>
                {row.afterFailures ? `After ${row.failureCount} failures` : "—"}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function AccountChanges({
  rows,
}: {
  rows: NonNullable<Awaited<ReturnType<typeof loader>>["accountChanges"]>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Performed by</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>No account changes recorded.</TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatWhen(row.createdAt)}</TableCell>
              <TableCell>{securityEventLabel(row.eventType)}</TableCell>
              <TableCell>{row.actorUsername ?? "system"}</TableCell>
              <TableCell>{row.targetUsername ?? "—"}</TableCell>
              <TableCell>{row.summary}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ActiveSessions({
  rows,
}: {
  rows: NonNullable<Awaited<ReturnType<typeof loader>>["sessions"]>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>IP hash</TableHead>
          <TableHead>Device</TableHead>
          <TableHead>Last activity</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>No active sessions.</TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.username}</TableCell>
              <TableCell className="font-mono">{row.ipHash ?? "—"}</TableCell>
              <TableCell className="max-w-xs truncate">{row.device ?? "—"}</TableCell>
              <TableCell>{formatWhen(row.updatedAt)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Form method="POST">
                    <input type="hidden" name="intent" value="logout-session" />
                    <input type="hidden" name="sessionId" value={row.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Force logout
                    </Button>
                  </Form>
                  <Form method="POST">
                    <input type="hidden" name="intent" value="logout-user" />
                    <input type="hidden" name="userId" value={row.userId} />
                    <Button type="submit" variant="outline" size="sm">
                      Log out all
                    </Button>
                  </Form>
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function Timeline({
  filters,
  timeline,
}: {
  filters: { eventType: string; username: string; from: string; to: string };
  timeline: NonNullable<Awaited<ReturnType<typeof loader>>["timeline"]>;
}) {
  return (
    <div className="space-y-4">
      <Form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="timeline" />
        <label className="flex flex-col gap-1 text-sm">
          Event type
          <select
            name="eventType"
            defaultValue={filters.eventType}
            className="border-input bg-background rounded-md border px-2 py-1"
          >
            <option value="">All</option>
            {Object.values(SECURITY_EVENT_TYPES).map((eventType) => (
              <option key={eventType} value={eventType}>
                {securityEventLabel(eventType)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input
            name="username"
            defaultValue={filters.username}
            className="border-input bg-background rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="border-input bg-background rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="border-input bg-background rounded-md border px-2 py-1"
          />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </Form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>IP hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {timeline.events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>No events match these filters.</TableCell>
            </TableRow>
          ) : (
            timeline.events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatWhen(event.createdAt)}</TableCell>
                <TableCell>{securityEventLabel(event.eventType)}</TableCell>
                <TableCell>{event.username ?? "—"}</TableCell>
                <TableCell>{event.targetUsername ?? "—"}</TableCell>
                <TableCell className="font-mono">{event.ipHash ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Admin403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: Admin403 }} />;
}
