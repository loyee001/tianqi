import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlan, calculateMixedPlan, calculateTreeBudget, calculatePlantPlan, calculateInteriorPlan, DEFAULT_RATES, RATES, MODULE_LENGTH_M } from './budget.mjs';

const input = { lengthM: 48, widthM: 2.4, budget: 50000, reservePct: 10, type: 'mesh' };
const cents = amount => Math.round(amount * 100);

test('default sample covers the route and includes every fixed cost and reserve', () => {
  const plan = calculatePlan(input);
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'full');
  assert.equal(plan.fullModules, 8);
  assert.equal(plan.fundedModules, 8);
  assert.equal(plan.fullCost, 39044);
  assert.equal(plan.reserveAmount, 5000);
  assert.equal(plan.available, 45000);
  assert.equal(plan.fundedTotal, 44044);
  assert.equal(plan.coveragePercent, 100);
  assert.equal(plan.items.filter(item => item.scope === 'fixed').length, 2);
  assert.equal(plan.items.reduce((sum, item) => sum + cents(item.total), 0), cents(plan.fundedCost));
});

test('insufficient full-route budget yields explicit phased coverage without overspend', () => {
  const plan = calculatePlan({ ...input, budget: 30000 });
  assert.equal(plan.status, 'partial');
  assert.equal(plan.fundedModules, 5);
  assert.equal(plan.coveredLengthM, 30);
  assert.equal(plan.coveragePercent, 62.5);
  assert.equal(plan.shortfall, 12044);
  assert.equal(plan.fundedCost, 25340);
  assert.ok(plan.fundedTotal <= plan.budget);
  assert.ok(plan.fullCost > plan.available);
});

test('zero and tiny budgets do not purchase modules or incur fixed costs', () => {
  for (const budget of [0, 1, 100, 2500]) {
    const plan = calculatePlan({ ...input, budget });
    assert.equal(plan.status, 'insufficient');
    assert.equal(plan.fundedModules, 0);
    assert.equal(plan.fundedCost, 0);
    assert.equal(plan.coveredLengthM, 0);
    assert.deepEqual(plan.items, []);
    assert.ok(plan.fundedTotal <= budget);
  }
});

test('last partial length still purchases a whole 6 m estimating module', () => {
  const plan = calculatePlan({ ...input, lengthM: 6.01 });
  assert.equal(plan.fullModules, 2);
  assert.equal(plan.coveredLengthM, 6.01);
  assert.equal(plan.items.find(item => item.id === 'coverage').quantity, 28.8);
  assert.equal(plan.coveragePercent, 100);
  assert.equal(MODULE_LENGTH_M, 6);
});

test('solid scheme uses its own rates and does not imply affordable full coverage', () => {
  const plan = calculatePlan({ ...input, type: 'solid' });
  assert.equal(plan.fullCost, 81452);
  assert.equal(plan.status, 'partial');
  assert.equal(plan.fundedModules, 4);
  assert.ok(plan.fundedTotal <= plan.budget);
});

test('missing, nonfinite and negative prices block a plan instead of becoming free', () => {
  for (const broken of [undefined, null, NaN, Infinity, -1, '45']) {
    const plan = calculatePlan({ ...input, rates: { ...RATES.mesh, coverage: broken } });
    assert.equal(plan.valid, false, String(broken));
    assert.match(plan.error, /单价/);
  }
  assert.equal(calculatePlan({ ...input, rates: {} }).valid, false);
});

test('invalid sizes, budgets, reserve and scheme types are rejected', () => {
  for (const patch of [
    { lengthM: 0 }, { lengthM: -1 }, { lengthM: NaN }, { widthM: 0 },
    { widthM: Infinity }, { budget: -1 }, { budget: NaN }, { reservePct: -1 },
    { reservePct: 101 }, { type: 'unknown' },
  ]) assert.equal(calculatePlan({ ...input, ...patch }).valid, false);
});

test('exact cent boundary never finances one module beyond available amount', () => {
  const one = calculatePlan({ ...input, lengthM: 6, budget: 10000, reservePct: 0 });
  assert.equal(calculatePlan({ ...input, lengthM: 6, budget: one.fullCost, reservePct: 0 }).status, 'full');
  assert.equal(calculatePlan({ ...input, lengthM: 6, budget: one.fullCost - 0.01, reservePct: 0 }).status, 'insufficient');
  assert.equal(calculatePlan({ ...input, lengthM: 6, budget: one.fullCost - 0.001, reservePct: 0 }).status, 'insufficient');
});

