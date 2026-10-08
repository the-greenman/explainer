#!/bin/sh
# Make working copies of the owner's clips (demo/video/, git-ignored): short GOP for responsive
# reverse/scrub, faststart, and the embedded mov_text subtitles extracted to WebVTT.
set -e
cd "$(dirname "$0")/../../demo/video"
enc() { # $1 source, $2 output stem
  ffmpeg -y -v error -i "$1" -map 0:v:0 -map 0:a:0 -c:v libx264 -g 15 -keyint_min 15 -crf 22 -c:a aac -movflags +faststart "$2.mp4"
  ffmpeg -y -v error -i "$1" -map 0:s:0 "$2.vtt"
}
enc decision_recording_intro intro
enc decision_recording_purpose.mp4 purpose
ls -l intro.* purpose.*
