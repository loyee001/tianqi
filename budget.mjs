/**
 * Green Shade Campus — demonstration cost model.
 * All rates and module quantities are editable examples, not supplier quotes
 * or a structural design. A module is a 6 m estimating unit.
 */
export const MODULE_LENGTH_M = 6;

export const RATES = Object.freeze({
  mesh: Object.freeze({ coverage: 45, support: 400, connector: 80, foundation: 350, installation: 600, survey: 1500, delivery: 1000 }),
  solid: Object.freeze({ coverage: 160, support: 680, connector: 180, foundation: 700, installation: 1200, survey: 2000, delivery: 1500 }),
  corridor: Object.freeze({ coverage: 320, support: 1200, connector: 260, foundation: 1200, installation: 2600, flooring: 180, drainage: 90, lighting: 280, survey: 3500, delivery: 2500 }),
});

const sharedDefinitions = [
  { id: 'support', name: '支撑构件（计价占位）', unit: '根', scope: 'module' },
  { id: 'connector', name: '连接配件（计价占位）', unit: '套', scope: 'module' },
  { id: 'foundation', name: '基础施工（计价占位）', unit: '处', scope: 'module' },
  { id: 'installation', name: '安装人工与机具', unit: '模块', scope: 'module' },
  { id: 'survey', name: '现场测量与方案复核', unit: '项', scope: 'fixed' },
  { id: 'delivery', name: '材料运输与进场', unit: '项', scope: 'fixed' },
];

export const RATE_DEFINITIONS = Object.freeze(Object.fromEntries(
  ['mesh', 'solid', 'corridor'].map(type => [type, Object.freeze([
    { id: 'coverage', name: type === 'mesh' ? '遮阳织物（仅遮阳）' : type === 'corridor' ? '不透光走廊屋面（示例）' : '透光顶板（防雨概念）', unit: '㎡', scope: 'module' },
    ...sharedDefinitions,
    ...(type === 'corridor' ? [
      { id: 'flooring', name: '走廊地面铺装（示例）', unit: '㎡', scope: 'module' },
      { id: 'drainage', name: '两侧檐沟与排水配套（示例）', unit: '米', scope: 'module' },
      { id: 'lighting', name: '走廊照明与配线（示例）', unit: '套', scope: 'module' },
    ] : []),
  ].map(definition => Object.freeze({ ...definition })))]),
));

export function DEFAULT_RATES(type = 'mesh') {
  if (!Object.hasOwn(RATES, type)) throw new RangeError('未知的方案类型');
  return { ...RATES[type] };
}

// Parse the decimal Number representation without first multiplying large
// amounts by 100. All affordability comparisons then use integer cents.
const pow10 = exponent => 10n ** BigInt(exponent);
function decimalParts(value) {
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const fractionLength = (mantissa.split('.')[1] || '').length;
  const scale = fractionLength - Number(exponent);
  const coefficient = BigInt(mantissa.replace('.', ''));
  return scale < 0 ? { n: coefficient * pow10(-scale), scale: 0 } : { n: coefficient, scale };
}
const ceilDiv = (numerator, denominator) => (numerator + denominator - 1n) / denominator;
const roundDiv = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);
function integerAtScale(value, scale, rounding = 'nearest') {
  const parts = decimalParts(value);
  if (parts.scale <= scale) return parts.n * pow10(scale - parts.scale);
  const denominator = pow10(parts.scale - scale);
  return rounding === 'floor' ? parts.n / denominator : roundDiv(parts.n, denominator);
}
const scaledNumber = (integer, scale = 0) => Number(`${integer}e-${scale}`);
function scaledDecimal(integer, scale = 0) {
  const digits = String(integer).padStart(scale + 1, '0');
  if (!scale) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return digits.slice(0, -scale) + (fraction ? `.${fraction}` : '');
}
const money = cents => scaledNumber(cents, 2);
const nonnegative = value => value > 0n ? value : 0n;
const treeDefinition = Object.freeze({ id: 'trees', name: '乔木苗木与栽植（示例）', unit: '株', scope: 'fixed' });
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

