import { type IconName } from "#app/components/ui/icon.tsx";
import { adminNavSections } from "#app/features/admin/admin-nav.ts";

export type NavLinkItem = {
  label: string;
  to: string;
  icon: IconName;
  ariaLabel: string;
};

/** Listening destinations. The same list for a user, a curator, and an admin. */
export const listeningNavItems = [
  { label: "Home", icon: "home", to: "/", ariaLabel: "Home page" },
  { label: "Discover", icon: "globe", to: "/discover", ariaLabel: "Discover music" },
  { label: "Search", icon: "magnifying-glass", to: "/search", ariaLabel: "Search music" },
  { label: "My Library", icon: "file-text", to: "/library", ariaLabel: "My music library" },
  { label: "My Playlists", icon: "list-bullet", to: "/playlists", ariaLabel: "My playlists" },
  { label: "History", icon: "clock", to: "/history", ariaLabel: "Listening history" },
] as const satisfies ReadonlyArray<NavLinkItem>;

/** Desktop header. Search stays the header search field, not a second link. */
export const desktopNavItems = listeningNavItems.filter((item) => item.to !== "/search");

/** Personal links in the account menu. Role tools live in their own header menus. */
export const accountMenuItems = [
  { label: "Downloads", icon: "download", to: "/downloads", ariaLabel: "Downloads" },
  { label: "My reports", icon: "file-text", to: "/reports", ariaLabel: "My reports" },
  { label: "Party Room", icon: "speaker-wave", to: "/rooms", ariaLabel: "Party Room" },
  {
    label: "Connected Services",
    icon: "link-2",
    to: "/music/services",
    ariaLabel: "Connected Services",
  },
] as const satisfies ReadonlyArray<NavLinkItem>;

/** Curator tools menu. Admins inherit these links. */
export const curatorMenuItems = [
  {
    label: "Curator Dashboard",
    icon: "pencil-2",
    to: "/music/curator/dashboard",
    ariaLabel: "Curator Dashboard",
  },
  {
    label: "Duplicates",
    icon: "arrows-right-left",
    to: "/music/curator/duplicates",
    ariaLabel: "Duplicates",
  },
  {
    label: "Genre Management",
    icon: "file-text",
    to: "/music/curator/genres",
    ariaLabel: "Genre Management",
  },
  {
    label: "Review Queue",
    icon: "file-text",
    to: "/music/curator/queue",
    ariaLabel: "Review Queue",
  },
] as const satisfies ReadonlyArray<NavLinkItem>;

export function headerMenusFor(roles: Array<{ name: string }>) {
  const names = new Set(roles.map((role) => role.name));
  const isAdmin = names.has("admin");
  const isCurator = names.has("curator") || isAdmin;

  return {
    curator: isCurator ? curatorMenuItems : [],
    admin: isAdmin ? adminNavSections : [],
  };
}
