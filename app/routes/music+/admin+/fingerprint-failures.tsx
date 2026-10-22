import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, Link, useSearchParams } from "react-router";
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
  type FingerprintFailuresLoaderData,
  type FingerprintFailureRow,
} from "#app/routes/api+/admin+/fingerprint-failures.tsx";
import { fetchInternal } from "#app/utils/internal-fetch.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/fingerprint-failures.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const SIZE_OPTIONS = [
  { value: "all", label: "All sizes" },
  { value: "small", label: "< 1 MB" },
  { value: "medium", label: "1–10 MB" },
  { value: "large", label: "≥ 10 MB" },
] as const;

export async function loader({
  request,
  url,
}: Route.LoaderArgs): Promise<FingerprintFailuresLoaderData> {
  await requireUserWithRole(request, "admin");

  // Fetch data from the internal API endpoint on a trusted origin, forwarding
  // only the session cookie (never the full incoming headers).
  const response = await fetchInternal(request, "/api/admin/fingerprint-failures", url.search);

  if (!response.ok) {
    throw data({ error: "Failed to load fingerprint failures" }, { status: response.status });
  }

  return (await response.json()) as FingerprintFailuresLoaderData;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return bytes === 0 ? "0 B" : "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function FilterBar({
  availableFormats,
  availableServices,
}: {
  availableFormats: string[];
  availableServices: Array<{ name: string; displayName: string }>;
}) {
  const [searchParams] = useSearchParams();
  const activeFormat = searchParams.get("format") ?? "all";
  const activeService = searchParams.get("service") ?? "all";
  const activeSize = searchParams.get("size") ?? "all";

  return (
    <Form method="get" className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="format" className="text-muted-foreground text-xs font-medium">
          Format
        </label>
        <select
          id="format"
          name="format"
          defaultValue={activeFormat}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="all">All formats</option>
          {availableFormats.map((format) => (
            <option key={format} value={format}>
              {format.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="service" className="text-muted-foreground text-xs font-medium">
          Service
        </label>
        <select
          id="service"
          name="service"
          defaultValue={activeService}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="all">All services</option>
          {availableServices.map((svc) => (
            <option key={svc.name} value={svc.name}>
              {svc.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="size" className="text-muted-foreground text-xs font-medium">
          File size
        </label>
        <select
          id="size"
          name="size"
          defaultValue={activeSize}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          {SIZE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="sm">
        Apply filters
      </Button>
    </Form>
  );
}

function FailureRow({ row }: { row: FingerprintFailureRow }) {
  return (
    <TableRow>
      <TableCell>
        <div className="space-y-0.5">
          <Link to={`/library/${row.trackId}`} className="font-medium hover:underline">
            {row.title}
          </Link>
          <p className="text-muted-foreground text-xs">by {row.artist}</p>
        </div>
      </TableCell>
      <TableCell>
        <div className="max-w-[180px] truncate font-mono text-xs" title={row.objectKey}>
          {row.objectKey}
        </div>
        {row.fileName && (
          <p className="text-muted-foreground truncate text-xs" title={row.fileName}>
            {row.fileName}
          </p>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {row.format && <Badge variant="secondary">{row.format.toUpperCase()}</Badge>}
          <Badge variant="outline">{row.serviceName ?? "unknown"}</Badge>
        </div>
        {row.mimeType && <p className="text-muted-foreground mt-1 text-xs">{row.mimeType}</p>}
      </TableCell>
      <TableCell className="text-sm">{formatBytes(row.fileSize)}</TableCell>
      <TableCell className="text-muted-foreground text-xs">{formatDate(row.uploadedAt)}</TableCell>
      <TableCell className="font-mono text-xs" title={row.contentHash ?? undefined}>
        {shortHash(row.contentHash)}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/library/${row.trackId}`}>View</Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function Pagination({
  page,
  totalPages,
  totalFailures,
  pageSize,
}: {
  page: number;
  totalPages: number;
  totalFailures: number;
  pageSize: number;
}) {
  const [searchParams] = useSearchParams();
  const format = searchParams.get("format") ?? "all";
  const service = searchParams.get("service") ?? "all";
  const size = searchParams.get("size") ?? "all";

  if (totalFailures === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-muted-foreground text-sm">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalFailures)} of{" "}
        {totalFailures} failures
      </p>
      <div className="flex gap-1">
        <Form method="get" className="inline">
          {format !== "all" && <input type="hidden" name="format" value={format} />}
          {service !== "all" && <input type="hidden" name="service" value={service} />}
          {size !== "all" && <input type="hidden" name="size" value={size} />}
          {page > 1 && <input type="hidden" name="page" value={page - 1} />}
          <Button type="submit" variant="outline" size="sm" disabled={page <= 1}>
            Previous
          </Button>
        </Form>
        <span className="text-muted-foreground flex items-center px-2 text-sm">
          Page {page} / {totalPages}
        </span>
        <Form method="get" className="inline">
          {format !== "all" && <input type="hidden" name="format" value={format} />}
          {service !== "all" && <input type="hidden" name="service" value={service} />}
          {size !== "all" && <input type="hidden" name="size" value={size} />}
          {page < totalPages && <input type="hidden" name="page" value={page + 1} />}
          <Button type="submit" variant="outline" size="sm" disabled={page >= totalPages}>
            Next
          </Button>
        </Form>
      </div>
    </div>
  );
}

export default function FingerprintFailuresRoute({ loaderData }: Route.ComponentProps) {
  const {
    stats,
    failures,
    availableFormats,
    availableServices,
    page,
    pageSize,
    totalPages,
    totalFailures,
  } = loaderData;

  return (
    <div className="container py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1">Fingerprint failures</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Audio files with a content hash but no Chromaprint fingerprint (decode/fpcalc failures)
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/music/admin/duplicates"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            Duplicates
          </Link>
          <Link
            to="/admin"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            ← Back to admin
          </Link>
        </div>
      </div>

      <Spacer size="sm" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total audio files</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With content hash</CardDescription>
            <CardTitle className="text-3xl">{stats.withContentHash}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With fingerprint</CardDescription>
            <CardTitle className="text-3xl">{stats.withAudioFingerprint}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fingerprint failed</CardDescription>
            <CardTitle className="text-3xl text-destructive">{stats.fingerprintFailed}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Hash set, fingerprint null
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unprocessed</CardDescription>
            <CardTitle className="text-3xl">{stats.unprocessed}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Both fields null</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>% healthy</CardDescription>
            <CardTitle className="text-3xl">{stats.healthyPercent}%</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Both hash + fingerprint
          </CardContent>
        </Card>
      </div>

      <Spacer size="sm" />

      <FilterBar availableFormats={availableFormats} availableServices={availableServices} />

      <Spacer size="sm" />

      {failures.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Icon name="check-circled" className="text-body-2xl text-muted-foreground mb-4" />
            <h2 className="text-h2 mb-2">No fingerprint failures</h2>
            <p className="text-muted-foreground text-sm">
              {totalFailures === 0 && stats.fingerprintFailed === 0
                ? "All hashed audio files have fingerprints, or none have been processed yet."
                : "No failures match the current filters."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Failure candidates</CardTitle>
            <CardDescription>
              contentHash set and audioFingerprint null — typically corrupt or truncated audio
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Track</TableHead>
                  <TableHead>Object / file</TableHead>
                  <TableHead>Format / service</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Hash</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((row) => (
                  <FailureRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalFailures={totalFailures}
              pageSize={pageSize}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FingerprintFailures403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: FingerprintFailures403 }} />;
}