test('fractional reserves and decimal inputs conserve cents for a range of budgets', () => {
  for (const type of ['mesh', 'solid', 'corridor']) {
    for (let i = 0; i < 150; i++) {
      const plan = calculatePlan({ ...input, type, lengthM: 43.321, widthM: 2.73, budget: i * 457.13, reservePct: 13.33 });
      assert.equal(plan.valid, true);
      assert.ok(cents(plan.fundedTotal) <= cents(plan.budget));
      assert.equal(cents(plan.fundedCost) + cents(plan.unallocatedAmount), cents(plan.available));
      assert.equal(cents(plan.available) + cents(plan.reserveAmount), cents(plan.budget));
      assert.equal(cents(plan.fundedCost) + cents(plan.reserveAmount), cents(plan.fundedTotal));
      assert.equal(plan.items.reduce((sum, item) => sum + cents(item.total), 0), cents(plan.fundedCost));
      if (plan.fundedModules < plan.fullModules) {
        const next = calculatePlan({ ...input, type, lengthM: (plan.fundedModules + 1) * 6, widthM: 2.73, budget: 1e8, reservePct: 0 });
        assert.ok(cents(next.fullCost) > cents(plan.available));
      }
    }
  }
});

test('100 percent reserve allows no construction and default rates are independent copies', () => {
  const plan = calculatePlan({ ...input, reservePct: 100 });
  assert.equal(plan.available, 0);
  assert.equal(plan.fundedCost, 0);
  assert.equal(plan.reserveAmount, input.budget);
  const rates = DEFAULT_RATES();
  rates.coverage = 999;
  assert.equal(RATES.mesh.coverage, 45);
});

test('missing, nonpositive and infinite lengths have distinct messages without a fake limit', () => {
  for (const lengthM of [undefined, null, NaN]) {
    const plan = calculatePlan({ ...input, lengthM });
    assert.equal(plan.valid, false);
    assert.match(plan.error, /请填写有效的路线长度/);
    assert.doesNotMatch(plan.error, /上限|超过|100000/);
  }
  assert.match(calculatePlan({ ...input, lengthM: 0 }).error, /大于 0/);
  assert.match(calculatePlan({ ...input, lengthM: -1 }).error, /大于 0/);
  assert.match(calculatePlan({ ...input, lengthM: Infinity }).error, /有限数字/);
  assert.match(calculatePlan({ ...input, budget: Infinity }).error, /有限数字/);
});

test('short routes including sub-micrometre positive values remain valid', () => {
  for (const lengthM of [0.1, 0.0000001, Number.MIN_VALUE]) {
    const plan = calculatePlan({ ...input, lengthM });
    assert.equal(plan.valid, true);
    assert.equal(plan.fullModules, 1);
    assert.equal(plan.coveredLengthM, lengthM);
    assert.equal(plan.coveragePercent, 100);
  }
});

test('large finite lengths and budgets have no former business cap', () => {
  for (const lengthM of [1e6, 1e12]) {
    const plan = calculatePlan({ ...input, lengthM, budget: 1e22 });
    assert.equal(plan.valid, true);
    assert.equal(plan.status, 'full');
    assert.equal(plan.coveredLengthM, lengthM);
    assert.equal(plan.fullModules, Math.ceil(lengthM / 6));
    assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
    assert.equal(plan.exact.budgetCents, '1000000000000000000000000');
  }
});

test('width and rate values also have no arbitrary business cap', () => {
  const wide = calculatePlan({ ...input, widthM: 2000, budget: 1e22 });
  assert.equal(wide.valid, true);
  assert.equal(wide.status, 'full');
  const expensive = calculatePlan({ ...input, budget: 1e22, rates: { ...RATES.mesh, coverage: 1e12 } });
  assert.equal(expensive.valid, true);
  assert.equal(expensive.status, 'full');
});

test('huge partial plans converge with exact BigInt affordability comparisons', () => {
  const plan = calculatePlan({ ...input, lengthM: 1e30, budget: 1e22 });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'partial');
  assert.ok(BigInt(plan.exact.fullModules) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
  assert.ok(BigInt(plan.exact.fullCostCents) > BigInt(plan.exact.budgetCents));
  assert.match(plan.precisionNotice, /近似显示/);
});

test('only a genuine numeric representation overflow receives a computational error', () => {
  const validHuge = calculatePlan({ ...input, lengthM: 1e300, budget: 1e308 });
  assert.equal(validHuge.valid, true);
  const overflow = calculatePlan({ ...input, widthM: Number.MAX_VALUE, budget: 1e308 });
  assert.equal(overflow.valid, false);
  assert.match(overflow.error, /数值表示范围/);
  assert.match(overflow.error, /不是路线长度或预算上限/);
});

