// Journal continuation uses sealed files and server APIs only. No chart imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {snapshotDay,applyReview,isoDate} from './journal-capture.mjs';
import {resumePack} from './journal-pack.mjs';
import {summaryHtml,appendSummary} from './capture-notes.mjs';
import {cleanupCompletedPack} from './capture-cleanup.mjs';
const load=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function seal(file,text){try{await fs.writeFile(file,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(file,'utf8')!==text)throw Error('Sealed notes differ; retain the original input and use an amendment');}}
export async function saveEntryCaptures(pack,input,api){
 const state=await load(path.join(pack,'stage.json'));if(!state.notes_only||state.trade_chart_only)return [];
 const manifest=await load(path.join(pack,'entry-captures.json')),saved=[];
 for(const trade_id of [...new Set(manifest.entries.map(e=>e.journal_id))]){
  const entries=manifest.entries.filter(e=>e.journal_id===trade_id),baseline=await api(`/journal/${trade_id}/entry-captures`),requestFile=path.join(pack,`entry-save-request-${trade_id}.json`);
  const rows=[];
  for(const entry of entries){
   if(entry.source_fingerprint!==baseline.source_fingerprint)throw Error('Imported fill facts changed since entry capture');
   const explicit=input.entries?.find(n=>n.trade_id===trade_id&&n.entry_key===entry.entry_key);
   const note=explicit||(entries.length===1?input.trades.find(n=>n.trade_id===trade_id):null);
   if(!note||(!note.text?.trim()&&note.no_note!==true)||(note.text?.trim()&&note.no_note===true))throw Error('Each journal entry needs supplied notes or explicit no_note');
   const previous=baseline.entries.find(e=>e.entry_key===entry.entry_key);
   rows.push({entry_key:entry.entry_key,rr:entry.rr,rr_evidence:entry.rr_evidence,chart_annotations:entry.chart_annotations,notes:appendSummary(previous?.notes,note.text),screenshot:{mime_type:'image/png',base64:(await fs.readFile(path.join(pack,entry.chart_file))).toString('base64')}});
  }
  let payload;try{payload=await load(requestFile);}catch(error){if(error.code!=='ENOENT')throw error;payload={request_id:path.basename(pack)+'/entries/'+trade_id,source_fingerprint:baseline.source_fingerprint,expected_revision:baseline.revision,entries:rows};await seal(requestFile,JSON.stringify(payload,null,2));}
  // Requests stay fixed across retries. Concurrent changes are rejected by the server.
  await api(`/journal/${trade_id}/entry-captures`,payload);
  const verify=await api(`/journal/${trade_id}/entry-captures`);
  for(const entry of payload.entries){const row=verify.entries.find(e=>e.entry_key===entry.entry_key);if(!row||row.stale||row.rr!==entry.rr||row.notes!==entry.notes)throw Error('Entry note/RR read-back mismatch');
   const image=await api(`/journal/${trade_id}/entry-captures/${encodeURIComponent(entry.entry_key)}/image`);
   const sha=b=>createHash('sha256').update(b).digest('hex');if(sha(Buffer.from(image.chart,'base64'))!==sha(Buffer.from(entry.screenshot.base64,'base64')))throw Error('Entry screenshot read-back mismatch');
  }
  saved.push({trade_id,entry_count:payload.entries.length,verified:true});
 }
 return saved;
}
export async function publishJournalNotes(pack,inputPath,{base=process.env.TRADING_API_URL||'http://100.125.89.9:5555',request=fetch,services={}}={}) {
 pack=path.resolve(pack);const state=await load(path.join(pack,'stage.json')),input=await load(inputPath);
 if(!state.tradingview_released||input.date!==state.date||input.user_finished!==true)throw Error('Released pack, matching date and explicit finish instruction required');
 if(state.questionnaire_version===1&&input.notes_only_override!==true)throw Error('Existing structured pack requires an explicit notes-only instruction');
 if(!Array.isArray(input.trades)||input.trades.length!==state.ordered.length)throw Error('Complete mapped trade notes required');
 if(input.daily!==undefined&&typeof input.daily!=='string')throw Error('Daily summary must be text');
 const seen=new Set();for(const note of input.trades){
  if(!state.ordered.some(t=>t.number===note.number&&t.trade_id===note.trade_id)||seen.has(note.trade_id))throw Error('Frozen journal note mapping changed or duplicated');seen.add(note.trade_id);
  if(note.no_note===true&&note.text===undefined)note.text='';
  if(typeof note.text!=='string'||(!note.text.trim()&&note.no_note!==true)||(note.text.trim()&&note.no_note===true))throw Error('Each journal trade needs supplied summary text or explicit no_note');summaryHtml(note.text);
 }
 if(input.entries!==undefined&&!Array.isArray(input.entries))throw Error('Entry notes must be mapped rows');
 const entrySeen=new Set();for(const note of input.entries||[]){
  if(!state.entry_ordered?.some(e=>e.trade_id===note.trade_id&&e.entry_key===note.entry_key)||entrySeen.has(note.entry_key))throw Error('Unknown or duplicated journal entry note');entrySeen.add(note.entry_key);summaryHtml(note.text);
 }
 for(const entry of state.entry_ordered||[]){const note=(input.entries||[]).find(n=>n.trade_id===entry.trade_id&&n.entry_key===entry.entry_key)||(entry.entry_count===1?input.trades.find(n=>n.trade_id===entry.trade_id):null);if(!note||(!note.text?.trim()&&note.no_note!==true)||(note.text?.trim()&&note.no_note===true))throw Error('Each journal entry needs supplied notes or explicit no_note');}
 summaryHtml(input.daily);
 await seal(path.join(pack,'notes-only-input.json'),JSON.stringify(input,null,2));
 const attempts=path.join(pack,'notes-save-attempts');await fs.mkdir(attempts,{recursive:true});const attempt=await fs.mkdtemp(path.join(attempts,'save-'));
 const api=async(route,body)=>{const res=await request(base.replace(/\/$/,'')+route,{method:body?'PUT':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('Journal '+route+': HTTP '+res.status);return res.json();};
 try{
  await (services.snapshotDay||snapshotDay)(state.date,path.join(attempt,'server'),{base,request,includeCatalog:false});
  const snapshotPath=path.join(attempt,'server/before.json'),fresh=await load(snapshotPath),reviewPath=path.join(attempt,'review.json');
  // A user-requested notes-only conversion leaves the sealed old questionnaire untouched.
  await (services.resumePack||resumePack)(pack,snapshotPath,reviewPath,path.join(pack,'notes-only-input.json'));
  const review=await load(reviewPath);
  const apply=services.applyReview||applyReview;
  await apply(review,fresh,{base,request,apply:false,preserveLegacyTags:true});
  const entryCaptures=await saveEntryCaptures(pack,input,api);
  const result=await apply(review,fresh,{base,request,apply:true,preserveLegacyTags:true});
  if(!result.complete)throw Error('Journal save remains incomplete');
  const dated=rows=>rows.find(row=>isoDate(row.date)===state.date);
  const dailyBefore=fresh.daily_note;
  const expectedDaily=appendSummary(dailyBefore?.notes,input.daily);
  if(input.daily?.trim()){
   const current=dated(await api('/journal/daily-notes'));
   if(String(current?.notes||'')!==String(dailyBefore?.notes||'')&&current?.notes!==expectedDaily)throw Error('Concurrent daily note edit; retain the pack');
   if(current?.notes!==expectedDaily)await api('/journal/daily-notes/'+state.date,{notes:expectedDaily});
  }
  const daily=dated(await api('/journal/daily-notes'));
  if(String(daily?.notes||'')!==expectedDaily||!equal(daily?.external_resources||[],dailyBefore?.external_resources||[]))throw Error('Daily note/resource read-back mismatch');
  const complete={status:'complete',date:state.date,tradingview_used:false,trades:result.reviewed,entry_captures:entryCaptures,verification:{charts:true,native_rr:true,notes:true,daily_notes:true,imported_financial_fields_preserved:true,existing_tags_preserved:true},questionnaire:false,checklist_analysis:false};
  await fs.writeFile(path.join(pack,'notes-only-complete.json'),JSON.stringify(complete,null,2));
  await cleanupCompletedPack(pack);
  return complete;
 }catch(error){await fs.writeFile(path.join(attempt,'failure.json'),JSON.stringify({error:error.message,pack,input:path.join(pack,'notes-only-input.json')},null,2));throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)publishJournalNotes(...process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
