import {evaluate} from '../connection.js';
const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';
export function parsePositionRRLabel(label, compact=false) {
  if(typeof label!=='string')throw Error('RR requires the TradingView position-tool label');
  const token=compact?label.trim().split('\n').at(-1):label.match(/risk\s*\/\s*reward\s+ratio\s*:\s*([^\n]+)/i)?.[1];
  if(!token || !/^\d+(?:[.,]\d+)?$/.test(token.trim()))throw Error('RR could not be read from the TradingView position-tool label');
  const value=Number(token.trim().replace(',','.'));
  if(!Number.isFinite(value))throw Error('Invalid position-tool RR');
  return value;
}
export function positionRR(annotations) {
  const read=annotations?.position_rr;
  if(!read || read.entity_id!==annotations.position_entity_id || !['tradingview_position_tool_label','visual_position_tool_label'].includes(read.source))throw Error('RR requires a label read from the matched position tool');
  const value=parsePositionRRLabel(read.label,read.compact===true);
  if(read.value!==value)throw Error('RR read-back value must match the position-tool label');
  return value;
}
// Ask TradingView's own label formatter for its value. A detached receiver captures
// the text without replacing renderer data or changing the user's drawing.
export async function readPositionRR(entityId, {evaluateChart=evaluate}={}) {
  const read=await evaluateChart(`(function() {
    var source=${CHART}._chartWidget.model().dataSourceForId(${JSON.stringify(entityId)});
    if(!source)throw Error('Position drawing is unavailable');
    var properties=source.properties().childs();
    if(!properties.infoBlocks.childs().riskRewardRatio.childs().visible.value())throw Error('Position-tool RR label is hidden');
    var views=Array.from(source._paneViews.values()).flat();
    var view=views.find(function(v){return typeof v._createMiddleLabel==='function'});
    if(!view)throw Error('TradingView position-tool label reader is unavailable');
    var reader=Object.create(view);
    // Newer renderers access pixel points before the first paint. The detached
    // label reader needs only a harmless position; prices still come from source.
    reader._points=[{x:0,y:0},{x:100,y:0}];
    reader._addCenterLabel=function(renderer,label,data){return data.txt};
    var label=view._createMiddleLabel.call(reader,{
      entryPrice:source.entryPrice(),profitPrice:source.profitPrice(),stopPrice:source.stopPrice(),
      currentPrice:source.entryPrice(),pl:0,left:0,edge:100,isClosed:false
    },null,source.ownerSource().symbolSource().symbolInfo());
    return {label:label,compact:properties.compact.value()};
  })()`);
  return {entity_id:entityId,source:'tradingview_position_tool_label',...read,
    value:parsePositionRRLabel(read.label,read.compact)};
}

