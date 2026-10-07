import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPack,resumePack,parseNotes} from './journal-pack.mjs';
import {reviewTemplate} from './journal-capture.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
const date='2026-10-06',start=Date.parse(`${date}T13:46:00Z`)/1000;
const write=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2));
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-pack-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const trade={id:2938,ticker:'SPY',type:'Call',date,entry_candle:'06:46',time_frame:1,outcome:'Win',quantity:1,profit_loss:20,notes:'<p>Original</p>',tags:['old'],has_chart:false,rr:null,transactions:[{side:'BUY',quantity:1,price:1,filledTime:`${date}T13:47:07Z`},{side:'SELL',quantity:1,price:1.2,filledTime:`${date}T13:50:06Z`}]};
  const snapshot={date,trades:[trade],tags:[{key:'old',group_id:22,page_type:'journal'}],groups:[{id:22,name:'Setup'}],chart_hashes:{2938:null}};
  const review=reviewTemplate(snapshot,dir),r=review.trades[0],a=r.chart_annotations;
  Object.assign(r,{chart_reviewed:true,rr:2,rr_evidence:'Native position-p label Risk/reward ratio: 2'});
  Object.assign(a,{position_entity_id:'position-p',position_rr:{entity_id:'position-p',source:'tradingview_position_tool_label',label:'Risk/reward ratio: 2',value:2,compact:false},position_start_candle_time:start,position_end_candle_time:start+240,position_mfe_candle_time:start+120,position_entry_price:100,position_target_price:101,position_stop_price:99.5,view_preserved:true,visible_range:{from:start-300,to:start+600},position_created_before_markers:true,markers_brought_to_front:true,overlap_checked:true,screenshot_after_annotations:true,commentary_free:true});
  a.transaction_markers.forEach((m,i)=>m.entity_id=`marker-${i}`);
  await fs.writeFile(r.chart_path,image);
  const bars=[100,100.4,101,100.8,100.6].map((high,i)=>({time:start+i*60,open:99.9,high,low:99.7,close:100,volume:10}));
  const evidence={date,captured_at:`${date}T15:00:00Z`,sources:[{ticker:'AMEX:SPY',time_frame:1,bars,drawings:[],indicators:{},ranges:Object.fromEntries(['pm','pd','5m','15m'].map(k=>[k,{status:'unknown',reason:'Not present in this bounded fixture'}]))}]};
  const release={chart_restored:true,user_drawings_preserved:true,temporary_annotations_removed:true,tradingview_released:true};
  const config={};for(const [key,value] of Object.entries({snapshot,review,evidence,release})){config[`${key}_path`]=path.join(dir,key+'.json');await write(config[`${key}_path`],value);}
  return {dir,pack:path.join(dir,'pack'),snapshot,review,evidence,release,config};
}
test('seals accepted screenshots and resumes completely offline with fresh notes/catalog',async t=>{
  const f=await fixture(t),created=await createPack(f.config,f.pack);
  assert.equal(created.tradingview_released,true);assert.deepEqual(created.ordered.map(x=>x.trade_id),[2938]);
  assert.deepEqual(await fs.readFile(path.join(f.pack,'trade-2938.png')),image);
  await fs.writeFile(path.join(f.pack,'notes.md'),`# Journal notes ${date}\n\n## Trade 1 | ID 2938\n\nWaited for retest.\n\n## Day\n\nAvoid P/L decisions.\n`);
  const fresh=structuredClone(f.snapshot);fresh.groups.push({id:23,name:'New management group'});fresh.tags.push({key:'new',group_id:23});fresh.trades[0].tags=['new'];fresh.trades[0].notes='<p>Newer manual note</p>';
  const freshPath=path.join(f.dir,'fresh.json');await write(freshPath,fresh);
  const output=path.join(f.dir,'offline-review.json'),result=await resumePack(f.pack,freshPath,output),review=JSON.parse(await fs.readFile(output));
  assert.equal(result.tradingview_used,false);assert.equal(result.tag_review_required,true);assert.equal(result.daily_notes_pending,true);
  assert.equal(review.trades[0].rr,2);assert.equal(review.trades[0].notes_append,'Waited for retest.');assert.deepEqual(review.trades[0].tags,['new']);assert.equal(review.trades[0].group_review[23],'');assert.equal(review.snapshot_path,freshPath);
  assert.equal(review.notes_input.daily,'Avoid P/L decisions.');
  await assert.rejects(createPack(f.config,f.pack),/EEXIST/);
});
test('does not seal unreviewed screenshots or a chart that is still occupied',async t=>{
  const f=await fixture(t);f.review.trades[0].chart_annotations.commentary_free=false;await write(f.config.review_path,f.review);
  await assert.rejects(createPack(f.config,f.pack),/commentary-free/);
  f.review.trades[0].chart_annotations.commentary_free=true;await write(f.config.review_path,f.review);f.release.tradingview_released=false;await write(f.config.release_path,f.release);
  await assert.rejects(createPack(f.config,f.pack),/release verification/);
  await assert.rejects(fs.stat(f.pack),/ENOENT/);
});
test('changed fills and manual server charts require recapture coordination',async t=>{
  const f=await fixture(t);await createPack(f.config,f.pack);const notes=path.join(f.dir,'notes.json');await write(notes,{date,trades:[{number:1,trade_id:2938,text:'',no_note:true}]});
  const freshPath=path.join(f.dir,'fresh.json'),fresh=structuredClone(f.snapshot);fresh.trades[0].transactions[0].filledTime=`${date}T13:48:07Z`;await write(freshPath,fresh);
  await assert.rejects(resumePack(f.pack,freshPath,path.join(f.dir,'review.json'),notes),/Imported trade changed/);
  fresh.trades=structuredClone(f.snapshot.trades);fresh.chart_hashes[2938]='manual-chart';await write(freshPath,fresh);
  await assert.rejects(resumePack(f.pack,freshPath,path.join(f.dir,'review.json'),notes),/Journal chart changed/);
});
test('protects cached image and source evidence integrity',async t=>{
  const f=await fixture(t);await createPack(f.config,f.pack);const freshPath=path.join(f.dir,'fresh.json');await write(freshPath,f.snapshot);
  await fs.writeFile(path.join(f.pack,'trade-2938.png'),Buffer.from('broken'));
  await assert.rejects(resumePack(f.pack,freshPath,path.join(f.dir,'review.json')),/Cached PNG changed/);
  await fs.writeFile(path.join(f.pack,'trade-2938.png'),image);await write(path.join(f.pack,'evidence.json'),{});
  await assert.rejects(resumePack(f.pack,freshPath,path.join(f.dir,'review.json')),/Sealed capture evidence changed/);
});
test('routes exact frozen ordinals and requires explicit no-note instead of empty templates',async t=>{
  const state={date,ordered:[{number:1,trade_id:2938},{number:2,trade_id:2940}]};
  const n=parseNotes(`# Journal notes ${date}\n## Trade 2 | ID 2940\nSecond\n## Trade 1 | ID 2938\nNO NOTE\n## Day\nDaily`,state);
  assert.deepEqual(n.trades.map(x=>[x.trade_id,x.text,x.no_note]),[[2940,'Second',false],[2938,'',true]]);
  assert.throws(()=>parseNotes(`# Journal notes ${date}\n## Trade 1 | ID 2940\nWrong`,state),/mismatch/);
  assert.throws(()=>parseNotes(`# Journal notes ${date}\n## Trade 1 | ID 2938\nOne\n## Trade 1 | ID 2938\nDuplicate`,state),/duplicate/);
  const f=await fixture(t);await createPack(f.config,f.pack);const freshPath=path.join(f.dir,'fresh.json');await write(freshPath,f.snapshot);
  await assert.rejects(resumePack(f.pack,freshPath,path.join(f.dir,'review.json')),/Missing or conflicting notes/);
});
test('rerun preserves an exact note already saved without appending it twice',async t=>{
  const f=await fixture(t);await createPack(f.config,f.pack);const fresh=structuredClone(f.snapshot);fresh.trades[0].notes='<p>Original</p><p>Risk &amp; retest</p>';const freshPath=path.join(f.dir,'fresh.json');await write(freshPath,fresh);
  const notes=path.join(f.dir,'notes.json');await write(notes,{date,trades:[{number:1,trade_id:2938,text:'Risk & retest',no_note:false}]});
  const output=path.join(f.dir,'resumed-review.json');await resumePack(f.pack,freshPath,output,notes);
  assert.equal('notes_append' in JSON.parse(await fs.readFile(output)).trades[0],false);
});
test('rejects cached evidence that uses post-exit extrema or the wrong PD date',async t=>{
  const f=await fixture(t);f.review.trades[0].chart_annotations.position_target_price=102;await write(f.config.review_path,f.review);
  await assert.rejects(createPack(f.config,f.pack),/entry\/MFE mismatch/);
  f.review.trades[0].chart_annotations.position_target_price=101;await write(f.config.review_path,f.review);
  f.evidence.sources[0].ranges.pd={status:'complete',source:'fixture',date,from:start-600,to:start-300,low:98,high:100,bar_count:5};await write(f.config.evidence_path,f.evidence);
  await assert.rejects(createPack(f.config,f.pack),/Wrong cached range date/);
});
