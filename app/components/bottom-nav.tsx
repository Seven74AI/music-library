import { NavLink } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";

interface TabConfig {
  label: string;
  icon: string;
  to: string;
}

const tabs: TabConfig[] = [
  { label: "Home", icon: "home", to: "/" },
  { label: "Search", icon: "magnifying-glass", to: "/search" },
  { label: "My Library", icon: "file-text", to: "/library" },
  { label: "My Playlists", icon: "list-bullet", to: "/playlists" },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      role="navigation"
      aria-label="Main navigation"
    >
      <ul className="flex h-16 items-center justify-around">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    name={tab.icon as Parameters<typeof Icon>[0]["name"]}
                    size="lg"
                    className={cn(isActive && "text-foreground")}
                  />
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
