import { randomUUID, createHash } from 'node:crypto';
import { evaluate, evaluateAsync, getClient } from '../src/connection.js';
import {
  activeChartBoundsExpression, beginPositionIsolationExpression,
  showOnlyPositionExpression, restorePositionIsolationExpression,
} from '../src/core/trading-sync.js';
import { removeOne } from '../src/core/drawing.js';

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);

async function screenshotBytes() {
  const bounds = await evaluate(activeChartBoundsExpression);
  if (!bounds || !(bounds.width > 0 && bounds.height > 0)) throw Error('Active chart screenshot bounds unavailable');
  const client = await getClient();
  const {data} = await client.Page.captureScreenshot({format:'png',clip:{
    x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,scale:1,
  }});
  return Buffer.from(data || '', 'base64');
}

function imageHash(image) {
  if (!Buffer.isBuffer(image) || image.length <= 8 || !image.subarray(0,8).equals(PNG_SIGNATURE)) {
    throw Error('Journal screenshot was empty or not a PNG');
  }
  return createHash('sha256').update(image).digest('hex');
}

/** In-memory capture: no unchecked PNG or disposable CDP screenshot is written. */
export async function captureJournalTradeImage({tradeId, positionId, annotationIds, seenImages}, deps = {}) {
  const read = deps.evaluate || evaluate;
  const asyncRead = deps.evaluateAsync || evaluateAsync;
  const capture = deps.capture || screenshotBytes;
  const key = randomUUID();
  const started = await read(beginPositionIsolationExpression(key));
  if (!started?.success) {
    const error = Error(started?.error || 'Journal position isolation could not start');
    error.captureUnsafe = true;
    throw error;
  }
  let result, failure;
  try {
    const blocked = new Set(seenImages);
    // This is a rejection control, never an accepted trade image.
    if (started.visible_positions > 1) blocked.add(imageHash(await capture()));
    const hidden = await asyncRead(showOnlyPositionExpression(key, null));
    if (!hidden?.success) throw Error(hidden?.error || 'Journal tools could not be hidden');
    blocked.add(imageHash(await capture()));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const isolated = await asyncRead(showOnlyPositionExpression(key, positionId));
      if (!isolated?.success) throw Error(isolated?.error || 'Journal trade could not be isolated');
      const annotations = await read(`(function() {
        /* journal-annotation-visibility */
        var chart=${CHART}, ids=${JSON.stringify(annotationIds.map(String))};
        return ids.every(function(id) {
          var shape=chart.getShapeById(id), p=shape && shape.getProperties();
          var visible=p && p.visible;
          if (visible && typeof visible.value === 'function') visible=visible.value();
          return visible === true;
        });
      })()`);
      if (annotations !== true) throw Error('Journal tool, fill callout or leader visibility could not be verified');
      const image = await capture(), hash = imageHash(image);
      if (!blocked.has(hash)) {
        result = {image, hash, screenshot_checks:{position_visibility_verified:true,
          annotations_visible:true, redraw_confirmed:true, repeated_frame_rejected:true, attempts:attempt}};
        break;
      }
    }
    if (!result) throw Error(`Trade ${tradeId}: stale, duplicate or multi-tool screenshot persisted after 3 attempts`);
  } catch (error) { failure = error; }
  const restored = await asyncRead(restorePositionIsolationExpression(key)).catch(() => null);
  if (!restored?.success) failure = Error(`${failure ? failure.message + '. ' : ''}Original position visibility could not be restored; stop and retain recovery state`);
  if (failure) { failure.captureUnsafe = true; throw failure; }
  seenImages.add(result.hash);
  return result;
}

/** Attempt every removal, then independently check that no generated mark remains. */
export async function removeJournalAnnotations(ids, deps = {}) {
  const remove = deps.remove || removeOne, read = deps.evaluate || evaluate;
  const errors = [];
  for (const id of [...ids].reverse()) {
    try { await remove({entity_id:id}); } catch (error) { errors.push(error.message); }
  }
  let remaining;
  try {
    remaining = await read(`(function() {
      /* journal-annotation-cleanup */
      var ids=${JSON.stringify(ids.map(String))};
      return (${CHART}.getAllShapes() || []).filter(function(s) {
        return ids.indexOf(String(s.id)) !== -1;
      }).map(function(s) { return String(s.id); });
    })()`);
  } catch (error) { errors.push(error.message); }
  if (!Array.isArray(remaining) || remaining.length) {
    const error = Error(`Temporary journal annotations could not be removed and verified: ${remaining?.join(', ') || 'unknown state'}. ${errors.join('. ')}`);
    error.captureUnsafe = true;
    throw error;
  }
}
