# ADR-030: Party Room (shared live queue)

## Status

Accepted. Amended 2026-10-13 (presence, return, host exit, reclaim). The 2026-09-29 decisions are implemented. The amendment is not.

**Tracking:** [#284](https://github.com/mnlamart/music-library/issues/284)

**Date:** 2026-09-29. Amendment: 2026-10-13.

## Context

Playback today is per-user and client-owned: **Queue Spine** + **Up Next** in `AudioPlayerProvider`, with personal **PlayerState** restore (ADR-015 / ADR-017). Audio and hydration require a logged-in user with track access (library / user playlist / service playlist). There is no friend graph, no shared queue, and no player realtime channel (SSE exists only for upload progress; WebSockets were removed in ADR-004).

The product need is an **in-person party**: many people want to queue tracks on one sound system, with live updates, optional walk-up guests, and roles — not Spotify-style sample-accurate listen-together, and not a 10k-track personal library spine shared across phones.

## Decision

### Product shape

- **Party Room** — server-hosted session with a short code, join URL, and QR (URL-encoded).
- **One speaker device** in v1 (the current Host’s device). Path reserved for later **claim speaker**.
- **Flat room queue** (ordered track list + `currentIndex`) — **not** Queue Spine / Up Next. Scale: hundreds of tracks (cap **500**), not 10k+.
- Room starts **empty**. Host may **Add playlist to queue** (bulk append, Host-only). DJ/Host add individual tracks via search / track menus.
- Played rows stay in the list **above** the pointer (history); only **upcoming** rows are reorderable / removable-by-editors.

### Participants and roles

- **RoomParticipant** — seat in a room (linked `userId` **or** guest token + display name) + role. Do not call this “membership.”
- Roles: **Host**, **DJ**, **Listener**.
- Room setting **`defaultJoinRole`**: `listener` | `dj` (never `host`). Host chooses whether walk-ups enter as Listener or DJ.
- Capability matrix:

|                                            | Host | DJ  | Listener |
| ------------------------------------------ | ---- | --- | -------- |
| See queue + now playing                    | ✓    | ✓   | ✓        |
| Add tracks                                 | ✓    | ✓   | ✗        |
| Reorder / remove others’ upcoming rows     | ✓    | ✓   | ✗        |
| **Remove own** row (any role)              | ✓    | ✓   | ✓        |
| Skip / play-pause (transport)              | ✓    | ✗   | ✗        |
| Kick, change roles, end room, set defaults | ✓    | ✗   | ✗        |
| Speaker device (v1)                        | ✓    | ✗   | ✗        |

- Queue rows store **`addedByParticipantId`** so remove-own works after demotion.

### Join, codes, QR

- **6-character** code; charset aligned with auth OTP (`ABCDEFGHJKLMNPQRSTUVWXYZ123456789` — no `0`/`O`/`I`).
- URL embeds the same code (e.g. `/rooms/AB3K9Q`). Join accepts code or pasted URL.
- Host UI: large code, copy link, **QR of the full URL** (reuse existing `qrcode` dependency).
- **Smart join:** logged-in → participant linked to user; logged-out → **guest shell**. No forced guest mode for signed-in users.
- Codes unique among **open** rooms; invalidated when the room ends.

### Guests vs logged-in UX

- **Logged-in:** normal app. While in a room and allowed to add: track `…` menu includes **Add to room queue**. Nav: **`/rooms`**, home **“Got a code?”**, persistent in-room chip. At most **one open seat** (`leftAt` null in an open room). Opening Party Room loads that room from the account and shows the code, link, and queue. `sessionStorage` is a cache, not the source of truth. Rooms have **no display name**; the **Room Code** is the only identity.
- After **Leave**, that person can create a new room. The room they left stays open under its current Host until that Host ends it or the empty clock finishes. The old “one open room per creator” check does not apply once the seat is gone.
- **Guests:** minified shell — **Room** tab + **Search** tab (artists / albums / tracks with **audio only**, full archived catalog). **Audition**: play one track at a time on their device to verify the song (not the room speaker).
- **Guest return:** the joining browser’s guest cookie (24h) matches their seat. Opening the site while that cookie matches a seat in an open room goes straight into the room. **Leave** clears the cookie, so Leave does not pull them back. Another device needs the **Room Code**.

### Catalog and audio grants

- Room search / add targets **any track that has an audio file** (archived catalog), not only the Host’s library.
- **Speaker grant:** Host speaker may resolve audio for tracks **on the room queue**.
- **Audition grant:** participant-gated, has-audio only, short-lived URL; one active audition per participant; ~**20** audition grants / participant / minute.
- Do not open unauthenticated raw `/resources/audio/:trackId` or ungated global search to strangers without a valid participant seat in an open room.

### Realtime and Host resilience

- Source of truth: **database** (room + queue + pointer + version). Mutations via HTTP; live updates via **SSE** room channel (same family as upload progress). Payloads carry a monotonic **`roomVersion`** for resync.
- Room does **not** die when the Host’s browser disconnects. Closing a tab is not **Leave**.
- **Presence.** A seat with `leftAt` null is still in the room. **Away** means the page is gone and, for the speaker, playback has stopped.
  - Non-speaker: **Away** after ~**10s** without a live page. A refresh inside that grace does not count as Away. A locked phone that is not the speaker goes Away.
  - Speaker: stays here while that device is playing, including a locked phone. Stays here for ~**30s** after the sound stops, so a gap before the next track does not count. An open page stays here while paused.
  - The participant list keeps Away people and marks them Away. **Leave** removes the row immediately. The list does not say “original host.”
- **Become host** shows only when the Host is Away and the sound has been stopped for ~**30s**. It stays hidden while the speaker device is playing and during that 30s. The new Host’s device becomes the speaker and may resume from `currentIndex` at **0:00** (no mid-track sync — consistent with ADR-017). Prefer DJ.
- **Reclaim host** is available to the person who holds it, while they are still in the room, including while a song is playing on someone else’s phone. It stops playback, moves the speaker to their device, and the room starts paused.
- **Reclaim host** starts with the creator. If they **Leave** after someone else has **Become host**, it passes to the person who has the speaker. A signed-in holder keeps it on their account. A guest holder keeps it on the joining browser only (24h cookie). Another device does not inherit it. After an explicit **Leave**, coming back with the code uses the room’s current **`defaultJoinRole`** and does not show **Reclaim host**.
- Handoff without ending the room is closing the tab, or someone else clicking **Become host** once the speaker is idle. It is not a quiet Leave.

### Lifecycle and player UX

- The current Host’s exit **ends the room** for everyone, after a confirmation that everyone will be disconnected and the code will stop working. That includes a replacement Host and a guest Host. DJ and Listener **Leave** only removes that seat.
- Auto-close ~**45 minutes** after everyone is **Away**. The clock does not start while anyone is here, including a locked phone that is still playing. Coming back inside the 45 minutes opens the room and clears the clock. Music stopped is not itself the signal. An idle open page is still a room.
- While a device is the room speaker: personal **PlayerState** is **suspended** (not overwritten). Leaving/ending restores personal queue.
- **Global player:** Host/speaker → room queue with full transport. Other logged-in participants → read-only now-playing bar linking to the room queue. Guests → equivalent in the guest shell.

### Play attribution

- Room speaker plays emit **room-scoped play events** only (e.g. `room_play_started` / `room_play_completed` with room + track + optional `addedByParticipantId`).
- They do **not** write personal `play_started` / `play_completed` **UsageEvent**s and must not inflate `/history`, Heavy Rotation, On-Repeat, Weekly Wrap, or Personal Play Boost.

### v1 limits (tunable constants)

| Limit                          | Value                            |
| ------------------------------ | -------------------------------- |
| Max queue tracks               | 500                              |
| Max seats (including Away)     | 50                               |
| Open seats per signed-in user  | 1                                |
| Guest display name             | 1–24 chars                       |
| Guest cookie                   | 24h                              |
| Add-track rate / participant   | ~30/min                          |
| Room search rate / participant | ~60/min                          |
| Audition grants / participant  | ~20/min                          |
| Non-speaker Away grace         | ~10s                             |
| Speaker silence before Away    | ~30s                             |
| Empty-room TTL                 | ~45 min after everyone is Away   |
| Become host                    | Host Away and sound stopped ~30s |

## Alternatives considered

- **Listen-together clock sync** — Rejected for v1; wrong problem for a single party speaker; fights autoplay and ADR-017.
- **Reuse personal Queue Spine + Up Next as the room model** — Rejected; party scale and mental model differ.
- **Host-library-only catalog** — Rejected; Host wants full archived catalog with audio for guest search/add.
- **WebSockets** — Rejected for v1; SSE matches an existing pattern; WS were removed once for complexity.
- **5-minute Host grace** — Rejected in the original decision in favor of **10s** + explicit Become host. The 2026-10-13 amendment replaces that 10s heartbeat gap: **Become host** waits until the sound has been stopped for ~**30s** and the Host is Away.
- **Credit personal UsageEvents to Host or adder** — Rejected; room plays are room activity.
- **Human-readable room name** — Rejected. The code is the only identity. Finding the room does not depend on remembering a name.
- **Host Leave keeps the room open** — Rejected. The current Host’s exit ends the room for everyone, after confirmation.
- **Reclaim dies when the creator Leaves** — Rejected. It passes to whoever has the speaker.
- **Reclaim waits for the next signed-in Become host when a guest has the speaker** — Rejected. That guest receives it immediately, on the joining browser only.

## Non-goals (v1)

- Multi-speaker / simultaneous claim-speaker (reserve capability; ship later).
- Sample-accurate sync across listener devices.
- Permanent reusable “house” codes across parties.
- Human-readable room names.
- Listener suggestions lane / approval queue.
- YouTube URL ingest during a party.
- Offline rooms (online-only).

## Consequences

- New domain module (suggested `app/features/party-room/`): Room, RoomParticipant, room queue rows, SSE fan-out, join/guest tokens, audition + speaker audio grants.
- Personal player and ADR-017 **PlayerState** remain the solo path; room mode is an overlay on the speaker device.
- Guest shell is a distinct route tree from the full app chrome.
- Upload SSE’s process-local connection map is acceptable on a single Fly machine; multi-node fan-out or version-polling fallback may be needed if the app scales out.
- Glossary: **Party Room** section in `docs/CONTEXT.md`; settled decision #66.
- The 2026-10-13 amendment is not implemented. Today the active code lives in `sessionStorage` (no account or guest-cookie lookup), `emptySince` is set only when the last seat clicks Leave, the Host heartbeat alone opens **Become host** after 10s, Host Leave does not end the room, and **Reclaim host** stays on the creator’s user id.

## References

- ADR-015 Queue Spine · ADR-017 PlayerState / no mid-track resume · ADR-004 WS removal · ADR-016 UsageEvent
- Epic: [#284](https://github.com/mnlamart/music-library/issues/284)
