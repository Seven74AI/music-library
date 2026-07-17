#!/usr/bin/env python3
"""Generate 2-second silent MP3 test fixtures for E2E audio tests.

Requires ffmpeg. If ffmpeg is unavailable, falls back to a pre-generated
silent MP3 from the fixtures directory.
"""
import os
import shutil
import subprocess
import sys

OUT_DIR = 'tests/fixtures/uploaded/audio'
# All test keys used across E2E transport tests
TEST_KEYS = [
    'silence.mp3',
    'test-download.mp3',
    'test-keyboard.mp3',
    'test-loop.mp3',
    'test-mobile.mp3',
    'test-mutekey.mp3',
    'test-nowplaying.mp3',
    'test-playlist.mp3',
    'test-seek.mp3',
    'test-shuffle.mp3',
    'test-sleep.mp3',
    'test-transport.mp3',
    'test-volume.mp3',
]

os.makedirs(OUT_DIR, exist_ok=True)

# Try ffmpeg first
try:
    subprocess.run(
        ['ffmpeg', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
         '-t', '2', '-acodec', 'libmp3lame', '-b:a', '128k',
         '-y', '/tmp/silent-2s.mp3'],
        check=True, capture_output=True,
    )
    source = '/tmp/silent-2s.mp3'
    print('Generated 2s silent MP3 with ffmpeg')
except (subprocess.CalledProcessError, FileNotFoundError):
    # Fallback: copy the first existing MP3 as template
    existing = [f for f in TEST_KEYS if os.path.exists(os.path.join(OUT_DIR, f))]
    if existing:
        source = os.path.join(OUT_DIR, existing[0])
        print(f'ffmpeg not available, using existing: {source}')
    else:
        print('ERROR: ffmpeg not available and no existing MP3 fixtures', file=sys.stderr)
        sys.exit(1)

for key in TEST_KEYS:
    filepath = os.path.join(OUT_DIR, key)
    if os.path.exists(filepath):
        # Only overwrite if source is newer/different
        existing_size = os.path.getsize(filepath)
        source_size = os.path.getsize(source)
        if existing_size != source_size:
            shutil.copy2(source, filepath)
            print(f'Updated {filepath} ({existing_size} → {source_size} bytes)')
        else:
            print(f'Skipped {filepath} (already {source_size} bytes)')
    else:
        shutil.copy2(source, filepath)
        print(f'Created {filepath} ({os.path.getsize(filepath)} bytes)')

print('Done')
