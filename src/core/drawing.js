/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate, getChartApi: deps?.getChartApi || _getChartApi };
}

const TOOLTIP_MANAGER_KEY = '__tvmcpDrawingTooltipManagerV1';

function normalizeReferenceLevels(referenceLevels) {
  if (!referenceLevels) return [];
  if (!Array.isArray(referenceLevels)) throw new Error('reference_levels must be an array');
  return referenceLevels.map((level, index) => ({
    label: String(level?.label || '').trim() || `Level ${index + 1}`,
    price: requireFinite(level?.price, `reference_levels[${index}].price`),
  }));
}

function tooltipInstallExpression({ apiPath, entityId, tooltip, low, high, tolerance, referenceLevels, dynamicSessionLevels }) {
  const center = (low + high) / 2;
  const resolvedTolerance = tolerance === undefined
    ? Math.max(Math.abs(center) * 0.00005, Math.abs(high - low) * 0.5, 1e-8)
    : requireFinite(tolerance, 'tooltip_tolerance');
  if (resolvedTolerance < 0) throw new Error('tooltip_tolerance must be non-negative');

  return `
    (function() {
      var key = ${safeString(TOOLTIP_MANAGER_KEY)};
      var manager = window[key];
      if (!manager) {
        var element = document.createElement('div');
        element.setAttribute('data-tvmcp-drawing-tooltip', 'true');
        Object.assign(element.style, {
          position: 'fixed',
          display: 'none',
          pointerEvents: 'none',
          zIndex: '2147483647',
          maxWidth: '320px',
          padding: '7px 9px',
          borderRadius: '6px',
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'rgba(22, 27, 34, 0.96)',
          color: '#F8FAFC',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          font: '12px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          whiteSpace: 'pre-line'
        });
        document.body.appendChild(element);
        manager = { items: {}, element: element, chart: ${apiPath}, handler: null };
        window[key] = manager;
      }
      if (!manager.pointerHandler) {
        manager.pointerX = null;
        manager.pointerY = null;
        manager.pointerHandler = function(event) {
          manager.pointerX = event.clientX;
          manager.pointerY = event.clientY;
        };
        document.addEventListener('pointermove', manager.pointerHandler, true);
        document.addEventListener('mousemove', manager.pointerHandler, true);
      }
      if (!manager.getDynamicSessionLevels) {
        manager.getDynamicSessionLevels = function() {
          try {
            var bars = manager.chart._chartWidget.model().mainSeries().bars();
            var end = bars.lastIndex();
            var last = bars.valueAt(end);
            if (!last) return [];
            var cacheKey = [bars.size(), end, last[0], last[1], last[2], last[3], last[4]].join(':');
            if (manager.sessionLevelCache && manager.sessionLevelCache.key === cacheKey) {
              return manager.sessionLevelCache.levels;
            }
            if (!manager.etFormatter) {
              manager.etFormatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/New_York',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false
              });
            }
            var getParts = function(timestamp) {
              var parts = manager.etFormatter.formatToParts(new Date(timestamp * 1000));
              var result = {};
              parts.forEach(function(part) { result[part.type] = part.value; });
              var hour = Number(result.hour) % 24;
              return {
                date: result.year + '-' + result.month + '-' + result.day,
                minutes: hour * 60 + Number(result.minute)
              };
            };
            var current = getParts(last[0]);
            var today = [];
            for (var index = end; index >= bars.firstIndex(); index--) {
              var bar = bars.valueAt(index);
              if (!bar) continue;
              var parts = getParts(bar[0]);
              if (parts.date !== current.date) break;
              today.push({ bar: bar, minutes: parts.minutes });
            }
            today.reverse();
            var levels = [];
            var addRange = function(rows, highLabel, lowLabel) {
              if (!rows.length) return;
              var highs = rows.map(function(row) { return row.bar[2]; });
              var lows = rows.map(function(row) { return row.bar[3]; });
              levels.push({ label: highLabel, price: Math.max.apply(null, highs) });
              levels.push({ label: lowLabel, price: Math.min.apply(null, lows) });
            };
            var premarket = today.filter(function(row) { return row.minutes >= 240 && row.minutes < 570; });
            if (current.minutes >= 240) addRange(premarket, 'PMH', 'PML');
            var currentDay = today.filter(function(row) { return row.minutes >= 570; });
            if (current.minutes >= 570 && currentDay.length) {
              levels.push({ label: 'Open', price: currentDay[0].bar[1] });
              addRange(currentDay, 'High', 'Low');
            }
            if (current.minutes >= 575) {
              addRange(today.filter(function(row) { return row.minutes >= 570 && row.minutes < 575; }), '5MH', '5ML');
            }
            if (current.minutes >= 585) {
              addRange(today.filter(function(row) { return row.minutes >= 570 && row.minutes < 585; }), '15MH', '15ML');
            }
            manager.sessionLevelCache = { key: cacheKey, levels: levels };
            return levels;
          } catch (error) {
            return [];
          }
        };
      }
      if (manager.handler && manager.anchorVersion !== 3) {
        try { manager.chart.crossHairMoved().unsubscribe(null, manager.handler); } catch (error) {}
        manager.handler = null;
      }
      if (!manager.handler) {
        manager.handler = function(params) {
          if (!params || !Number.isFinite(params.price)) {
            manager.element.style.display = 'none';
            return;
          }
          var best = null;
          var bestDistance = Infinity;
          Object.keys(manager.items).forEach(function(id) {
            var item = manager.items[id];
            var distance = params.price < item.low
              ? item.low - params.price
              : params.price > item.high ? params.price - item.high : 0;
            if (distance <= item.tolerance && distance < bestDistance) {
              best = item;
              bestDistance = distance;
            }
          });
          if (!best) {
            manager.element.style.display = 'none';
            return;
          }
          if (!Number.isFinite(manager.pointerX) || !Number.isFinite(manager.pointerY)) {
            manager.element.style.display = 'none';
            return;
          }
          var references = (best.referenceLevels || []).slice();
          if (best.dynamicSessionLevels) references = references.concat(manager.getDynamicSessionLevels());
          var touches = [];
          var seenTouches = {};
          references.forEach(function(level) {
            if (!level || !Number.isFinite(level.price)) return;
            if (level.price < best.low - best.tolerance || level.price > best.high + best.tolerance) return;
            var key = level.label + ':' + level.price;
            if (seenTouches[key]) return;
            seenTouches[key] = true;
            touches.push(level.label + ' ' + level.price.toFixed(2));
          });
          manager.element.textContent = best.text + '\\n' + (touches.length
            ? 'Touches: ' + touches.join(', ')
            : 'No Key Levels indicator touch');
          manager.element.style.display = 'block';
          var width = manager.element.offsetWidth || 320;
          var height = manager.element.offsetHeight || 80;
          var left = Math.max(8, Math.min(manager.pointerX + 14, window.innerWidth - width - 8));
          var top = Math.max(8, Math.min(manager.pointerY + 14, window.innerHeight - height - 8));
          manager.element.style.left = left + 'px';
          manager.element.style.top = top + 'px';
        };
        manager.chart.crossHairMoved().subscribe(null, manager.handler);
        manager.anchorVersion = 3;
      }
      manager.items[${safeString(entityId)}] = {
        text: ${safeString(tooltip)},
        low: ${low},
        high: ${high},
        tolerance: ${resolvedTolerance},
        referenceLevels: JSON.parse(${safeString(JSON.stringify(referenceLevels || []))}),
        dynamicSessionLevels: ${dynamicSessionLevels ? 'true' : 'false'}
      };
      return { registered: true, entity_id: ${safeString(entityId)} };
    })()
  `;
}

