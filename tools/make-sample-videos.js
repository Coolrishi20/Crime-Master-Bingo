#!/usr/bin/env node
/* Generates royalty-free test music videos (colour bars + tone + burned-in title)
 * with ffmpeg, tagged with title/artist metadata. For testing only.
 * Usage: node tools/make-sample-videos.js <outDir> [count=45] [seconds=8] */
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const out = path.resolve(process.argv[2] || 'sample-videos');
const count = Number(process.argv[3] || 45); const secs = Number(process.argv[4] || 8);
fs.mkdirSync(out, { recursive: true });
const A = ['Neon', 'Midnight', 'Velvet', 'Electric', 'Golden', 'Crimson', 'Silver', 'Cosmic', 'Wild', 'Lonely', 'Dancing', 'Burning', 'Summer', 'Crystal', 'Broken'];
const B = ['Heart', 'Highway', 'Dreams', 'Lights', 'Thunder', 'River', 'Paradise', 'Shadows', 'Fever', 'Echoes', 'Rain', 'Skyline', 'Rhythm', 'Horizon', 'Disco'];
const ART = ['The Sample Band', 'Test Pattern', 'DJ Placeholder', 'Lorem & Ipsum', 'The Demo Tapes', 'Synthwave Kid', 'Nova Lane', 'Echo Park Trio', 'Mira Sol', 'The Royalty Frees'];
for (let i = 0; i < count; i++) {
  const title = `${A[i % A.length]} ${B[(i * 7 + Math.floor(i / 15)) % B.length]}`;
  const artist = ART[i % ART.length];
  const file = path.join(out, `${artist} - ${title}.mp4`);
  if (fs.existsSync(file)) continue;
  const hue = (i * 37) % 360; const freq = 220 + (i * 23) % 440;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25,hue=h=${hue}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100`,
    '-t', String(secs),
    '-vf', `drawbox=x=0:y=560:w=1280:h=160:color=black@0.55:t=fill,drawtext=text='${title.replace(/'/g, '')}':fontcolor=white:fontsize=56:x=40:y=590,drawtext=text='${artist.replace(/'/g, '')}':fontcolor=0xffb6dc:fontsize=36:x=40:y=660`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', '-shortest',
    '-metadata', `title=${title}`, '-metadata', `artist=${artist}`, '-movflags', '+faststart', file]);
  process.stdout.write('.');
}
console.log(`\n${count} sample videos in ${out}`);
