import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const tradingRoot=process.env.TRADING_PROJECT_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../trading');
export const {buildReplayLedger,pacific}=require(path.join(tradingRoot,'backend/utils/replayLedger.js'));

// Read the active chart's replay facade, never a broker connection or another pane.
export const replaySnapshotExpression = `(() => {
  const api=window.TradingViewApi, chart=api._activeChartWidgetWV.value(), replay=api._replayApi;
  const unwrap=x=>x&&typeof x.value==='function'?x.value():x;
  if(!unwrap(replay.isReplayStarted())||unwrap(replay.isAutoplayStarted())) throw Error('Pause an active replay before capturing');
  const facade=replay.replayStrategyFacade(), report=facade&&facade.reportData();
  if(!report||!Array.isArray(report.filledOrders)) throw Error('Replay filled-order report unavailable');
  const info=chart._chartWidget.model().mainSeries().symbolInfo();
  return {source:location.pathname,symbol:chart.symbolExt().full_name||chart.symbolExt().symbol,
    resolution:String(chart.resolution()),replay_time:unwrap(replay.currentDate()),
    instrument:{type:info.type,tick_size:info.minmov/info.pricescale,point_value:info.pointvalue,
      currency:info.currency_code,timezone:info.timezone,session:info.session},
    report, recovery_state:facade.recoveryState()};
})()`;


export function mapReplayDrawings(ledger,evidence){
  const used=new Set();
  return ledger.trades.map(t=>{
    const candidates=evidence.drawings.filter(d=>d.name===(t.direction==='long'?'long_position':'short_position')&&d.points.length>=2&&Math.min(...d.points.map(p=>p.time))*1000<=t.entry_time&&Math.max(...d.points.map(p=>p.time))*1000>=t.entry_time);
    if(candidates.length!==1||used.has(candidates[0].id))throw Error('Replay trade needs a unique matching position drawing: '+t.source_id);
    const d=candidates[0];used.add(d.id);
    return {...t,drawing:{id:d.id,match_basis:'unique_direction_and_time_overlap',entry_time:d.points[0].time,entry_price:d.points[0].price,
      current_stop_distance:d.properties.stopLevel*ledger.instrument.tick_size,current_target_distance:d.properties.profitLevel*ledger.instrument.tick_size,
      historical_initial_risk_verified:false}};
  });
}