// Keep raw budget text intact: Number('10000000000000000000001') loses 1.
// Truncate sub-cent text directly, including very small scientific notation,
// instead of constructing a potentially enormous power-of-ten denominator.
function budgetTextCents(text) {
  const [mantissa, exponent = '0'] = text.toLowerCase().replace(/^[+-]/, '').split('e');
  const fractionLength = (mantissa.split('.')[1] || '').length;
  const digits = mantissa.replace('.', '').replace(/^0+/, '') || '0';
  if (digits === '0') return 0n;
  const shift = BigInt(exponent) - BigInt(fractionLength) + 2n;
  if (shift < 0n) {
    const removedDigits = -shift;
    if (removedDigits >= BigInt(digits.length)) return 0n;
    return BigInt(digits.slice(0, digits.length - Number(removedDigits)));
  }
  return BigInt(digits) * (10n ** shift);
}

function validateNumber(value, label, allowZero, errors) {
  if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`请填写有效的${label}。`);
  else if (!Number.isFinite(value)) errors.push(`${label}必须是有限数字，不能是无穷大。`);
  else if (allowZero ? value < 0 : value <= 0) errors.push(`${label}须${allowZero ? '大于或等于' : '大于'} 0。`);
}

// Shared by the route planner and route-independent tree placement. This is
// the only implementation of budget parsing, reserves and tree affordability.
function allocateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice }, requireCentPrice = false) {
  const errors = [];
  const budgetText = typeof budget === 'string' ? budget.trim() : null;
  if (budgetText !== null) {
    if (/^[+-]?infinity$/i.test(budgetText)) errors.push('总预算金额（元）必须是有限数字，不能是无穷大。');
    else if (!decimalPattern.test(budgetText)) errors.push('请填写有效的总预算金额（元）。');
    else if (budgetText.startsWith('-') && /[1-9]/.test(budgetText.split(/[eE]/)[0])) errors.push('总预算金额（元）须大于或等于 0。');
    else if (!Number.isFinite(Number(budgetText))) errors.push('总预算金额超出当前数值表示范围；这是数值计算限制，不是预算上限。');
  } else validateNumber(budget, '总预算金额（元）', true, errors);
  validateNumber(reservePct, '预备金比例', true, errors);
  if (Number.isFinite(reservePct) && reservePct > 100) errors.push('预备金比例不能超过 100%。');
  validateNumber(treesCount, '树木数量', true, errors);
  if (Number.isFinite(treesCount) && !Number.isInteger(treesCount)) errors.push('树木数量须为整数。');
  validateNumber(treeUnitPrice, '树木苗木与栽植单价', true, errors);
  if (requireCentPrice && Number.isFinite(treeUnitPrice) && treeUnitPrice >= 0) {
    const parts = decimalParts(treeUnitPrice);
    if (parts.scale > 2 && parts.n % pow10(parts.scale - 2) !== 0n) errors.push('树木苗木与栽植单价最多保留两位小数。');
  }
  if (errors.length) return { valid: false, error: errors.join(' '), errors };

  const budgetCents = budgetText === null ? integerAtScale(budget, 2, 'floor') : budgetTextCents(budgetText);
  const reserveParts = decimalParts(reservePct);
  const reserveCents = ceilDiv(budgetCents * reserveParts.n, 100n * pow10(reserveParts.scale));
  const availableCents = budgetCents - reserveCents;
  const treeCount = integerAtScale(treesCount, 0);
  const treePriceCents = integerAtScale(treeUnitPrice, 2);
  const requestedTreesCents = treeCount * treePriceCents;
  const treeAffordable = requestedTreesCents <= availableCents;
  const fundedTrees = treeAffordable ? treeCount : availableCents / treePriceCents;
  const fundedTreesCents = fundedTrees * treePriceCents;
  return {
    valid: true, budgetCents, reserveCents, availableCents, treeCount,
    treePriceCents, requestedTreesCents, treeAffordable, fundedTrees,
    fundedTreesCents, canopyAvailableCents: availableCents - fundedTreesCents,
  };
}

