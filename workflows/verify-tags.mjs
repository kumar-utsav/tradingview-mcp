import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapConcurrent } from './concurrency.mjs';

export const sameTags = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export function isoDate(value) {
  const s=String(value||''),m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date=m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:s;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw Error('Invalid date');
  return date;
}
export const planDay=(trades,date)=>trades.filter(trade=>isoDate(trade.chart_date ?? trade.date)===isoDate(date)).sort((a,b)=>String(a.entry_candle||a.time||'').localeCompare(String(b.entry_candle||b.time||''))||a.id-b.id);
const apiClient=(base,request)=>async route=>{const response=await request(base+route,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`HTTP ${response.status} on ${route}`);return response.json();};
export function reviewTemplate(records,groups) {
  const group_review=Object.fromEntries(groups.filter(group=>group.is_active_checklist).map(group=>[group.id,'']));
  return {trades:records.map(trade=>({id:trade.id,expected_tags:[...(trade.tags||[])],expected_notes:trade.notes,tags:[...(trade.tags||[])],chart_reviewed:false,evidence:{},group_review:{...group_review}}))};
}
async function readDay(date,{base,request}) {
  date=isoDate(date);const get=apiClient(base,request);
  const [all,tags,groups,notes]=await Promise.all(['/backtest/','/tags/?page_type=backtest','/tags/groups?page_type=backtest','/backtest/daily-notes'].map(get));
  if (!Array.isArray(notes)) throw Error('Daily notes response must be an array');
  const matches=notes.filter(note=>isoDate(note.date)===date);
  if(matches.length>1)throw Error(`Duplicate daily notes for ${date}`);
  const daily_note=matches[0] ?? null;
  return {date,captured_at:new Date().toISOString(),trades:planDay(all,date),tags,groups,daily_note};
}
async function saveImages(snapshot,dir,{base,request,prefix='trade',imageConcurrency=4}) {
  const get=apiClient(base,request),failures=[];
  await mapConcurrent(snapshot.trades,imageConcurrency,async trade=>{try{const payload=await get(`/backtest/${trade.id}/image`);const image=Buffer.from(String(payload.chart||'').replace(/^data:[^,]+,/,''),'base64');if(!image.length)throw Error('empty chart');await fs.writeFile(path.join(dir,`${prefix}-${trade.id}.png`),image,{flag:'wx'});}catch(error){failures.push({id:trade.id,reason:error.message});}});
  return failures.sort((a,b)=>a.id-b.id);
}
export async function snapshotDay(date,dir,{base,request=fetch,imageConcurrency=4}={}) {
  await fs.mkdir(path.dirname(path.resolve(dir)),{recursive:true});await fs.mkdir(dir);
  const snapshot=await readDay(date,{base,request});snapshot.image_failures=await saveImages(snapshot,dir,{base,request,prefix:'before',imageConcurrency});
  await fs.writeFile(path.join(dir,'before.json'),JSON.stringify(snapshot,null,2),{flag:'wx'});
  return {date:snapshot.date,trade_count:snapshot.trades.length,image_failures:snapshot.image_failures};
}
export function reviewContext(current) {
  const active=current.groups.filter(group=>group.is_active_checklist);
  const activeIds=new Set(active.map(group=>group.id));
  const savedKeys=new Set(current.trades.flatMap(trade=>trade.tags||[]));
  const byGroup=new Map();
  for(const tag of current.tags){
    if(!byGroup.has(tag.group_id))byGroup.set(tag.group_id,[]);
    byGroup.get(tag.group_id).push(tag);
  }
  return {
    date:current.date,trades:current.trades,daily_note:current.daily_note,
    image_failures:current.image_failures,
    checklist:active.map(group=>({
      id:group.id,name:group.name,selection_mode:group.selection_mode,
      tags:(byGroup.get(group.id)||[]).map(({key,label,description})=>({key,label,description})),
    })),
    other_saved_tags:current.tags
      .filter(tag=>!activeIds.has(tag.group_id)&&savedKeys.has(tag.key))
      .map(({key,label,description,group_id})=>({key,label,description,group_id})),
  };
}
export async function prepareDay(date,dir,{base,request=fetch,imageConcurrency=4}={}) {
  const current=await readDay(date,{base,request});current.image_failures=await saveImages(current,dir,{base,request,imageConcurrency});
  const template=reviewTemplate(current.trades,current.groups);
  await fs.writeFile(path.join(dir,'current.json'),JSON.stringify(current,null,2),{flag:'wx'});
  await fs.writeFile(path.join(dir,'review.template.json'),JSON.stringify(template,null,2),{flag:'wx'});
  await fs.writeFile(path.join(dir,'review-context.json'),JSON.stringify(reviewContext(current),null,2),{flag:'wx'});
  return {date:current.date,trade_count:current.trades.length,review_template:path.resolve(dir,'review.template.json'),image_failures:current.image_failures};
}

