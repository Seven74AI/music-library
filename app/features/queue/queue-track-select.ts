export const QUEUE_TRACK_SELECT = {
  id: true,
  title: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;
