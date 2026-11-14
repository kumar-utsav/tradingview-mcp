#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { replayWithAnnotations } from '../src/core/replay-annotations.js';
import { disconnect } from '../src/connection.js';

const configPath = process.env.REPLAY_BRIDGE_CONFIG || `${homedir()}/.config/tradingview-mcp/replay-bridge.json`;
const config = JSON.parse(await readFile(configPath, 'utf8'));
const base = new URL(config.backendUrl);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid backend URL');
if (typeof config.token !== 'string' || config.token.length < 32) throw Error('Replay bridge token is missing');
const instance = randomUUID();
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function post(path, body = {}) {
  const response = await fetch(new URL(`/tradingview-replay/bridge/${path}`, base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ ...body, instance }), signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `Replay server returned ${response.status}`);
  return data;
}
// A heartbeat never claims a job. Execution stays strictly sequential.
const heartbeat = setInterval(() => post('heartbeat').catch(() => {}), 3000);
console.log('TradingView replay helper started');
let lastError = '';
try {
  while (!stopping) {
    try {
      const { job } = await post('next');
      if (lastError) console.log('Replay server reconnected');
      lastError = '';
      if (!job) { await sleep(1000); continue; }
      let result, error;
      try {
        result = await replayWithAnnotations(job.plan);
        console.log(`Opened ${job.plan.symbol}: ${job.plan.targetLabel}`);
      } catch (failure) { error = failure.message; console.error(`Replay failed: ${error}`); }
      // Retry acknowledgment only: never repeat a chart mutation after a network failure.
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await post(`${job.id}/complete`, { result, error }); break; }
        catch (failure) { if (attempt === 2) throw failure; await sleep(1000); }
      }
    } catch (failure) {
      if (lastError !== failure.message) console.error(`Replay helper: ${failure.message}`);
      lastError = failure.message;
      await sleep(3000);
    }
  }
} finally { clearInterval(heartbeat); await disconnect(); }
