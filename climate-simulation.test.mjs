import test from 'node:test';
import assert from 'node:assert/strict';
import {createClimateSimulation, simulatedSunPosition} from './climate-simulation.mjs';

test('solar direction rises in the east, is highest at noon, and sets west', () => {
  const morning = simulatedSunPosition({hour:8}), noon = simulatedSunPosition({hour:12}), afternoon = simulatedSunPosition({hour:16});
  assert.ok(morning.azimuthDeg > 0 && morning.azimuthDeg < 180);
  assert.ok(afternoon.azimuthDeg > 180 && afternoon.azimuthDeg < 360);
  assert.ok(noon.elevationDeg > morning.elevationDeg && noon.elevationDeg > afternoon.elevationDeg);
});
test('night has no solar irradiance, despite cloud variation; afternoon retains thermal lag', () => {
  const sim = createClimateSimulation({seed:42});
  assert.equal(sim.setHour(0).radiationWm2, 0);assert.equal(sim.setHour(23).radiationWm2, 0);
  const dawn = sim.setHour(5), noon = sim.setHour(12), afternoon = sim.setHour(15);
  assert.ok(noon.radiationWm2 > 400);assert.ok(afternoon.temperatureC > noon.temperatureC);
  assert.ok(noon.temperatureC > dawn.temperatureC);
});
test('identical seeds and commands reproduce the entire evolving signal and reset', () => {
  const a = createClimateSimulation({seed:'campus',hour:10}), b = createClimateSimulation({seed:'campus',hour:10});
  const initial = a.sample();
  for (let i=0; i<40; i++) assert.deepEqual(a.advance(.5), b.advance(.5));
  assert.deepEqual(a.reset(), initial);
  const changed = createClimateSimulation({seed:'other',hour:10});
  assert.notEqual(changed.sample().cloudCoverPercent, initial.cloudCoverPercent);
});
test('clouds drift continuously while air temperature changes much more slowly', () => {
  const sim = createClimateSimulation({seed:42,hour:11,scenario:'cloudy'});
  let previous = sim.sample(), minLight = previous.radiationWm2, maxLight = minLight;
  for (let i=0; i<240; i++) {
    const current = sim.advance(.25);
    assert.ok(Math.abs(current.temperatureC - previous.temperatureC) <= .015001);
    assert.ok(Math.abs(current.cloudCoverPercent - previous.cloudCoverPercent) < 4);
    assert.ok(Math.abs(current.radiationWm2 - previous.radiationWm2) < 45);
    assert.ok(current.cloudCoverPercent >= 0 && current.cloudCoverPercent <= 100);
    minLight = Math.min(minLight,current.radiationWm2);maxLight = Math.max(maxLight,current.radiationWm2);previous = current;
  }
  assert.ok(maxLight - minLight > 70, 'passing clouds have visible, nonconstant light variation');
});
test('heatwave is hotter, cloudy conditions have less light, and scenario switching is continuous', () => {
  const sunny = createClimateSimulation({seed:9,hour:12,scenario:'sunny'});
  const cloudy = createClimateSimulation({seed:9,hour:12,scenario:'cloudy'});
  const heatwave = createClimateSimulation({seed:9,hour:12,scenario:'heatwave'});
  assert.ok(heatwave.sample().temperatureC > sunny.sample().temperatureC + 5);
  assert.ok(cloudy.sample().radiationWm2 < sunny.sample().radiationWm2 * .7);
  const before = sunny.sample(), switchSample = sunny.setScenario('cloudy');
  assert.equal(switchSample.temperatureC, before.temperatureC);assert.equal(switchSample.radiationWm2, before.radiationWm2);
  assert.ok(sunny.advance(6).radiationWm2 < before.radiationWm2);
});
test('crossing midnight and long advances preserve finite bounded values', () => {
  const sim = createClimateSimulation({hour:23.9,dayOfYear:365});
  const nextDay = sim.advance(12);assert.equal(nextDay.dayOfYear,1);assert.ok(nextDay.hour < 1);
  for (const duration of [60,1440,1000000]) {
    const result = sim.advance(duration);
    for (const value of [result.hour,result.temperatureC,result.radiationWm2,result.sun.azimuthDeg,result.sun.elevationDeg]) assert.ok(Number.isFinite(value));
    assert.ok(result.hour >= 0 && result.hour < 24);assert.ok(result.radiationWm2 >= 0 && result.radiationWm2 <= 1000);
  }
  assert.throws(()=>sim.advance(-1), /nonnegative/);assert.throws(()=>sim.advance(Number.MAX_VALUE), /numeric representation/);assert.throws(()=>sim.setScenario('random'), /scenario/);
});
