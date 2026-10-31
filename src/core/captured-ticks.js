// Price movement per contract; quantity weights partial exits, never multiplies
// the displayed move. Contract-ticks remain a separate accounting measure.
const clean=n=>Number(n.toFixed(10));
export function capturedTicks(lots,tickSize,{price_basis='execution_fills'}={}) {
 if(!Number.isFinite(tickSize)||tickSize<=0)throw Error('Verified instrument tick size required');
 if(!Array.isArray(lots)||!lots.length)throw Error('Closed matched entry/exit lots required');
 const rows=lots.map(l=>{
  if(!['long','short'].includes(l.direction)||![l.entry_price,l.exit_price,l.quantity].every(Number.isFinite)||l.quantity<=0)throw Error('Invalid matched lot for captured ticks');
  return {...l,ticks:clean((l.exit_price-l.entry_price)*(l.direction==='long'?1:-1)/tickSize)};
 });
 const quantity=rows.reduce((s,r)=>s+r.quantity,0),contractTicks=clean(rows.reduce((s,r)=>s+r.ticks*r.quantity,0));
 return {version:1,status:'verified',price_basis,tick_size:tickSize,quantity,captured_ticks:clean(contractTicks/quantity),contract_ticks:contractTicks,method:'quantity_weighted_matched_exits',lots:rows};
}
export function ticksNote(metric) {
 if(metric.status!=='verified')return `Actual entry-to-exit ticks unavailable: ${metric.reason}`;
 return `Actual entry-to-exit move: ${metric.captured_ticks} ticks (quantity-weighted across exits; tick size ${metric.tick_size}).`;
}
