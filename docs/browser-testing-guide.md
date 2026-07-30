# 🧪 Browser Testing Guide

How to test the Music Library app manually in a browser — covering all pages, auth states, viewports, and mock modes.

---

## 1. Start the Dev Server

```bash
cd ~/projects/music-library

# Standard dev mode — mocks enabled, real YouTube API
npm run dev
# → http://localhost:3000

# Full mock mode — no external API calls (offline-safe)
npm run dev:youtube-mocks
# → http://localhost:3000 (YouTube mocks included)

# No mocks at all — hits real APIs
npm run dev:no-mocks
# → http://localhost:3000
```

Wait for **"🚀 We have liftoff!"** in the console. The Vite HMR dev server hot-reloads all changes.

---

## 2. Test Credentials

Seeded users (run `npm run db:seed` first):

| Username   | Password       | Role    |
| ---------- | -------------- | ------- |
| `kody`     | `kodylovesyou` | Admin   |
| `kodyuser` | `kodylovesyou` | Regular |

Also seeded: 5 test users, 2 albums (Meryl — _Jour avant caviar_ and _Ozoror_), 4 tracks with audio files.

---

## 3. Page Checklist

Open each URL and verify it renders without console errors.

### Public pages (no login required)

| URL                | What to check                                             |
| ------------------ | --------------------------------------------------------- |
| `/`                | Landing page — hero, features, links to About/Privacy/ToS |
| `/login`           | Login form — email + password fields, submit button       |
| `/signup`          | Registration form                                         |
| `/forgot-password` | Password reset form                                       |
| `/support`         | Support page                                              |
| `/privacy`         | Privacy policy                                            |
| `/tos`             | Terms of service                                          |
| `/about`           | About page                                                |

### Authenticated pages (login required)

Log in as `kodyuser` / `kodylovesyou`, then navigate:

| URL                            | What to check                                      |
| ------------------------------ | -------------------------------------------------- |
| `/library`                     | Track listing, cover art, play buttons, search bar |
| `/library?search=…`            | Search results — FTS5 search, pagination           |
| `/playlists`                   | Playlist list — seeded playlists visible           |
| `/playlists/<id>`              | Individual playlist — track list, reorder, play    |
| `/music`                       | Music services page                                |
| `/music/services`              | Service listing                                    |
| `/music/services/youtube`      | YouTube integration entry point                    |
| `/search`                      | Global search page                                 |
| `/downloads`                   | Offline downloads page                             |
| `/settings/profile`            | Profile settings — photo, email, password          |
| `/settings/profile/photo`      | Profile photo upload                               |
| `/settings/profile/password`   | Password change                                    |
| `/settings/profile/passkeys`   | Passkey management                                 |
| `/settings/profile/two-factor` | 2FA setup                                          |
| `/users/kodyuser`              | Public user profile                                |

### Resource routes (API endpoints)

These return data, not pages. Check in browser DevTools Network tab:

| URL                          | Expected                    |
| ---------------------------- | --------------------------- |
| `/resources/healthcheck`     | `{"status":"ok"}`           |
| `/resources/theme-switch`    | Dark/light theme toggle API |
| `/resources/audio/<trackId>` | Audio streaming endpoint    |
| `/resources/notifications`   | User notification endpoint  |

---

## 4. Browser DevTools Testing

Open DevTools (F12) and check these tabs during testing:

### Console

- **No red errors** on any page load
- No uncaught promise rejections
- MSW warnings about unhandled requests are expected in dev (mock gaps)

### Network

- Filter by **Doc** to see page requests — all should be `200`
- Filter by **Fetch/XHR** to see API calls — watch responses
- Service worker registration should succeed (`/sw.js`)

### Application → Service Workers

- **Registered**: Service worker should be active
- **Offline**: Check "Offline" box, reload `/library` — should render from cache
- **Unregister**: If you need to clear SW state

### Application → Storage

- **Local Storage**: Theme preference (`theme: "light"` / `"dark"`)
- **IndexedDB**: Offline cache for audio and page shells (if offline mode enabled)
- **Cookies**: Session cookie (`_session`), client hint cookies (`CH-prefers-color-scheme`, `CH-time-zone`)

---

## 5. Mobile Viewport Testing

Toggle the responsive design mode in DevTools (Ctrl+Shift+M / Cmd+Shift+M).

**Key mobile behaviors:**

- Bottom nav bar shows (Library, Playlists, Search, Music)
- Audio player shows as a mini bar at the bottom
- **Now Playing sheet** — tap the mini player to expand the full sheet
- **Install banner** — PWA install prompt appears; dismiss with "Not now"
- Modals/sheets slide up from the bottom (Radix UI)

**Mobile pitfalls:**

- Z-index conflicts — install banner (z-30) can intercept bottom nav taps (z-40)
- Now Playing sheet overlay must dismiss properly (tap backdrop or swipe down)
- Buttons/links in summary/detail elements ignore keyboard shortcuts
- `<input type="range">` sliders shouldn't trigger keyboard shortcuts

---

## 6. Offline Mode Testing

1. Start with `npm run dev` (MOCKS=true)
2. Log in and navigate to `/library` — let the page shell cache
3. In DevTools → Application → Service Workers, check **Offline**
4. Reload `/library` — should render from cache
5. Navigate to `/playlists` — should load from cache
6. **Verify**: No "You're offline" banner flickers during SSR hydration

---

## 7. Auth Flow Testing

1. Visit `/library` while logged out → should redirect to `/login`
2. Log in with wrong password → error message appears
3. Log in successfully → redirects to `/library`
4. Session persists across page reloads
5. Log out (via profile menu) → redirects to `/`

---

## 8. Common Test Scenarios

### Search

1. Navigate to `/library`
2. Type in the search bar — FTS5 results appear
3. Verify track/artist/album results render
4. Clear search — full library returns

### Audio playback

1. Click play on any track
2. Audio player mini-bar appears at bottom
3. Play/pause toggle works
4. Next/previous track navigation
5. Progress bar scrubbing

### Playlist management

1. Navigate to `/playlists/<id>`
2. Tracks render with drag handles (dnd-kit)
3. Reorder tracks via drag-and-drop
4. Remove track from playlist
5. Add track to playlist from library

### Theme switching

1. Toggle dark/light in settings or via theme switch
2. All pages respect the theme
3. Theme persists across page loads

---

## 9. Quick Smoke Test Script

Run these in order — if all pass, the app is healthy:

```bash
# 1. Start server in background
npm run dev &

# 2. Wait for liftoff
sleep 5

# 3. Test all public pages return 200
for path in / /login /signup /forgot-password /support /privacy /tos /about; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000$path)
  echo "$STATUS $path"
done

# 4. Test healthcheck
curl http://localhost:3000/resources/healthcheck
```

---

## 10. Troubleshooting

| Symptom                  | Likely cause                                         | Fix                                                                                         |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Blank page / timeout     | SSR is stuck                                         | Check `server/dev-server.js` logs; restart dev server                                       |
| "You're offline" banner  | `navigator.onLine` is `undefined` (Node ≥21 SSR bug) | Fixed in `use-online-status.ts` — verify the guard: `typeof navigator.onLine === "boolean"` |
| 404 on asset             | Vite not built                                       | Run `npm run build` first if not using dev server                                           |
| Playwright port conflict | Inspector 9229 already in use                        | `lsof -ti:9229                                                                              | xargs kill -9` |
| MSW warnings in console  | Unhandled mock routes                                | Expected in dev — add handlers in `app/mocks/` if needed                                    |
| Service worker stale     | Old SW cached                                        | Unregister in DevTools → Application → Service Workers, then hard reload                    |
