import { invariantResponse } from "@epic-web/invariant";
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, Link } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
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
import {
  deleteUserAsAdmin,
  demoteFromAdmin,
  disableUser,
  enableUser,
  promoteToAdmin,
  type ModerationResult,
} from "#app/features/usage-analytics/admin-users.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { useDoubleCheck } from "#app/utils/misc.tsx";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { type Route } from "./+types/users_.$userId.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const actorId = await requireUserWithRole(request, "admin");
  const userId = params.userId;
  invariantResponse(userId, "User id required", { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      disabledAt: true,
      roles: { select: { name: true } },
      sessions: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, createdAt: true, updatedAt: true, expirationDate: true },
      },
      _count: {
        select: {
          userTracks: { where: { isActive: true } },
          playlists: true,
          connections: true,
          servicePlaylists: true,
        },
      },
      connections: {
        select: { providerName: true, createdAt: true },
      },
      usageEvents: {
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          type: true,
          trackId: true,
          meta: true,
          createdAt: true,
        },
      },
    },
  });
  invariantResponse(user, "User not found", { status: 404 });

  return {
    actorId,
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      disabledAt: user.disabledAt?.toISOString() ?? null,
      roles: user.roles.map((role) => role.name),
      sessions: user.sessions.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        expirationDate: session.expirationDate.toISOString(),
      })),
      connections: user.connections.map((connection) => ({
        providerName: connection.providerName,
        createdAt: connection.createdAt.toISOString(),
      })),
      usageEvents: user.usageEvents.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const actorId = await requireUserWithRole(request, "admin");
  const userId = params.userId;
  invariantResponse(userId, "User id required", { status: 400 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  const failed = (result: Extract<ModerationResult, { ok: false }>) =>
    data({ error: result.error }, { status: result.reason === "not-found" ? 404 : 400 });

  switch (intent) {
    case "disable": {
      if (userId === actorId) {
        return data({ error: "You cannot disable your own account" }, { status: 400 });
      }
      const result = await disableUser(userId);
      if (!result.ok) return failed(result);
      return redirectWithToast(`/admin/users/${userId}`, {
        type: "success",
        title: "User disabled",
        description: "Sessions revoked; login blocked.",
      });
    }
    case "enable": {
      const result = await enableUser(userId);
      if (!result.ok) return failed(result);
      return redirectWithToast(`/admin/users/${userId}`, {
        type: "success",
        title: "User enabled",
        description: "Account can sign in again.",
      });
    }
    case "promote": {
      const result = await promoteToAdmin(userId);
      if (!result.ok) return failed(result);
      return redirectWithToast(`/admin/users/${userId}`, {
        type: "success",
        title: "Promoted to admin",
        description: "Admin role connected.",
      });
    }
    case "demote": {
      const result = await demoteFromAdmin({
        targetUserId: userId,
        actorUserId: actorId,
      });
      if (!result.ok) return failed(result);
      return redirectWithToast(`/admin/users/${userId}`, {
        type: "success",
        title: "Demoted from admin",
        description: "Admin role removed.",
      });
    }
    case "delete": {
      const confirmUsername = String(formData.get("confirmUsername") ?? "");
      const target = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      invariantResponse(target, "User not found", { status: 404 });
      if (confirmUsername !== target.username) {
        return data({ error: "Type the username exactly to confirm deletion" }, { status: 400 });
      }
      const result = await deleteUserAsAdmin({
        targetUserId: userId,
        actorUserId: actorId,
      });
      if (!result.ok) return failed(result);
      return redirectWithToast("/admin/users", {
        type: "success",
        title: "User deleted",
        description: `${target.username} and related data were removed.`,
      });
    }
    default:
      return data({ error: `Unknown intent: ${String(intent)}` }, { status: 400 });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/**
 * A bulk library add writes one event but bumps the daily counter by the number
 * of tracks, so the feed shows that count instead of the raw `{"count":N}` JSON.
 */
export function describeEventMeta(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const parsed: unknown = JSON.parse(meta);
    if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
      const { count } = parsed as { count: unknown };
      if (typeof count === "number" && Number.isFinite(count)) {
        return `+${count} track${count === 1 ? "" : "s"}`;
      }
    }
  } catch {
    // Not JSON we recognise — fall through and show it verbatim.
  }
  return meta;
}

export default function AdminUserDetailRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { user, actorId } = loaderData;
  const isSelf = user.id === actorId;
  const isAdmin = user.roles.includes("admin");
  const isDisabled = Boolean(user.disabledAt);
  const deleteCheck = useDoubleCheck();

  return (
    <div className="container py-8">
      <p className="text-muted-foreground mb-2 text-sm">
        <Link to="/admin/users" className="underline">
          ← Users
        </Link>
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{user.username}</h1>
          <p className="text-muted-foreground text-sm">
            {user.email}
            {user.name ? ` · ${user.name}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {user.roles.map((role) => (
              <Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
                {role}
              </Badge>
            ))}
            {isDisabled ? <Badge variant="destructive">Disabled</Badge> : null}
          </div>
        </div>
      </div>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {actionData.error}
        </p>
      ) : null}

      <Spacer size="sm" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Library</CardTitle>
            <CardDescription>Owned content counts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>{user._count.userTracks} active tracks</div>
            <div>{user._count.playlists} playlists</div>
            <div>{user._count.servicePlaylists} synced playlists</div>
            <div>{user._count.connections} service connections</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Timestamps</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Joined {new Date(user.createdAt).toLocaleString()}</div>
            <div>Updated {new Date(user.updatedAt).toLocaleString()}</div>
            {user.disabledAt ? (
              <div>Disabled {new Date(user.disabledAt).toLocaleString()}</div>
            ) : null}
            <div>
              Connections:{" "}
              {user.connections.length === 0
                ? "none"
                : user.connections.map((c) => c.providerName).join(", ")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Moderation</CardTitle>
            <CardDescription>Admin actions</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!isDisabled ? (
              <Form method="post">
                <input type="hidden" name="intent" value="disable" />
                <Button type="submit" variant="outline" disabled={isSelf} className="w-full">
                  Disable account
                </Button>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="enable" />
                <Button type="submit" variant="secondary" className="w-full">
                  Enable account
                </Button>
              </Form>
            )}
            {!isAdmin ? (
              <Form method="post">
                <input type="hidden" name="intent" value="promote" />
                <Button type="submit" variant="secondary" className="w-full">
                  Promote to admin
                </Button>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="demote" />
                <Button type="submit" variant="outline" disabled={isSelf} className="w-full">
                  Demote from admin
                </Button>
              </Form>
            )}
            <Form method="post" className="space-y-2 border-t pt-2">
              <input type="hidden" name="intent" value="delete" />
              <label className="text-muted-foreground block text-xs">
                Type <strong>{user.username}</strong> to confirm delete
                <input
                  name="confirmUsername"
                  className="border-input bg-background mt-1 flex h-9 w-full rounded-md border px-2 text-sm"
                  disabled={isSelf}
                  autoComplete="off"
                />
              </label>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSelf}
                className="w-full"
                {...deleteCheck.getButtonProps({ type: "submit" })}
              >
                {deleteCheck.doubleCheck ? "Confirm delete" : "Delete user"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>

      <Spacer size="sm" />

      <h2 className="text-h3 mb-2">Recent sessions</h2>
      <div className="mb-6 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {user.sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground p-4 text-center">
                  No sessions
                </TableCell>
              </TableRow>
            ) : (
              user.sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>{new Date(session.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{new Date(session.updatedAt).toLocaleString()}</TableCell>
                  <TableCell>{new Date(session.expirationDate).toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <h2 className="text-h3 mb-2">Recent usage events</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Track</TableHead>
              <TableHead>Meta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {user.usageEvents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground p-4 text-center">
                  No events yet
                </TableCell>
              </TableRow>
            ) : (
              user.usageEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-sm">
                    {new Date(event.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{event.type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.trackId ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs">
                    {describeEventMeta(event.meta) ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <GeneralErrorBoundary
      statusHandlers={{
        403: () => (
          <div className="flex flex-col items-center gap-2 py-12">
            <Icon name="avatar" className="text-body-2xl" />
            <h1 className="text-h1">403</h1>
            <p>You must be an admin to view this page.</p>
          </div>
        ),
        404: ({ error }) => (
          <div className="flex flex-col items-center gap-2 py-12">
            <h1 className="text-h1">404</h1>
            <p>{error?.data ?? "User not found"}</p>
            <Link to="/admin/users" className="underline">
              Back to users
            </Link>
          </div>
        ),
      }}
    />
  );
}
