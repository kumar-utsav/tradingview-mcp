import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildReplayLedger} from '../src/core/replay-capture.js';
import {expectedReplayFeeLedger, REPLAY_FEE_MODEL} from '../src/core/replay-fee-expectations.js';

test('capture loads with only the existing ledger dependency and no server fee module', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'capture-no-server-fees-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'backend/utils'), {recursive: true});
  const sourceRoot = process.env.TRADING_PROJECT_ROOT || path.resolve('..', 'trading');
  await copyFile(path.join(sourceRoot, 'backend/utils/replayLedger.js'), path.join(root, 'backend/utils/replayLedger.js'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const m = await import('./src/core/replay-capture.js'); if (typeof m.buildReplayLedger !== 'function' || !m.REPLAY_FEE_MODEL) process.exit(1)"],
  {env: {...process.env, TRADING_PROJECT_ROOT: root}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('fee read-back expectations preserve source evidence and count contracts once', async () => {
  const snapshot = JSON.parse(await readFile(new URL('./fixtures/replay-mes-scale.json', import.meta.url)));
  const ledger = buildReplayLedger(snapshot, '2026-09-01');
  const before = structuredClone(ledger);
  const expected = expectedReplayFeeLedger(ledger, {id: REPLAY_FEE_MODEL, request_id: 'test', applied_at: '2026-11-06T00:00:00Z'});
  assert.deepEqual(ledger, before);
  assert.equal(expected.net_pnl, 275.6);
  assert.equal(expected.trades.reduce((n, t) => n + t.commission, 0), 21.9);
  for (const trade of expected.trades) {
    for (const lot of trade.matched_lots) {
      assert.equal(lot.commission, Math.round(lot.quantity * 146) / 100);
      assert.equal(lot.net_pnl, Math.round((lot.gross_pnl - lot.commission) * 100) / 100);
    }
  }
  assert.throws(() => expectedReplayFeeLedger(ledger, {id: 'unknown'}), /Supported replay fee model/);
});