/** Budget-only tree placement, available before a route or scale is defined. */
export function calculateTreeBudget({ budget, reservePct = 10, treesCount = 0, treeUnitPrice = 380 } = {}) {
  const allocation = allocateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice }, true);
  if (!allocation.valid) return allocation;
  const { budgetCents, reserveCents, availableCents, treeCount, treePriceCents, requestedTreesCents, treeAffordable, fundedTrees, fundedTreesCents, canopyAvailableCents } = allocation;
  const result = {
    valid: true,
    error: null,
    treeAffordable,
    treesCount,
    treeUnitPrice: money(treePriceCents),
    fundedTrees: Number(fundedTrees),
    unfundedTrees: Number(treeCount - fundedTrees),
    treesCost: money(fundedTreesCents),
    requestedTreesCost: money(requestedTreesCents),
    treeShortfall: money(nonnegative(requestedTreesCents - availableCents)),
    budget: money(budgetCents),
    reservePct,
    reserveAmount: money(reserveCents),
    available: money(availableCents),
    fundedTotal: money(fundedTreesCents + reserveCents),
    unallocatedAmount: money(canopyAvailableCents),
    exact: {
      budgetCents: String(budgetCents), reserveCents: String(reserveCents),
      availableCents: String(availableCents), treesCostCents: String(fundedTreesCents),
      requestedTreesCostCents: String(requestedTreesCents),
      treeShortfallCents: String(nonnegative(requestedTreesCents - availableCents)),
      treeUnitPriceCents: String(treePriceCents),
      treesCount: String(treeCount), fundedTrees: String(fundedTrees),
      unfundedTrees: String(treeCount - fundedTrees),
      unallocatedAmountCents: String(canopyAvailableCents),
      fundedTotalCents: String(fundedTreesCents + reserveCents),
    },
  };
  if (Object.values(result).some(value => typeof value === 'number' && !Number.isFinite(value))) {
    const error = '计算结果超出当前数值表示范围；这是数值计算限制，不是预算上限。';
    return { valid: false, error, errors: [error] };
  }
  return result;
}

function plantPlanFromBudget(treeBudget, { lengthM = 0, widthM = 0, spaceName = '全校园', indoor = false } = {}) {
  const fullCostCents = BigInt(treeBudget.exact.requestedTreesCostCents);
  const fundedCostCents = BigInt(treeBudget.exact.treesCostCents);
  const reserveCents = BigInt(treeBudget.exact.reserveCents);
  const treePriceCents = BigInt(treeBudget.exact.treeUnitPriceCents);
  const fullTrees = BigInt(treeBudget.exact.treesCount);
  const fundedTrees = BigInt(treeBudget.exact.fundedTrees);
  const plantItems = count => count > 0n ? [{
    id: 'trees', name: indoor ? '室内绿植与布置（示例）' : '全校园绿植与布置（示例）', unit: indoor ? '盆' : '株', scope: 'fixed',
    quantity: Number(count), unitPrice: money(treePriceCents), total: money(count * treePriceCents),
    exactQuantity: String(count), exactUnitPriceCents: String(treePriceCents),
    exactTotalCents: String(count * treePriceCents),
  }] : [];
  const exact = {
    ...treeBudget.exact,
    fundedCostCents: String(fundedCostCents), fullCostCents: String(fullCostCents),
    fullTotalCents: String(fullCostCents + reserveCents),
    shortfallCents: treeBudget.exact.treeShortfallCents,
    fullModules: '0', fundedModules: '0',
  };
  const result = {
    ...treeBudget,
    layoutOnly: true,
    treeOnly: !indoor,
    type: indoor ? 'interior' : 'plants',
    spaceName: typeof spaceName === 'string' && spaceName.trim() ? spaceName.trim() : '室内空间',
    status: treeBudget.treeAffordable ? 'full' : 'overbudget',
    lengthM,
    widthM,
    moduleLengthM: 0,
    fullModules: 0,
    fundedModules: 0,
    coveredLengthM: 0,
    coveragePercent: 0,
    fundedCost: treeBudget.treesCost,
    fullCost: treeBudget.requestedTreesCost,
    fullTotal: money(fullCostCents + reserveCents),
    shortfall: treeBudget.treeShortfall,
    items: plantItems(fundedTrees),
    fullItems: plantItems(fullTrees),
    rates: {},
    exact,
    precisionNotice: Object.values(exact).some(value => BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) ? '极大数值可能近似显示；预算比较按整数分计算，exact 字段保留精确值。' : null,
    pricingLabel: `${indoor ? '室内布局示意' : '仅绿植方案'}；仅计绿植与预备金，绿植单价为示例估价`,
  };
  if (!Number.isFinite(result.fullTotal)) {
    const error = '计算结果超出当前数值表示范围；这是数值计算限制，不是预算上限。';
    return { valid: false, error, errors: [error] };
  }
  return result;
}

