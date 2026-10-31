import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertCapturePath, isWithin} from './capture-paths.mjs';
import {cleanupCompletedPack} from './capture-cleanup.mjs';
import {freezeDay} from './backtest-freeze.mjs';
import {freezeReplayDay} from './replay-backtest-freeze.mjs';
import {createPack} from './journal-pack.mjs';
import {annotateSnapshot} from './journal-annotate.mjs';

test('capture entry points reject Desktop output before capture or filesystem writes', async () => {
  const directory = path.join(os.homedir(), 'Desktop', 'capture-guard-must-not-create');
  assert.throws(() => assertCapturePath(path.dirname(directory)), /off the Desktop/);
  for (const run of [
    () => freezeDay('2026-10-25', directory),
    () => freezeReplayDay('2026-10-25', directory),
    () => createPack({}, directory),
    () => annotateSnapshot('/missing-snapshot.json', {outputDir: directory}),
  ]) await assert.rejects(run, /off the Desktop/);
  await assert.rejects(fs.stat(directory), {code: 'ENOENT'});
  assert.equal(isWithin('/safe/root', '/safe/root/..'), false);
  assert.equal(isWithin('/safe/root', '/safe/root/../root-other'), false);
});

test('cleanup deletes only completed child packs in managed roots', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-paths-test-'));
  t.after(() => fs.rm(parent, {recursive:true, force:true}));
  const managedRoot = path.join(parent, 'managed'), desktopRoot = path.join(parent, 'desktop');
  const options = {managedRoot, desktopRoot};
  const complete = path.join(managedRoot, 'journal', 'complete');
  const pending = path.join(managedRoot, 'backtest', 'pending');
  const outside = path.join(parent, 'unmanaged');
  const legacy = path.join(desktopRoot, 'legacy');
  for (const directory of [complete, pending, outside, legacy]) await fs.mkdir(directory, {recursive:true});
  for (const directory of [complete, outside, legacy, managedRoot]) {
    await fs.writeFile(path.join(directory, 'notes-only-complete.json'), JSON.stringify({status:'complete'}));
  }
  assert.equal(await cleanupCompletedPack(pending, options), false);
  assert.equal(await cleanupCompletedPack(outside, options), false);
  assert.equal(await cleanupCompletedPack(managedRoot, options), false);
  assert.equal(await cleanupCompletedPack(complete, options), true);
  assert.equal(await cleanupCompletedPack(legacy, options), true);
  await fs.stat(pending);
  await fs.stat(outside);
  await assert.rejects(fs.stat(complete), {code:'ENOENT'});
});
