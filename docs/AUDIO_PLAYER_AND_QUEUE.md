# Audio Player & Queue System - Product Documentation

## Overview

The Music Library application features a sophisticated audio player with a context-aware queue system that provides a seamless music listening experience. The system intelligently manages playback, queue loading, and user interactions across different contexts (library, playlists) while maintaining optimal performance even with large music collections (5,000+ tracks).

---

## Audio Player

### What It Is

The audio player is a persistent, bottom-fixed control bar that appears when a user starts playing music. It provides all essential playback controls and track information in a compact, always-accessible interface.

### Key Features

#### 1. **Persistent Playback Control**
- **Fixed Position**: The player stays at the bottom of the screen, visible across all pages
- **Always Accessible**: Users can control playback from anywhere in the application
- **Auto-Play**: When a track is selected, playback begins automatically (respecting browser autoplay policies)

#### 2. **Playback Controls**
- **Play/Pause Button**: Large, prominent button in the center for easy access
- **Previous/Next Track**: Navigate through the queue with arrow buttons
- **Seek Bar**: Interactive progress bar showing current position and total duration
  - Users can click or drag to jump to any point in the track
  - Displays current time and total duration in MM:SS format
- **Close Button**: Minimize the player (stops playback and clears queue)

#### 3. **Advanced Playback Modes**

**Loop Modes** (3 states, cycles through):
- **Off**: Normal playback, stops at end of queue
- **All**: Loops entire queue continuously
- **One**: Loops the current track indefinitely
  - Visual indicator: Button shows active state with "1" badge when looping one track

**Shuffle Mode**:
- Randomizes track order for playback
- Visual indicator: Button highlights when active
- Works seamlessly with loop modes

#### 4. **Track Information Display**
- **Thumbnail**: Album art or placeholder icon if no cover available
- **Track Title**: Prominently displayed
- **Artist Name**: Shown below title
- **Consistent Placeholders**: Standardized icon for tracks without album art across the entire application

#### 5. **Smart Audio File Selection**
- Automatically selects the best available audio format
- Priority order: FLAC > WAV > MP3 > M4A > OGG > AAC
- Ensures highest quality playback when multiple formats are available

#### 6. **Audio URL loading (production & local dev)**
- The player fetches `/resources/audio/:trackId` and receives a JSON `{ url }` (presigned Tigris URL in production; local stream URL in dev)
- Auto-play only runs after the URL for the **current** track has loaded (avoids races when skipping tracks)
- Navigation (next, previous, click another track) updates the current track immediately and keeps playback going when possible

---

## Queue System

### What It Is

The queue is a context-aware playlist that automatically loads and manages tracks based on where the user initiated playback. It's designed to handle both small playlists and massive music libraries (5,000+ tracks) efficiently.

### Key Concepts

#### 1. **Context-Aware Loading**

The queue system understands where the user clicked "Play" and loads tracks accordingly:

**Library Context**:
- When a user clicks play from their music library
- Queue resets and loads all **playable** tracks from the user's library (tracks with at least one archived audio file)
- Metadata-only library entries (no audio files) are excluded from the queue even when the list shows them
- Maintains the order tracks appear in the library (among playable tracks)

**Playlist Context**:
- When a user clicks play from a specific playlist
- Queue resets and loads all **playable** tracks from that playlist
- Metadata-only playlist entries are excluded from the queue
- Maintains the playlist's track order (among playable tracks)

**Key Behavior**: The queue always resets when switching between contexts (library ↔ playlist), ensuring users get the expected set of tracks.

#### 2. **Queue loading & navigation**

When playback starts, the selected track plays immediately while the full queue loads in the background:

**Full-track queue load**:
- Fetches all tracks for the context (`fields=full`) in pages of 100
- Includes audio file metadata needed for playback and the queue UI
- Runs after `setCurrentTrack` so the player appears without waiting for the full list

**Synchronous navigation**:
- Next, previous, and clicking another track in the list update the current track immediately
- No per-track async hop before switching — the queue is already in memory once loaded
- An epoch guard cancels stale playlist fetches if the user switches context mid-load

