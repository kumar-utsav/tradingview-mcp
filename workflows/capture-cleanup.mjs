import fs from 'node:fs/promises';
import path from 'node:path';
import {captureRoot, isWithin} from './capture-paths.mjs';

// Delete verified managed packs and legacy Desktop packs; retain incomplete runs.
export async function cleanupCompletedPack(pack, {desktopRoot='/Users/utsav/Desktop', managedRoot=captureRoot} = {}) {
  const absolute = path.resolve(pack);
  if (![desktopRoot, managedRoot].some(root => isWithin(root, absolute))) return false;
  let marker;
  for (const name of ['notes-only-complete.json','structured-complete.json']) {
    try { marker = JSON.parse(await fs.readFile(path.join(absolute,name),'utf8')); break; } catch {}
  }
  if (!marker || marker.status !== 'complete') return false;
  await fs.rm(absolute, {recursive:true, force:true});
  return true;
}
