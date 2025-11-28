<div align="center">
  <h1 align="center"><a href="https://www.epicweb.dev/epic-stack">The Music Library 🎶</a></h1>
  <strong align="center">
    Store, share and play your music from everywhere.
  </strong>
</div>

## Prerequisites

- Node.js 22+
- npm
- Fly.io CLI
- Git

## Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd music-library
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory with the following variables:
   ```bash
   # Required for local development
   SESSION_SECRET=your-session-secret-here
   HONEYPOT_SECRET=your-honeypot-secret-here
   SITE_URL=http://localhost:3000
   
   # YouTube Integration (optional for local dev)
   YOUTUBE_API_KEY=your-youtube-api-key
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   
   # Email (optional for local dev)
   RESEND_API_KEY=your-resend-api-key
   ```

4. **Set up the database**
   ```bash
   npm run setup
   ```

5. **Start the development server**
   ```bash
   # With mocks enabled (recommended for development)
   npm run dev
   
   # With YouTube mocks enabled
   npm run dev:youtube-mocks
   
   # Without mocks (requires real API keys)
   npm run dev:no-mocks
   ```

6. **Access the application**
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `npm run dev` - Start development server with mocks
- `npm run dev:youtube-mocks` - Start dev server with YouTube mocks
- `npm run dev:no-mocks` - Start dev server without mocks
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run test:e2e:dev` - Run E2E tests in UI mode
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm run validate` - Run all checks (tests, lint, typecheck)

## Testing

This project uses Vitest for unit tests and Playwright for E2E tests. See [tests/README.md](./tests/README.md) for detailed testing guidelines.

```bash
# Run unit tests
npm run test

# Run E2E tests
npm run test:e2e

# Run E2E tests in development mode (with UI)
npm run test:e2e:dev

# Install Playwright browsers (first time only)
npm run test:e2e:install
```

## Production Deployment

### 1. Fly.io Setup

1. **Sign up for Fly.io**
   ```bash
   fly auth signup
   ```

2. **Create apps** (get app name from `fly.toml`)
   ```bash
   fly apps create [APP_NAME]
   fly apps create [APP_NAME]-staging
   ```

### 2. Environment Variables

Set the following secrets for both production and staging apps:

**Required secrets:**
- `SESSION_SECRET` - Session encryption key
- `HONEYPOT_SECRET` - Form spam protection
- `RESEND_API_KEY` - Email service API key
- `SITE_URL` - Your production/staging URL
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `YOUTUBE_API_KEY` - YouTube Data API key

**Set secrets:**
```bash
# Generate random secrets
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) HONEYPOT_SECRET=$(openssl rand -hex 32) --app [APP_NAME]
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) HONEYPOT_SECRET=$(openssl rand -hex 32) --app [APP_NAME]-staging

# Set URLs
fly secrets set SITE_URL=https://your-domain.com --app [APP_NAME]
fly secrets set SITE_URL=https://your-staging-domain.com --app [APP_NAME]-staging

# Set API keys
fly secrets set GOOGLE_CLIENT_ID=your-client-id --app [APP_NAME]
fly secrets set GOOGLE_CLIENT_ID=your-client-id --app [APP_NAME]-staging

fly secrets set GOOGLE_CLIENT_SECRET=your-client-secret --app [APP_NAME]
fly secrets set GOOGLE_CLIENT_SECRET=your-client-secret --app [APP_NAME]-staging

fly secrets set YOUTUBE_API_KEY=your-youtube-key --app [APP_NAME]
fly secrets set YOUTUBE_API_KEY=your-youtube-key --app [APP_NAME]-staging

fly secrets set RESEND_API_KEY=your-resend-key --app [APP_NAME]
fly secrets set RESEND_API_KEY=your-resend-key --app [APP_NAME]-staging
```

### 3. Additional Configuration

**Prevent search engine indexing on staging:**
```bash
fly secrets set ALLOW_INDEXING=false --app [APP_NAME]-staging
```

### 4. Database Setup

