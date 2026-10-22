# Party Room (client)

Logged-in UX + speaker player integration for [ADR-030](../../../docs/decisions/030-party-room.md).

## Ownership

This package currently mixes:

- **UI client** (this PR): `api.client.ts`, `party-room-provider.tsx`, `player-suspend.ts`, `types.ts`, routes/components under `app/routes/rooms*` and `app/components/party-room/`
- **Overlapping domain helpers** (`constants.ts`, `capabilities.ts`, `code.ts`) that duplicate names from backend PR **#294**

**Merge order:** merge [#294](https://github.com/mnlamart/music-library/pull/294) first, then rebase this branch and delete duplicate domain helpers — re-export from the backend module instead.

## Backend contract (PR #294)

| Method | Path                            | Purpose                                                                                   |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST` | `/api/rooms`                    | Create                                                                                    |
| `GET`  | `/api/rooms/:code`              | Snapshot                                                                                  |
| `POST` | `/api/rooms/:code/join`         | Smart join                                                                                |
| `POST` | `/api/rooms/:code/leave`        | Leave                                                                                     |
| `POST` | `/api/rooms/:code/end`          | Host end                                                                                  |
| `POST` | `/api/rooms/:code/heartbeat`    | Presence heartbeat for any seated participant                                             |
| `POST` | `/api/rooms/:code/become-host`  | Takeover                                                                                  |
| `POST` | `/api/rooms/:code/reclaim-host` | Reclaim host for `reclaimParticipantId`                                                   |
| `POST` | `/api/rooms/:code/settings`     | `defaultJoinRole`                                                                         |
| `POST` | `/api/rooms/:code/queue`        | Intent: `add_track`, `add_playlist`, `remove`, `reorder`, `play`, `pause`, `skip`, `jump` |
| `GET`  | `/api/rooms/:code/events`       | SSE                                                                                       |
| `POST` | `/api/rooms/:code/play-events`  | `room_play_started` / `room_play_completed`                                               |
| `GET`  | `/api/rooms/:code/qr`           | QR data URL                                                                               |

`GET /api/rooms/current` returns this browser's open seat (signed-in user or `en_room_guest` cookie). `sessionStorage` (`party-room.active-code`) caches that code after a successful response. A missing cache is not "no room." Guests also return through that cookie on document GETs.

## UI surfaces

- `/rooms`, `/rooms/:code`
- Home **Got a code?**
- In-room chip, Add to room queue, Become/Reclaim host
- Speaker suspend/restore + room play events (no personal `UsageEvent`)
