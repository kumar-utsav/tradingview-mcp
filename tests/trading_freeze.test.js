import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {freezeBacktestDay,publishFrozenBacktestDay,frozenChartEvidenceExpression} from '../src/core/trading-sync.js';

function fixture() {
  const events=[];let changed=false;let failScreenshot=false;let imageNumber=0;
  const identity={source:'/chart/test/',symbol:'SPY',resolution:'1',visible_range:{from:1,to:2}};
  const trade={source_id:'/chart/test/::p1',chart_date:'2026-09-02',notes:'Held',entry_price:100};
  const note={drawing_id:'n1',status:'assigned',text:'Held',trade_source_id:trade.source_id};
  const deps={
    evaluate:async expression=>{
      if(expression.includes('backtest-frozen-evidence'))return expression.includes('if (true)')
        ? {...identity,...(changed?{symbol:'QQQ'}:{})} : {identity,drawings:[{id:'n1',properties:{text:'1: Held'}}],bars:[]};
      if(expression.includes('backtest-day-inventory'))return [{drawing_id:'p1',source_id:trade.source_id}];
      if(expression.includes('backtest-day-notes'))return {count:1,note:'Daily note'};
      if(expression.includes('getVisibleRange'))return {date_visible:true};
      if(expression.includes('backtest-trade-note-delete')){events.push('delete');return {success:true};}
      if(expression.includes('backtest-trade-note-commit')){events.push('commit');return {success:true};}
      if(expression.includes('backtest-trade-note-restore')){events.push('undo');return {success:true};}
      if(expression.includes('backtest-position-isolation-begin')){events.push('isolate-begin');return {success:true};}
      return {trades:[trade],note_audit:[note]};
    },
    evaluateAsync:async expression=>{events.push(expression.includes('isolation-restore')?'visibility-restored':'isolate');return {success:true};},
    captureScreenshot:async ()=>{events.push('screenshot');if(failScreenshot)throw Error('screen failed');return Buffer.from(`image-${++imageNumber}`).toString('base64');},
    getPineLabels:async()=>({studies:[]}),getPineBoxes:async()=>({studies:[]}),getPineLines:async()=>({studies:[]}),
    fetch:async()=>{throw Error('Network must not run before chart release');},
    resourceFetch:async()=>{throw Error('Video lookup must not run before chart release');},
  };
  const snapshots={};
  const persist=async (phase,bundle)=>{events.push(phase);snapshots[phase]=structuredClone(bundle);};
  return {deps,events,persist,snapshots,change:()=>{changed=true;},fail:()=>{failScreenshot=true;}};
}