async function registerTooltip({ evaluate, apiPath, entityId, tooltip, low, high, tolerance, referenceLevels, dynamicSessionLevels }) {
  if (!entityId || !tooltip) return false;
  await evaluate(tooltipInstallExpression({
    apiPath,
    entityId,
    tooltip,
    low,
    high,
    tolerance,
    referenceLevels: normalizeReferenceLevels(referenceLevels),
    dynamicSessionLevels,
  }));
  return true;
}

export async function drawShape({ shape, point, point2, overrides: overridesRaw, text, tooltip, tooltip_tolerance, reference_levels, dynamic_session_levels, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const overrides = overridesRaw ? (typeof overridesRaw === 'string' ? JSON.parse(overridesRaw) : overridesRaw) : {};
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides || {});
  const textStr = text ? JSON.stringify(text) : '""';

  const p1time = requireFinite(point.time, 'point.time');
  const p1price = requireFinite(point.price, 'point.price');

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  if (point2) {
    const p2time = requireFinite(point2.time, 'point2.time');
    const p2price = requireFinite(point2.price, 'point2.price');
    await evaluate(`
      ${apiPath}.createMultipointShape(
        [{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }],
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    await evaluate(`
      ${apiPath}.createShape(
        { time: ${p1time}, price: ${p1price} },
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  const low = Math.min(p1price, point2 ? Number(point2.price) : p1price);
  const high = Math.max(p1price, point2 ? Number(point2.price) : p1price);
  const tooltipRegistered = await registerTooltip({
    evaluate,
    apiPath,
    entityId: newId,
    tooltip,
    low,
    high,
    tolerance: tooltip_tolerance,
    referenceLevels: reference_levels,
    dynamicSessionLevels: dynamic_session_levels,
  });
  const result = { entity_id: newId };
  return { success: true, shape, entity_id: result?.entity_id, tooltip_registered: tooltipRegistered };
}

export async function setTooltip({ entity_id, tooltip, lower_price, upper_price, tooltip_tolerance, reference_levels, dynamic_session_levels, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const entityId = String(entity_id);
  const shapeData = await evaluate(`
    (function() {
      var shape = ${apiPath}.getShapeById(${safeString(entityId)});
      if (!shape) return null;
      return { points: shape.getPoints ? shape.getPoints() : [] };
    })()
  `);
  if (!shapeData) throw new Error(`Shape not found: ${entityId}`);
  const prices = (shapeData.points || []).map(point => Number(point.price)).filter(Number.isFinite);
  if (lower_price !== undefined) prices.push(requireFinite(lower_price, 'lower_price'));
  if (upper_price !== undefined) prices.push(requireFinite(upper_price, 'upper_price'));
  if (!prices.length) throw new Error(`Drawing ${entityId} has no price coordinates`);
  const low = lower_price === undefined ? Math.min(...prices) : requireFinite(lower_price, 'lower_price');
  const high = upper_price === undefined ? Math.max(...prices) : requireFinite(upper_price, 'upper_price');
  if (low > high) throw new Error('lower_price must be less than or equal to upper_price');
  await registerTooltip({
    evaluate,
    apiPath,
    entityId,
    tooltip,
    low,
    high,
    tolerance: tooltip_tolerance,
    referenceLevels: reference_levels,
    dynamicSessionLevels: dynamic_session_levels,
  });
  return { success: true, entity_id: entityId, tooltip_registered: true, lower_price: low, upper_price: high };
}

export async function listDrawings() {
  const apiPath = await _getChartApi();
  const shapes = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { return { id: s.id, name: s.name }; });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export async function getProperties({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      var methods = [];
      try { for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = shape.isVisible(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      var manager = window[${safeString(TOOLTIP_MANAGER_KEY)}];
      if (manager && manager.items) delete manager.items[eid];
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id: result?.entity_id, removed: result?.removed, remaining_shapes: result?.remaining_shapes };
}

export async function clearAll() {
  const apiPath = await _getChartApi();
  await _evaluate(`
    (function() {
      ${apiPath}.removeAllShapes();
      var manager = window[${safeString(TOOLTIP_MANAGER_KEY)}];
      if (manager && manager.items) manager.items = {};
    })()
  `);
  return { success: true, action: 'all_shapes_removed' };
}
