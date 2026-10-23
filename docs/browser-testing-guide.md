# 🧪 Browser Testing Guide

How to test the Music Library app manually in a browser.

## 1. Start the Dev Server

```bash
cd ~/projects/music-library
npm run db:seed    # first time only
npm run dev        # → http://localhost:3000
```

Wait for **"🚀 We have liftoff!"**

## 2. Test Credentials

| Username    | Password       | Role    |
| ----------- | -------------- | ------- |
| `kody`      | `kodylovesyou` | Admin   |
| `kodyuser`  | `kodylovesyou` | Regular |

## 3. Page Checklist

### Public (no login)

| URL | Page |
| --- | ---- |
| `/` | Landing page |
| `/login` | Login form |
| `/signup` | Registration |
| `/forgot-password` | Password reset |
| `/support` | Support page |
| `/privacy` | Privacy policy |
| `/tos` | Terms of service |
| `/about` | About page |

### Authenticated (login first)

| URL | Page |
| --- | ---- |
| `/library` | Track listing, search, play |
| `/playlists` | Playlist list |
| `/playlists/<id>` | Individual playlist |
| `/music` | Music services |
| `/music/services` | Service listing |
| `/music/services/youtube` | YouTube integration |
| `/search` | Global search |
| `/downloads` | Offline downloads |
| `/settings/profile` | Profile settings |
| `/settings/profile/photo` | Photo upload |
| `/settings/profile/password` | Password change |
| `/settings/profile/passkeys` | Passkey management |
| `/settings/profile/two-factor` | 2FA setup |
| `/users/<username>` | Public user profile |

### Resource routes (check in DevTools Network tab)

| URL | Expected |
| --- | -------- |
| `/resources/healthcheck` | `{"status":"ok"}` |
| `/resources/theme-switch` | Dark/light toggle |

## 4. DevTools Tabs

- **Console** — no red errors on page load
- **Network** — all Doc/Fetch requests return 200
- **Application → Service Workers** — registered and active
- **Application → Storage** — session cookie, client hint cookies, theme in LocalStorage

## 5. Mobile Viewport

Toggle responsive mode (Ctrl+Shift+M). Bottom nav, mini audio player, and the now-playing sheet should all render correctly.

## 6. Auth Flow

1. Visit `/library` while logged out → redirected to `/login`
2. Log in with `kodyuser` / `kodylovesyou` → redirected to `/library`
3. Session persists across reloads

## 7. Quick Smoke Test

```bash
for path in / /login /signup /forgot-password /support /privacy /tos /about; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000$path)
  echo "$STATUS $path"
done
curl http://localhost:3000/resources/healthcheck
```
