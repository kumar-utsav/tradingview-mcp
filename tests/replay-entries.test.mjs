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
 assert.equal((await run()).report.position.symbolToAccountRate,1);assert.equal((await run()).rate_source,'serviceInfo');assert.equal(report.position.symbolToAccountRate,undefined);
 report.position.symbolToAccountRate=2;assert.equal((await run()).report.position.symbolToAccountRate,2);
 delete report.position.symbolToAccountRate;delete report.serviceInfo.symbolToAccountRate;assert.equal((await run()).report.position.symbolToAccountRate,undefined);
});

test('modern replay capture resolves the paused active chart facade when the legacy API is null',async()=>{
 const {replaySnapshotExpression}=await import('../src/core/replay-capture.js');
 const vm=await import('node:vm');
 const report={position:{qty:0},filledOrders:[{id:'active-chart-fill'}],serviceInfo:{symbolToAccountRate:1}};
 const model={id:()=> 'active-model',mainSeries:()=>({symbolInfo:()=>({type:'futures',minmov:1,pricescale:4,pointvalue:5,currency_code:'USD'})})};
 const chart={symbolExt:()=>({full_name:'CME_MINI:MES1!'}),resolution:()=>2,_chartWidget:{model:()=>model}};
 let started=true,autoplay=false,facadeAvailable=true;
 const facade={reportData:()=>report,recoveryState:()=>({saved:true})};
 const controller={isReplayStarted:()=>({value:()=>started}),isAutoplayStarted:()=>({value:()=>autoplay}),replayCurrentDate:()=>({value:()=>123}),
   tradingUIController:()=>({replayStrategyFacadesPerChartModelId:()=>new Map(facadeAvailable?[['other-model',{reportData:()=>assert.fail('wrong chart')}],['active-model',facade]]:[['other-model',facade]])})};
 const run=()=>vm.runInNewContext(replaySnapshotExpression,{window:{TradingViewApi:{_activeChartWidgetWV:{value:()=>chart},_replayApi:null,_loadReplayController:async()=>({controller})}},location:{pathname:'/chart/modern'}});
 const snapshot=await run();assert.equal(snapshot.report.filledOrders[0].id,'active-chart-fill');assert.equal(snapshot.replay_time,123);assert.equal(snapshot.instrument.tick_size,.25);
 autoplay=true;await assert.rejects(async()=>run(),/Pause an active replay/);autoplay=false;
 started=false;await assert.rejects(async()=>run(),/Pause an active replay/);started=true;
 facadeAvailable=false;await assert.rejects(async()=>run(),/filled-order report unavailable/);
});