**Virtual Scrolling** (queue sheet only):
- The queue UI uses virtual scrolling technology
- Only visible tracks are rendered in the DOM
- Enables smooth scrolling through thousands of tracks without performance degradation
- Automatically renders more items as user scrolls

#### 3. **Queue Management Features**

**View Queue**:
- Click the queue button (list icon) in the audio player
- Opens a bottom sheet showing all tracks in the queue
- Displays track count: "Queue (69 tracks)"
- Auto-scrolls to currently playing track when opened
- Highlights the current track with visual indicators

**Remove Tracks**:
- Each track in the queue has a remove button
- Supports duplicate tracks (same track can appear multiple times)
- Removing a track updates the queue immediately
- If current track is removed, automatically plays next available track

**Per-track queue actions** (library and user playlist track row menus):
- **Play next**: When the player is active, inserts the track immediately after the currently playing track (no auto-play of the inserted track). When nothing is playing, starts playback of the selected track (same as clicking the row).
- **Add to Queue**: Appends the track to the end of the queue without starting playback (same behavior as bulk "Add to Queue" on playlist pages).
- Both actions are only shown for tracks with archived audio files (playable tracks).
- Success toasts confirm the action; menu clicks do not trigger row click-to-play.

**Track Identification**:
- Tracks are identified by both ID and position
- Allows the same track to appear multiple times in the queue
- Ensures accurate removal and navigation

#### 4. **Queue Navigation**

**Next Track**:
- Advances to the next track in the queue
- Respects loop and shuffle modes
- If at end of queue:
  - Loop Off: Stops playback
  - Loop All: Wraps to first track
  - Shuffle: Picks random track

**Previous Track**:
- Goes back to the previous track
- Respects loop and shuffle modes
- If at beginning of queue:
  - Loop Off: Does nothing
  - Loop All: Wraps to last track
  - Shuffle: Picks random track

**Shuffle Mode**:
- When enabled, next/previous buttons pick random tracks
- Never repeats the current track
- Works with all loop modes

**Loop Modes**:
- **Loop Off**: Normal sequential playback, stops at end
- **Loop All**: Continuous playback, wraps to beginning when reaching end
- **Loop One**: Repeats current track indefinitely (restarts on next/previous)

---

## User Flows

### Flow 1: Playing from Library

1. User browses their music library
2. User clicks "Play" on any track
3. **System Behavior**:
   - Audio player appears at bottom
   - Selected track begins playing immediately
   - Queue resets (if previously had different context)
   - All library tracks load in the background (`fields=full`, paginated)
4. User can:
   - Navigate through entire library using next/previous
   - Open queue to see all library tracks
   - Remove tracks from queue
   - Use shuffle/loop modes

### Flow 2: Playing from Playlist

1. User opens a playlist
2. User clicks "Play" on any track in the playlist
3. **System Behavior**:
   - Audio player appears at bottom
   - Selected track begins playing immediately
   - Queue resets (if previously had different context)
   - All playlist tracks load in the background (`fields=full`, paginated)
4. User can:
   - Navigate through entire playlist using next/previous
   - Open queue to see all playlist tracks
   - Remove tracks from queue
   - Use shuffle/loop modes

### Flow 3: Switching Contexts

1. User is playing from library (queue has library tracks)
2. User opens a playlist and clicks "Play"
3. **System Behavior**:
   - Queue resets completely
   - Library tracks are cleared
   - New track begins playing immediately
   - Playlist tracks load in the background

### Flow 4: Queue Management

1. User has queue open (showing all tracks)
2. User scrolls through queue (virtual scrolling handles large lists)
3. User clicks remove on a track
4. **System Behavior**:
   - Track is removed from queue
   - If removed track was current: automatically plays next track
   - If removed track was before current: current index adjusts
   - Queue updates immediately

### Flow 5: Auto-Scroll to Current Track

