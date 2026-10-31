import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildReplayLedger,ledgerByEntry,mapReplayDrawings} from '../src/core/replay-capture.js';
test('overlapping long and short tools map to each opening fill, with no reuse or ambiguous ties',()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('./fixtures/replay-mes-scale.json',import.meta.url)));
 const ledger=ledgerByEntry(buildReplayLedger(snapshot,'2026-09-01'));
 const drawings=ledger.trades.map((t,i)=>({id:'tool'+i,name:t.direction==='long'?'long_position':'short_position',points:[{time:t.entry_time/1000-30,price:t.weighted_entry_price},{time:t.exit_time/1000+60}],properties:{stopLevel:4,profitLevel:8}}));
 const result=mapReplayDrawings(ledger,{drawings});assert.deepEqual(result.map(t=>t.drawing.id),drawings.map(t=>t.id));
 assert.throws(()=>mapReplayDrawings(ledger,{drawings:drawings.slice(0,-1)}),/unique matching/);
 assert.throws(()=>mapReplayDrawings(ledger,{drawings:[...drawings,{...drawings[0],id:'duplicate'}]}),/unique matching/);
});

test('replay snapshot reads flat-position conversion rate from serviceInfo without assuming a rate',async()=>{
 const {replaySnapshotExpression}=await import('../src/core/replay-capture.js');
 const vm=await import('node:vm');
 const report={position:{qty:0},filledOrders:[],serviceInfo:{symbolToAccountRate:1}};
 const chart={symbolExt:()=>({full_name:'CME_MINI:MES1!'}),resolution:()=>1,_chartWidget:{model:()=>({mainSeries:()=>({symbolInfo:()=>({type:'futures',minmov:1,pricescale:4,pointvalue:5,currency_code:'USD'})})})}};
 const replay={isReplayStarted:()=>true,isAutoplayStarted:()=>false,currentDate:()=>1,replayStrategyFacade:()=>({reportData:()=>report,recoveryState:()=>({})})};
 const run=()=>vm.runInNewContext(replaySnapshotExpression,{window:{TradingViewApi:{_activeChartWidgetWV:{value:()=>chart},_replayApi:replay}},location:{pathname:'/chart/test'}});
 assert.equal(run().report.position.symbolToAccountRate,1);assert.equal(run().rate_source,'serviceInfo');assert.equal(report.position.symbolToAccountRate,undefined);
 report.position.symbolToAccountRate=2;assert.equal(run().report.position.symbolToAccountRate,2);
 delete report.position.symbolToAccountRate;delete report.serviceInfo.symbolToAccountRate;assert.equal(run().report.position.symbolToAccountRate,undefined);
});