test('trees enter both full and funded totals before canopy affordability', () => {
  const plan = calculatePlan({ ...input, treesCount: 5 });
  assert.equal(plan.valid, true);
  assert.equal(plan.treeAffordable, true);
  assert.equal(plan.fundedTrees, 5);
  assert.equal(plan.unfundedTrees, 0);
  assert.equal(plan.treesCost, 1900);
  assert.equal(plan.requestedTreesCost, 1900);
  assert.equal(plan.fullCost, 40944);
  assert.equal(plan.fundedCost, 40944);
  assert.equal(plan.fundedTotal, 45944);
  assert.equal(plan.items.find(item => item.id === 'trees').total, 1900);
  assert.equal(plan.items.reduce((sum, item) => sum + cents(item.total), 0), cents(plan.fundedCost));
  const reduced = calculatePlan({ ...input, budget: 39000, treesCount: 5 });
  assert.equal(reduced.fundedModules, 6);
  assert.equal(reduced.fundedTrees, 5);
  assert.ok(reduced.fundedTotal <= reduced.budget);
});

test('lowering budget leaves excess trees proposed without overspending', () => {
  const plan = calculatePlan({ ...input, budget: 1000, treesCount: 4 });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'overbudget');
  assert.equal(plan.treeAffordable, false);
  assert.equal(plan.fundedTrees, 2);
  assert.equal(plan.unfundedTrees, 2);
  assert.equal(plan.treeShortfall, 620);
  assert.equal(plan.fundedModules, 0);
  assert.equal(plan.treesCost, 760);
  assert.equal(plan.requestedTreesCost, 1520);
  assert.equal(plan.fundedCost, 760);
  assert.equal(plan.fundedTotal, 860);
  assert.equal(plan.unallocatedAmount, 140);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.fullItems.find(item => item.id === 'trees').quantity, 4);
});

test('tree inputs are validated, while explicit zero-cost donated trees are supported', () => {
  for (const patch of [{ treesCount: -1 }, { treesCount: 1.5 }, { treesCount: NaN }, { treeUnitPrice: Infinity }, { treeUnitPrice: -1 }]) {
    assert.equal(calculatePlan({ ...input, ...patch }).valid, false);
  }
  const plan = calculatePlan({ ...input, treesCount: 4, treeUnitPrice: 0 });
  assert.equal(plan.valid, true);
  assert.equal(plan.treeAffordable, true);
  assert.equal(plan.fundedTrees, 4);
  assert.equal(plan.treesCost, 0);
});

test('raw decimal budget strings preserve the final unit beyond Number precision', () => {
  const plan = calculatePlan({ ...input, budget: '10000000000000000000001' });
  assert.equal(plan.valid, true);
  assert.equal(plan.exact.budgetCents, '1000000000000000000000100');
  assert.equal(plan.exact.reserveCents, '100000000000000000000010');
  assert.equal(plan.exact.availableCents, '900000000000000000000090');
  assert.equal(BigInt(plan.exact.fundedTotalCents) + BigInt(plan.exact.unallocatedAmountCents), BigInt(plan.exact.budgetCents));
  const decimal = calculatePlan({ ...input, budget: '10000000000000000000001.99' });
  assert.equal(decimal.exact.budgetCents, '1000000000000000000000199');
});

test('decimal budget text accepts signs, leading decimals and exponents without losing cents', () => {
  for (const [budget, exactCents] of [
    ['.5', '50'], ['+.5', '50'], [' +50000. ', '5000000'], ['5e4', '5000000'],
    ['1.0000000000000000000001e22', '1000000000000000000000100'],
    ['100.009', '10000'], ['000001.23', '123'], ['-0.000', '0'],
    ['1e-999999999999999999', '0'], ['0e999999999999999999', '0'],
  ]) {
    const plan = calculatePlan({ ...input, budget });
    assert.equal(plan.valid, true, budget);
    assert.equal(plan.exact.budgetCents, exactCents, budget);
  }
});

