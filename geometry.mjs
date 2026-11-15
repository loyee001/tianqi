/** One map coordinate unit represents this many metres in the sample campus. */
export const SAMPLE_METERS_PER_PIXEL = 48 / 570;

const isPoint = point => point !== null && typeof point === 'object'
  && Number.isFinite(point.x) && Number.isFinite(point.y);

// Avoid overflowing two large coordinates when their average is representable.
const average = (a, b) => Number.isFinite(a + b) ? (a + b) / 2 : a / 2 + b / 2;
const midpoint = (a, b) => ({ x: average(a.x, b.x), y: average(a.y, b.y) });

/**
 * Sample a quadratic Bézier from start to end through the third point at t=.5.
 * Its control point is 2 * through - (start + end) / 2. Sampling adapts to
 * curvature; returned points include the exact three supplied coordinates.
 *
 * Each accepted chord is bounded by its local control polygon. The sum of
 * these length gaps is at most 1e-5 of the original control polygon length,
 * apart from floating-point roundoff. A second tolerance (1e-4 of that length)
 * limits midpoint deviation for a smooth visible curve. These are geometric
 * approximation tolerances, not limits on a user's route length or budget.
 * At extreme coordinate magnitudes, machine precision sets the tolerance floor.
 * Invalid/coincident endpoints or unrepresentable arithmetic return null.
 */
export function curveThroughPoint(start, end, through) {
  if (![start, end, through].every(isPoint)) return null;
  if (start.x === end.x && start.y === end.y) return null;
  const center = midpoint(start, end);
  const control = {
    x: through.x + (through.x - center.x),
    y: through.y + (through.y - center.y),
  };
  if (!isPoint(control)) return null;
  const upperLength = polylineLength([start, control, end]);
  if (upperLength === null || upperLength <= 0) return null;
  const magnitude = Math.max(...[start, end, through, control].flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  const precisionFloor = Math.max(Number.MIN_VALUE, magnitude * Number.EPSILON * 8);
  const lengthTolerance = Math.max(upperLength * 1e-5, precisionFloor);
  const shapeTolerance = Math.max(upperLength * 1e-4, precisionFloor);
  const interior = typeof start.interior === 'string' && start.interior
    && start.interior === end.interior && start.interior === through.interior ? start.interior : null;
  const copy = p => ({ x: p.x, y: p.y, ...(interior ? { interior } : {}) });
  const points = [copy(start)];
  // Splitting at .5 before flattening makes the requested through point exact,
  // including when one side needs more subdivision than the other.
  const pending = [
    { a: through, c: midpoint(control, end), b: end, from: .5, to: 1 },
    { a: start, c: midpoint(start, control), b: through, from: 0, to: .5 },
  ];
  while (pending.length) {
    const segment = pending.pop();
    const { a, c, b, from, to } = segment;
    const polygonLength = polylineLength([a, c, b]);
    const chordLength = polylineLength([a, b]);
    if (polygonLength === null || chordLength === null) return null;
    const midChord = midpoint(a, b);
    const deviation = Math.hypot(c.x - midChord.x, c.y - midChord.y) / 2;
    const rounding = Math.max(Number.MIN_VALUE, polygonLength * Number.EPSILON * 8);
    if (polygonLength - chordLength <= lengthTolerance * (to - from) + rounding && deviation <= shapeTolerance) {
      points.push(copy(b));
      continue;
    }
    const time = average(from, to);
    if (time === from || time === to) return null;
    const leftControl = midpoint(a, c), rightControl = midpoint(c, b);
    const split = midpoint(leftControl, rightControl);
    pending.push({ a: split, c: rightControl, b, from: time, to });
    pending.push({ a, c: leftControl, b: split, from, to: time });
  }
  return polylineLength(points) === null ? null : points;
}

/**
 * Euclidean length of a polyline, in the points' coordinate units.
 * Empty / single-point routes and repeated adjacent points have zero length.
 * Invalid coordinates (including NaN) return null; they are never skipped or
 * joined across. There is no route-point or business-distance maximum.
 */
export function polylineLength(points) {
  if (!Array.isArray(points)) return null;
  let total = 0;
  let compensation = 0;
  let previous = null;
  for (const point of points) {
    if (!isPoint(point)) return null;
    if (previous) {
      const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (!Number.isFinite(segment)) return null;
      // Compensated summation preserves small segments in long polylines.
      const adjusted = segment - compensation;
      const next = total + adjusted;
      if (!Number.isFinite(next)) return null;
      compensation = (next - total) - adjusted;
      total = next;
    }
    previous = point;
  }
  return total;
}

/**
 * Convert a nonzero route into metres without rounding.
 * Returns null until both the route and its positive scale are available.
 */
export function deriveRouteLength(points, metersPerPixel) {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const pixels = polylineLength(points);
  if (pixels === null || pixels <= 0) return null;
  const metres = pixels * metersPerPixel;
  return Number.isFinite(metres) && metres > 0 ? metres : null;
}

/**
 * Obtain metres per map coordinate unit from a known measured distance.
 * Missing, coincident or invalid calibration points / distance return null.
 */
export function calibrationScale(start, end, distanceM) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  const pixels = polylineLength([start, end]);
  if (pixels === null || pixels <= 0) return null;
  const scale = distanceM / pixels;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

const interpolatePoint = (a, b, t) => ({
  x: a.x * (1 - t) + b.x * t,
  y: a.y * (1 - t) + b.y * t,
  ...(a.interior && a.interior === b.interior ? { interior: a.interior } : {}),
});

/** Copy a route interval using distance along its actual bends, not its chord. */
export function slicePolyline(points, startFraction, endFraction) {
  const total = polylineLength(points);
  if (!total || !Number.isFinite(startFraction) || !Number.isFinite(endFraction)
      || startFraction < 0 || endFraction > 1 || startFraction >= endFraction) return null;
  const from = total * startFraction, to = total * endFraction, result = [];
  let walked = 0;
  const append = point => {
    const last = result[result.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) result.push(point);
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (!distance) continue;
    const next = walked + distance;
    if (next >= from && walked <= to) {
      append(interpolatePoint(a, b, Math.max(0, Math.min(1, (from - walked) / distance))));
      append(interpolatePoint(a, b, Math.max(0, Math.min(1, (to - walked) / distance))));
    }
    walked = next;
    if (walked >= to) break;
  }
  // Preserve endpoints exactly even when accumulation differs by a few ulps.
  if (startFraction === 0 && result.length) result[0] = { ...points[0] };
  if (endFraction === 1 && result.length) result[result.length - 1] = { ...points[points.length - 1] };
  return result.length >= 2 && polylineLength(result) > 0 ? result : null;
}

/** Find the closest route point and its fraction of the complete route length. */
export function projectPointOnRoute(points, point) {
  const total = polylineLength(points);
  if (!total || !isPoint(point)) return null;
  let walked = 0, closest = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) continue;
    const along = (point.x - a.x) * (dx / distance) + (point.y - a.y) * (dy / distance);
    const t = Math.max(0, Math.min(1, along / distance));
    const projected = interpolatePoint(a, b, t), separation = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (Number.isFinite(separation) && (!closest || separation < closest.distance)) {
      closest = { fraction: Math.max(0, Math.min(1, (walked + t * distance) / total)), point: projected, distance: separation };
    }
    walked += distance;
  }
  return closest;
}
