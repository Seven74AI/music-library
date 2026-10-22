import { data, Outlet } from "react-router";
import { Breadcrumbs, type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { Icon } from "#app/components/ui/icon.tsx";

export const handle: BreadcrumbHandle = {
  breadcrumb: <Icon name="calendar">On-Repeat</Icon>,
};

export function loader() {
  return data({});
}

export default function OnRepeatLayout() {
  return (
    <main className="container flex min-h-[400px] flex-1 px-0 pb-12">
      <div className="w-full">
        <Breadcrumbs />
        <Outlet />
      </div>
    </main>
  );
}
