#!/bin/sh
# Makes the neutral test video for the media-slot example: 12 s of ffmpeg testsrc2 (a moving pattern with a running clock) and a tone.
# Output: demo/media/slots.mp4 (git-ignored). 0.5 s keyframes and faststart, like the working copies of examples/video.
set -e
cd "$(dirname "$0")/../.."
mkdir -p demo/media
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" \
  -f lavfi -i "sine=frequency=330:duration=12" \
  -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p -g 15 -keyint_min 15 -sc_threshold 0 \
  -c:a aac -b:a 64k -movflags +faststart -shortest \
  demo/media/slots.mp4
ls -l demo/media/slots.mp4
