# Music Library Application - Comprehensive Testing Plan

## Overview
This document outlines a systematic testing plan for all routes and actions in the Music Library application. Each route will be tested for both display functionality and interactive actions.

## Test Categories

### 1. Authentication Routes (`_auth+/`)
**Base URL**: `/auth/`

#### 1.1 Login (`/auth/login`)
- **Actions to test**:
  - [ ] Login with valid credentials
  - [ ] Login with invalid credentials
  - [ ] Login with remember me checked
  - [ ] Login with redirect parameter
  - [ ] Honeypot validation

#### 1.2 Signup (`/auth/signup`)
- **Actions to test**:
  - [ ] Signup with valid email
  - [ ] Signup with invalid email
  - [ ] Honeypot validation

#### 1.3 Onboarding (`/auth/onboarding`)
- **Actions to test**:
  - [ ] Complete onboarding with valid data
  - [ ] Username uniqueness validation
  - [ ] Password strength validation
  - [ ] Honeypot validation

#### 1.4 Provider Authentication (`/auth/auth_/{provider}`)
- **Actions to test**:
  - [ ] OAuth provider authentication
  - [ ] Provider callback handling

#### 1.5 Password Reset (`/auth/forgot-password`, `/auth/reset-password`)
- **Actions to test**:
  - [ ] Request password reset
  - [ ] Reset password with valid token
  - [ ] Reset password with invalid token

#### 1.6 Email Verification (`/auth/verify`)
- **Actions to test**:
  - [ ] Verify email with valid code
  - [ ] Verify email with invalid code

#### 1.7 Logout (`/auth/logout`)
- **Actions to test**:
  - [ ] Logout user
  - [ ] Session cleanup

#### 1.8 WebAuthn (`/auth/webauthn/`)
- **Actions to test**:
  - [ ] Passkey registration
  - [ ] Passkey authentication

### 2. Marketing Routes (`_marketing+/`)
**Base URL**: `/`

#### 2.1 Homepage (`/`)
- **Actions to test**:
  - [ ] Page loads correctly
  - [ ] Navigation links work
  - [ ] Responsive design

#### 2.2 About (`/about`)
- **Actions to test**:
  - [ ] Page displays correctly
  - [ ] All content is visible

#### 2.3 Privacy (`/privacy`)
- **Actions to test**:
  - [ ] Privacy policy displays
  - [ ] All sections are readable

#### 2.4 Terms of Service (`/tos`)
- **Actions to test**:
  - [ ] Terms display correctly
  - [ ] All sections are accessible

#### 2.5 Support (`/support`)
- **Actions to test**:
  - [ ] Support page loads
  - [ ] Contact information is visible

### 3. Library Routes
**Base URL**: `/library`

#### 3.1 Library Index (`/library`)
- **Actions to test**:
  - [ ] Display user's tracks
  - [ ] Search functionality
  - [ ] Filter options
  - [ ] Pagination

#### 3.2 Import Track from Services (`/music/services/youtube/import`)
- **Actions to test**:
  - [ ] Enter YouTube URL
  - [ ] Preview track details
  - [ ] Import track successfully
  - [ ] Error handling for invalid URLs
  - [ ] Handle already existing tracks

#### 3.3 Track Detail (`/library/{trackId}`)
- **Actions to test**:
  - [ ] Display track information
  - [ ] Play audio (audio playback disabled - no downloads available)
  - [ ] Edit track metadata
  - [ ] Delete track

#### 3.4 Remove Track (`/library/{trackId}/remove`)
- **Actions to test**:
  - [ ] Confirm deletion
  - [ ] Remove track from library
  - [ ] Handle cancellation

### 4. Music Service Routes (`music+/`)
**Base URL**: `/music`

#### 4.1 Music Index (`/music`)
- **Actions to test**:
  - [ ] Display available services
  - [ ] Service connection status
  - [ ] Navigation to services

#### 4.2 Services Overview (`/music/services`)
- **Actions to test**:
  - [ ] List all services
  - [ ] Service status indicators
  - [ ] Connection buttons

#### 4.3 Import Services (`/music/services/import`)
- **Actions to test**:
  - [ ] Import from different services
  - [ ] Track import process
  - [ ] Import status feedback

#### 4.4 YouTube Service Routes (`/music/services/youtube`)

##### 4.4.1 YouTube Index (`/music/services/youtube`)
- **Actions to test**:
  - [ ] Display YouTube service status
  - [ ] OAuth connection status
  - [ ] Sync playlists action
  - [ ] Remove playlist action

##### 4.4.2 YouTube Auth (`/music/services/youtube/auth`)
- **Actions to test**:
  - [ ] Initiate OAuth flow
  - [ ] Handle OAuth callback
  - [ ] Store OAuth tokens

##### 4.4.3 YouTube Playlists (`/music/services/youtube/playlists`)
- **Actions to test**:
  - [ ] Display user's YouTube playlists
  - [ ] Add playlist to sync
  - [ ] Remove playlist from sync
  - [ ] Refresh playlists

##### 4.4.4 YouTube Synced Playlists (`/music/services/youtube/synced-playlists`)
- **Actions to test**:
  - [ ] Display synced playlists
  - [ ] Remove playlist from sync
  - [ ] Resync playlist
  - [ ] View playlist details

