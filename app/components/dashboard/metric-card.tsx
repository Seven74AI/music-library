import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";

export function MetricCard({
  label,
  value,
  detail,
  testId,
  count,
}: {
  label: string;
  value: string;
  detail?: string;
  testId: string;
  count?: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl" data-testid={testId} data-count={count}>
          {value}
        </CardTitle>
      </CardHeader>
      {detail ? (
        <CardContent className="pt-0 text-sm text-muted-foreground">{detail}</CardContent>
      ) : null}
    </Card>
  );
}