test('empty, malformed, negative and infinite budget text receive accurate validation', () => {
  for (const budget of ['', ' ', 'abc', 'NaN', '1_000', '0x10', '.', '1e']) {
    const plan = calculatePlan({ ...input, budget });
    assert.equal(plan.valid, false, budget);
    assert.match(plan.error, /请填写有效的总预算/);
  }
  for (const budget of ['-1', '-.1', '-1e-9999']) assert.match(calculatePlan({ ...input, budget }).error, /大于或等于 0/);
  for (const budget of ['Infinity', '-Infinity', '+Infinity']) assert.match(calculatePlan({ ...input, budget }).error, /有限数字/);
  assert.match(calculatePlan({ ...input, budget: '1e9999' }).error, /数值表示范围/);
});

test('large material rows preserve exact quantities and cents and sum to exact totals', () => {
  const plan = calculatePlan({ ...input, lengthM: 1e16, widthM: 2.73, budget: '10000000000000000000001' });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'full');
  const coverage = plan.items.find(item => item.id === 'coverage');
  assert.equal(coverage.exactQuantity, '27300000000000005.46');
  assert.equal(coverage.exactUnitPriceCents, '4500');
  assert.equal(coverage.exactTotalCents, '122850000000000024570');
  assert.equal(plan.exact.fundedCostCents, '776183333333333738570');
  assert.equal(plan.items.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fundedCostCents));
  assert.equal(plan.fullItems.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fullCostCents));
});

test('exact material rows remain consistent for partial routes and funded trees', () => {
  for (const budget of ['1000', '30000', '10000000000000000000001']) {
    const plan = calculatePlan({ ...input, lengthM: 1e30, widthM: 2.73, budget, treesCount: 4, treeUnitPrice: 380.01 });
    assert.equal(plan.valid, true);
    assert.equal(plan.items.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fundedCostCents));
    assert.equal(plan.fullItems.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fullCostCents));
    const trees = plan.items.find(item => item.id === 'trees');
    assert.equal(trees.exactUnitPriceCents, '38001');
    assert.equal(trees.exactQuantity, String(plan.fundedTrees));
    assert.equal(trees.exactTotalCents, plan.exact.treesCostCents);
    assert.equal(BigInt(plan.exact.fundedCostCents) + BigInt(plan.exact.reserveCents), BigInt(plan.exact.fundedTotalCents));
    assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
  }
});

test('tree-only budget works before a route exists and shares the route planner allocation', () => {
  const settings = { budget: '1000', reservePct: 10, treesCount: 4, treeUnitPrice: 380 };
  const treeBudget = calculateTreeBudget(settings);
  const routePlan = calculatePlan({ ...input, ...settings });
  assert.equal(treeBudget.valid, true);
  assert.equal(treeBudget.treeAffordable, false);
  assert.equal(treeBudget.fundedTrees, 2);
  assert.equal(treeBudget.unfundedTrees, 2);
  assert.equal(treeBudget.treesCost, 760);
  assert.equal(treeBudget.reserveAmount, 100);
  assert.equal(treeBudget.fundedTotal, 860);
  for (const key of ['budgetCents', 'reserveCents', 'availableCents', 'treesCostCents', 'requestedTreesCostCents']) {
    assert.equal(treeBudget.exact[key], routePlan.exact[key]);
  }
  assert.equal(BigInt(treeBudget.exact.fundedTotalCents) + BigInt(treeBudget.exact.unallocatedAmountCents), BigInt(treeBudget.exact.budgetCents));
});

test('tree-only budget preserves huge raw budget precision and handles zero budgets', () => {
  const treeBudget = calculateTreeBudget({ budget: '10000000000000000000001', treesCount: 3, treeUnitPrice: 380.01 });
  assert.equal(treeBudget.valid, true);
  assert.equal(treeBudget.treeAffordable, true);
  assert.equal(treeBudget.exact.budgetCents, '1000000000000000000000100');
  assert.equal(treeBudget.exact.treesCostCents, '114003');
  assert.ok(BigInt(treeBudget.exact.fundedTotalCents) <= BigInt(treeBudget.exact.budgetCents));
  const zero = calculateTreeBudget({ budget: '0', treesCount: 1 });
  assert.equal(zero.valid, true);
  assert.equal(zero.treeAffordable, false);
  assert.equal(zero.fundedTrees, 0);
  assert.equal(zero.fundedTotal, 0);
});

test('tree-only budget rejects missing amounts, illegal values and sub-cent tree prices', () => {
  for (const patch of [
    { budget: '' }, { budget: '-1' }, { budget: 'Infinity' }, { reservePct: 101 },
    { treesCount: -1 }, { treesCount: 1.5 }, { treeUnitPrice: -1 }, { treeUnitPrice: NaN },
  ]) assert.equal(calculateTreeBudget({ budget: '50000', ...patch }).valid, false);
  assert.match(calculateTreeBudget({ budget: '0', treesCount: 1, treeUnitPrice: 0.004 }).error, /最多保留两位小数/);
  assert.equal(calculateTreeBudget({ budget: '0', treesCount: 1, treeUnitPrice: 0 }).treeAffordable, true);
});

