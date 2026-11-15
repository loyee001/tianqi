import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendRoutes,evaluateRoute,estimateRouteExposure,SAMPLE_CANDIDATES,routeCrossesSampleBuilding} from './climate-recommendations.mjs';
import {deriveRouteLength,SAMPLE_METERS_PER_PIXEL} from './geometry.mjs';
import {calculatePlan,DEFAULT_RATES} from './budget.mjs';
const environment={temperatureC:34,radiationWm2:750,sun:{azimuthDeg:90,elevationDeg:25}};
const budgetInput={budget:'50000',reservePct:10,type:'mesh',widthM:2.4,treesCount:0,treeUnitPrice:380};
const run=extra=>recommendRoutes({environment,budgetInput,...extra});

test('default corridors have valid outdoor endpoints and never cross building footprints',()=>{
  for(const c of SAMPLE_CANDIDATES){assert.equal(routeCrossesSampleBuilding(c.route),false);assert.ok(deriveRouteLength(c.route,SAMPLE_METERS_PER_PIXEL)>0);assert.match(c.from,/门外/);assert.match(c.to,/门外/);}
  const result=run();assert.equal(result.valid,true);assert.equal(result.status,'recommended');assert.ok(result.candidates.some(c=>c.id===result.recommendedId));
});
test('sun direction changes shadow exposure and the mild-temperature preferred corridor',()=>{
  const east=run({environment:{...environment,temperatureC:23}});
  const west=run({environment:{...environment,temperatureC:23,sun:{azimuthDeg:270,elevationDeg:25}}});
  assert.notEqual(east.recommendedId,west.recommendedId);
  const id='library-teaching';assert.notEqual(east.candidates.find(c=>c.id===id).exposurePercent,west.candidates.find(c=>c.id===id).exposurePercent);
});
test('temperature changes the tradeoff between a highly exposed short segment and exposed total length',()=>{
  const cool=run({environment:{...environment,temperatureC:23,sun:{azimuthDeg:270,elevationDeg:25}}});
  const hot=run({environment:{...environment,temperatureC:36,sun:{azimuthDeg:270,elevationDeg:25}}});
  assert.notEqual(cool.recommendedId,hot.recommendedId);assert.ok(hot.candidates[0].lengthM>cool.candidates[0].lengthM);
});
test('night and weak light never present an urgent recommended construction route',()=>{
  for(const patch of [{radiationWm2:0,sun:{azimuthDeg:270,elevationDeg:-10}},{radiationWm2:30}]){
    const result=run({environment:{...environment,...patch}});assert.equal(result.status,'low-priority');assert.equal(result.recommendedId,null);assert.ok(result.candidates.every(c=>c.priorityScore===0));
  }
});
test('a constrained budget selects a continuous affordable portion with matching length and plan',()=>{
  const result=run({budgetInput:{...budgetInput,budget:'10000'}});assert.equal(result.valid,true);assert.equal(result.status,'recommended');
  for(const c of result.candidates){
    assert.equal(c.partial,true);assert.ok(c.lengthM<=6);assert.ok(Math.abs(c.lengthM-deriveRouteLength(c.route,SAMPLE_METERS_PER_PIXEL))<1e-9);assert.equal(c.plan.lengthM,c.lengthM);assert.equal(c.plan.status,'full');assert.ok(BigInt(c.plan.exact.fundedTotalCents)<=1000000n);assert.ok(c.from&&c.to);
  }
});
test('zero and module-minus-one-cent budgets never invent an applicable segment',()=>{
  const one=calculatePlan({...budgetInput,budget:'100000',lengthM:6,reservePct:0});
  const below=(BigInt(one.exact.fundedCostCents)-1n);const text=String(below/100n)+'.'+String(below%100n).padStart(2,'0');
  for(const budget of ['0',text]){const result=run({budgetInput:{...budgetInput,budget,reservePct:0}});assert.equal(result.status,'insufficient');assert.equal(result.recommendedId,null);assert.deepEqual(result.candidates,[]);}
  const exact=run({budgetInput:{...budgetInput,budget:String(one.fundedCost),reservePct:0}});assert.equal(exact.status,'recommended');assert.ok(exact.candidates.every(c=>c.plan.fundedModules===1));
});
test('large budget strings and planted-tree priority preserve the existing exact budget model',()=>{
  const result=run({budgetInput:{...budgetInput,budget:'10000000000000000000001',treesCount:5}});
  for(const c of result.candidates){assert.equal(c.plan.exact.budgetCents,'1000000000000000000000100');assert.equal(c.plan.treesCost,1900);assert.equal(c.plan.fundedTrees,5);}
  const tooMany=run({budgetInput:{...budgetInput,budget:'1000',treesCount:5}});assert.equal(tooMany.status,'insufficient');
});
test('custom uploaded routes do not inherit sample buildings or invented candidate routes',()=>{
  const custom={id:'custom',from:'自选起点',to:'自选终点',route:[{x:100,y:150},{x:250,y:150}]};
  assert.equal(routeCrossesSampleBuilding(custom.route),true);
  const result=run({candidates:[custom],useSampleObstacles:false});assert.equal(result.status,'recommended');assert.equal(result.candidates[0].exposurePercent,100);assert.match(result.candidates[0].assumptions,/缺少三维/);
  assert.equal(run({useSampleObstacles:false}).valid,false);
});
test('invalid budget, prices, calibration, environment and indoor-only routes fail explicitly',()=>{
  assert.equal(run({budgetInput:{...budgetInput,budget:''}}).valid,false);
  assert.equal(run({budgetInput:{...budgetInput,treeUnitPrice:.004}}).valid,false);
  assert.equal(run({metersPerPixel:null}).valid,false);
  assert.equal(run({environment:{...environment,temperatureC:NaN}}).valid,false);
  assert.equal(run({candidates:[{id:'inside',route:[{x:150,y:410,interior:'图书馆'},{x:180,y:410,interior:'图书馆'}]}]}).valid,false);
});
test('funded outdoor trees can reduce modelled exposure, while pending and indoor plants cannot',()=>{
  const route=[{x:490,y:285},{x:492,y:285}],sun={azimuthDeg:180,elevationDeg:80};
  const base={route,sun,metersPerPixel:1,useSampleObstacles:false};
  assert.equal(estimateRouteExposure(base),100);
  assert.ok(estimateRouteExposure({...base,trees:[{x:491,y:285,funded:true}]})<100);
  assert.equal(estimateRouteExposure({...base,trees:[{x:491,y:285,funded:false}]}),100);
  assert.equal(estimateRouteExposure({...base,trees:[{x:491,y:285,interior:'图书馆'}]}),100);
});


