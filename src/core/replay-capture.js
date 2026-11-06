import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const tradingRoot=process.env.TRADING_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../trading');
export const {buildReplayLedger,ledgerByEntry,splitReplayPosition,pacific}=require(path.join(tradingRoot,'backend/utils/replayLedger.js'));
export const {applyReplayFeeModel,REPLAY_FEE_MODEL}=require(path.join(tradingRoot,'backend/utils/replayFees.js'));

// Read the active chart's replay facade, never a broker connection or another pane.
export const replaySnapshotExpression = `(async () => {
  const api=window.TradingViewApi, chart=api._activeChartWidgetWV.value();
  // New Replay keeps its controller separate from the retired public API.
  // Loading the existing controller does not start, step or reset the session.
  const legacy=api._replayApi;
  const replay=legacy || (await api._loadReplayController?.())?.controller;
  const unwrap=x=>x&&typeof x.value==='function'?x.value():x;
  if(!replay) throw Error('Replay controller unavailable; replay state could not be determined');
  if(!unwrap(replay.isReplayStarted())||unwrap(replay.isAutoplayStarted())) throw Error('Pause an active replay before capturing');
  // Scope the ledger to this chart model, never another pane's active facade.
  const facade=legacy ? replay.replayStrategyFacade()
    : replay.tradingUIController()?.replayStrategyFacadesPerChartModelId()?.get(chart._chartWidget.model().id());
  const report=facade&&facade.reportData();
  if(!report||!Array.isArray(report.filledOrders)) throw Error('Replay filled-order report unavailable');
  const info=chart._chartWidget.model().mainSeries().symbolInfo();
  return {source:location.pathname,symbol:chart.symbolExt().full_name||chart.symbolExt().symbol,
    resolution:String(chart.resolution()),replay_time:unwrap(legacy ? replay.currentDate() : replay.replayCurrentDate()),
    instrument:{type:info.type,tick_size:info.minmov/info.pricescale,point_value:info.pointvalue,
      currency:info.currency_code,timezone:info.timezone,session:info.session},
    report:{...report,position:{...report.position,
      symbolToAccountRate:report.position?.symbolToAccountRate??report.serviceInfo?.symbolToAccountRate}},
    rate_source:report.position?.symbolToAccountRate!=null?'position':'serviceInfo',
    original_position:report.position,
    recovery_state:facade.recoveryState()};
})()`;


export function mapReplayDrawings(ledger,evidence){
  const used=new Set();
  return ledger.trades.map(t=>{
    const candidates=evidence.drawings.filter(d=>d.name===(t.direction==='long'?'long_position':'short_position')&&d.points.length>=2&&Math.min(...d.points.map(p=>p.time))*1000<=t.entry_time&&Math.max(...d.points.map(p=>p.time))*1000>=t.entry_time);
    if(ledger.grouping==='per_entry'&&candidates.length>1){
      candidates.sort((a,b)=>b.points[0].time-a.points[0].time);
      if(candidates[0].points[0].time!==candidates[1].points[0].time)candidates.splice(1);
    }
    if(candidates.length!==1||used.has(candidates[0].id))throw Error('Replay trade needs a unique matching position drawing: '+t.source_id);
    const d=candidates[0];used.add(d.id);
    return {...t,drawing:{id:d.id,match_basis:ledger.grouping==='per_entry'?'unique_latest_start_before_opening_fill':'unique_direction_and_time_overlap',entry_time:d.points[0].time,entry_price:d.points[0].price,
      current_stop_distance:d.properties.stopLevel*ledger.instrument.tick_size,current_target_distance:d.properties.profitLevel*ledger.instrument.tick_size,
      historical_initial_risk_verified:false}};
  });
}
