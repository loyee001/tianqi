import test from 'node:test';
import assert from 'node:assert/strict';
import { polylineLength, deriveRouteLength, calibrationScale, curveThroughPoint, slicePolyline, projectPointOnRoute, SAMPLE_METERS_PER_PIXEL } from './geometry.mjs';

const sampleRoute = [{ x: 306, y: 181 }, { x: 398, y: 181 }, { x: 398, y: 370 }, { x: 687, y: 370 }];

test('sample campus retains its 48 m scale', () => {
  assert.equal(polylineLength(sampleRoute), 570);
  assert.equal(deriveRouteLength(sampleRoute, SAMPLE_METERS_PER_PIXEL), 48);
});

test('short edited routes derive their true length rather than a missing-length error', () => {
  const route = [{ x: 398, y: 181 }, { x: 408, y: 181 }];
  assert.equal(polylineLength(route), 10);
  assert.ok(Math.abs(deriveRouteLength(route, SAMPLE_METERS_PER_PIXEL) - 0.8421052631578947) < 1e-12);
});

test('the screenshot route is about 8.07 m, not missing or over a maximum', () => {
  const route = [{ x: 542, y: 212 }, { x: 517, y: 227 }, { x: 452, y: 242 }];
  const length = deriveRouteLength(route, SAMPLE_METERS_PER_PIXEL);
  const measured = (Math.hypot(25, 15) + Math.hypot(65, 15)) * 48 / 570;
  assert.ok(length > 0 && length < 10);
  assert.ok(Math.abs(length - measured) < 1e-12);
});

test('routes have no 30-point maximum', () => {
  const points = Array.from({ length: 10001 }, (_, x) => ({ x, y: 0 }));
  assert.equal(polylineLength(points), 10000);
  assert.equal(deriveRouteLength(points, 2), 20000);
});

test('routes have no 100000 m business maximum', () => {
  assert.equal(deriveRouteLength([{ x: 0, y: 0 }, { x: 3e9, y: 4e9 }], 10), 5e10);
});

test('adjacent duplicates contribute no distance', () => {
  const a = { x: 0, y: 0 }, b = { x: 3, y: 4 };
  assert.equal(polylineLength([a, a, b, b]), 5);
  assert.equal(deriveRouteLength([a, a, b, b], 2), 10);
});

test('empty or zero-length routes do not become a calculated plan', () => {
  assert.equal(polylineLength([]), 0);
  assert.equal(polylineLength([{ x: 1, y: 1 }]), 0);
  assert.equal(deriveRouteLength([], 1), null);
  assert.equal(deriveRouteLength([{ x: 1, y: 1 }], 1), null);
  assert.equal(deriveRouteLength([{ x: 1, y: 1 }, { x: 1, y: 1 }], 1), null);
});

test('missing or invalid calibration never becomes a zero or NaN length', () => {
  for (const scale of [undefined, null, '', NaN, Infinity, 0, -1, '1']) {
    assert.equal(deriveRouteLength(sampleRoute, scale), null);
  }
  assert.equal(calibrationScale(undefined, undefined, undefined), null);
  assert.equal(calibrationScale({ x: 0, y: 0 }, { x: 0, y: 0 }, 5), null);
  for (const distance of [undefined, null, '', NaN, Infinity, 0, -1, '5']) {
    assert.equal(calibrationScale({ x: 0, y: 0 }, { x: 3, y: 4 }, distance), null);
  }
});

test('two-point calibration uses its measured diagonal and stays independent of route length', () => {
  const scale = calibrationScale({ x: 10, y: 10 }, { x: 13, y: 14 }, 20);
  assert.equal(scale, 4);
  assert.equal(deriveRouteLength(sampleRoute, scale), 2280);
  assert.equal(calibrationScale({ x: 0, y: 0 }, { x: 1, y: 0 }, 1e12), 1e12);
});

test('invalid coordinates are rejected instead of silently bridging corrupt route segments', () => {
  for (const point of [null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '1', y: 1 }]) {
    assert.equal(polylineLength([{ x: 0, y: 0 }, point, { x: 10, y: 0 }]), null);
    assert.equal(calibrationScale(point, { x: 10, y: 0 }, 10), null);
  }
  assert.equal(polylineLength(null), null);
});