test('indoor circulation charges only plants and reserve, never outdoor canopy items', () => {
  const plan = calculateInteriorPlan({ lengthM: 20, widthM: 1.8, budget: '10000', treesCount: 4, spaceName: '食堂大厅' });
  assert.equal(plan.valid, true);
  assert.equal(plan.layoutOnly, true);
  assert.equal(plan.type, 'interior');
  assert.equal(plan.spaceName, '食堂大厅');
  assert.equal(plan.status, 'full');
  assert.equal(plan.fullModules, 0);
  assert.equal(plan.fundedModules, 0);
  assert.equal(plan.coveredLengthM, 0);
  assert.equal(plan.coveragePercent, 0);
  assert.equal(plan.fundedCost, 1520);
  assert.equal(plan.fullCost, 1520);
  assert.equal(plan.reserveAmount, 1000);
  assert.equal(plan.fundedTotal, 2520);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, 'trees');
  assert.equal(plan.items[0].unit, '盆');
  assert.equal(plan.items[0].exactTotalCents, plan.exact.fundedCostCents);
  const empty = calculateInteriorPlan({ lengthM: 20, widthM: 1.8, budget: '10000' });
  assert.equal(empty.fundedCost, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.fundedTotal, 1000);
});

test('indoor plants use the shared budget priority and exact totals when funds are short', () => {
  const plan = calculateInteriorPlan({ lengthM: 20, widthM: 1.8, budget: '1000', treesCount: 4 });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'overbudget');
  assert.equal(plan.fundedTrees, 2);
  assert.equal(plan.unfundedTrees, 2);
  assert.equal(plan.fundedCost, 760);
  assert.equal(plan.fullCost, 1520);
  assert.equal(plan.fullTotal, 1620);
  assert.equal(plan.shortfall, 620);
  assert.equal(plan.fullItems[0].exactTotalCents, plan.exact.fullCostCents);
  assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
  assert.equal(BigInt(plan.exact.fundedCostCents) + BigInt(plan.exact.reserveCents), BigInt(plan.exact.fundedTotalCents));
  const huge = calculateInteriorPlan({ lengthM: 20, widthM: 1.8, budget: '10000000000000000000001', treesCount: 4 });
  assert.equal(huge.exact.budgetCents, '1000000000000000000000100');
  assert.equal(huge.exact.fundedCostCents, '152000');
});

test('indoor plan validates route sizes and reuses strict plant budget validation', () => {
  for (const patch of [{ lengthM: 0 }, { widthM: -1 }, { lengthM: NaN }, { widthM: Infinity }, { budget: '' }, { treeUnitPrice: 0.004 }]) {
    assert.equal(calculateInteriorPlan({ lengthM: 20, widthM: 1.8, budget: '1000', ...patch }).valid, false);
  }
});

test('standalone planting is a complete valid plan without route, scale or building charges', () => {
  const plan = calculatePlantPlan({ budget: '10000', treesCount: 4 });
  assert.equal(plan.valid, true);
  assert.equal(plan.type, 'plants');
  assert.equal(plan.treeOnly, true);
  assert.equal(plan.layoutOnly, true);
  assert.equal(plan.status, 'full');
  for (const key of ['lengthM', 'widthM', 'moduleLengthM', 'fullModules', 'fundedModules', 'coveredLengthM', 'coveragePercent']) assert.equal(plan[key], 0, key);
  assert.equal(plan.fundedCost, 1520);
  assert.equal(plan.fundedTotal, 2520);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, 'trees');
  assert.equal(plan.items[0].unit, '株');
  assert.equal(plan.items[0].exactQuantity, '4');
  assert.equal(plan.items[0].exactTotalCents, plan.exact.fundedCostCents);
  assert.deepEqual(plan.rates, {});
  assert.match(plan.pricingLabel, /仅绿植方案/);
});

