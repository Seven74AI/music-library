import { NavLink, useNavigate } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";
import { listeningNavItems } from "./app-navigation.ts";

export function BottomNav() {
  const navigate = useNavigate();

  const handleSearchClick = (e: React.MouseEvent) => {
    e.preventDefault();
    void navigate("/search");
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-51 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      role="navigation"
      aria-label="Main navigation"
    >
      <ul className="flex h-16 items-center justify-around">
        {listeningNavItems.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === "/"}
              viewTransition={false}
              onClick={tab.to === "/search" ? handleSearchClick : undefined}
              aria-label={tab.ariaLabel}
              prefetch="intent"
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={tab.icon} size="lg" className={cn(isActive && "text-foreground")} />
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