test('unrepresentable numeric results return null without a business limit', () => {
  assert.equal(polylineLength([{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }]), null);
  assert.equal(deriveRouteLength([{ x: 0, y: 0 }, { x: 2, y: 0 }], Number.MAX_VALUE), null);
});

test('curved route passes exactly through all requested points and measures its arc instead of its chord', () => {
  const start = { x: 100, y: 150 }, end = { x: 300, y: 150 }, through = { x: 180, y: 240 };
  const points = curveThroughPoint(start, end, through);
  assert.ok(points.length > 3);
  assert.deepEqual(points[0], start);
  assert.deepEqual(points.at(-1), end);
  assert.ok(points.some(p => p.x === through.x && p.y === through.y));
  const length = polylineLength(points);
  assert.ok(length > polylineLength([start, end]));
  assert.equal(deriveRouteLength(points, 2), length * 2);
});

test('curve samples retain matching interior metadata without mutating inputs', () => {
  const start = Object.freeze({ x: 10, y: 20, interior: '图书馆', id: 'a' });
  const end = Object.freeze({ x: 50, y: 20, interior: '图书馆', id: 'b' });
  const through = Object.freeze({ x: 30, y: 40, interior: '图书馆', id: 'c' });
  const points = curveThroughPoint(start, end, through);
  assert.ok(points.every(p => p.interior === '图书馆'));
  assert.notEqual(points[0], start);
  assert.notEqual(points.at(-1), end);
  assert.deepEqual(start, { x: 10, y: 20, interior: '图书馆', id: 'a' });
  assert.ok(curveThroughPoint(start, { ...end, interior: '食堂' }, through).every(p => !('interior' in p)));
});

test('mirroring and reversing a curve preserve its shape and measured length', () => {
  const start = { x: 0, y: 0 }, end = { x: 120, y: 0 }, through = { x: 60, y: 45 };
  const points = curveThroughPoint(start, end, through);
  const mirrored = curveThroughPoint(start, end, { x: 60, y: -45 });
  assert.equal(mirrored.length, points.length);
  points.forEach((point, i) => {
    assert.equal(mirrored[i].x, point.x);
    assert.equal(mirrored[i].y + point.y, 0);
  });
  assert.equal(polylineLength(mirrored), polylineLength(points));
  assert.deepEqual(curveThroughPoint(end, start, through), [...points].reverse());
});

test('zero curvature remains a valid straight route and collinear reversals still count travelled length', () => {
  const straight = curveThroughPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 });
  assert.deepEqual(straight, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
  assert.equal(polylineLength(straight), 100);
  const reversal = curveThroughPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -20, y: 0 });
  assert.ok(reversal.some(point => point.x === -20));
  assert.ok(polylineLength(reversal) > 140);
});

test('adaptive curve length stays within the documented control-polygon error across curvatures', () => {
  const start = { x: 0, y: 0 }, end = { x: 100, y: 0 };
  const sampleCounts = [];
  for (const through of [{ x: 50, y: .01 }, { x: 50, y: 5 }, { x: 20, y: 80 }, { x: 250, y: 1000 }]) {
    const control = { x: 2 * through.x - 50, y: 2 * through.y };
    const dense = Array.from({ length: 100001 }, (_, i) => {
      const t = i / 100000, u = 1 - t;
      return { x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: 2 * u * t * control.y };
    });
    const points = curveThroughPoint(start, end, through);
    sampleCounts.push(points.length);
    const error = polylineLength(dense) - polylineLength(points);
    const bound = polylineLength([start, control, end]) * 1e-5;
    assert.ok(error >= -1e-8 && error <= bound, `error ${error} exceeds ${bound}`);
  }
  assert.ok(sampleCounts[0] < sampleCounts[2], String(sampleCounts));
});