test('standalone planting supports empty plans and zero-cost donated plants', () => {
  const empty = calculatePlantPlan({ budget: '0' });
  assert.equal(empty.valid, true);
  assert.equal(empty.status, 'full');
  assert.equal(empty.fundedTotal, 0);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.fullItems, []);
  const donated = calculatePlantPlan({ budget: '0', treesCount: 5, treeUnitPrice: 0 });
  assert.equal(donated.fundedTrees, 5);
  assert.equal(donated.fundedCost, 0);
  assert.equal(donated.items[0].exactTotalCents, '0');
  const reserved = calculatePlantPlan({ budget: '50000' });
  assert.equal(reserved.fundedCost, 0);
  assert.equal(reserved.fundedTotal, 5000);
});

test('standalone planting preserves exact cents and leaves unfunded plants proposed', () => {
  const short = calculatePlantPlan({ budget: '760.01', reservePct: 0, treesCount: 2, treeUnitPrice: 380.01 });
  assert.equal(short.valid, true);
  assert.equal(short.status, 'overbudget');
  assert.equal(short.fundedTrees, 1);
  assert.equal(short.unfundedTrees, 1);
  assert.equal(short.exact.fullCostCents, '76002');
  assert.equal(short.exact.fundedCostCents, '38001');
  assert.equal(short.exact.shortfallCents, '1');
  assert.equal(short.fullItems[0].exactTotalCents, short.exact.fullCostCents);
  assert.ok(BigInt(short.exact.fundedTotalCents) <= BigInt(short.exact.budgetCents));
  const exact = calculatePlantPlan({ budget: '760.02', reservePct: 0, treesCount: 2, treeUnitPrice: 380.01 });
  assert.equal(exact.status, 'full');
  assert.equal(exact.exact.fundedTotalCents, '76002');
  const huge = calculatePlantPlan({ budget: '10000000000000000000001.99', treesCount: 4 });
  assert.equal(huge.exact.budgetCents, '1000000000000000000000199');
  assert.equal(BigInt(huge.exact.fundedTotalCents) + BigInt(huge.exact.unallocatedAmountCents), BigInt(huge.exact.budgetCents));
});

test('standalone planting strictly validates amounts without demanding irrelevant route dimensions', () => {
  assert.equal(calculatePlantPlan({ budget: '1000', lengthM: NaN, widthM: -1 }).valid, true);
  for (const patch of [{ budget: '' }, { budget: '-1' }, { reservePct: 101 }, { treesCount: 1.5 }, { treeUnitPrice: 0.004 }]) {
    assert.equal(calculatePlantPlan({ budget: '1000', ...patch }).valid, false);
  }
});

test('complete corridor includes opaque roof, paving, drainage and lighting in itemized costs', () => {
  const plan = calculatePlan({ ...input, type: 'corridor', lengthM: 12, budget: '100000' });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'full');
  assert.equal(plan.fundedModules, 2);
  const rows = Object.fromEntries(plan.items.map(item => [item.id, item]));
  assert.match(rows.coverage.name, /不透光/);
  assert.equal(rows.coverage.exactQuantity, '28.8');
  assert.equal(rows.flooring.exactQuantity, '28.8');
  assert.equal(rows.drainage.exactQuantity, '24');
  assert.equal(rows.lighting.exactQuantity, '4');
  assert.equal(rows.support.exactQuantity, '8');
  assert.equal(rows.foundation.exactQuantity, '8');
  assert.equal(rows.installation.exactQuantity, '2');
  assert.equal(rows.survey.exactQuantity, '1');
  assert.equal(rows.delivery.exactQuantity, '1');
  assert.equal(plan.items.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fundedCostCents));
  const pc = calculatePlan({ ...input, type: 'solid', lengthM: 12, budget: '100000' });
  assert.ok(plan.fullCost > pc.fullCost);
});

test('complete corridor only finances whole fully equipped modules at the exact budget boundary', () => {
  const one = calculatePlan({ ...input, type: 'corridor', lengthM: 6, widthM: 2.73, budget: '100000', reservePct: 0 });
  const exact = calculatePlan({ ...input, type: 'corridor', lengthM: 12, widthM: 2.73, budget: one.fullCost, reservePct: 0 });
  assert.equal(exact.fundedModules, 1);
  assert.equal(exact.fundedCost, one.fullCost);
  assert.equal(exact.coveredLengthM, 6);
  assert.equal(exact.items.find(item => item.id === 'flooring').exactQuantity, '16.38');
  assert.equal(exact.items.find(item => item.id === 'flooring').exactTotalCents, '294840');
  assert.equal(exact.items.find(item => item.id === 'drainage').exactQuantity, '12');
  assert.equal(exact.items.find(item => item.id === 'lighting').exactQuantity, '2');
  const short = calculatePlan({ ...input, type: 'corridor', lengthM: 6, widthM: 2.73, budget: one.fullCost - 0.01, reservePct: 0 });
  assert.equal(short.fundedModules, 0);
  assert.deepEqual(short.items, []);
  const withTree = calculatePlan({ ...input, type: 'corridor', lengthM: 6, widthM: 2.73, budget: one.fullCost, reservePct: 0, treesCount: 1 });
  assert.equal(withTree.fundedModules, 0);
  assert.equal(withTree.fundedTrees, 1);
  assert.ok(BigInt(withTree.exact.fundedTotalCents) <= BigInt(withTree.exact.budgetCents));
});