/** A complete plants-only plan needs no route, map scale, or corridor dimensions. */
export function calculatePlantPlan({ budget, reservePct = 10, treesCount = 0, treeUnitPrice = 380 } = {}) {
  const treeBudget = calculateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice });
  return treeBudget.valid ? plantPlanFromBudget(treeBudget) : treeBudget;
}

/** Indoor routes describe circulation only; they never purchase outdoor roofs. */
export function calculateInteriorPlan({ lengthM, widthM, budget, reservePct = 10, treesCount = 0, treeUnitPrice = 380, spaceName = '室内空间' } = {}) {
  const errors = [];
  validateNumber(lengthM, '室内路径长度（米）', false, errors);
  validateNumber(widthM, '室内通道宽度（米）', false, errors);
  const treeBudget = calculateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice });
  if (!treeBudget.valid) errors.push(...treeBudget.errors);
  if (errors.length) return { valid: false, error: errors.join(' '), errors };
  return plantPlanFromBudget(treeBudget, { lengthM, widthM, spaceName, indoor: true });
}

/**
 * Reserve is a percentage of budget, rounded UP to a cent. Trees are funded
 * first, in placement order. If trees alone exceed available funds, unfunded
 * trees remain proposed and no canopy modules are funded (status: overbudget).
 * fundedCost excludes reserve; fundedTotal includes it and never exceeds the
 * budget. Huge finite inputs have no business cap; internal arithmetic uses
 * BigInt. Budget accepts a Number or raw decimal string (preferred for large
 * amounts), with decimal strings available in `exact` beyond ordinary
 * Number display precision. Only genuinely unrepresentable results are errors.
 */
