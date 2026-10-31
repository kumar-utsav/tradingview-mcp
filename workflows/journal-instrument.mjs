export const isFuturesJournal=trade=>String(trade.type).toLowerCase()==='futures'||trade.transactions?.some(f=>f.instrumentType==='FUTURES')===true;
export function journalChartSymbol(ticker) {
  const symbol=String(ticker).trim().toUpperCase();
  const bare=symbol.split(':').pop().replace(/^\//,'');
  if(/^MES(?:[FGHJKMNQUVXZ]\d{1,4}|[12]!)?$/.test(bare))return 'CME_MINI:MES1!';
  return symbol.includes(':')?symbol:symbol==='SPY'?'AMEX:SPY':symbol==='QQQ'?'NASDAQ:QQQ':symbol;
}
export function firstJournalFill(trade){return [...trade.transactions].sort((a,b)=>Date.parse(a.filledTime)-Date.parse(b.filledTime))[0];}
export function journalStart(trade,stored){return isFuturesJournal(trade)?Math.floor(Date.parse(firstJournalFill(trade).filledTime)/1000/(Number(trade.time_frame)*60))*Number(trade.time_frame)*60:stored;}

// Most favorable actual closing fill for winners; final closing fill otherwise.
// Duration always remains the final flat exit candle.
export function journalTargetExit(trade) {
  const fills=[...trade.transactions].sort((a,b)=>Date.parse(a.filledTime)-Date.parse(b.filledTime));
  const first=fills[0], exits=fills.filter(f=>f.side!==first.side), final=exits.at(-1);
  if(!final)throw Error('Closing fill required');
  const cash=fills.reduce((sum,f)=>sum+(f.side==='SELL'?1:-1)*Number(f.quantity)*Number(f.price),0);
  const outcome=trade.journal_trade_id?Math.sign(cash):String(trade.outcome).toLowerCase()==='win'?1:String(trade.outcome).toLowerCase()==='loss'?-1:Math.sign(cash);
  if(outcome<=0)return final;
  return exits.reduce((best,f)=>first.side==='SELL'?(f.price<best.price?f:best):(f.price>best.price?f:best));
}