test('complete corridor requires prices for all added components and keeps editable rates isolated', () => {
  for (const id of ['flooring', 'drainage', 'lighting']) {
    const invalid = calculatePlan({ ...input, type: 'corridor', rates: { ...RATES.corridor, [id]: undefined } });
    assert.equal(invalid.valid, false);
    assert.match(invalid.error, /单价/);
  }
  const copy = DEFAULT_RATES('corridor');
  copy.flooring = 999;
  assert.equal(RATES.corridor.flooring, 180);
});

const mixedSections = types => types.map((type, i) => ({ id: `part-${i + 1}`, type, startFraction: i / types.length, endFraction: (i + 1) / types.length }));
const mixedInput = { lengthM: 24, widthM: 2.4, budget: '100000', reservePct: 10, sections: mixedSections(['mesh', 'solid', 'corridor', 'plants']) };

test('mixed route prices every material separately and preserves an uncovered planting interval', () => {
  const plan = calculateMixedPlan(mixedInput);
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'full');
  assert.equal(plan.coveredLengthM, 18);
  assert.equal(plan.coveragePercent, 75);
  assert.equal(plan.fullModules, 3);
  assert.equal(plan.fullCost, 7068 + 13244 + 28080);
  assert.deepEqual(plan.sections.map(s => s.fundedEndFraction), [.25, .5, .75, 1]);
  assert.equal(plan.sections[3].coveredLengthM, 0);
  assert.equal(plan.sections[3].fundedCost, 0);
  assert.equal(plan.fundedTrees, 0);
  assert.equal(plan.items.find(item => item.id === 'solid:coverage').materialType, 'solid');
  assert.equal(plan.items.find(item => item.id === 'solid:coverage').baseId, 'coverage');
  assert.equal(plan.items.find(item => item.id === 'corridor:flooring').quantity, 14.4);
  assert.deepEqual(calculatePlan({ ...mixedInput, type: 'mixed' }), plan);
});

test('separated intervals of the same material share fixed fees and aggregate exact quantities', () => {
  const plan = calculateMixedPlan({ ...mixedInput, lengthM: 18, sections: mixedSections(['mesh', 'plants', 'mesh']) });
  assert.equal(plan.fullCost, 2 * 4568 + 2500);
  assert.equal(plan.items.find(item => item.id === 'mesh:survey').quantity, 1);
  assert.equal(plan.items.find(item => item.id === 'mesh:delivery').quantity, 1);
  assert.equal(plan.items.find(item => item.id === 'mesh:coverage').exactQuantity, '28.8');
  assert.equal(plan.sections[2].items.some(item => item.scope === 'fixed'), false);
  assert.equal(plan.sections[2].fullCost, 4568);
  assert.equal(plan.sections.reduce((sum, section) => sum + section.fullCost, 0), plan.fullCost);
});

test('mixed routes charge reserve and placed trees only once across all ranges', () => {
  const plan = calculateMixedPlan({ ...mixedInput, treesCount: 3, treeUnitPrice: 380 });
  assert.equal(plan.reserveAmount, 10000);
  assert.equal(plan.fundedTrees, 3);
  assert.equal(plan.items.filter(item => item.id === 'trees').length, 1);
  assert.equal(plan.fullCost, 48392 + 1140);
  assert.equal(plan.fundedTotal, plan.fundedCost + 10000);
  assert.equal(plan.items.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fundedCostCents));
});

test('mixed funding stops at an expensive interval rather than skipping to a cheaper later one', () => {
  const plan = calculateMixedPlan({ ...mixedInput, lengthM: 24, reservePct: 0, budget: '15000', sections: mixedSections(['mesh', 'corridor', 'plants', 'mesh']) });
  assert.equal(plan.status, 'partial');
  assert.equal(plan.sections[0].fundedModules, 1);
  assert.equal(plan.sections[1].fundedModules, 0);
  assert.equal(plan.sections[2].status, 'full');
  assert.equal(plan.sections[3].fundedModules, 0);
  assert.equal(plan.fundedCost, 7068);
  assert.equal(plan.coveredLengthM, 6);
  assert.equal(plan.sections[3].fundedEndFraction, .75);
});

