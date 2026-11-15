/**
 * Illustrative outdoor microclimate, not a sensor feed or weather forecast.
 *
 * `hour` is simulated LOCAL SOLAR TIME: solar noon is 12:00. There is no
 * longitude, timezone or real-date correction. Solar declination follows a
 * simple annual sinusoid, sufficient for a conceptual campus shadow preview.
 * Global horizontal irradiance follows solar elevation and continuous seeded
 * cloud cover. It is not illuminance (lux), and it is not a measured value.
 * Air temperature has a daily cycle plus a 55-minute thermal response, rather
 * than instantaneous random changes. Building/ground heating and humidity are
 * not resolved; none of these values predicts a real school's cooling effect.
 */
const PI = Math.PI, TAU = 2 * PI, RAD = PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, base) => ((value % base) + base) % base;
const smooth = value => value * value * (3 - 2 * value);
const SCENARIOS = Object.freeze({
  sunny: Object.freeze({meanC:28, amplitudeC:5, clouds:.2, haze:1}),
  cloudy: Object.freeze({meanC:25.5, amplitudeC:3.1, clouds:.74, haze:.97}),
  heatwave: Object.freeze({meanC:34.5, amplitudeC:6, clouds:.1, haze:.93}),
});

function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let result = 2166136261;
  for (const char of String(seed)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
function hash(index, seed) {
  let n = (index | 0) ^ seed;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(coordinate, seed) {
  const left = Math.floor(coordinate), fraction = smooth(coordinate - left);
  return hash(left, seed) * (1 - fraction) + hash(left + 1, seed) * fraction;
}
function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}
function assertScenario(value) {
  if (!Object.hasOwn(SCENARIOS, value)) throw new RangeError('scenario must be sunny, cloudy or heatwave');
}

/** Approximate solar position; azimuth is clockwise from north (east = 90°). */
export function simulatedSunPosition({hour, dayOfYear = 196, latitude = 31.3}) {
  assertFinite(hour, 'hour');assertFinite(dayOfYear, 'dayOfYear');assertFinite(latitude, 'latitude');
  if (latitude < -90 || latitude > 90) throw new RangeError('latitude must be between -90 and 90');
  const latitudeRad = latitude * RAD;
  const declination = 23.44 * RAD * Math.sin(TAU * (284 + dayOfYear) / 365);
  const hourAngle = (mod(hour, 24) - 12) * 15 * RAD;
  const altitude = Math.asin(clamp(Math.sin(latitudeRad) * Math.sin(declination)
    + Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle), -1, 1));
  const azimuth = Math.atan2(Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) - Math.tan(declination) * Math.cos(latitudeRad));
  return {azimuthDeg:mod(azimuth / RAD + 180, 360), elevationDeg:altitude / RAD};
}

/**
 * Create an independently seeded, deterministic simulation. Every mutating
 * method returns the new sample. setHour jumps the clock and initializes a
 * stable temperature for that time; setScenario preserves the current air
 * temperature and transitions the cloud field over six simulated minutes.
 */
