/* Shape-outline LineEndpoint projection and legacy four-anchor compatibility. */
(function initMeldexBoardOutlineEndpoints(global) {
  'use strict';

  const LEGACY_PATH_T = Object.freeze({ top: 0, right: 0.25, bottom: 0.5, left: 0.75 });
  const LEGACY_ANCHOR_ALIASES = Object.freeze({
    'top-center': 'top', 'right-center': 'right',
    'bottom-center': 'bottom', 'left-center': 'left',
  });

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = clone(value[key]); });
    return result;
  }

  function normalizedBounds(value) {
    return {
      x: Number(value?.x) || 0,
      y: Number(value?.y) || 0,
      w: Math.max(1, Number(value?.w ?? value?.width) || 1),
      h: Math.max(1, Number(value?.h ?? value?.height) || 1),
    };
  }

  function arc(points, cx, cy, radius, start, end, steps) {
    for (let index = 1; index <= steps; index += 1) {
      const angle = start + ((end - start) * index) / steps;
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
  }

  function roundedRectanglePoints(bounds, radiusValue) {
    const { x, y, w, h } = normalizedBounds(bounds);
    const radius = Math.max(0, Math.min(Number(radiusValue) || 0, w / 2, h / 2));
    if (!radius) return [
      { x: x + w / 2, y }, { x: x + w, y }, { x: x + w, y: y + h },
      { x, y: y + h }, { x, y }, { x: x + w / 2, y },
    ];
    const points = [{ x: x + w / 2, y }, { x: x + w - radius, y }];
    arc(points, x + w - radius, y + radius, radius, -Math.PI / 2, 0, 6);
    points.push({ x: x + w, y: y + h - radius });
    arc(points, x + w - radius, y + h - radius, radius, 0, Math.PI / 2, 6);
    points.push({ x: x + radius, y: y + h });
    arc(points, x + radius, y + h - radius, radius, Math.PI / 2, Math.PI, 6);
    points.push({ x, y: y + radius });
    arc(points, x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, 6);
    points.push({ x: x + w / 2, y });
    return points;
  }

  function radialPoints(bounds, radiusAt, count) {
    const { x, y, w, h } = normalizedBounds(bounds);
    const points = [];
    for (let index = 0; index <= count; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
      const factor = radiusAt(angle, index);
      points.push({ x: x + w / 2 + Math.cos(angle) * w / 2 * factor,
        y: y + h / 2 + Math.sin(angle) * h / 2 * factor });
    }
    return points;
  }

  function speechPoints(bounds) {
    const { x, y, w, h } = normalizedBounds(bounds);
    return [
      { x: x + w / 2, y }, { x: x + w, y }, { x: x + w, y: y + h * 0.78 },
      { x: x + w * 0.72, y: y + h * 0.78 }, { x: x + w * 0.62, y: y + h },
      { x: x + w * 0.5, y: y + h * 0.78 }, { x, y: y + h * 0.78 }, { x, y },
      { x: x + w / 2, y },
    ];
  }

  function outlinePoints(shapeValue, bounds, options) {
    const shape = String(shapeValue || 'rect');
    const settings = options || {};
    const normalized = normalizedBounds(bounds);
    if (shape === 'ellipse') return radialPoints(bounds, () => 1, 96);
    if (shape === 'pill') return roundedRectanglePoints(bounds, Math.min(normalized.w, normalized.h) / 2);
    if (shape === 'octagon') return radialPoints(bounds, () => 1, 8);
    if (['cloud', 'fluffy'].includes(shape)) {
      const depth = shape === 'cloud' ? 0.1 : 0.055;
      return radialPoints(bounds, (angle) => 1 + depth * Math.cos(angle * 10), 160);
    }
    if (['thorn', 'spiky'].includes(shape)) {
      return radialPoints(bounds, (_angle, index) => (index % 2 ? 0.7 : 1), 24);
    }
    if (shape === 'thorn-curve') {
      return radialPoints(bounds, (angle) => 0.84 + 0.16 * Math.cos(angle * 12), 192);
    }
    if (['speech', 'speech-bubble', 'balloon'].includes(shape)) return speechPoints(bounds);
    const radius = shape === 'rounded'
      ? (settings.borderRadius || Math.min(normalized.w, normalized.h) / 5)
      : settings.borderRadius;
    return roundedRectanglePoints(bounds, radius);
  }

  function pathMetrics(points) {
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      lengths.push(lengths[index - 1] + Math.hypot(
        points[index].x - points[index - 1].x, points[index].y - points[index - 1].y,
      ));
    }
    return { lengths, total: lengths[lengths.length - 1] || 1 };
  }

  function pointAtPathT(shape, bounds, pathT, options) {
    const points = outlinePoints(shape, bounds, options);
    const metrics = pathMetrics(points);
    const normalized = ((Number(pathT) || 0) % 1 + 1) % 1;
    const distance = normalized * metrics.total;
    let index = 1;
    while (index < metrics.lengths.length - 1 && metrics.lengths[index] < distance) index += 1;
    const before = metrics.lengths[index - 1];
    const span = Math.max(1e-9, metrics.lengths[index] - before);
    const ratio = (distance - before) / span;
    return {
      x: points[index - 1].x + (points[index].x - points[index - 1].x) * ratio,
      y: points[index - 1].y + (points[index].y - points[index - 1].y) * ratio,
      segment: index - 1,
    };
  }

  function projectToSegment(point, first, second) {
    const dx = second.x - first.x; const dy = second.y - first.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const ratio = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared));
    const x = first.x + dx * ratio; const y = first.y + dy * ratio;
    return { x, y, ratio, distanceSquared: (point.x - x) ** 2 + (point.y - y) ** 2 };
  }

  function intersectDragSegment(point, toward, first, second) {
    const dragX = toward.x - point.x; const dragY = toward.y - point.y;
    const edgeX = second.x - first.x; const edgeY = second.y - first.y;
    const denominator = dragX * edgeY - dragY * edgeX;
    if (Math.abs(denominator) < 1e-9) return null;
    const offsetX = first.x - point.x; const offsetY = first.y - point.y;
    const dragRatio = (offsetX * edgeY - offsetY * edgeX) / denominator;
    const edgeRatio = (offsetX * dragY - offsetY * dragX) / denominator;
    if (dragRatio < -1e-7 || dragRatio > 1 + 1e-7 || edgeRatio < -1e-7 || edgeRatio > 1 + 1e-7) return null;
    return {
      x: point.x + dragX * dragRatio,
      y: point.y + dragY * dragRatio,
      ratio: Math.max(0, Math.min(1, edgeRatio)),
      dragRatio: Math.max(0, Math.min(1, dragRatio)),
      distanceSquared: 0,
    };
  }

  function projectPointToOutline(shape, boundsValue, pointValue, options) {
    const bounds = normalizedBounds(boundsValue);
    const point = { x: Number(pointValue?.x) || 0, y: Number(pointValue?.y) || 0 };
    const points = outlinePoints(shape, bounds, options);
    const metrics = pathMetrics(points);
    let best = null;
    const toward = options?.towardPoint && {
      x: Number(options.towardPoint.x) || 0,
      y: Number(options.towardPoint.y) || 0,
    };
    const useDragIntersection = toward && Math.hypot(toward.x - point.x, toward.y - point.y) > 1e-7;
    if (useDragIntersection) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const intersection = intersectDragSegment(point, toward, points[index], points[index + 1]);
        if (!intersection) continue;
        const candidate = { ...intersection, segment: index };
        if (!best || candidate.dragRatio < best.dragRatio) best = candidate;
      }
    }
    if (!best) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const candidate = { ...projectToSegment(point, points[index], points[index + 1]), segment: index };
        const tied = best && Math.abs(candidate.distanceSquared - best.distanceSquared) <= 0.25;
        if (!best || candidate.distanceSquared < best.distanceSquared
            || (tied && index === options?.previousSegment)) best = candidate;
      }
    }
    let length = metrics.lengths[best.segment]
      + (metrics.lengths[best.segment + 1] - metrics.lengths[best.segment]) * best.ratio;
    const snapDistance = Math.max(0, Number(options?.snapDistance) || 0);
    if (snapDistance > 0) {
      let snapped = null;
      Object.values(LEGACY_PATH_T).forEach((pathT) => {
        const candidate = pointAtPathT(shape, bounds, pathT, options);
        const distanceSquared = (best.x - candidate.x) ** 2 + (best.y - candidate.y) ** 2;
        if (distanceSquared <= snapDistance ** 2
            && (!snapped || distanceSquared < snapped.distanceSquared)) {
          snapped = { ...candidate, pathT, distanceSquared };
        }
      });
      if (snapped) {
        best = { ...best, x: snapped.x, y: snapped.y, segment: snapped.segment };
        length = snapped.pathT * metrics.total;
      }
    }
    const pathT = length / metrics.total;
    return {
      point: { x: best.x, y: best.y },
      outlinePosition: {
        mode: 'outline', pathT, segment: best.segment,
        localHint: { xRatio: (best.x - bounds.x) / bounds.w, yRatio: (best.y - bounds.y) / bounds.h },
      },
    };
  }

  function legacyAnchorToOutline(anchor) {
    const canonical = LEGACY_ANCHOR_ALIASES[anchor] || anchor;
    if (!Object.prototype.hasOwnProperty.call(LEGACY_PATH_T, canonical)) return null;
    return { mode: 'outline', pathT: LEGACY_PATH_T[canonical], legacyAnchor: anchor };
  }

  function projectLegacyAnchor(shape, boundsValue, anchor, options) {
    const bounds = normalizedBounds(boundsValue);
    const canonical = LEGACY_ANCHOR_ALIASES[anchor] || anchor;
    const points = {
      top: { x: bounds.x + bounds.w / 2, y: bounds.y },
      right: { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
      bottom: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
      left: { x: bounds.x, y: bounds.y + bounds.h / 2 },
    };
    if (!points[canonical]) return null;
    const projected = projectPointToOutline(shape, bounds, points[canonical], options);
    projected.outlinePosition.legacyAnchor = anchor;
    return projected;
  }

  function outlineToLegacyAnchor(position, tolerance) {
    const pathT = ((Number(position?.pathT) || 0) % 1 + 1) % 1;
    const limit = Number.isFinite(+tolerance) ? +tolerance : 0.06;
    let best = null;
    Object.entries(LEGACY_PATH_T).forEach(([name, value]) => {
      const distance = Math.min(Math.abs(pathT - value), 1 - Math.abs(pathT - value));
      if (!best || distance < best.distance) best = { name, distance };
    });
    return best.distance <= limit ? best.name : null;
  }

  function normalizeEndpoint(value) {
    const source = clone(value || {});
    if (!['topic', 'group', 'point'].includes(source.targetKind)) {
      throw new TypeError('LineEndpoint.targetKind is invalid');
    }
    if (source.targetKind === 'point') {
      const point = source.targetRef || source.point;
      source.targetRef = { x: Number(point?.x) || 0, y: Number(point?.y) || 0 };
    } else if (source.targetRef == null || source.targetRef === '') {
      throw new TypeError('LineEndpoint.targetRef is required');
    }
    if (typeof source.outlinePosition === 'string') {
      source.outlinePosition = legacyAnchorToOutline(source.outlinePosition);
    }
    if (!source.outlinePosition && source.legacyAnchor) {
      source.outlinePosition = legacyAnchorToOutline(source.legacyAnchor);
    }
    return source;
  }

  function endpointFromLegacy(line, side, topicRefByLegacyId) {
    const endpoint = line?.[`${side}Endpoint`];
    if (endpoint) {
      const normalized = normalizeEndpoint(endpoint);
      if (normalized.targetKind === 'topic' && typeof normalized.targetRef === 'string'
          && topicRefByLegacyId?.[normalized.targetRef]) {
        normalized.targetRef = clone(topicRefByLegacyId[normalized.targetRef]);
      }
      return normalized;
    }
    const point = line?.[`${side}Point`];
    if (point) return normalizeEndpoint({ targetKind: 'point', targetRef: point });
    const legacyId = line?.[side];
    const targetRef = line?.[`${side}TopicRef`] || topicRefByLegacyId?.[legacyId] || legacyId;
    return normalizeEndpoint({
      targetKind: 'topic', targetRef,
      outlinePosition: legacyAnchorToOutline(line?.[`${side}Anchor`]) || undefined,
      legacyAnchor: line?.[`${side}Anchor`] || undefined,
    });
  }

  function legacyEndpointFields(endpointValue) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (endpoint.targetKind === 'point') return { point: clone(endpoint.targetRef) };
    return {
      id: typeof endpoint.targetRef === 'string'
        ? endpoint.targetRef : endpoint.targetRef.topicId || endpoint.targetRef.groupId,
      anchor: endpoint.legacyAnchor || outlineToLegacyAnchor(endpoint.outlinePosition),
    };
  }

  function lookupGeometry(endpoint, geometry) {
    if (endpoint.targetKind === 'group') {
      const id = typeof endpoint.targetRef === 'string' ? endpoint.targetRef : endpoint.targetRef.groupId;
      return geometry?.groups instanceof Map ? geometry.groups.get(id) : geometry?.groups?.[id];
    }
    const ref = endpoint.targetRef;
    const key = typeof ref === 'string' ? ref : JSON.stringify([ref?.sourceId, ref?.topicId]);
    return geometry?.topics instanceof Map ? geometry.topics.get(key) : geometry?.topics?.[key];
  }

  function resolveEndpoint(endpointValue, geometry) {
    const endpoint = normalizeEndpoint(endpointValue);
    if (endpoint.targetKind === 'point') return { status: 'resolved', point: clone(endpoint.targetRef), endpoint };
    const target = lookupGeometry(endpoint, geometry);
    if (!target) return { status: 'missing-target', point: null, endpoint };
    const position = endpoint.outlinePosition || legacyAnchorToOutline(endpoint.legacyAnchor || 'right');
    if (position?.legacyAnchor) {
      const projected = projectLegacyAnchor(target.shape || 'rect', target, position.legacyAnchor, target);
      return { status: 'resolved', point: projected.point,
        endpoint: { ...endpoint, outlinePosition: projected.outlinePosition } };
    }
    const point = pointAtPathT(target.shape || 'rect', target, position.pathT, target);
    return { status: 'resolved', point: { x: point.x, y: point.y }, endpoint };
  }

  function normalizeLine(line, topicRefByLegacyId) {
    const result = clone(line || {});
    result.fromEndpoint = endpointFromLegacy(result, 'from', topicRefByLegacyId);
    result.toEndpoint = endpointFromLegacy(result, 'to', topicRefByLegacyId);
    return result;
  }

  function nudgeOutlinePosition(position, direction, options) {
    const step = Math.max(0.001, Number(options?.step) || 0.01);
    const delta = direction === 'backward' || direction === 'previous' ? -step : step;
    const result = clone(position || { mode: 'outline', pathT: 0 });
    result.mode = 'outline'; result.pathT = ((Number(result.pathT) || 0) + delta + 1) % 1;
    delete result.legacyAnchor;
    return result;
  }

  function handleContract(pointerType) {
    const touch = pointerType === 'touch';
    return { visualSize: touch ? 28 : 12, hitTargetSize: touch ? 44 : 24,
      keyboardStep: 0.01, coarsePointer: touch };
  }

  global.MeldexBoardOutlineEndpoints = Object.freeze({
    outlinePoints, pointAtPathT, projectPointToOutline, legacyAnchorToOutline, projectLegacyAnchor,
    outlineToLegacyAnchor, normalizeEndpoint, endpointFromLegacy, legacyEndpointFields,
    resolveEndpoint, normalizeLine, nudgeOutlinePosition, handleContract,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