export function calculatePlan({ lengthM, widthM, budget, reservePct = 10, type = 'mesh', rates, treesCount = 0, treeUnitPrice = 380, sections, ratesByType } = {}) {
  if (type === 'mixed') return calculateMixedPlan({ lengthM, widthM, budget, reservePct, treesCount, treeUnitPrice, sections, ratesByType });
  const errors = [];
  const allocation = allocateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice });
  if (!allocation.valid) errors.push(...allocation.errors);
  if (!Object.hasOwn(RATES, type)) errors.push('请选择有效的遮阳方案。');
  validateNumber(lengthM, '路线长度（米）', false, errors);
  validateNumber(widthM, '通道宽度（米）', false, errors);
  const selectedRates = rates === undefined ? RATES[type] : rates;
  if (Object.hasOwn(RATES, type)) {
    for (const { id, name } of RATE_DEFINITIONS[type]) validateNumber(selectedRates?.[id], `${name}单价`, true, errors);
  }
  if (errors.length) return { valid: false, error: errors.join(' '), errors };

  const { budgetCents, reserveCents, availableCents, treeCount, treePriceCents, requestedTreesCents, treeAffordable, fundedTrees, fundedTreesCents, canopyAvailableCents } = allocation;
  const lengthParts = decimalParts(lengthM);
  const widthParts = decimalParts(widthM);
  const fullModules = ceilDiv(lengthParts.n, 6n * pow10(lengthParts.scale));
  const rateCents = Object.fromEntries(RATE_DEFINITIONS[type].map(({ id }) => [id, integerAtScale(selectedRates[id], 2)]));

  function estimate(modules, includeItems = false) {
    if (!modules) return { items: [], cents: 0n };
    const quantities = {
      coverage: { n: modules * 6n * widthParts.n, scale: widthParts.scale },
      flooring: { n: modules * 6n * widthParts.n, scale: widthParts.scale },
      drainage: { n: modules * 12n, scale: 0 },
      lighting: { n: modules * 2n, scale: 0 },
      support: { n: modules * 4n, scale: 0 },
      connector: { n: modules * 4n, scale: 0 },
      foundation: { n: modules * 4n, scale: 0 },
      installation: { n: modules, scale: 0 },
      survey: { n: 1n, scale: 0 },
      delivery: { n: 1n, scale: 0 },
    };
    let cents = 0n;
    const items = [];
    for (const definition of RATE_DEFINITIONS[type]) {
      const quantity = quantities[definition.id];
      const itemCents = quantity.scale > 0
        ? roundDiv(quantity.n * rateCents[definition.id], pow10(quantity.scale))
        : quantity.n * rateCents[definition.id];
      cents += itemCents;
      if (includeItems) items.push({
        ...definition,
        quantity: scaledNumber(quantity.n, quantity.scale),
        unitPrice: money(rateCents[definition.id]),
        total: money(itemCents),
        exactQuantity: scaledDecimal(quantity.n, quantity.scale),
        exactUnitPriceCents: String(rateCents[definition.id]),
        exactTotalCents: String(itemCents),
      });
    }
    return { items, cents };
  }
  function treeItem(count) {
    return {
      ...treeDefinition,
      quantity: Number(count),
      unitPrice: money(treePriceCents),
      total: money(count * treePriceCents),
      exactQuantity: String(count),
      exactUnitPriceCents: String(treePriceCents),
      exactTotalCents: String(count * treePriceCents),
    };
  }

  const fullEstimate = estimate(fullModules, true);
  // BigInt bounds guarantee progress even beyond Number.MAX_SAFE_INTEGER.
  let low = 0n;
  let high = treeAffordable ? fullModules : 0n;
  if (treeAffordable && fullEstimate.cents <= canopyAvailableCents) low = high;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (estimate(middle).cents <= canopyAvailableCents) low = middle;
    else high = middle - 1n;
  }
  const fundedModules = low;
  const fundedEstimate = estimate(fundedModules, true);
  const fullCostCents = fullEstimate.cents + requestedTreesCents;
  const fundedCostCents = fundedEstimate.cents + fundedTreesCents;
  const coveredLengthM = fundedModules === fullModules ? lengthM : Math.min(lengthM, Number(fundedModules * 6n));
  const status = !treeAffordable ? 'overbudget' : fundedModules === fullModules ? 'full' : fundedModules > 0n || fundedTrees > 0n ? 'partial' : 'insufficient';
  const items = [...fundedEstimate.items, ...(fundedTrees > 0n ? [treeItem(fundedTrees)] : [])];
  const fullItems = [...fullEstimate.items, ...(treeCount > 0n ? [treeItem(treeCount)] : [])];
  const exact = {
    budgetCents: String(budgetCents), reserveCents: String(reserveCents),
    availableCents: String(availableCents),
    fullCostCents: String(fullCostCents), fundedCostCents: String(fundedCostCents),
    fullTotalCents: String(fullCostCents + reserveCents),
    fundedTotalCents: String(fundedCostCents + reserveCents),
    shortfallCents: String(nonnegative(fullCostCents - availableCents)),
    unallocatedAmountCents: String(availableCents - fundedCostCents),
    fullModules: String(fullModules), fundedModules: String(fundedModules),
    requestedTreesCostCents: String(requestedTreesCents), treesCostCents: String(fundedTreesCents),
    treeShortfallCents: String(nonnegative(requestedTreesCents - availableCents)),
    treeUnitPriceCents: String(treePriceCents),
  };
  const result = {
    valid: true,
    error: null,
    status,
    type,
    lengthM,
    widthM,
    budget: money(budgetCents),
    reservePct,
    moduleLengthM: MODULE_LENGTH_M,
    fullModules: Number(fullModules),
    fundedModules: Number(fundedModules),
    fullCost: money(fullCostCents),
    fundedCost: money(fundedCostCents),
    reserveAmount: money(reserveCents),
    available: money(availableCents),
    fullTotal: money(fullCostCents + reserveCents),
    fundedTotal: money(fundedCostCents + reserveCents),
    shortfall: money(nonnegative(fullCostCents - availableCents)),
    unallocatedAmount: money(availableCents - fundedCostCents),
    coveredLengthM,
    coveragePercent: Math.round(coveredLengthM / lengthM * 10000) / 100,
    treesCount,
    treeUnitPrice: money(treePriceCents),
    fundedTrees: Number(fundedTrees),
    unfundedTrees: Number(treeCount - fundedTrees),
    treesCost: money(fundedTreesCents),
    requestedTreesCost: money(requestedTreesCents),
    treeAffordable,
    treeShortfall: money(nonnegative(requestedTreesCents - availableCents)),
    items,
    fullItems,
    rates: Object.fromEntries(RATE_DEFINITIONS[type].map(({ id }) => [id, money(rateCents[id])])),
    exact,
    precisionNotice: Object.values(exact).some(value => BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) ? '极大数值可能近似显示；预算比较按整数分计算，exact 字段保留精确值。' : null,
    pricingLabel: '示例估价，需以供应商报价及现场复核替换',
  };
  const numericResults = [...Object.values(result), ...fullItems.flatMap(item => [item.quantity, item.unitPrice, item.total])];
  if (numericResults.some(value => typeof value === 'number' && !Number.isFinite(value))) {
    const error = '计算结果超出当前数值表示范围；这是数值计算限制，不是路线长度或预算上限。';
    return { valid: false, error, errors: [error] };
  }
  return result;
}

