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
test('does not seal identical screenshots for different imported trades',async t=>{
  const f=await fixture(t);
  const second=structuredClone(f.snapshot.trades[0]);second.id=2939;
  f.snapshot.trades.push(second);f.snapshot.chart_hashes[2939]=null;
  const row=structuredClone(f.review.trades[0]);row.id=2939;row.chart_path=path.join(f.dir,'trade-2939.png');
  f.review.trades.push(row);await fs.writeFile(row.chart_path,image);
  await write(f.config.snapshot_path,f.snapshot);await write(f.config.review_path,f.review);
  await assert.rejects(createPack(f.config,f.pack),/Duplicate journal trade screenshots/);
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

test('structured review metadata does not invalidate an otherwise unchanged captured journal trade',async t=>{const f=await fixture(t);f.config.questionnaire_version=1;await createPack(f.config,f.pack);const fresh=structuredClone(f.snapshot);fresh.trades[0].capture_review={version:1,revision:1,pack_id:path.basename(f.pack)};const file=path.join(f.dir,'fresh.json'),notes=path.join(f.dir,'notes.json');await write(file,fresh);await write(notes,{date,trades:[{number:1,trade_id:2938,text:'',no_note:true}]});await resumePack(f.pack,file,path.join(f.dir,'resumed.json'),notes);fresh.trades[0].capture_review.pack_id='manual-edit';await write(file,fresh);await assert.rejects(resumePack(f.pack,file,path.join(f.dir,'other.json'),notes),/Structured review changed/);});

test('notes-only journal pack saves supplied summaries, entry captures and daily notes without any checklist calls',async t=>{
 const {publishJournalNotes}=await import('./journal-notes.mjs');const {journalEntries}=await import('./journal-entries.mjs');
 const f=await fixture(t);f.config.notes_only=true;await createPack(f.config,f.pack);
 const state=JSON.parse(await fs.readFile(path.join(f.pack,'stage.json')));assert.equal(state.notes_only,true);assert.equal(state.entry_ordered.length,1);await assert.rejects(fs.stat(path.join(f.pack,'review-input.json')),/ENOENT/);
 const inputPath=path.join(f.pack,'notes-input.json'),input={date,user_finished:true,raw_dictation:'My exact source dictation.',trades:[{number:1,trade_id:2938,text:'- Waited for the retest.\n- Exited at the next zone.'}],daily:'- Followed the planned entry.'};await write(inputPath,input);
 const row=structuredClone(f.snapshot.trades[0]);let chart=null,entriesSaved=null,daily={date,notes:'<p>Existing day note</p>',external_resources:[{url:'https://example.com/existing'}]};const calls=[];
 const request=async(url,options={})=>{const route=new URL(url).pathname,c=options.body?JSON.parse(options.body):null;calls.push([route,options.method||'GET']);let result;
  if(route==='/journal/')result=[structuredClone(row)];
  else if(route==='/journal/daily-notes')result=[structuredClone(daily)];
  else if(route==='/journal/daily-notes/'+date){daily.notes=c.notes;result=daily;}
  else if(route==='/journal/2938/entry-captures'){
   const ledger=journalEntries(row);if(c)entriesSaved=c;
   result={...ledger,revision:entriesSaved?1:0,entries:ledger.entries.map(e=>({...e,rr:entriesSaved?.entries[0].rr??null,notes:entriesSaved?.entries[0].notes||'',stale:false}))};
  }else if(route.includes('/entry-captures/')&&route.endsWith('/image'))result={chart:entriesSaved.entries[0].screenshot.base64};
  else if(route==='/journal/2938/image')result={chart};
  else if(route==='/journal/2938'&&c){if(c.propName==='chart'){chart=c.value;row.has_chart=true;}else row[c.propName]=c.value;result=row;}
  else throw Error('Unexpected API call: '+route);
  return {ok:true,json:async()=>structuredClone(result)};
 };
 const first=await publishJournalNotes(f.pack,inputPath,{base:'http://fixture',request});assert.equal(first.status,'complete');assert.equal(first.entry_captures[0].entry_count,1);assert.equal(row.rr,2);assert.equal(row.profit_loss,20);assert.deepEqual(row.transactions,f.snapshot.trades[0].transactions);assert.deepEqual(row.tags,['old']);assert(row.notes.startsWith('<p>Original</p>'));assert(row.notes.includes('<ul>'));assert(daily.notes.startsWith('<p>Existing day note</p>'));assert.deepEqual(daily.external_resources,[{url:'https://example.com/existing'}]);assert(calls.every(([route])=>!route.includes('capture-review')&&!route.startsWith('/tags')));
 const oldNotes=row.notes;await publishJournalNotes(f.pack,inputPath,{base:'http://fixture',request});assert.equal(row.notes,oldNotes);
});

test('multi-entry pack seals separate journal tools, allocated fills and native RR; missing entry notes do not seal an input',async t=>{
 const {entryAnnotationSnapshot}=await import('./journal-entries.mjs');const {planAnnotation}=await import('./journal-annotate.mjs');const {publishJournalNotes}=await import('./journal-notes.mjs');
 const f=await fixture(t),parent=f.snapshot.trades[0];parent.quantity=2;parent.transactions.splice(1,0,{side:'BUY',quantity:1,price:1.1,filledTime:`${date}T13:48:07Z`});parent.transactions.at(-1).quantity=2;
 const original=f.review.trades[0],parentRow=reviewTemplate(f.snapshot,f.dir).trades[0];parentRow.chart_reviewed=true;parentRow.rr=original.rr;parentRow.rr_evidence=original.rr_evidence;parentRow.chart_annotations={...original.chart_annotations,transaction_markers:parentRow.chart_annotations.transaction_markers};parentRow.chart_annotations.transaction_markers.forEach((m,i)=>m.entity_id='parent-marker-'+i);f.review.trades=[parentRow];
 const views=entryAnnotationSnapshot(f.snapshot),entryReview=reviewTemplate(views.snapshot,f.dir);
 for(const [i,row] of entryReview.trades.entries()){
  const plan=planAnnotation(views.snapshot.trades[i],f.evidence.sources[0].bars,'1'),rr=i?1.2:2;
  row.chart_reviewed=true;row.rr=rr;row.rr_evidence='Fixture native tool label';row.chart_path=path.join(f.dir,`entry-fixture-${i}.png`);await fs.writeFile(row.chart_path,Buffer.concat([image,Buffer.from([i])]));
  Object.assign(row.chart_annotations,{position_entity_id:'entry-tool-'+i,position_rr:{source:'tradingview_position_tool_label',entity_id:'entry-tool-'+i,value:rr,label:'Risk/reward ratio: '+rr},position_start_candle_time:plan.start.time,position_end_candle_time:plan.end.time,position_mfe_candle_time:plan.mfe.time,position_entry_price:plan.start.price,position_target_price:plan.end.price,position_stop_price:plan.stop_price,view_preserved:true,visible_range:{from:start-300,to:start+600},position_created_before_markers:true,markers_brought_to_front:true,overlap_checked:true,screenshot_after_annotations:true,commentary_free:true});row.chart_annotations.transaction_markers.forEach((m,j)=>m.entity_id=`entry-${i}-marker-${j}`);
 }
 await write(f.config.snapshot_path,f.snapshot);await write(f.config.review_path,f.review);f.config.notes_only=true;f.config.entry_review_path=path.join(f.dir,'entry-review.json');await write(f.config.entry_review_path,entryReview);
 const result=await createPack(f.config,f.pack);assert.deepEqual(result.entry_ordered.map(e=>e.number),['1.1','1.2']);
 const saved=JSON.parse(await fs.readFile(path.join(f.pack,'entry-captures.json')));assert.deepEqual(saved.entries.map(e=>e.rr),[2,1.2]);assert.notDeepEqual(await fs.readFile(path.join(f.pack,'entry-1.png')),await fs.readFile(path.join(f.pack,'entry-2.png')));
 const notesPath=path.join(f.pack,'notes-input.json');await write(notesPath,{date,user_finished:true,trades:[{number:1,trade_id:2938,text:'Entered and added after confirmation.'}]});await assert.rejects(publishJournalNotes(f.pack,notesPath,{request:async()=>{throw Error('No server access expected');}}),/Each journal entry/);await assert.rejects(fs.stat(path.join(f.pack,'notes-only-input.json')),/ENOENT/);
});

test('trade-chart-only journal packs omit entry screenshots and entry save requests',async t=>{
 const f=await fixture(t);await createPack({...f.config,notes_only:true,trade_chart_only:true},f.pack);
 const state=JSON.parse(await fs.readFile(path.join(f.pack,'stage.json')));
 assert.equal(state.trade_chart_only,true);assert.equal(state.entry_ordered,undefined);
 assert.deepEqual((await fs.readdir(f.pack)).filter(f=>f.endsWith('.png')),['trade-2938.png']);
 const {saveEntryCaptures}=await import('./journal-notes.mjs');
 assert.deepEqual(await saveEntryCaptures(f.pack,{},()=>{throw Error('No entry API calls permitted');}),[]);
});