test('drawn-route score uses the original entire route and respects the 49/50 threshold',()=>{
  const hot={temperatureC:36,radiationWm2:800,sun:{azimuthDeg:180,elevationDeg:80}};
  const halfCost=calculatePlan({...budgetInput,budget:'100000',reservePct:0,lengthM:24}).fundedCost;
  const input={environment:hot,budgetInput:{...budgetInput,budget:String(halfCost),reservePct:0},metersPerPixel:1,useSampleObstacles:false};
  const at50=evaluateRoute({...input,route:[{x:0,y:0},{x:48,y:0}]});
  assert.equal(at50.score,50);assert.equal(at50.belowThreshold,false);assert.equal(at50.plan.lengthM,48);assert.equal(at50.plan.coveredLengthM,24);assert.equal(at50.budgetCoveragePercent,50);
  const at49=evaluateRoute({...input,route:[{x:0,y:0},{x:49,y:0}]});
  assert.equal(at49.score,49);assert.equal(at49.belowThreshold,true);assert.match(at49.reason,/可行性过低，请换一条路线/);assert.equal(at49.plan.lengthM,49);assert.equal(at49.plan.coveredLengthM,24);
});
test('blocked and nocturnal original routes score zero, while invalid sun inputs have no fabricated score',()=>{
  const blocked=evaluateRoute({route:[{x:100,y:150},{x:250,y:150}],environment,budgetInput});
  assert.equal(blocked.valid,true);assert.equal(blocked.score,0);assert.equal(blocked.obstructed,true);assert.match(blocked.reason,/穿过/);
  const route=SAMPLE_CANDIDATES[0].route;
  const night=evaluateRoute({route,environment:{...environment,sun:{azimuthDeg:250,elevationDeg:-10},radiationWm2:0},budgetInput});assert.equal(night.score,0);assert.match(night.reason,/夜间/);
  for(const sun of [{azimuthDeg:180,elevationDeg:91},{azimuthDeg:361,elevationDeg:30},{azimuthDeg:NaN,elevationDeg:30}]){
    const invalid=evaluateRoute({route,environment:{...environment,sun},budgetInput});assert.equal(invalid.valid,false);assert.equal(invalid.score,null);assert.equal(invalid.belowThreshold,null);assert.equal(run({environment:{...environment,sun}}).valid,false);
  }
});
test('candidate percentages use the same score and ordering as manually drawn routes',()=>{
  const result=run();let last=Infinity;
  for(const c of result.candidates){const evaluation=evaluateRoute({route:c.route,environment,budgetInput});assert.equal(c.recommendationScore,evaluation.score);assert.equal(c.belowThreshold,evaluation.belowThreshold);assert.ok(c.recommendationScore<=last);last=c.recommendationScore;}
  assert.ok(result.candidates.find(c=>c.id===result.recommendedId).recommendationScore>=50);
  const weak=run({environment:{...environment,radiationWm2:200}});assert.equal(weak.status,'low-priority');assert.equal(weak.recommendedId,null);assert.ok(weak.candidates.every(c=>c.recommendationScore<50));
});
test('a custom uploaded route is scored without silently claiming it intersects sample buildings',()=>{
  const route=[{x:100,y:150},{x:250,y:150}];
  const result=evaluateRoute({route,environment,budgetInput,useSampleObstacles:false});assert.equal(result.valid,true);assert.equal(result.obstructed,false);assert.ok(result.score>=50);assert.match(result.assumptions,/缺少三维/);
});