1. User is playing track #45 in a 100-track queue
2. User opens queue
3. **System Behavior**:
   - Queue opens showing all tracks
   - Automatically scrolls to track #45
   - Centers current track in viewport
   - Highlights current track visually

---

## Visual Design & User Experience

### Audio Player UI

**Layout** (Left to Right):
1. **Left Section**: Track thumbnail + title/artist
2. **Center Section**: Playback controls + progress bar
3. **Right Section**: Queue button + loop + shuffle + download + close

**Visual States**:
- **Loop Button**:
  - Off: Muted gray, hover effect
  - All: Primary color with background highlight
  - One: Primary color with background highlight + "1" badge
- **Shuffle Button**:
  - Off: Muted gray, hover effect
  - On: Primary color with background highlight
- **Play/Pause Button**:
  - Large, prominent, always visible
  - Icon changes based on playback state

### Queue UI

**Queue Sheet**:
- Opens from bottom (80% viewport height)
- Shows track count in header
- Empty state message when no tracks
- Smooth scrolling with virtual list

**Track Items**:
- Thumbnail (or placeholder icon)
- Title and artist
- Remove button (trash icon)
- Current track highlighted:
  - Background color highlight
  - Left border accent
  - Play icon badge on thumbnail

**Performance**:
- Smooth scrolling even with 5,000+ tracks (virtual list in the queue sheet)
- Responsive interactions

---

## Technical Performance Features

### 1. **Paginated queue fetch**
- Loads tracks in pages of 100 until the full context list is in memory
- Playlist fetch uses an epoch guard so stale responses are ignored after context switches

### 2. **Presigned URL playback**
- Audio `src` is set only after the server returns the stream URL for the current track
- Prevents auto-play from firing on a previous track's URL during fast navigation (React `useEffect` cleanup / ignore-flag pattern)

### 3. **Virtual Scrolling**
- Renders only visible items
- Handles unlimited track counts
- Smooth scrolling performance
- Minimal DOM footprint

---

## Edge Cases & Special Behaviors

### Duplicate Tracks
- Same track can appear multiple times in queue
- Each instance is tracked by position
- Removal affects only the specific instance
- Navigation works correctly with duplicates

### Empty Queue
- Shows empty state message
- Disables navigation buttons
- Prevents playback errors

### Track Without Audio Files
- Player doesn't appear if no audio available
- Graceful handling of missing files
- User sees appropriate feedback

### Browser Autoplay Restrictions
- Respects browser autoplay policies (`play()` returns a Promise; may reject with `NotAllowedError`)
- Requires user interaction for initial play in many browsers
- Handles autoplay prevention gracefully (play button remains available)
- Play button works immediately after user interaction

### Large Library Performance
- Tested with 5,000+ tracks
- Queue loads in < 2 seconds
- Smooth scrolling maintained
- No performance degradation

---

## User Benefits

1. **Seamless Experience**: Play from anywhere, queue manages context automatically
2. **Fast start**: Playback begins on the selected track while the full queue loads in the background
3. **Full Control**: Easy queue management, shuffle, loop modes
4. **Visual Clarity**: Clear indicators for current track, loop/shuffle states
5. **Efficient Navigation**: Auto-scroll to current track, easy browsing
6. **Flexible Playback**: Multiple loop modes, shuffle, easy track removal

---

## Future Enhancement Opportunities

1. **Queue Persistence**: Save queue state across sessions
2. **Queue Reordering**: Drag-and-drop to reorder tracks
3. **Queue History**: View recently played tracks
4. **Smart Queue**: AI-suggested next tracks
5. **Queue Sharing**: Share queue with other users
6. **Queue Export**: Export queue as playlist
7. **Cross-Device Sync**: Continue playback on different devices

---

## Summary

The audio player and queue system provide a modern, efficient music playback experience that scales from small playlists to massive music libraries. The context-aware design ensures users always get the expected tracks when playing from different sources, while performance optimizations ensure smooth operation regardless of library size. The intuitive UI and comprehensive controls give users full control over their listening experience.

