// Download Generic JB2A Loop clips used as persistent-zone overlays.
// Usage: node scripts/bundle-zone-loops.mjs
import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {zoneLoopDownloads, animationSourceRevision} from '../dist/zone-loop-catalog.mjs';

const exec = promisify(execFile);
const base = new URL('../dist/', import.meta.url);
const creditsFile = new URL('assets/animations/credits.json', base);
const credits = JSON.parse(await readFile(creditsFile, 'utf8'));
const pending = zoneLoopDownloads.filter((clip) => clip.source && !credits.clips.some((entry) => entry.id === clip.id));

console.log(`Bundling ${pending.length} zone-loop clips (revision ${animationSourceRevision}).`);

let index = 0;
async function worker() {
  while (index < pending.length) {
    const clip = pending[index++];
    const relative = 'assets/animations/' + clip.id + '.webm';
    const path = new URL(relative, base);
    const temporary = new URL(relative + '.download', base);
    try {
      await exec('curl', ['--fail', '-sL', '--retry', '2', '--retry-all-errors', '--retry-delay', '1',
        '--connect-timeout', '15', '--max-time', '90', '--max-filesize', '25000000', clip.source, '-o', fileURLToPath(temporary)]);
      const bytes = await readFile(temporary);
      const probe = JSON.parse((await exec('ffprobe', ['-v', 'quiet', '-show_format', '-of', 'json', fileURLToPath(temporary)])).stdout);
      await rename(temporary, path);
      credits.clips.push({
        id: clip.id,
        file: relative,
        source: clip.source,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        duration: Number(probe.format.duration),
      });
      console.log(clip.id + ': ' + bytes.length + ' bytes · ' + clip.spells.slice(0, 3).join(', '));
    } catch (error) {
      await rm(temporary, {force: true});
      throw error;
    }
  }
}

const results = await Promise.allSettled(Array.from({length: 2}, worker));
await writeFile(creditsFile, JSON.stringify(credits, null, 2) + '\n');
for (const result of results) if (result.status === 'rejected') throw result.reason;
console.log(credits.clips.length + ' credited local clips.');
