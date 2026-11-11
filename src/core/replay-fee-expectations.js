// Client-side expectations for independent read-back verification only.
// Ingestion receives the untouched report and model ID; the server applies fees.
export const REPLAY_FEE_MODEL = 'mes_mnq_usd_0_73_per_contract_per_side_v1';
const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (rows, key) => cents(rows.reduce((n, row) => n + row[key], 0));
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.011;

export function expectedReplayFeeLedger(ledger, model) {
  if (model?.id !== REPLAY_FEE_MODEL || !model.request_id ||
      typeof model.applied_at !== 'string' || !Number.isFinite(Date.parse(model.applied_at)))
    throw Error('Supported replay fee model and stable amendment identity required');
  const costBasis = 'FIFO_verified_gross_with_user_approved_modeled_fees';
  const trades = ledger.trades.map(trade => {
    const source = {...trade, instrument: ledger.instrument, cost_basis: ledger.cost_basis};
    if (!/^(MES|MNQ)(1!|[FGHJKMNQUVXZ]\d{1,4})?$/.test(String(source.ticker).split(':').pop()) ||
        source.instrument?.type !== 'futures' || source.instrument.currency !== 'USD' || source.status !== 'closed')
      throw Error('Closed USD MES/MNQ execution required');
    const next = structuredClone(source);
    for (const tx of next.transactions) {
      tx.fees = cents(tx.quantity * 0.73);
      if (tx.commission != null) tx.commission = tx.fees;
    }
    for (const lot of next.matched_lots) {
      lot.commission = cents(lot.quantity * 1.46);
      lot.net_pnl = cents(lot.gross_pnl - lot.commission);
    }
    next.commission = sum(next.matched_lots, 'commission');
    next.net_pnl = cents(next.gross_pnl - next.commission);
    next.outcome = next.net_pnl > 0 ? 'Win' : next.net_pnl < 0 ? 'Loss' : 'BE';
    if (near(source.commission, next.commission) && near(source.net_pnl, next.net_pnl) &&
        source.transactions.every((tx, i) => near(tx.fees ?? tx.commission, next.transactions[i].fees)) &&
        source.matched_lots.every((lot, i) => near(lot.commission, next.matched_lots[i].commission) && near(lot.net_pnl, next.matched_lots[i].net_pnl)))
      return source;
    next.cost_basis = costBasis;
    next.commission_adjustment = {
      request_id: model.request_id, applied_at: model.applied_at,
      source: 'user_approved_modeled_fees',
      reason: 'Webull MES/MNQ total fees: $0.73 per contract per side; applied to recorded fills.',
      rate_per_contract_per_side: 0.73, round_trip_per_contract: 1.46,
      original_execution: structuredClone(source), original_commission: source.commission,
      original_net_pnl: source.net_pnl,
    };
    if (next.tick_capture?.lots) next.tick_capture.lots = next.tick_capture.lots.map((lot, i) => ({
      ...lot, commission: next.matched_lots[i].commission, net_pnl: next.matched_lots[i].net_pnl,
    }));
    return next;
  });
  return {...ledger, fee_model: {...model, rate_per_contract_per_side: 0.73, currency: 'USD', replaces_reported_fees: true},
    cost_basis: costBasis, net_pnl: sum(trades, 'net_pnl'), trades};
}