/**
 * A continuous route can use a different material on each arc-length range.
 * Each range purchases whole estimating modules; survey and delivery are paid
 * once per material. Trees/reserve are allocated once for the whole project.
 * Funding follows route order and stops at the first unfinished building range.
 * A plants range only preserves ground: placed trees are priced separately.
 */
export function calculateMixedPlan({ lengthM, widthM, budget, reservePct = 10, treesCount = 0, treeUnitPrice = 380, sections, ratesByType } = {}) {
  const errors = [];
  validateNumber(lengthM, '路线长度（米）', false, errors);
  validateNumber(widthM, '通道宽度（米）', false, errors);
  const allocation = allocateTreeBudget({ budget, reservePct, treesCount, treeUnitPrice }, true);
  if (!allocation.valid) errors.push(...allocation.errors);
  if (!Array.isArray(sections) || !sections.length) errors.push('请至少设置一个路线分段。');
  else {
    let end = 0;
    for (const [index, section] of sections.entries()) {
      if (!section || !['mesh', 'solid', 'corridor', 'plants'].includes(section.type)
          || !Number.isFinite(section.startFraction) || !Number.isFinite(section.endFraction)
          || section.startFraction !== end || section.endFraction <= section.startFraction
          || section.endFraction > 1) {
        errors.push(`第 ${index + 1} 段须使用有效材料，分段应从起点连续覆盖路线，不能重叠或留空。`);
        break;
      }
      end = section.endFraction;
    }
    if (end !== 1) errors.push('最后一段须覆盖到路线终点。');
  }
  if (errors.length) return { valid: false, error: errors.join(' '), errors };
  const { budgetCents, reserveCents, availableCents, treeCount, treePriceCents, requestedTreesCents,
    treeAffordable, fundedTrees, fundedTreesCents, canopyAvailableCents } = allocation;
  const materialNames = { mesh: '透气遮阳网', solid: 'PC 板连廊', corridor: '完整走廊' };
  const fullItems = [], items = [], plannedSections = [], usedMaterials = new Set();
  let remaining = canopyAvailableCents, stopped = !treeAffordable;
  let fullCost = requestedTreesCents, fundedCost = fundedTreesCents, fullModules = 0n, fundedModules = 0n, coveredLengthM = 0;
  const selectedRates = {};
  for (const [index, section] of sections.entries()) {
    // Multiplying endpoints first avoids spurious 6.000000000000001 m thirds.
    const startM = lengthM * section.startFraction, endM = lengthM * section.endFraction;
    const segmentLength = endM - startM;
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
      const error = `第 ${index + 1} 段长度超出当前数值表示精度，请调整分界位置。`;
      return { valid: false, error, errors: [error] };
    }
    const common = { ...section, id: section.id ?? `section-${index + 1}`, startM, endM, lengthM: segmentLength };
    if (section.type === 'plants') {
      plannedSections.push({ ...common, status: 'full', coveredLengthM: 0, fundedEndFraction: section.endFraction,
        fullModules: 0, fundedModules: 0, fullCost: 0, fundedCost: 0, items: [], fullItems: [],
        exact: { fullCostCents: '0', fundedCostCents: '0', fullModules: '0', fundedModules: '0' } });
      continue;
    }
    const type = section.type, repeated = usedMaterials.has(type);
    const sourceRates = ratesByType?.[type] ?? RATES[type];
    // Validate original prices before zeroing already-paid fixed services.
    for (const { id, name } of RATE_DEFINITIONS[type]) validateNumber(sourceRates?.[id], `${materialNames[type]}${name}单价`, true, errors);
    if (errors.length) return { valid: false, error: errors.join(' '), errors };
    selectedRates[type] = { ...sourceRates };
    const sectionRates = { ...sourceRates, ...(repeated ? { survey: 0, delivery: 0 } : {}) };
    const estimate = calculatePlan({ lengthM: segmentLength, widthM, budget: scaledDecimal(stopped ? 0n : remaining, 2),
      reservePct: 0, type, rates: sectionRates, treesCount: 0, treeUnitPrice });
    if (!estimate.valid) return estimate;
    const canFund = !stopped;
    const funded = canFund ? BigInt(estimate.exact.fundedModules) : 0n;
    const segmentFundedCents = canFund ? BigInt(estimate.exact.fundedCostCents) : 0n;
    const segmentFullCents = BigInt(estimate.exact.fullCostCents);
    const qualify = item => ({ ...item, id: `${type}:${item.id}`, baseId: item.id, materialType: type,
      name: `${materialNames[type]} · ${item.name}` });
    const filterItems = rows => rows.filter(item => !repeated || item.scope !== 'fixed').map(qualify);
    const sectionFullItems = filterItems(estimate.fullItems);
    const sectionItems = canFund ? filterItems(estimate.items) : [];
    const covered = canFund ? estimate.coveredLengthM : 0;
    const complete = funded === BigInt(estimate.exact.fullModules);
    plannedSections.push({ ...common, status: complete ? 'full' : funded ? 'partial' : 'insufficient',
      coveredLengthM: covered,
      fundedEndFraction: complete ? section.endFraction : section.startFraction + covered / lengthM,
      fullModules: estimate.fullModules, fundedModules: Number(funded),
      fullCost: money(segmentFullCents), fundedCost: money(segmentFundedCents), items: sectionItems, fullItems: sectionFullItems,
      exact: { fullCostCents: String(segmentFullCents), fundedCostCents: String(segmentFundedCents),
        fullModules: estimate.exact.fullModules, fundedModules: String(funded) } });
    usedMaterials.add(type);
    fullItems.push(...sectionFullItems); items.push(...sectionItems);
    fullCost += segmentFullCents; fundedCost += segmentFundedCents;
    fullModules += BigInt(estimate.exact.fullModules); fundedModules += funded;
    coveredLengthM += covered; remaining -= segmentFundedCents;
    if (!complete) stopped = true;
  }
  const treeItem = count => ({ ...treeDefinition, quantity: Number(count), unitPrice: money(treePriceCents), total: money(count * treePriceCents),
    exactQuantity: String(count), exactUnitPriceCents: String(treePriceCents), exactTotalCents: String(count * treePriceCents) });
  if (treeCount) fullItems.push(treeItem(treeCount));
  if (fundedTrees) items.push(treeItem(fundedTrees));
  function aggregate(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const previous = grouped.get(row.id);
      if (!previous) { grouped.set(row.id, { ...row }); continue; }
      const a = decimalParts(previous.exactQuantity), b = decimalParts(row.exactQuantity), scale = Math.max(a.scale, b.scale);
      const quantity = a.n * pow10(scale - a.scale) + b.n * pow10(scale - b.scale);
      previous.exactQuantity = scaledDecimal(quantity, scale); previous.quantity = scaledNumber(quantity, scale);
      previous.exactTotalCents = String(BigInt(previous.exactTotalCents) + BigInt(row.exactTotalCents));
      previous.total = money(BigInt(previous.exactTotalCents));
    }
    return [...grouped.values()];
  }
  const exact = {
    budgetCents: String(budgetCents), reserveCents: String(reserveCents), availableCents: String(availableCents),
    fullCostCents: String(fullCost), fundedCostCents: String(fundedCost), fullTotalCents: String(fullCost + reserveCents),
    fundedTotalCents: String(fundedCost + reserveCents), shortfallCents: String(nonnegative(fullCost - availableCents)),
    unallocatedAmountCents: String(availableCents - fundedCost), fullModules: String(fullModules), fundedModules: String(fundedModules),
    requestedTreesCostCents: String(requestedTreesCents), treesCostCents: String(fundedTreesCents),
    treeShortfallCents: String(nonnegative(requestedTreesCents - availableCents)), treeUnitPriceCents: String(treePriceCents),
  };
  const result = {
    valid: true, error: null, type: 'mixed', layoutOnly: false, treeOnly: false,
    status: !treeAffordable ? 'overbudget' : fundedModules === fullModules ? 'full' : fundedModules || fundedTrees ? 'partial' : 'insufficient',
    lengthM, widthM, budget: money(budgetCents), reservePct, moduleLengthM: MODULE_LENGTH_M,
    fullModules: Number(fullModules), fundedModules: Number(fundedModules), fullCost: money(fullCost), fundedCost: money(fundedCost),
    reserveAmount: money(reserveCents), available: money(availableCents), fullTotal: money(fullCost + reserveCents),
    fundedTotal: money(fundedCost + reserveCents), shortfall: money(nonnegative(fullCost - availableCents)),
    unallocatedAmount: money(availableCents - fundedCost), coveredLengthM, coveragePercent: Math.round(coveredLengthM / lengthM * 10000) / 100,
    treesCount, treeUnitPrice: money(treePriceCents), fundedTrees: Number(fundedTrees), unfundedTrees: Number(treeCount - fundedTrees),
    treesCost: money(fundedTreesCents), requestedTreesCost: money(requestedTreesCents), treeAffordable,
    treeShortfall: money(nonnegative(requestedTreesCents - availableCents)), sections: plannedSections,
    items: aggregate(items), fullItems: aggregate(fullItems), rates: {}, ratesByType: selectedRates, exact,
    precisionNotice: Object.values(exact).some(value => BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) ? '极大数值可能近似显示；预算比较按整数分计算，exact 字段保留精确值。' : null,
    pricingLabel: '分段示例估价；每段按 6 m 模块计价，同类材料固定费用只计一次，绿植按实际布置另计',
  };
  const numbers = [...Object.values(result), ...result.fullItems.flatMap(item => [item.quantity, item.unitPrice, item.total])];
  if (numbers.some(value => typeof value === 'number' && !Number.isFinite(value))) {
    const error = '计算结果超出当前数值表示范围；这是数值计算限制，不是路线长度或预算上限。';
    return { valid: false, error, errors: [error] };
  }
  return result;
}
