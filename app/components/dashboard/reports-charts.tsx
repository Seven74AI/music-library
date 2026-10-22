import { type DashboardCharts } from "#app/features/curator/dashboard.ts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

function shortDate(value: string) {
  return value.slice(5);
}

export function ReportsCharts({ charts }: { charts: DashboardCharts }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className="rounded-lg border p-4" data-testid="completeness-chart">
        <h3 className="mb-4 text-base font-semibold">Metadata completeness</h3>
        <LineChart points={charts.completenessOverTime} />
      </section>
      <section className="rounded-lg border p-4" data-testid="edits-chart">
        <h3 className="mb-4 text-base font-semibold">Edits per day</h3>
        <BarChart points={charts.editsPerDay} />
      </section>
      <section className="rounded-lg border p-4 xl:col-span-2" data-testid="issues-chart">
        <h3 className="mb-4 text-base font-semibold">Issue types</h3>
        {charts.issueTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open queue issues.</p>
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
            <PieChart slices={charts.issueTypes} />
            <ul className="space-y-2 text-sm">
              {charts.issueTypes.map((entry) => (
                <li key={entry.type} className="flex justify-between gap-3">
                  <span>{entry.label}</span>
                  <span className="font-medium">{entry.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function LineChart({ points }: { points: { date: string; percent: number }[] }) {
  const width = 640;
  const height = 220;
  const pad = 28;
  const coords = points.map((point, index) => {
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = pad + (1 - point.percent / 100) * (height - pad * 2);
    return { x, y, point };
  });
  const d = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-64 w-full"
      role="img"
      aria-label="Metadata completeness over time"
    >
      <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" />
      {coords
        .filter((_, index) => index % 5 === 0)
        .map((coord) => (
          <text
            key={coord.point.date}
            x={coord.x}
            y={height - 6}
            fontSize="10"
            textAnchor="middle"
            fill="currentColor"
          >
            {shortDate(coord.point.date)}
          </text>
        ))}
    </svg>
  );
}

function BarChart({ points }: { points: { date: string; count: number }[] }) {
  const width = 640;
  const height = 220;
  const pad = 28;
  const max = Math.max(1, ...points.map((point) => point.count));
  const barWidth = (width - pad * 2) / points.length;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-64 w-full"
      role="img"
      aria-label="Edits per day"
    >
      {points.map((point, index) => {
        const barHeight = (point.count / max) * (height - pad * 2);
        const x = pad + index * barWidth;
        const y = height - pad - barHeight;
        return (
          <rect
            key={point.date}
            x={x + 1}
            y={y}
            width={Math.max(barWidth - 2, 1)}
            height={barHeight}
            fill="#16a34a"
          />
        );
      })}
    </svg>
  );
}

function PieChart({ slices }: { slices: { type: string; count: number }[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const cx = 100;
  const cy = 100;
  const radius = 80;
  let angle = -Math.PI / 2;
  const paths = slices.map((slice, index) => {
    const sweep = total === 0 ? 0 : (slice.count / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    if (slices.length === 1 || sweep >= Math.PI * 2 - 0.0001) {
      return (
        <circle key={slice.type} cx={cx} cy={cy} r={radius} fill={COLORS[index % COLORS.length]} />
      );
    }
    const startPoint = polar(cx, cy, radius, start);
    const endPoint = polar(cx, cy, radius, end);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${large} 1 ${endPoint.x} ${endPoint.y} Z`;
    return <path key={slice.type} d={d} fill={COLORS[index % COLORS.length]} />;
  });
  return (
    <svg
      viewBox="0 0 200 200"
      className="mx-auto h-64 w-full max-w-xs"
      role="img"
      aria-label="Issue types"
    >
      {paths}
    </svg>
  );
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}
