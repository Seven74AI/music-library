/**
 * Admin destinations shared by the overview page and the header admin menu.
 * Keep this module free of server imports so the header can use it on the client.
 */
export const adminNavSections = [
  {
    title: "System Health",
    links: [
      { label: "Database Quality", to: "/admin/database-quality" },
      { label: "FTS Index", to: "/admin/fts-index" },
      { label: "Cache Admin", to: "/admin/cache" },
      { label: "DB backups", to: "/admin/db-backup" },
    ],
  },
  {
    title: "Content Management",
    links: [
      { label: "Orphaned Tracks", to: "/admin/orphaned-tracks" },
      { label: "Missing Covers", to: "/admin/missing-covers" },
      { label: "Duplicates", to: "/music/admin/duplicates" },
      { label: "Audio Queue", to: "/admin/audio-queue" },
      { label: "Fingerprint failures", to: "/music/admin/fingerprint-failures" },
    ],
  },
  {
    title: "User Management",
    links: [{ label: "Users", to: "/admin/users" }],
  },
  {
    title: "Security",
    links: [
      { label: "Security Events", to: "/admin/security-events" },
      { label: "Failed Logins", to: "/admin/security-events?tab=failed" },
    ],
  },
  {
    title: "Settings",
    links: [{ label: "YouTube Cookies", to: "/admin/youtube-cookies" }],
  },
] as const;
