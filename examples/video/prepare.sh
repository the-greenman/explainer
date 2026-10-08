#!/bin/sh
# Make working copies of the owner's clips (demo/video/, git-ignored): short GOP for responsive
# reverse/scrub, faststart, and the embedded mov_text subtitles extracted to WebVTT.
# Then compile ONE file, decision-records.mp4 (intro then purpose, stream copy) plus ONE
# decision-records.vtt, so the segments are in/out cuts of a single file and crossing the cut does not reload.
set -e
cd "$(dirname "$0")/../../demo/video"
enc() { # $1 source, $2 output stem
  ffmpeg -y -v error -i "$1" -map 0:v:0 -map 0:a:0 -c:v libx264 -g 15 -keyint_min 15 -crf 22 -c:a aac -movflags +faststart "$2.mp4"
  ffmpeg -y -v error -i "$1" -map 0:s:0 "$2.vtt"
}
enc decision_recording_intro intro
enc decision_recording_purpose.mp4 purpose

# concat demuxer + stream copy works because both encodes share codec parameters
printf "file 'intro.mp4'\nfile 'purpose.mp4'\n" > concat.txt
ffmpeg -y -v error -f concat -safe 0 -i concat.txt -c copy -movflags +faststart decision-records.mp4

# Where purpose starts in the combined file: the first video packet of purpose, i.e. the intro's video duration.
# (Printed so the manifest `in`/`out` can be checked against it.)
START=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 intro.mp4)
echo "purpose starts at $START s in decision-records.mp4"
# combined captions: intro cues as-is, purpose cues shifted by START
node -e '
const fs = require("fs");
const parse = (s) => { const m = s.match(/(?:(\d+):)?(\d+):(\d+)\.(\d+)/); return (+(m[1]||0))*3600 + +m[2]*60 + +m[3] + +m[4]/1000; };
const fmt = (x) => { const h = Math.floor(x/3600), m = Math.floor(x%3600/60), s = x - h*3600 - m*60; return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+s.toFixed(3).padStart(6,"0"); };
const shift = (txt, off) => txt.replace(/^WEBVTT\s*/, "").replace(/(\S+) --> (\S+)/g, (_, a, b) => `${fmt(parse(a)+off)} --> ${fmt(parse(b)+off)}`).trim();
const off = parseFloat(process.argv[1]);
fs.writeFileSync("decision-records.vtt", "WEBVTT\n\n" + shift(fs.readFileSync("intro.vtt","utf8"), 0) + "\n\n" + shift(fs.readFileSync("purpose.vtt","utf8"), off) + "\n");
' "$START"
ls -l intro.* purpose.* decision-records.*