export function createClimateSimulation({seed = 1960313, hour = 12, scenario = 'sunny', dayOfYear = 196, latitude = 31.3} = {}) {
  assertFinite(hour, 'hour');assertFinite(dayOfYear, 'dayOfYear');assertFinite(latitude, 'latitude');
  if (latitude < -90 || latitude > 90) throw new RangeError('latitude must be between -90 and 90');
  if (dayOfYear < 1 || dayOfYear > 366) throw new RangeError('dayOfYear must be between 1 and 366');
  assertScenario(scenario);
  const initial = {hour:mod(hour, 24), dayOfYear:Math.floor(dayOfYear), scenario};
  const randomSeed = seedNumber(seed);
  let clock = (initial.dayOfYear - 1) * 1440 + initial.hour * 60;
  let currentScenario = scenario, transition = null, temperatureC;
  const dayAt = minute => mod(Math.floor(minute / 1440), 365) + 1;
  const hourAt = minute => mod(minute, 1440) / 60;

  function settingsAt(minute) {
    const target = SCENARIOS[currentScenario];
    if (!transition) return target;
    const fraction = smooth(clamp((minute - transition.startMinute) / 6, 0, 1));
    return Object.fromEntries(Object.keys(target).map(key => [key,
      transition.previous[key] * (1 - fraction) + target[key] * fraction]));
  }
  function lightAt(minute, settings = settingsAt(minute)) {
    const sun = simulatedSunPosition({hour:hourAt(minute), dayOfYear:dayAt(minute), latitude});
    // Smooth changes on multiple timescales represent drifting cloud layers.
    // Unlike drawing random numbers each frame, this is independent of FPS.
    const slow = noise(minute / 47, randomSeed) - .5;
    const passing = noise(minute / 7, randomSeed ^ 0x9e3779b9) - .5;
    const fine = noise(minute / 2.5, randomSeed ^ 0x85ebca6b) - .5;
    const cloudFraction = clamp(settings.clouds + .42 * slow + .31 * passing + .06 * fine, .015, .99);
    const clearRadiation = sun.elevationDeg <= 0 ? 0 : 1000 * Math.pow(Math.sin(sun.elevationDeg * RAD), 1.12);
    const transmission = 1 - .86 * Math.pow(cloudFraction, 1.25);
    return {sun, cloudCoverPercent:cloudFraction * 100, radiationWm2:clearRadiation * transmission * settings.haze, clearRadiation};
  }
  function targetTemperature(minute, settings = settingsAt(minute)) {
    // Equilibrium minimum around 04:00 and maximum around 14:00. Thermal
    // inertia shifts the actual peak later into the afternoon.
    const sinceMinimum = mod(hourAt(minute) - 4, 24);
    const dailyWave = sinceMinimum <= 10
      ? -Math.cos(PI * sinceMinimum / 10)
      : Math.cos(PI * (sinceMinimum - 10) / 14);
    const light = lightAt(minute, settings);
    const usualTransmission = 1 - .86 * Math.pow(settings.clouds, 1.25);
    const cloudDeparture = light.radiationWm2 - light.clearRadiation * usualTransmission * settings.haze;
    return settings.meanC + settings.amplitudeC * dailyWave + cloudDeparture * .003;
  }
  function steadyTemperature(minute) {
    // A day of warm-up removes nearly all dependence on arbitrary initial air
    // temperature. Only explicit time jumps use this; animation keeps inertia.
    const settings = SCENARIOS[currentScenario];
    let value = targetTemperature(minute - 1440, settings);
    const blend = 1 - Math.exp(-5 / 55);
    for (let t = minute - 1435; t <= minute; t += 5) value += (targetTemperature(t, settings) - value) * blend;
    return value;
  }
  function sample() {
    const light = lightAt(clock);
    return {hour:hourAt(clock), dayOfYear:dayAt(clock), scenario:currentScenario,
      temperatureC, radiationWm2:light.radiationWm2, cloudCoverPercent:light.cloudCoverPercent,
      sun:light.sun, source:'simulation'};
  }
  function advance(minutes) {
    assertFinite(minutes, 'minutes');
    if (minutes < 0) throw new RangeError('minutes must be nonnegative; use setHour for clock jumps');
    if (!Number.isFinite(clock + minutes) || Math.abs(clock + minutes) > Number.MAX_SAFE_INTEGER - 1440) {
      throw new RangeError('simulation time exceeds numeric representation');
    }
    if (minutes > 1440) {
      // Thermal memory after a day is negligible; avoid a multi-year loop.
      clock += minutes - 1440;transition = null;temperatureC = steadyTemperature(clock);minutes = 1440;
    }
    while (minutes > 1e-9) {
      const step = Math.min(1, minutes);
      clock += step;
      const change = (targetTemperature(clock) - temperatureC) * (1 - Math.exp(-step / 55));
      temperatureC += clamp(change, -.06 * step, .06 * step);
      minutes -= step;
      if (transition && clock >= transition.startMinute + 6) transition = null;
    }
    return sample();
  }
  function setHour(nextHour) {
    assertFinite(nextHour, 'hour');
    clock = Math.floor(clock / 1440) * 1440 + mod(nextHour, 24) * 60;
    transition = null;temperatureC = steadyTemperature(clock);
    return sample();
  }
  function setScenario(nextScenario) {
    assertScenario(nextScenario);
    if (nextScenario !== currentScenario) {
      const previous = settingsAt(clock);
      currentScenario = nextScenario;transition = {previous, startMinute:clock};
    }
    return sample();
  }
  function reset() {
    currentScenario = initial.scenario;clock = (initial.dayOfYear - 1) * 1440 + initial.hour * 60;
    transition = null;temperatureC = steadyTemperature(clock);
    return sample();
  }
  temperatureC = steadyTemperature(clock);
  return {sample, advance, setHour, setScenario, reset};
}
