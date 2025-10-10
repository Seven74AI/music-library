<div align="center">
  <h1 align="center"><a href="https://www.epicweb.dev/epic-stack">The Music Library 🎶</a></h1>
  <strong align="center">
    Store, share and play your music from everywhere.
  </strong>
</div>

## Install

1. Sign to fly
`fly auth signup``

2. Create 2 apps, prd & stg (get app name from fly.toml)
fly apps create [app-name]
fly apps create [app-name]-staging

## YouTube Playlist Integration

This music library application includes YouTube playlist integration features:

### Features
- **List YouTube Playlists**: View all your YouTube playlists in one place
- **Sync Playlists**: Connect your YouTube account and sync your playlists
- **Store Playlist Data**: Save playlist metadata locally for offline access
- **Remove Playlists**: Remove playlists from your synced collection
- **OAuth Integration**: Secure authentication with YouTube using OAuth 2.0

### Setup
To enable YouTube playlist features, you'll need to:

1. Create a YouTube Data API project in the [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the YouTube Data API v3
3. Create OAuth 2.0 credentials
4. Set the following environment variables:
   ```bash
   YOUTUBE_API_KEY=your_api_key
   YOUTUBE_CLIENT_ID=your_client_id
   YOUTUBE_CLIENT_SECRET=your_client_secret
   SITE_URL=http://localhost:3000  # or your production URL
   ```

### Usage
1. Navigate to `/youtube/playlists` in the application
2. Click "Connect YouTube Account" to authenticate
3. Your playlists will be automatically synced
4. Manage your synced playlists from the interface
