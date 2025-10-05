<div align="center">
  <h1 align="center"><a href="https://www.epicweb.dev/epic-stack">The Epic Stack 🚀</a></h1>
  <strong align="center">
    Ditch analysis paralysis and start shipping Epic Web apps.
  </strong>
  <p>
    This is an opinionated project starter and reference that allows teams to
    ship their ideas to production faster and on a more stable foundation based
    on the experience of <a href="https://kentcdodds.com">Kent C. Dodds</a> and
    <a href="https://github.com/epicweb-dev/epic-stack/graphs/contributors">contributors</a>.
  </p>
</div>

```sh
npx epicli
```

[![The Epic Stack](https://github-production-user-asset-6210df.s3.amazonaws.com/1500684/246885449-1b00286c-aa3d-44b2-9ef2-04f694eb3592.png)](https://www.epicweb.dev/epic-stack)

[The Epic Stack](https://www.epicweb.dev/epic-stack)

<hr />

## Watch Kent's Introduction to The Epic Stack

[![Epic Stack Talk slide showing Flynn Rider with knives, the text "I've been around and I've got opinions" and Kent speaking in the corner](https://github-production-user-asset-6210df.s3.amazonaws.com/1500684/277818553-47158e68-4efc-43ae-a477-9d1670d4217d.png)](https://www.epicweb.dev/talks/the-epic-stack)

["The Epic Stack" by Kent C. Dodds](https://www.epicweb.dev/talks/the-epic-stack)

## Docs

[Read the docs](https://github.com/epicweb-dev/epic-stack/blob/main/docs)
(please 🙏).

## Support

- 🆘 Join the
  [discussion on GitHub](https://github.com/epicweb-dev/epic-stack/discussions)
  and the [KCD Community on Discord](https://kcd.im/discord).
- 💡 Create an
  [idea discussion](https://github.com/epicweb-dev/epic-stack/discussions/new?category=ideas)
  for suggestions.
- 🐛 Open a [GitHub issue](https://github.com/epicweb-dev/epic-stack/issues) to
  report a bug.

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

## Branding

Want to talk about the Epic Stack in a blog post or talk? Great! Here are some
assets you can use in your material:
[EpicWeb.dev/brand](https://epicweb.dev/brand)

## Thanks

You rock 🪨
