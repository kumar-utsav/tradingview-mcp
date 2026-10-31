// Shared rendering for user-supplied capture summaries. Never generates analysis.
const escape = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function summaryHtml(text) {
  text=String(text||'').trim();
  if(!text)return '';
  if(/^\s*#{1,6}\s/m.test(text))throw Error('Capture note summaries must not contain headings');
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(lines.every(line=>/^[-*]\s+/.test(line)))return '<ul>'+lines.map(line=>'<li><p>'+escape(line.replace(/^[-*]\s+/,''))+'</p></li>').join('')+'</ul>';
  return lines.map(line=>'<p>'+escape(line)+'</p>').join('');
}
export function appendSummary(existing,text) {
  const old=String(existing||''),html=summaryHtml(text);
  if(!html||old.includes(html)||old.trim()===String(text).trim())return old;
  return old+html;
}

export async function preflightNotes(page,{base=process.env.TRADING_API_URL||'http://100.125.89.9:5555',request=fetch}={}){
 if(!['journal','backtest'].includes(page))throw Error('Choose journal or backtest');
 const response=await request(base.replace(/\/$/,'')+'/'+page+'/capture-notes/registry',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Notes-only capture backend is unavailable; keep TradingView free');
 const status=await response.json();if(!status.ready)throw Error('Notes-only capture storage is not ready');
 return {...status,tradingview_used:false};
}
