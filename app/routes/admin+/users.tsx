import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Form, Link, useSearchParams } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#app/components/ui/table.tsx";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/users.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const PAGE_SIZE = 25;

/** Falls back to page 1 for missing, non-numeric, fractional or out-of-range input. */
export function parsePageParam(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");

  const q = (url.searchParams.get("q") ?? "").trim();
  const page = parsePageParam(url.searchParams.get("page"));
  const where = q
    ? {
        OR: [{ username: { contains: q } }, { email: { contains: q } }, { name: { contains: q } }],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        createdAt: true,
        disabledAt: true,
        roles: { select: { name: true } },
        sessions: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { updatedAt: true, createdAt: true },
        },
        _count: {
          select: {
            userTracks: { where: { isActive: true } },
            connections: true,
          },
        },
        connections: {
          where: { providerName: "youtube" },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  return {
    q,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      disabledAt: user.disabledAt?.toISOString() ?? null,
      roles: user.roles.map((role) => role.name),
      lastSessionAt:
        user.sessions[0]?.updatedAt.toISOString() ??
        user.sessions[0]?.createdAt.toISOString() ??
        null,
      trackCount: user._count.userTracks,
      youtubeConnected: user.connections.length > 0,
    })),
  };
}

export default function AdminUsersRoute({ loaderData }: Route.ComponentProps) {
  const { users, q, page, totalPages, total } = loaderData;
  const [searchParams] = useSearchParams();

  return (
    <div className="container py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1">Users</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <Link to="/admin" className="underline">
              Overview
            </Link>{" "}
            · {total} total
          </p>
        </div>
      </div>

      <Spacer size="sm" />

      <Form method="get" className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search username, email, name…"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full max-w-md rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </Form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Library</TableHead>
              <TableHead>Last session</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground p-4 text-center">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link to={`/admin/users/${user.id}`} className="font-medium underline">
                      {user.username}
                    </Link>
                    <div className="text-muted-foreground text-xs">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.trackCount} tracks
                    {user.youtubeConnected ? (
                      <div className="text-muted-foreground text-xs">YouTube connected</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {user.lastSessionAt ? new Date(user.lastSessionAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {user.disabledAt ? (
                      <Badge variant="destructive">Disabled</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link
                to={`/admin/users?${new URLSearchParams({
                  ...Object.fromEntries(searchParams),
                  page: String(page - 1),
                }).toString()}`}
              >
                Previous
              </Link>
            </Button>
          ) : null}
          <span className="text-muted-foreground text-sm">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link
                to={`/admin/users?${new URLSearchParams({
                  ...Object.fromEntries(searchParams),
                  page: String(page + 1),
                }).toString()}`}
              >
                Next
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
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
      }}
    />
  );
}
