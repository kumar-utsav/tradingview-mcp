import { evaluate, evaluateAsync } from '../connection.js';
import { getState, setSymbol, setTimeframe } from './chart.js';

const controller = `const a=window.TradingViewApi; const r=a._replayApi || (await a._loadReplayController?.())?.controller; if(!r) throw Error('Replay controller unavailable'); const modern=!a._replayApi; const unwrap=v=>v&&typeof v.value==='function'?v.value():v; const w=a._activeChartWidgetWV.value()._chartWidget;`;

async function waitForReplayChart(symbol, timeframe) {
  for (let i = 0; i < 60; i++) {
    const state = await evaluate(`(()=>{const c=window.TradingViewApi._activeChartWidgetWV.value();const s=c._chartWidget.model().mainSeries();return {symbol:c.symbol(),timeframe:String(c.resolution()),loading:s.isLoading(),bars:s.bars().size()};})()`);
    if ((!symbol || state.symbol === symbol) && (!timeframe || state.timeframe === String(timeframe)) && !state.loading && state.bars > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

export function validateReplayPlan(plan) {
  if (!plan || !/^[A-Z0-9_]+:[A-Z0-9_.!]+$/.test(plan.symbol || '')) throw Error('Invalid replay symbol');
  const minutes = Number(plan.timeframe);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) throw Error('Invalid replay timeframe');
  if (!Number.isSafeInteger(plan.targetTime) || plan.targetTime <= 0 || plan.targetTime % (minutes * 60000)) throw Error('Invalid replay target');
  if (plan.selectTime !== plan.targetTime + minutes * 60000) throw Error('Invalid replay selection time');
  return plan;
}

export async function jumpToReplay(plan) {
  validateReplayPlan(plan);
  // Refuse to reset a replay session containing trades, including closed trades.
  await evaluateAsync(`(async()=>{${controller}
    if(unwrap(r.isReplayStarted())) {
      if(unwrap(r.isAutoplayStarted())) throw Error('Pause replay before opening another trade.');
      const ui=modern?r.tradingUIController():null;
      if(!modern || typeof ui?.isTradingReplaySessionHasExecutions !== 'function') throw Error('Close the current replay before opening another trade; its execution history could not be checked.');
      if(ui.isTradingReplaySessionHasExecutions()) throw Error('Current replay has executions. Finish or close that replay before opening another trade.');
    }
    return true;
  })()`);
  const initial = await getState();
  const _deps = { waitForChartReady: waitForReplayChart };
  if (initial.symbol !== plan.symbol) {
    const symbol = await setSymbol({ symbol: plan.symbol, _deps });
    if (!symbol.chart_ready) throw Error('TradingView did not load the requested symbol');
  }
  if (String(initial.resolution) !== String(plan.timeframe)) {
    const timeframe = await setTimeframe({ timeframe: String(plan.timeframe), _deps });
    if (!timeframe.chart_ready) throw Error('TradingView did not load the requested timeframe');
  }
  await evaluate(`(async()=>{${controller}
    if(modern){const available=r.replayAvailability().get(w.model().id());if(!available?.isAvailable)throw Error('Replay unavailable for this symbol/timeframe');await r.showReplayToolbar(false);await r.selectDate(w,${plan.selectTime});}
    else {if(!unwrap(r.isReplayAvailable()))throw Error('Replay unavailable for this symbol/timeframe');await r.showReplayToolbar();await r.selectDate(${plan.selectTime});}
    return true;
  })()`, { awaitPromise: true, timeout: 20000 });
  let state;
  for (let i = 0; i < 80; i++) {
    state = await evaluateAsync(`(async()=>{${controller}
      const c=a._activeChartWidgetWV.value();const last=w.model().mainSeries().bars().last();
      return {symbol:c.symbol(),timeframe:String(c.resolution()),started:unwrap(r.isReplayStarted()),autoplay:unwrap(r.isAutoplayStarted()),lastBarTime:last?.value?.[0]*1000};
    })()`);
    if (state.started && !state.autoplay && state.symbol === plan.symbol && state.timeframe === String(plan.timeframe) && state.lastBarTime === plan.targetTime) return state;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error(`Replay did not reach the requested candle (last bar: ${state?.lastBarTime ? new Date(state.lastBarTime).toISOString() : 'unavailable'})`);
}