describe('Frozen backtest capture',()=>{
  it('chat mode never extracts or cleans chart commentary and makes no server writes',async()=>{
    const f=fixture(),evaluate=f.deps.evaluate;
    f.deps.evaluate=async expression=>{
      assert.ok(!expression.includes('backtest-day-notes'));
      return evaluate(expression);
    };
    const b=await freezeBacktestDay({date:'2026-09-02',notesMode:'chat',persist:f.persist,_deps:f.deps});
    assert.equal(b.notes_mode,'chat');assert.equal(b.payload.trades[0].notes,'');
    assert.equal(b.payload.daily_note,null);assert.deepEqual(b.note_audit,[]);
    for(const event of ['delete','undo','commit'])assert.ok(!f.events.includes(event));
    assert.ok(f.events.includes('visibility-restored'));assert.ok(f.snapshots.frozen);
  });
  it('captures annotated chart first, durably backs up before cleanup, and restores visibility before release',async()=>{
    const f=fixture();const b=await freezeBacktestDay({date:'2026-09-02',persist:f.persist,_deps:f.deps});
    assert.deepEqual(f.events,['screenshot','recovery','delete','screenshot','isolate-begin','isolate','screenshot','isolate','screenshot','visibility-restored','frozen','commit']);
    assert.equal(f.snapshots.recovery.payload.screenshot,undefined);
    assert.equal(f.snapshots.recovery.evidence.drawings[0].properties.text,'1: Held');
    assert.equal(b.payload.trades[0].notes,'Held');
    assert.equal(b.payload.daily_note,'Daily note');
    assert.equal(b.payload.trade_screenshots.length,1);
  });
  it('does not remove notes if the durable recovery write fails',async()=>{
    const f=fixture();await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:async()=>{throw Error('disk full');}}),/disk full/);
    assert.deepEqual(f.events,['screenshot']);
  });
  it('restores notes and position visibility when final disk persistence fails before release',async()=>{
    const f=fixture();await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:async(p,b)=>{
      if(p==='frozen')throw Error('disk full');await f.persist(p,b);
    }}),/Assigned notes restored/);
    assert.equal(f.events.at(-1),'undo');assert.ok(f.events.includes('visibility-restored'));
  });
  it('rejects navigation during capture instead of mixing evidence or undoing user work',async()=>{
    const f=fixture();await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:async(p,b)=>{
      await f.persist(p,b);if(p==='recovery')f.change();
    }}),/Chart changed/);
    assert.ok(!f.events.includes('frozen'));assert.ok(!f.events.includes('undo'));assert.ok(!f.events.includes('delete'));
  });
  it('marks unavailable Pine evidence without fetching the chart again after release',async()=>{
    const f=fixture();f.deps.getPineBoxes=async()=>{throw Error('hidden study');};
    const b=await freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:f.persist});
    assert.equal(b.evidence.graphics.boxes.success,false);
  });
  it('restores notes and visibility if an isolated screenshot fails',async()=>{
    const f=fixture();let images=0;
    f.deps.captureScreenshot=async()=>{if(++images===3)throw Error('screen failed');return 'cG5n';};
    await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:f.persist}),/Assigned notes restored/);
    assert.ok(f.events.includes('visibility-restored'));assert.equal(f.events.at(-1),'undo');
    assert.equal(f.snapshots.frozen,undefined);
  });
  it('rejects an empty annotated image before touching notes',async()=>{
    const f=fixture();f.deps.captureScreenshot=async()=>'';
    await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:f.persist}),/Annotated screenshot was empty/);
    assert.ok(!f.events.includes('delete'));
  });
  it('rejects a stuck full-day frame, restores visibility and never seals the pack',async()=>{
    const f=fixture();f.deps.captureScreenshot=async()=> 'same-frame';
    await assert.rejects(freezeBacktestDay({date:'2026-09-02',notesMode:'chat',_deps:f.deps,persist:f.persist}),/stale, duplicate or full-day image/);
    assert.ok(f.events.includes('visibility-restored'));
    assert.ok(f.snapshots.recovery);assert.equal(f.snapshots.frozen,undefined);
  });
  it('retries a stale frame and accepts a freshly rendered individual image',async()=>{
    const f=fixture();const frames=['day','day','hidden','hidden','trade'];
    f.deps.captureScreenshot=async()=>frames.shift();
    const b=await freezeBacktestDay({date:'2026-09-02',notesMode:'chat',_deps:f.deps,persist:f.persist});
    assert.equal(b.payload.trade_screenshots[0].screenshot.base64,'trade');
    assert.equal(frames.length,0);assert.ok(f.events.includes('visibility-restored'));
  });
  it('rejects the original multi-tool day frame even if the hidden control changed',async()=>{
    const f=fixture(),evaluate=f.deps.evaluate;
    f.deps.evaluate=async expression=>expression.includes('backtest-position-isolation-begin')
      ? {success:true,visible_positions:2} : evaluate(expression);
    const frames=['day','day','hidden','day','day','day'];
    f.deps.captureScreenshot=async()=>frames.shift();
    await assert.rejects(freezeBacktestDay({date:'2026-09-02',notesMode:'chat',_deps:f.deps,persist:f.persist}),/Individual trade screenshot did not change/);
    assert.equal(f.snapshots.frozen,undefined);assert.ok(f.events.includes('visibility-restored'));
  });
  it('rejects identical images assigned to different trades',async()=>{
    const f=fixture(),evaluate=f.deps.evaluate;
    f.deps.evaluate=async expression=>{
      const result=await evaluate(expression);
      if(expression.includes('backtest-day-inventory'))return [...result,{drawing_id:'p2',source_id:'/chart/test/::p2'}];
      if(Array.isArray(result.trades))return {...result,trades:[...result.trades,{...result.trades[0],source_id:'/chart/test/::p2'}]};
      return result;
    };
    const frames=['day','day','hidden','trade','trade','trade','trade'];
    f.deps.captureScreenshot=async()=>frames.shift();
    await assert.rejects(freezeBacktestDay({date:'2026-09-02',notesMode:'chat',_deps:f.deps,persist:f.persist}),/Individual trade screenshot did not change/);
    assert.equal(f.snapshots.frozen,undefined);assert.ok(f.events.includes('visibility-restored'));
  });
  it('does not release or undo over new work if the chart changes during final disk persistence',async()=>{
    const f=fixture();await assert.rejects(freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:async(p,b)=>{
      await f.persist(p,b);if(p==='frozen')f.change();
    }}),/Chart changed/);
    assert.ok(!f.events.includes('commit'));assert.ok(!f.events.includes('undo'));
  });
  it('rejects mismatched per-trade screenshots before any publication',async()=>{
    const f=fixture();const bundle=await freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:f.persist});
    bundle.payload.trade_screenshots[0].source_id='another-trade';
    await assert.rejects(publishFrozenBacktestDay(bundle,{_deps:f.deps}),/matching screenshot/);
  });
  it('retries publishing immutable local evidence using the same key without any chart access',async()=>{
    const f=fixture();const bundle=await freezeBacktestDay({date:'2026-09-02',_deps:f.deps,persist:f.persist});
    const oldUrl=process.env.TRADING_BACKEND_URL,oldToken=process.env.TRADINGVIEW_INGESTION_TOKEN;
    process.env.TRADING_BACKEND_URL='http://localhost:5555';process.env.TRADINGVIEW_INGESTION_TOKEN='test';
    const requests=[];const blocked=async()=>{throw Error('Chart accessed after release');};
    const deps={evaluate:blocked,evaluateAsync:blocked,captureScreenshot:blocked,getPineLabels:blocked,resourceFetch:blocked,
      fetch:async(_u,options)=>{requests.push(options);return {ok:true,json:async()=>({accepted_trade_source_ids:[],possible_duplicates:[{source_id:bundle.payload.trades[0].source_id}]}),headers:{get:()=>null}};}};
    try {
      const r=await publishFrozenBacktestDay(bundle,{_deps:deps});await publishFrozenBacktestDay(bundle,{_deps:deps});
      assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
      assert.equal(requests[0].body,requests[1].body);
      assert.equal(r.note_recovery_required.length,1);assert.equal(r.chart_released,true);
      assert.equal(bundle.payload.daily_resources.length,0);
    }finally{
      if(oldUrl===undefined)delete process.env.TRADING_BACKEND_URL;else process.env.TRADING_BACKEND_URL=oldUrl;
      if(oldToken===undefined)delete process.env.TRADINGVIEW_INGESTION_TOKEN;else process.env.TRADINGVIEW_INGESTION_TOKEN=oldToken;
    }
  });
  it('snapshots actual notes, geometry and loaded history, without including future dates',()=>{
    const items=[['2026-09-01T14:00:00Z',1],['2026-09-02T14:00:00Z',2],['2026-09-03T14:00:00Z',3]]
      .map(([d,p])=>({value:[Date.parse(d)/1000,p,p+1,p-1,p,5]}));
    const chart={symbolExt:()=>({symbol:'SPY'}),resolution:()=>1,getVisibleRange:()=>({from:1,to:2}),
      getAllShapes:()=>[{id:'n1',name:'text'}],getShapeById:()=>({getPoints:()=>[{time:1,price:2}],getProperties:()=>({text:'1: Original'})}),
      getAllStudies:()=>[{id:'s1',name:'Levels'}],getSeries:()=>({data:()=>({bars:()=>({_items:items})})})};
    const r=vm.runInNewContext(frozenChartEvidenceExpression('2026-09-02'),{window:{TradingViewApi:{activeChart:()=>chart},location:{pathname:'/chart/test/'}}});
    assert.equal(r.bars.length,2);assert.equal(r.drawings[0].properties.text,'1: Original');
    assert.equal(r.previous_loaded_date,'2026-09-01');assert.equal(r.identity.last_bar[1],2);
    chart.getShapeById=()=>assert.fail('Commentary must not be read in chat mode');
    const chat=vm.runInNewContext(frozenChartEvidenceExpression('2026-09-02',false,false),{window:{TradingViewApi:{activeChart:()=>chart},location:{pathname:'/chart/test/'}}});
    assert.equal(chat.drawings.length,0);assert.equal(chat.bars.length,2);
  });
});