// Offline validation is only a plan check. Apply still reloads live catalog and
// records, checks concurrency before every write, and independently reads back.
export function validateSnapshot(manifest,snapshot) {
  if(!Array.isArray(manifest.trades)||!manifest.trades.length)throw Error('Review trades required');
  if(new Set(manifest.trades.map(t=>t.id)).size!==manifest.trades.length)throw Error('Duplicate trade IDs');
  const records=new Map(snapshot.trades.map(trade=>[trade.id,trade]));
  if(records.size!==manifest.trades.length||manifest.trades.some(r=>!records.has(r.id)))throw Error('Snapshot review must cover every dated trade');
  for(const review of manifest.trades)validateReview(review,records.get(review.id),snapshot.tags,snapshot.groups);
  return {mode:'validate',validated:true,live_verified:false,results:manifest.trades.map(r=>({id:r.id,tag_count:r.tags.length,action:sameTags(r.expected_tags,r.tags)?'unchanged':'would_save'}))};
}
export function validateReview(review, current, catalog, groups) {
  if (!Number.isSafeInteger(review.id) || !current || review.id !== current.id) throw new Error('Unknown trade');
  if (!Array.isArray(review.tags) || !Array.isArray(review.expected_tags) || !review.tags.every(k => typeof k === 'string')) throw new Error('Tag arrays required');
  if (new Set(review.tags).size !== review.tags.length) throw new Error('Duplicate tags');
  if (!sameTags(review.expected_tags, current.tags || []) || review.expected_notes !== current.notes) throw new Error(`Trade ${review.id} changed since review; reread before saving`);
  if (review.chart_reviewed !== true) throw new Error('Chart review required');
  const usedGroups = new Set();
  for (const key of review.tags) {
    const tag = catalog.find(t => t.key === key);
    if (!tag) throw new Error(`Unknown tag ${key}`);
    if (typeof review.evidence?.[key] !== 'string' || !review.evidence[key].trim()) throw new Error(`Evidence missing: ${key}`);
    const group = groups.find(g => g.id === tag.group_id);
    if (group?.selection_mode === 'single' && usedGroups.has(group.id)) throw new Error(`Conflicting selections: ${group.name}`);
    if (group?.selection_mode === 'single') usedGroups.add(group.id);
  }
  for (const g of groups.filter(g => g.is_active_checklist)) {
    if (typeof review.group_review?.[g.id] !== 'string' || !review.group_review[g.id].trim()) throw new Error(`Group not reviewed: ${g.name}`);
  }
  for (const range of ['premarket', 'prior_day']) {
    if (review.tags.includes(`bt_position_inside_${range}`) && review.tags.includes(`bt_position_outside_${range}`)) throw new Error(`Contradictory ${range} position`);
  }
  if (review.tags.includes('bt_review_invalid') && !review.tags.some(k => k.startsWith('bt_issue_'))) throw new Error('Invalid setup requires a specific issue');
}

export async function runReview(manifest, { base, apply = false, request = fetch } = {}) {
  const get=apiClient(base,request);
  if (!Array.isArray(manifest.trades) || !manifest.trades.length) throw new Error('Review trades required');
  if (new Set(manifest.trades.map(t => t.id)).size !== manifest.trades.length) throw new Error('Duplicate trade IDs');
  const [trades, tags, groups] = await Promise.all(['/backtest/', '/tags/?page_type=backtest', '/tags/groups?page_type=backtest'].map(get));
  // Validate the whole plan before any writes. PUT has no compare-and-swap API;
  // recheck immediately before each write and stop if a concurrent edit is seen.
  for (const r of manifest.trades) validateReview(r, trades.find(t => t.id === r.id), tags, groups);
  const results = [];
  for (const r of manifest.trades) {
    const original = trades.find(t => t.id === r.id);
    const changed = !sameTags(original.tags, r.tags);
    if (apply && changed) {
      const fresh = (await get('/backtest/')).find(t => t.id === r.id);
      validateReview(r, fresh, tags, groups);
      const response = await request(`${base}/backtest/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propName: 'tags', value: r.tags }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Save failed for ${r.id}: HTTP ${response.status}`);
    }
    results.push({ id: r.id, tag_count: r.tags.length, action: changed ? (apply ? 'saved' : 'would_save') : 'unchanged' });
  }
  const saved = await get('/backtest/');
  for (const r of manifest.trades) {
    const actual = saved.find(t => t.id === r.id);
    const wanted = apply ? r.tags : r.expected_tags;
    if (!actual || !sameTags(actual.tags, wanted) || actual.notes !== r.expected_notes) throw new Error(`Read-back mismatch for ${r.id}`);
  }
  return { mode: apply ? 'apply' : 'dry_run', verified: true, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command,arg,dir]=process.argv.slice(2),base=(process.env.TRADING_API_URL||'http://100.125.89.9:5555').replace(/\/$/,'');let result;
  if(command==='snapshot')result=await snapshotDay(arg,dir,{base});
  else if(command==='prepare')result=await prepareDay(arg,dir,{base});
  else if(command==='validate')result=validateSnapshot(JSON.parse(await fs.readFile(arg,'utf8')),JSON.parse(await fs.readFile(dir,'utf8')));
  else {if(!command)throw Error('Usage: verify-tags.mjs snapshot YYYY-MM-DD new-run-directory | prepare YYYY-MM-DD run-directory | validate manifest.json current.json | manifest.json [--apply]');const manifest=JSON.parse(await fs.readFile(command,'utf8'));result=await runReview(manifest,{base,apply:process.argv.includes('--apply')});}
  const outputDir=['snapshot','prepare'].includes(command)?dir:command==='validate'?path.dirname(path.resolve(arg)):path.dirname(path.resolve(command));
  await fs.writeFile(path.join(outputDir,`${result.mode||command}-result.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result, null, 2));
}
