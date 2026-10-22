/**
 * Health Score Ring Component
 */

import { cn } from "#app/utils/misc.tsx";

interface HealthScoreRingProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function HealthScoreRing({ score, size = "lg", showLabel = true }: HealthScoreRingProps) {
  const percentage = Math.round(score);

  const color = percentage >= 90 ? "green" : percentage >= 70 ? "yellow" : "red";
  const colorClass = {
    green: "text-green-600",
    yellow: "text-yellow-600",
    red: "text-red-600",
  }[color];

  const strokeColor = {
    green: "#16a34a",
    yellow: "#ca8a04",
    red: "#dc2626",
  }[color];

  const label = percentage >= 90 ? "Excellent" : percentage >= 70 ? "Needs Work" : "Poor";

  const sizeValues = {
    sm: { radius: 40, strokeWidth: 8, fontSize: "text-xl" },
    md: { radius: 60, strokeWidth: 10, fontSize: "text-3xl" },
    lg: { radius: 80, strokeWidth: 12, fontSize: "text-5xl" },
  }[size];

  const { radius, strokeWidth, fontSize } = sizeValues;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const svgSize = (radius + strokeWidth) * 2;
  const center = radius + strokeWidth;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width={svgSize} height={svgSize} className="transform -rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-muted-foreground/20"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold", fontSize, colorClass)}>{percentage}%</span>
        </div>
      </div>

      {showLabel && (
        <div className="text-center">
          <p className={cn("font-semibold", colorClass)}>{label}</p>
        </div>
      )}
    </div>
  );
}
