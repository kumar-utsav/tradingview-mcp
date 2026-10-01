import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planDay,validateReview,applyReview,snapshotDay,reviewTemplate} from './journal-capture.mjs';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
const trade={id:1,date:'9/23/2026',ticker:'SPY',type:'Put',time_frame:1,entry_candle:'07:10',time:'07:11:12',outcome:'Loss',profit_loss:-23,quantity:2,transactions:[
 {side:'BUY',quantity:1,price:1.2,filledTime:'2026-09-23T14:11:12.544Z'},
 {side:'BUY',quantity:1,price:1.1,filledTime:'2026-09-23T14:14:38.755Z'},
 {side:'SELL',quantity:2,price:0.9,filledTime:'2026-09-23T14:15:28.963Z'}
],notes:'<p>Original note</p>',tags:[],rr:null,has_chart:false};
const groups=[{id:22,name:'Setup',selection_mode:'single'}];
const tags=['a','b'].map(key=>({key,page_type:'journal',group_id:22}));
const row=()=>({id:1,chart_reviewed:true,chart_context:{date:'2026-09-23',ticker:'AMEX:SPY',time_frame:1,entry_candle:'07:10'},chart_path:'test.png',chart_annotations:{position_tool:'short_position',position_entity_id:'position-1',first_entry_time:'2026-09-23T14:11:12.544Z',final_exit_time:'2026-09-23T14:15:28.963Z',position_start_rule:'first_entry_candle',position_end_rule:'mfe_low',position_start_candle_time:1790172660,position_end_candle_time:1790172840,position_entry_price:769.4,position_target_price:769.2,position_stop_price:769.9,stop_distance:0.5,view_preserved:true,resolution:'1',visible_range:{from:1790167560,to:1790177760},position_created_before_markers:true,markers_brought_to_front:true,transaction_markers:[
 {transaction_index:0,entity_id:'marker-0',side:'BUY',quantity:1,price:1.2,filled_time:'2026-09-23T14:11:12.544Z',text:'BUY 1 @ $1.20'},
 {transaction_index:1,entity_id:'marker-1',side:'BUY',quantity:1,price:1.1,filled_time:'2026-09-23T14:14:38.755Z',text:'BUY 1 @ $1.10'},
 {transaction_index:2,entity_id:'marker-2',side:'SELL',quantity:2,price:0.9,filled_time:'2026-09-23T14:15:28.963Z',text:'SELL 2 @ $0.90'}
],overlap_checked:true,screenshot_after_annotations:true},tags:['a'],evidence:{a:'Specific chart evidence'},group_review:{22:'Reviewed setup'}});
const snapshot=()=>({date:'2026-09-23',trades:[structuredClone(trade)],chart_hashes:{1:null}});
function mock({silent=false,extra=false}={}){
 const state=structuredClone(trade),writes=[];
 const request=async(url,options={})=>{const route=new URL(url).pathname;let data;
 if(options.method==='PUT'){const body=JSON.parse(options.body);writes.push(body);if(!silent){if(body.propName==='chart'){state.chart=body.value;state.has_chart=true;}else state[body.propName]=body.value;}data={trade:state};}
 else if(route==='/journal/')data=[state,...(extra?[{...trade,id:2}]:[])];
 else if(route==='/tags/')data=tags;
 else if(route==='/tags/groups')data=groups;
 else if(route.endsWith('/image'))data={chart:state.chart};
 else if(route.includes('/daily-notes/'))data={date:'2026-09-23',notes:'Daily note',external_resources:[]};
 else throw Error(route);
 return {ok:true,json:async()=>structuredClone(data)};
 };return {state,writes,request};
}
const opts=m=>({base:'http://test',request:m.request,readFile:async()=>image});
test('selects all imported IDs for day including same candle, excludes Miss',()=>{
 assert.deepEqual(planDay([trade,{...trade,id:2},{...trade,id:3,outcome:'Miss'},{...trade,id:4,date:'9/22/2026'}],'2026-09-23').map(t=>t.id),[1,2]);
});
test('rejects mismatched chart identity and incomplete group review',()=>{
 for(const change of [{ticker:'QQQ'},{date:'2026-09-22'},{time_frame:2},{entry_candle:'07:11'}]){const r=row();Object.assign(r.chart_context,change);assert.throws(()=>validateReview(r,trade,tags,groups,trade.date),/identity/);}
 const r=row();r.group_review={};assert.throws(()=>validateReview(r,trade,tags,groups,trade.date),/Unreviewed/);
});
test('requires a verified position tool and one quantity label per transaction',()=>{
 const missing=row();delete missing.chart_annotations;assert.throws(()=>validateReview(missing,trade,tags,groups,trade.date),/annotations required/);
 const wrongTool=row();wrongTool.chart_annotations.position_tool='long_position';assert.throws(()=>validateReview(wrongTool,trade,tags,groups,trade.date),/Wrong position tool/);
 const wrongStart=row();wrongStart.chart_annotations.first_entry_time='2026-09-23T14:14:38.755Z';assert.throws(()=>validateReview(wrongStart,trade,tags,groups,trade.date),/First entry mismatch/);
 const wrongEndpoint=row();wrongEndpoint.chart_annotations.position_end_rule='final_exit_candle';assert.throws(()=>validateReview(wrongEndpoint,trade,tags,groups,trade.date),/endpoint rule/);
 const wrongStop=row();wrongStop.chart_annotations.position_stop_price=769.8;assert.throws(()=>validateReview(wrongStop,trade,tags,groups,trade.date),/wrong price/);
 const wrongDistance=row();wrongDistance.chart_annotations.stop_distance=1;assert.throws(()=>validateReview(wrongDistance,trade,tags,groups,trade.date),/\$0\.50/);
 const missingMarker=row();missingMarker.chart_annotations.transaction_markers.pop();assert.throws(()=>validateReview(missingMarker,trade,tags,groups,trade.date),/Every transaction/);
 const badText=row();badText.chart_annotations.transaction_markers[0].text='BUY';assert.throws(()=>validateReview(badText,trade,tags,groups,trade.date),/side, quantity and dollar-formatted fill price/);
 const missingPrice=row();missingPrice.chart_annotations.transaction_markers[0].text='BUY 1';assert.throws(()=>validateReview(missingPrice,trade,tags,groups,trade.date),/dollar-formatted fill price/);
 const wrongPrice=row();wrongPrice.chart_annotations.transaction_markers[0].price=1.19;assert.throws(()=>validateReview(wrongPrice,trade,tags,groups,trade.date),/marker mismatch/);
 const overlap=row();overlap.chart_annotations.overlap_checked=false;assert.throws(()=>validateReview(overlap,trade,tags,groups,trade.date),/overlap check/);
 const zoom=row();zoom.chart_annotations.view_preserved=false;assert.throws(()=>validateReview(zoom,trade,tags,groups,trade.date),/view must be preserved/);
 const order=row();order.chart_annotations.markers_brought_to_front=false;assert.throws(()=>validateReview(order,trade,tags,groups,trade.date),/brought to front/);
});
test('uses direction-aware MFE for wins and losses',()=>{
 const longTrade={...trade,type:'Call'};
 const long=row();Object.assign(long.chart_annotations,{position_tool:'long_position',position_end_rule:'mfe_high',position_entry_price:769.4,position_target_price:769.8,position_stop_price:768.9});
 assert.doesNotThrow(()=>validateReview(long,longTrade,tags,groups,longTrade.date));
 const winTrade={...trade,outcome:'Win'};
 const win=row();win.chart_annotations.position_end_rule='mfe_low';
 assert.doesNotThrow(()=>validateReview(win,winTrade,tags,groups,winTrade.date));
});
test('supports sell-first option entries and anchors the first actual transaction',()=>{
 const sellFirst={...trade,transactions:[{side:'SELL',quantity:1,price:.89,filledTime:'2026-09-23T14:11:12.544Z'},{side:'BUY',quantity:1,price:1.04,filledTime:'2026-09-23T14:12:12.544Z'}]};
 const review=row();review.chart_annotations.first_entry_time=sellFirst.transactions[0].filledTime;review.chart_annotations.final_exit_time=sellFirst.transactions[1].filledTime;
 review.chart_annotations.transaction_markers=[{transaction_index:0,entity_id:'marker-0',side:'SELL',quantity:1,price:.89,filled_time:sellFirst.transactions[0].filledTime,text:'SELL 1 @ $0.89'},{transaction_index:1,entity_id:'marker-1',side:'BUY',quantity:1,price:1.04,filled_time:sellFirst.transactions[1].filledTime,text:'BUY 1 @ $1.04'}];
 assert.doesNotThrow(()=>validateReview(review,sellFirst,tags,groups,sellFirst.date));
});
test('rejects unknown tags, conflicting selections and unsupported removals',()=>{
 const r=row();r.tags=['a','b'];r.evidence.b='evidence';assert.throws(()=>validateReview(r,trade,tags,groups,trade.date),/Conflicting/);
 r.tags=['bt_invalid'];assert.throws(()=>validateReview(r,trade,tags,groups,trade.date),/Not a journal tag/);
 r.tags=['a'];assert.throws(()=>validateReview(r,{...trade,tags:['b']},tags,groups,trade.date),/removal/);
});
test('dry run does not write; apply preserves imported data and notes, verifies chart',async()=>{
 const m=mock(),r={...row(),notes_append:'Chart note <literal>',notes_source:'Matching drawing ID 42'};
 const manifest={trades:[r]};await applyReview(manifest,snapshot(),opts(m));assert.equal(m.writes.length,0);
 const result=await applyReview(manifest,snapshot(),{...opts(m),apply:true});assert.equal(result.complete,true);
 assert.deepEqual(m.writes.map(w=>w.propName),['chart','tags','notes']);assert.equal(m.state.profit_loss,-23);assert.deepEqual(m.state.transactions,trade.transactions);
 assert.equal(m.state.notes,'<p>Original note</p><p>Chart note &lt;literal&gt;</p>');assert.equal(m.state.chart,image.toString('base64'));
 await assert.rejects(applyReview(manifest,snapshot(),{...opts(m),apply:true}),/Stale/);
});
test('detects unsuccessful save even with HTTP 200',async()=>{
 const m=mock({silent:true});await assert.rejects(applyReview({trades:[row()]},snapshot(),{...opts(m),apply:true}),/Read-back mismatch/);
});
test('stale financial data or newly imported trade stops before writing',async()=>{
 for(const m of [mock(),mock({extra:true})]){if(!m.state.extra)m.state.quantity=4;await assert.rejects(applyReview({trades:[row()]},snapshot(),{...opts(m),apply:true}),/Stale|list changed/);assert.equal(m.writes.length,0);}
});
test('all IDs must be accounted for and skips prevent completion',async()=>{
 const m=mock();await assert.rejects(applyReview({trades:[]},snapshot(),opts(m)),/Every imported/);
 const result=await applyReview({skipped:[{id:1,reason:'Chart history unavailable'}]},snapshot(),{...opts(m),apply:true});assert.equal(result.complete,false);assert.equal(m.writes.length,0);
});
test('snapshot directory cannot be reused',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'journal-test-')),dir=path.join(parent,'run');const m=mock();
 try{const result=await snapshotDay('2026-09-23',dir,opts(m));const saved=JSON.parse(await fs.readFile(path.join(dir,'before.json'),'utf8'));const template=JSON.parse(await fs.readFile(result.review_template,'utf8'));
  assert.equal(saved.daily_note.notes,'Daily note');assert.equal(template.trades[0].chart_annotations.transaction_markers.length,3);
  await assert.rejects(snapshotDay('2026-09-23',dir,opts(m)),/EEXIST/);
 }finally{await fs.rm(parent,{recursive:true,force:true});}
});
test('snapshot accepts a missing daily note without hiding other failures',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'journal-test-')),dir=path.join(parent,'run'),m=mock();
 const request=async(url,options={})=>url.includes('/daily-notes/')?{ok:false,status:404,json:async()=>null}:m.request(url,options);
 try{await snapshotDay('2026-09-23',dir,{...opts(m),request});const saved=JSON.parse(await fs.readFile(path.join(dir,'before.json'),'utf8'));assert.equal(saved.daily_note,null);}
 finally{await fs.rm(parent,{recursive:true,force:true});}
});
test('snapshot emits a prefilled, validator-shaped review template',async()=>{
 const template=reviewTemplate({...snapshot(),groups},'/tmp/run'),item=template.trades[0],marker=item.chart_annotations.transaction_markers[0];
 assert.equal(template.snapshot_path,'/tmp/run/before.json');assert.equal(item.chart_annotations.position_tool,'short_position');
 assert.equal(item.chart_annotations.position_end_rule,'mfe_low');assert.equal(marker.text,'BUY 1 @ $1.20');assert.deepEqual(item.group_review,{22:''});
});
test('template preserves malformed imported rows for explicit skipping',()=>{
 const malformed={...trade,transactions:[{side:'BUY',quantity:1,price:'bad',filledTime:'bad'}]};
 const template=reviewTemplate({date:'2026-09-23',trades:[malformed],groups},'/tmp/run');
 assert.equal(template.trades[0].chart_annotations.transaction_markers[0].text,'');
});
