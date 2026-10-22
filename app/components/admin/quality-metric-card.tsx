/**
 * Quality Metric Card Component
 */

import { Progress } from "#app/components/ui/progress.tsx";
import { cn } from "#app/utils/misc.tsx";

interface QualityMetricCardProps {
  label: string;
  percentage: number;
  target: number;
  weight: number;
  showTarget?: boolean;
}

export function QualityMetricCard({
  label,
  percentage,
  target,
  weight,
  showTarget = true,
}: QualityMetricCardProps) {
  const isGood = percentage >= target;
  const isClose = percentage >= target - 5;

  const statusIcon = isGood ? "✓" : percentage >= target - 10 ? "⚠" : "✗";
  const statusColor = isGood ? "text-green-600" : isClose ? "text-yellow-600" : "text-red-600";
  const statusText = isGood ? "Good" : isClose ? "Close" : "Below Target";

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="text-muted-foreground text-xs">Weight: {(weight * 100).toFixed(0)}%</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{percentage.toFixed(1)}%</p>
          {showTarget && <p className="text-muted-foreground text-xs">Target: {target}%</p>}
        </div>
      </div>

      <Progress value={percentage} className="mb-2 h-3" />

      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium", statusColor)}>
          {statusIcon} {statusText}
        </span>
        {showTarget && !isGood && (
          <span className="text-muted-foreground text-xs">
            {(target - percentage).toFixed(1)}% below target
          </span>
        )}
      </div>
    </div>
  );
}