##### 4.4.5 YouTube Playlist Detail (`/music/services/youtube/playlist/{id}`)
- **Actions to test**:
  - [ ] Display playlist tracks
  - [ ] Add tracks to library
  - [ ] Remove tracks from library
  - [ ] Sync playlist
  - [ ] Remove playlist from sync

### 5. Playlist Routes
**Base URL**: `/playlists`

#### 5.1 Playlists Index (`/playlists`)
- **Actions to test**:
  - [ ] Display user's playlists
  - [ ] Create new playlist
  - [ ] Edit existing playlists
  - [ ] Delete playlists

#### 5.2 New Playlist (`/playlists/new`)
- **Actions to test**:
  - [ ] Create playlist with valid data
  - [ ] Add tracks to playlist
  - [ ] Form validation
  - [ ] Error handling

#### 5.3 Playlist Detail (`/playlists/{playlistId}`)
- **Actions to test**:
  - [ ] Display playlist tracks
  - [ ] Add tracks to playlist
  - [ ] Remove tracks from playlist
  - [ ] Edit playlist metadata
  - [ ] Delete playlist

### 6. Settings Routes (`settings+/`)
**Base URL**: `/settings`

#### 6.1 Profile Index (`/settings/profile`)
- **Actions to test**:
  - [ ] Update profile information
  - [ ] Sign out of all sessions
  - [ ] Delete account data
  - [ ] Form validation

#### 6.2 Change Email (`/settings/profile/change-email`)
- **Actions to test**:
  - [ ] Request email change
  - [ ] Verify new email
  - [ ] Handle verification errors

#### 6.3 Password Management (`/settings/profile/password`)
- **Actions to test**:
  - [ ] Change password
  - [ ] Create password (for OAuth users)
  - [ ] Password strength validation

#### 6.4 Profile Photo (`/settings/profile/photo`)
- **Actions to test**:
  - [ ] Upload profile photo
  - [ ] Remove profile photo
  - [ ] Image validation
  - [ ] File size limits

#### 6.5 Two-Factor Authentication (`/settings/profile/two-factor`)
- **Actions to test**:
  - [ ] Enable 2FA
  - [ ] Disable 2FA
  - [ ] Verify 2FA setup
  - [ ] Backup codes generation

#### 6.6 Passkeys (`/settings/profile/passkeys`)
- **Actions to test**:
  - [ ] Register passkey
  - [ ] Remove passkey
  - [ ] List passkeys

### 7. User Routes (`users+/`)
**Base URL**: `/users`

#### 7.1 User Profile (`/users/{username}`)
- **Actions to test**:
  - [ ] Display user profile
  - [ ] Public/private content visibility
  - [ ] User statistics


### 8. Admin Routes (`admin+/`)
**Base URL**: `/admin`

#### 8.1 Cache Management (`/admin/cache`)
- **Actions to test**:
  - [ ] View cache statistics
  - [ ] Clear specific cache entries
  - [ ] Clear all cache
  - [ ] Admin authentication

### 9. Resource Routes (`resources+/`)
**Base URL**: `/resources`

#### 9.1 Health Check (`/resources/healthcheck`)
- **Actions to test**:
  - [ ] Health status endpoint
  - [ ] System information

#### 9.2 Theme Switch (`/resources/theme-switch`)
- **Actions to test**:
  - [ ] Switch to light theme
  - [ ] Switch to dark theme
  - [ ] System theme detection

#### 9.3 File Downloads (`/resources/download-user-data`)
- **Actions to test**:
  - [ ] Download user data
  - [ ] Data export functionality
  - Note: Audio download functionality has been removed

### 10. SEO Routes (`_seo+/`)
**Base URL**: Various

#### 10.1 Robots.txt (`/robots.txt`)
- **Actions to test**:
  - [ ] Robots.txt accessibility
  - [ ] Correct content

#### 10.2 Sitemap (`/sitemap.xml`)
- **Actions to test**:
  - [ ] Sitemap generation
  - [ ] All routes included

## Testing Methodology

### Phase 1: Authentication Flow
1. Test signup process
2. Test email verification
3. Test login/logout
4. Test password reset
5. Test OAuth providers

### Phase 2: Core Functionality
1. Test library management
2. Test playlist operations
3. Test music service integration
4. Test file uploads

### Phase 3: User Management
1. Test profile settings
2. Test security features (2FA, passkeys)
3. Test user data management

### Phase 4: Advanced Features
1. Test admin functions
2. Test API endpoints
3. Test error handling
4. Test edge cases

## Success Criteria

- [ ] All routes load without errors
- [ ] All actions execute successfully
- [ ] Form validations work correctly
- [ ] Error handling is appropriate
- [ ] User feedback is clear
- [ ] Security measures are effective
- [ ] Performance is acceptable

## Notes

- Test with both authenticated and unauthenticated users
- Test with different user roles (admin, regular user)
- Test with various data states (empty, populated, edge cases)
- Test responsive design on different screen sizes
- Test accessibility features
- Test with different browsers

## Browser Testing Checklist

For each route, verify:
- [ ] Page loads correctly
- [ ] All interactive elements work
- [ ] Forms submit successfully
- [ ] Error messages display properly
- [ ] Success messages appear
- [ ] Navigation works
- [ ] Responsive design functions
- [ ] No console errors
- [ ] No network errors