test('funded outdoor tree trunks block walking routes, but pending trees and broad crowns do not act as walls',()=>{
  const input={route:[{x:480,y:285},{x:500,y:285}],environment:{temperatureC:36,radiationWm2:800,sun:{azimuthDeg:180,elevationDeg:80}},budgetInput,metersPerPixel:1,useSampleObstacles:false};
  const blocked=evaluateRoute({...input,trees:[{x:490,y:285,funded:true}]});assert.equal(blocked.obstructed,true);assert.equal(blocked.score,0);assert.match(blocked.reason,/树干/);
  const pending=evaluateRoute({...input,trees:[{x:490,y:285,funded:false}]});assert.equal(pending.obstructed,false);assert.ok(pending.score>=50);
  const indoor=evaluateRoute({...input,trees:[{x:490,y:285,interior:'图书馆'}]});assert.equal(indoor.obstructed,false);
  const beside=evaluateRoute({...input,trees:[{x:490,y:286,funded:true}]});assert.equal(beside.obstructed,false);
  const sampleRoute=[{x:440,y:163},{x:462,y:163}];
  assert.equal(evaluateRoute({...input,route:sampleRoute,useSampleObstacles:true}).obstructed,true);
  assert.equal(evaluateRoute({...input,route:sampleRoute,useSampleObstacles:false}).obstructed,false);
});

const mixedSections=[
  {id:'green',type:'plants',startFraction:0,endFraction:.25},
  {id:'shade',type:'mesh',startFraction:.25,endFraction:.5},
  {id:'rain',type:'solid',startFraction:.5,endFraction:.75},
  {id:'hall',type:'corridor',startFraction:.75,endFraction:1},
];
const mixedInput={...budgetInput,type:'mixed',budget:'1000000',sections:mixedSections,ratesByType:{mesh:DEFAULT_RATES('mesh'),solid:DEFAULT_RATES('solid'),corridor:DEFAULT_RATES('corridor')}};
const mixedCandidate={id:'mixed',from:'甲门口',to:'乙门口',route:[{x:100,y:300},{x:130,y:300},{x:130,y:330}]};