**Create persistent volumes:**
```bash
# Production (2 volumes for redundancy)
fly volumes create data --region cdg --size 1 --count=2 --app [APP_NAME]

# Staging
fly volumes create data --region cdg --size 1 --app [APP_NAME]-staging
```

### 5. External Services

**Setup Consul for service discovery:**
```bash
fly consul attach --app [APP_NAME]
fly consul attach --app [APP_NAME]-staging
```

**Setup Tigris for file storage:**
```bash
fly storage create --app [APP_NAME]
fly storage create --app [APP_NAME]-staging
```

### 6. Deploy

```bash
# Deploy to production
fly deploy --app [APP_NAME]

# Deploy to staging
fly deploy --app [APP_NAME]-staging
```


## YouTube Playlist Integration

This music library application includes YouTube playlist integration features:

### Features
- **List YouTube Playlists**: View all your YouTube playlists in one place
- **Sync Playlists**: Connect your YouTube account and sync your playlists
- **Store Playlist Data**: Save playlist metadata locally for offline access
- **Track Deleted Videos**: Preserve original titles and metadata when videos are deleted from YouTube
- **Track Removed Videos**: Automatically remove tracks that are no longer in YouTube playlists
- **Sync Reporting**: View summary of deleted and removed tracks after each sync
- **Visual Indicators**: See which tracks have been deleted with clear visual indicators
- **Remove Playlists**: Remove playlists from your synced collection
- **OAuth Integration**: Secure authentication with YouTube using OAuth 2.0

### YouTube API Setup
To enable YouTube playlist features, you'll need to:

1. **Create a YouTube Data API project** in the [Google Cloud Console](https://console.cloud.google.com/)
2. **Enable the YouTube Data API v3**
3. **Create OAuth 2.0 credentials**
4. **Set up authorized redirect URIs:**
   - For local development: `http://localhost:3000/auth/callback/google`
   - For production: `https://your-domain.com/auth/callback/google`
   - For staging: `https://your-staging-domain.com/auth/callback/google`

### Environment Variables
Set the following environment variables (see Local Development Setup section above):

```bash
YOUTUBE_API_KEY=your_youtube_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SITE_URL=http://localhost:3000  # or your production URL
```

### Usage
1. Navigate to `/music/services/youtube/playlists` in the application
2. Click "Connect YouTube Account" to authenticate
3. Your playlists will be automatically synced
4. Refresh any playlist to see a sync summary showing:
   - Tracks added to the playlist
   - Tracks deleted from YouTube (with original titles preserved)
   - Tracks removed from the playlist
5. Deleted tracks are displayed with visual indicators and cannot be played
6. Manage your synced playlists from the interface

## Environment Variables Reference

### Required Variables
- `SESSION_SECRET` - Random string for session encryption (generate with `openssl rand -hex 32`)
- `HONEYPOT_SECRET` - Random string for form spam protection (generate with `openssl rand -hex 32`)
- `SITE_URL` - Your application URL (e.g., `http://localhost:3000` for local dev)

### Optional Variables
- `YOUTUBE_API_KEY` - YouTube Data API key for playlist integration
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `RESEND_API_KEY` - Resend API key for email functionality
- `ALLOW_INDEXING` - Allow search engine indexing (`true`/`false`, defaults to `true`)

## Database

This project uses SQLite with Prisma ORM. The database is automatically set up when you run `npm run setup`.

### Database Commands
```bash
# Run database migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# View database in Prisma Studio
npx prisma studio

# Reset database (development only)
npx prisma migrate reset
```

## Architecture

This project is built with the [Epic Stack](https://www.epicweb.dev/epic-stack) and includes:

- **React Router v7** - Full-stack React framework
- **Prisma** - Database ORM
- **SQLite** - Database (with LiteFS for production)
- **Tailwind CSS** - Styling
- **Vitest** - Unit testing
- **Playwright** - E2E testing
- **Fly.io** - Deployment platform

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run validate`
5. Submit a pull request

## License

[Add your license information here]
