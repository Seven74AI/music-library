import { NavLink } from "react-router";
import { cn } from "#app/utils/misc.tsx";
import { desktopNavItems } from "./app-navigation.ts";

export function DesktopNav() {
  return (
    <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
      {desktopNavItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          prefetch="intent"
          aria-label={item.ariaLabel}
          className={({ isActive }) =>
            cn(
              "rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