test('mixed recommendations preserve the entire bent route, material order and exact combined budget',()=>{
  const result=run({budgetInput:{...mixedInput,treesCount:2},candidates:[mixedCandidate],metersPerPixel:1,useSampleObstacles:false});
  assert.equal(result.valid,true);assert.equal(result.candidates.length,1);
  const candidate=result.candidates[0];
  assert.deepEqual(candidate.route,mixedCandidate.route);assert.equal(candidate.lengthM,60);
  assert.equal(candidate.plan.type,'mixed');assert.equal(candidate.plan.status,'full');
  assert.deepEqual(candidate.plan.sections.map(s=>[s.id,s.type,s.startFraction,s.endFraction]),mixedSections.map(s=>[s.id,s.type,s.startFraction,s.endFraction]));
  assert.equal(candidate.plan.treesCost,760);assert.equal(candidate.plan.reserveAmount,100000);
  assert.equal(candidate.plan.coveredLengthM,45);
  assert.ok(BigInt(candidate.plan.exact.fundedTotalCents)<=BigInt(candidate.plan.exact.budgetCents));
  assert.match(candidate.reason,/保留各段材料选择/);
  const direct=evaluateRoute({route:candidate.route,environment,budgetInput:{...mixedInput,treesCount:2},metersPerPixel:1,useSampleObstacles:false});
  assert.equal(candidate.recommendationScore,direct.score);
});

test('a limited mixed budget keeps unfunded sections in place rather than cropping or shifting materials',()=>{
  const input={...mixedInput,budget:'10000',reservePct:0};
  const result=run({budgetInput:input,candidates:[mixedCandidate],metersPerPixel:1,useSampleObstacles:false});
  assert.equal(result.valid,true);assert.equal(result.candidates.length,1);
  const candidate=result.candidates[0];
  assert.deepEqual(candidate.route,mixedCandidate.route);
  assert.equal(candidate.from,mixedCandidate.from);assert.equal(candidate.to,mixedCandidate.to);
  assert.equal(candidate.partial,true);assert.equal(candidate.plan.status,'partial');
  assert.equal(candidate.plan.sections[1].fundedModules,1);
  assert.equal(candidate.plan.sections[2].fundedModules,0);
  assert.equal(candidate.plan.sections[3].fundedModules,0);
  assert.ok(BigInt(candidate.plan.exact.fundedTotalCents)<=1000000n);
  assert.match(candidate.reason,/分段材料和位置已保留/);assert.doesNotMatch(candidate.reason,/连续一段/);
  assert.equal(candidate.belowThreshold,true);
});

test('mixed recommendation validates the selected material rates including sub-cent prices',()=>{
  const invalid=run({budgetInput:{...mixedInput,ratesByType:{...mixedInput.ratesByType,solid:{...mixedInput.ratesByType.solid,coverage:.005}}}});
  assert.equal(invalid.valid,false);assert.match(invalid.reason,/两位小数/);
});

test('mixed route score uses the exposure of financed positions rather than whole-route average',()=>{
  const input={route:[{x:100,y:280},{x:400,y:280}],environment:{temperatureC:36,radiationWm2:800,sun:{azimuthDeg:0,elevationDeg:30}},metersPerPixel:.1,useSampleObstacles:false,trees:[{x:160,y:220,funded:true}]};
  const assessment=first=>evaluateRoute({...input,budgetInput:{...mixedInput,treesCount:1,sections:[
    {id:'a',type:first?'mesh':'plants',startFraction:0,endFraction:.5},
    {id:'b',type:first?'plants':'mesh',startFraction:.5,endFraction:1},
  ]}});
  const shaded=assessment(true),exposed=assessment(false);
  assert.equal(shaded.valid,true);assert.equal(exposed.valid,true);
  assert.equal(shaded.exposurePercent,exposed.exposurePercent);
  assert.equal(shaded.budgetCoveragePercent,50);assert.equal(exposed.budgetCoveragePercent,50);
  assert.ok(shaded.fundedExposedRoutePercent<exposed.fundedExposedRoutePercent);
  assert.ok(shaded.score<exposed.score);
  assert.match(exposed.reason,/实际资助位置/);
});