test('mixed partial interval uses exact whole-module funding and correct route fraction', () => {
  const plan = calculateMixedPlan({ ...mixedInput, lengthM: 36, budget: '20000', reservePct: 0, sections: mixedSections(['mesh', 'solid']) });
  assert.equal(plan.sections[0].fundedModules, 3);
  assert.equal(plan.sections[1].fundedModules, 0);
  const partial = calculateMixedPlan({ ...mixedInput, lengthM: 36, budget: '13000', reservePct: 0, sections: mixedSections(['mesh', 'solid']) });
  assert.equal(partial.sections[0].fundedModules, 2);
  assert.equal(partial.sections[0].coveredLengthM, 12);
  assert.equal(partial.sections[0].fundedEndFraction, 1 / 3);
  assert.equal(partial.sections[1].fundedModules, 0);
});

test('mixed budget conserves integer cents at affordability boundaries and varying reserves', () => {
  for (let i = 0; i < 90; i++) {
    const plan = calculateMixedPlan({ ...mixedInput, budget: String(i * 541.19), reservePct: 13.33, treesCount: 3, treeUnitPrice: 380.17, widthM: 2.73 });
    assert.equal(plan.valid, true);
    assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
    assert.equal(BigInt(plan.exact.fundedCostCents) + BigInt(plan.exact.unallocatedAmountCents), BigInt(plan.exact.availableCents));
    assert.equal(plan.items.reduce((sum, item) => sum + BigInt(item.exactTotalCents), 0n), BigInt(plan.exact.fundedCostCents));
  }
  const exact = calculateMixedPlan({ ...mixedInput, budget: '48392', reservePct: 0 });
  assert.equal(exact.status, 'full');
  const short = calculateMixedPlan({ ...mixedInput, budget: '48391.99', reservePct: 0 });
  assert.equal(short.status, 'partial');
  assert.equal(short.sections[2].fundedModules, 0);
});

test('mixed all-plants ranges need no construction prices and never fabricate shade or trees', () => {
  const plan = calculateMixedPlan({ ...mixedInput, budget: 0, sections: mixedSections(['plants', 'plants']) });
  assert.equal(plan.status, 'full');
  assert.equal(plan.fundedCost, 0);
  assert.equal(plan.fullModules, 0);
  assert.equal(plan.coveredLengthM, 0);
  assert.deepEqual(plan.items, []);
  const trees = calculateMixedPlan({ ...mixedInput, budget: 500, sections: mixedSections(['plants', 'mesh']), treesCount: 2 });
  assert.equal(trees.status, 'overbudget');
  assert.equal(trees.fundedTrees, 1);
  assert.equal(trees.fundedModules, 0);
});

test('mixed partitions reject gaps, overlaps and invalid or unrepresentable ranges', () => {
  for (const sections of [[], null, [{ type: 'mesh', startFraction: .1, endFraction: 1 }],
    [{ type: 'mesh', startFraction: 0, endFraction: .4 }, { type: 'solid', startFraction: .5, endFraction: 1 }],
    [{ type: 'mesh', startFraction: 0, endFraction: .6 }, { type: 'solid', startFraction: .5, endFraction: 1 }],
    [{ type: 'unknown', startFraction: 0, endFraction: 1 }], [{ type: 'mesh', startFraction: 0, endFraction: 0 }]]) {
    assert.equal(calculateMixedPlan({ ...mixedInput, sections }).valid, false);
  }
  assert.equal(calculateMixedPlan({ ...mixedInput, ratesByType: { mesh: {} } }).valid, false);
  assert.equal(calculateMixedPlan({ ...mixedInput, treeUnitPrice: 380.001 }).valid, false);
});

test('mixed finite enormous budgets retain exact cents and impose no business length limit', () => {
  const plan = calculateMixedPlan({ ...mixedInput, lengthM: 1e20, budget: '10000000000000000000000001.01' });
  assert.equal(plan.valid, true);
  assert.equal(plan.status, 'full');
  assert.equal(plan.exact.budgetCents, '1000000000000000000000000101');
  assert.ok(BigInt(plan.exact.fundedTotalCents) <= BigInt(plan.exact.budgetCents));
  assert.equal(plan.sections[0].lengthM, 2.5e19);
  assert.equal(plan.coveragePercent, 75);
});