test('curve geometry has no route-length cap and handles translated large coordinates without overflow', () => {
  const large = curveThroughPoint({ x: 0, y: 0 }, { x: 1e140, y: 0 }, { x: 5e139, y: 3e139 });
  assert.ok(large);
  assert.ok(deriveRouteLength(large, 1) > 1e140);
  const translated = curveThroughPoint({ x: 1e300, y: 1e300 }, { x: 1.1e300, y: 1e300 }, { x: 1.05e300, y: 1.05e300 });
  assert.ok(translated);
  assert.ok(Number.isFinite(polylineLength(translated)));
  const tiny = curveThroughPoint({ x: 0, y: 0 }, { x: 1e-200, y: 0 }, { x: 5e-201, y: 3e-201 });
  assert.ok(tiny);
  assert.ok(polylineLength(tiny) > 1e-200);
});

test('invalid curve inputs and unrepresentable control points return null', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 }, c = { x: 50, y: 20 };
  for (const bad of [null, undefined, {}, { x: '5', y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
    assert.equal(curveThroughPoint(bad, b, c), null);
    assert.equal(curveThroughPoint(a, bad, c), null);
    assert.equal(curveThroughPoint(a, b, bad), null);
  }
  assert.equal(curveThroughPoint(a, a, c), null);
  assert.equal(curveThroughPoint(a, b, { x: Number.MAX_VALUE, y: Number.MAX_VALUE }), null);
  assert.equal(curveThroughPoint({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }, a), null);
});

test('route slicing preserves corners and uses cumulative route length', () => {
  const route = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }];
  assert.deepEqual(slicePolyline(route, .25, .75), [{ x: 6, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }]);
  assert.deepEqual(slicePolyline(route, 0, 1), route);
  assert.deepEqual(slicePolyline(route, .5, 1), [{ x: 12, y: 0 }, { x: 12, y: 12 }]);
  assert.notEqual(slicePolyline(route, 0, 1)[0], route[0]);
});

test('slicing a sampled arc retains its shape, indoor metadata and aggregate length', () => {
  const route = curveThroughPoint({ x: 0, y: 0, interior: 'teaching' }, { x: 100, y: 0, interior: 'teaching' }, { x: 50, y: 50, interior: 'teaching' });
  const fractions = [0, .17, .58, .83, 1];
  const pieces = fractions.slice(1).map((end, i) => slicePolyline(route, fractions[i], end));
  assert.ok(pieces.every(piece => piece.length > 2 && piece.every(point => point.interior === 'teaching')));
  assert.ok(Math.abs(pieces.reduce((sum, piece) => sum + polylineLength(piece), 0) - polylineLength(route)) < 1e-10);
  pieces.slice(1).forEach((piece, i) => assert.deepEqual(piece[0], pieces[i].at(-1)));
});

test('route projection selects the nearest bent interval and clamps beyond endpoints', () => {
  const route = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }];
  assert.deepEqual(projectPointOnRoute(route, { x: 15, y: 6 }), { fraction: .75, point: { x: 12, y: 6 }, distance: 3 });
  assert.equal(projectPointOnRoute(route, { x: -5, y: 0 }).fraction, 0);
  assert.equal(projectPointOnRoute(route, { x: 12, y: 20 }).fraction, 1);
  const repeated = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 12, y: 0 }];
  assert.equal(projectPointOnRoute(repeated, { x: 6, y: 1 }).fraction, .5);
});

test('route slicing and projection reject invalid input and keep very large finite routes', () => {
  const route = [{ x: 0, y: 0 }, { x: 1e140, y: 0 }];
  assert.ok(Math.abs(polylineLength(slicePolyline(route, .25, .75)) / 5e139 - 1) < 1e-14);
  assert.equal(projectPointOnRoute(route, { x: 5e139, y: 1e139 }).fraction, .5);
  for (const range of [[-1, .5], [.5, .5], [.6, .4], [0, 2], [NaN, 1]]) assert.equal(slicePolyline(route, ...range), null);
  for (const bad of [null, [], [{ x: 0, y: 0 }], [{ x: NaN, y: 0 }, { x: 10, y: 0 }]]) {
    assert.equal(slicePolyline(bad, 0, 1), null);
    assert.equal(projectPointOnRoute(bad, { x: 2, y: 2 }), null);
  }
  assert.equal(projectPointOnRoute(route, { x: Infinity, y: 0 }), null);
});
