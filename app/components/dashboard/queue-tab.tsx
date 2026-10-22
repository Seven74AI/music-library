import { QueueTable } from "#app/components/dashboard/queue-table.tsx";

export function QueueTab() {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">Review queue</h2>
      <QueueTable />
    </section>
  );
}
