import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePlanting} from './planting-recommendations.mjs';
import {SAMPLE_METERS_PER_PIXEL} from './geometry.mjs';
import {SAMPLE_BUILDINGS} from './campus-buildings.mjs';

const environment={temperatureC:35,radiationWm2:800,sun:{azimuthDeg:180,elevationDeg:60}};
const budgetInput={budget:100000,reservePct:10,treeUnitPrice:380};
const tree={id:'new-tree',x:500,y:280,funded:true};
const options={environment,budgetInput,metersPerPixel:SAMPLE_METERS_PER_PIXEL,useSampleObstacles:false};
const evaluate=overrides=>evaluatePlanting({...options,...overrides});

test('plants-only assessment needs no route; adding and removing a funded tree changes fixed-scope shade',()=>{
  const before=evaluate({trees:[]}),after=evaluate({trees:[tree]}),removed=evaluate({trees:[]});
  assert.equal(after.valid,true);assert.equal(after.routeCoverage,null);
  assert.equal(before.score,null);
  assert.equal(before.coverage.directSunPercent,100);assert.equal(before.coverage.shadePercent,0);
  assert.ok(after.coverage.shadePercent>before.coverage.shadePercent);
  assert.ok(after.coverage.directSunPercent<before.coverage.directSunPercent);
  assert.equal(after.coverage.sampleCount,before.coverage.sampleCount);
  assert.equal(after.coverage.addedTreeShadePercent,after.coverage.shadePercent);
  assert.equal(after.coverage.baselineShadePercent,before.coverage.baselineShadePercent);
  assert.deepEqual(removed.coverage,before.coverage);
  assert.equal(after.coverage.directSunPercent+after.coverage.shadePercent,100);
  assert.ok(after.trees[0].score>50);assert.ok(after.trees[0].reasons.length>=3);
});

test('overlapping new shadows are a union and have lower marginal recommendation scores',()=>{
  const one=evaluate({trees:[tree]}),duplicate=evaluate({trees:[tree,{...tree,id:'duplicate'}]});
  assert.equal(duplicate.coverage.shadePercent,one.coverage.shadePercent);
  assert.equal(duplicate.coverage.addedTreeShadePercent,one.coverage.addedTreeShadePercent);
  assert.ok(duplicate.trees.every(t=>t.score<one.trees[0].score));
  assert.match(duplicate.trees[0].reason,/100%.*重叠/);
  const separated=evaluate({trees:[tree,{...tree,id:'separate',x:700}]});
  assert.ok(separated.coverage.shadePercent>duplicate.coverage.shadePercent);
});

test('route coverage responds to sun azimuth and canopy area responds to sun elevation',()=>{
  const currentRoute=[{x:440,y:280},{x:470,y:280}];
  const east=evaluate({trees:[tree],currentRoute,environment:{...environment,sun:{azimuthDeg:90,elevationDeg:45}}});
  const west=evaluate({trees:[tree],currentRoute,environment:{...environment,sun:{azimuthDeg:270,elevationDeg:45}}});
  assert.equal(east.routeCoverage.scope,'route');assert.ok(east.routeCoverage.addedTreeShadePercent>50);
  assert.equal(west.routeCoverage.addedTreeShadePercent,0);
  const low=evaluate({trees:[tree],environment:{...environment,sun:{azimuthDeg:180,elevationDeg:20}}});
  assert.ok(low.coverage.shadePercent>east.coverage.shadePercent);
});

test('night has no direct sun and attributes no improvement to new trees',()=>{
  const night=evaluate({trees:[tree],currentRoute:[{x:440,y:280},{x:470,y:280}],environment:{...environment,radiationWm2:0,sun:{azimuthDeg:0,elevationDeg:-8}}});
  assert.equal(night.valid,true);assert.equal(night.score,0);assert.equal(night.trees[0].score,0);
  for(const coverage of [night.coverage,night.routeCoverage]){
    assert.equal(coverage.valid,true);assert.equal(coverage.directSunPercent,0);
    assert.equal(coverage.shadePercent,null);assert.equal(coverage.baselineShadePercent,null);
    assert.equal(coverage.addedTreeShadePercent,0);assert.match(coverage.reason,/夜间/);
  }
});

test('unfunded, removed and indoor plants do not cast outdoor shadows',()=>{
  const baseline=evaluate({trees:[]});
  const result=evaluate({trees:[{...tree,funded:false},{...tree,id:'indoor',interior:'图书馆'},{...tree,id:'removed',removed:true}]});
  assert.deepEqual(result.coverage,baseline.coverage);
  assert.equal(result.trees.length,2);assert.equal(result.trees[0].score,0);assert.equal(result.trees[0].funded,false);
  assert.equal(result.trees[1].interior,true);assert.ok(result.trees[1].score>0);
  assert.match(result.trees[1].reason,/不计入室外遮阴/);assert.match(result.trees[1].reason,/不能据此判定/);
  const nightIndoor=evaluate({trees:[{...tree,interior:'图书馆'}],environment:{...environment,radiationWm2:0,sun:{azimuthDeg:0,elevationDeg:-10}}});
  assert.equal(nightIndoor.trees[0].score,result.trees[1].score);
});

test('exact budget affordability is enforced even if a caller marks an unaffordable tree funded',()=>{
  const enough=evaluate({trees:[tree],budgetInput:{budget:'380.00',reservePct:0,treeUnitPrice:380}});
  const short=evaluate({trees:[tree],budgetInput:{budget:'379.99',reservePct:0,treeUnitPrice:380}});
  assert.equal(enough.trees[0].funded,true);assert.ok(enough.coverage.addedTreeShadePercent>0);
  assert.equal(short.trees[0].funded,false);assert.equal(short.trees[0].score,0);assert.equal(short.coverage.addedTreeShadePercent,0);
  const onlyFirst=evaluate({trees:[tree,{...tree,id:'second',x:650}],budgetInput:{budget:'380',reservePct:0,treeUnitPrice:380}});
  assert.equal(onlyFirst.trees[0].funded,true);assert.equal(onlyFirst.trees[1].funded,false);
  assert.equal(onlyFirst.coverage.shadePercent,enough.coverage.shadePercent);
});

test('missing or invalid scale and invalid solar data never produce invented percentages',()=>{
  for(const metersPerPixel of [undefined,null,0,-1,NaN]){
    const result=evaluate({trees:[tree],metersPerPixel});
    assert.equal(result.valid,false);assert.equal(result.score,null);assert.equal(result.trees[0].score,null);
    assert.equal(result.trees[0].funded,true);
    assert.equal(result.coverage.valid,false);assert.equal(result.coverage.directSunPercent,null);
    assert.equal(result.coverage.addedTreeShadePercent,null);assert.match(result.reasons[0],/校准/);
  }
  for(const sun of [{azimuthDeg:NaN,elevationDeg:30},{azimuthDeg:360.1,elevationDeg:30},{azimuthDeg:90,elevationDeg:91}]){
    const result=evaluate({trees:[tree],environment:{...environment,sun}});
    assert.equal(result.valid,false);assert.equal(result.score,null);assert.equal(result.coverage.shadePercent,null);
  }
  assert.equal(evaluate({budgetInput:{...budgetInput,budget:'bad'}}).valid,false);
  const noFundingFlag=evaluate({trees:[{id:'unmarked',x:500,y:280}],metersPerPixel:null});
  assert.equal(noFundingFlag.trees[0].funded,undefined);
  const extreme=evaluate({trees:[tree],metersPerPixel:1e-160});
  assert.equal(extreme.valid,false);assert.equal(extreme.coverage.shadePercent,null);
});

test('sample campus preserves existing building and greenery baseline while masking building ground',()=>{
  const open=evaluate({trees:[]}),campus=evaluate({trees:[],useSampleObstacles:true});
  assert.ok(campus.coverage.sampleCount<open.coverage.sampleCount);
  assert.ok(campus.coverage.baselineShadePercent>0);
  assert.equal(campus.coverage.shadePercent,campus.coverage.baselineShadePercent);
  const planted=evaluate({trees:[tree],useSampleObstacles:true});
  assert.equal(planted.coverage.baselineShadePercent,campus.coverage.baselineShadePercent);
  assert.ok(planted.coverage.shadePercent>=campus.coverage.shadePercent);
  const badLocation=evaluate({trees:[{...tree,x:150,y:150}],useSampleObstacles:true});
  assert.equal(badLocation.trees[0].score,0);assert.match(badLocation.trees[0].reason,/建筑占地/);
  assert.equal(badLocation.coverage.shadePercent,campus.coverage.shadePercent);
  assert.match(open.coverage.assumptions,/未识别实际建筑/);
});

test('existing canopy shade is a fixed baseline and only funded canopy length is represented',()=>{
  const currentRoute=[{x:400,y:280},{x:600,y:280}],sunEnvironment={...environment,sun:{azimuthDeg:180,elevationDeg:90}};
  const plan={valid:true,type:'mesh',widthM:2.4,coveragePercent:50};
  const noRoof=evaluate({trees:[],currentRoute,environment:sunEnvironment});
  const halfRoof=evaluate({trees:[],currentRoute,plan,environment:sunEnvironment});
  const fullRoof=evaluate({trees:[],currentRoute,plan:{...plan,coveragePercent:100},environment:sunEnvironment});
  assert.equal(noRoof.coverage.baselineShadePercent,0);
  assert.ok(halfRoof.coverage.baselineShadePercent>0);assert.ok(fullRoof.coverage.baselineShadePercent>halfRoof.coverage.baselineShadePercent);
  assert.ok(halfRoof.routeCoverage.shadePercent>=49&&halfRoof.routeCoverage.shadePercent<=51);
  assert.equal(fullRoof.routeCoverage.shadePercent,100);
  const withTree=evaluate({trees:[{...tree,x:700}],currentRoute,plan,environment:sunEnvironment});
  assert.equal(withTree.coverage.baselineShadePercent,halfRoof.coverage.baselineShadePercent);
  assert.ok(withTree.coverage.addedTreeShadePercent>0);
  const layout=evaluate({trees:[],currentRoute,plan:{...plan,layoutOnly:true},environment:sunEnvironment});
  assert.equal(layout.coverage.baselineShadePercent,0);
  const corridor=evaluate({trees:[],currentRoute,plan:{...plan,type:'corridor'},environment:sunEnvironment});
  assert.ok(corridor.coverage.baselineShadePercent>halfRoof.coverage.baselineShadePercent);
});

test('mixed canopy shade follows financed section positions, excluding planted-only and pending sections',()=>{
  const currentRoute=[{x:100,y:202.5},{x:900,y:202.5}];
  const plan={valid:true,type:'mixed',widthM:10,coveragePercent:90,sections:[
    {type:'plants',startFraction:0,endFraction:.25,fundedEndFraction:.25},
    {type:'mesh',startFraction:.25,endFraction:.5,fundedEndFraction:.5},
    {type:'solid',startFraction:.5,endFraction:.75,fundedEndFraction:.625},
    {type:'corridor',startFraction:.75,endFraction:1,fundedEndFraction:.75},
  ]};
  const result=evaluate({trees:[],currentRoute,plan,metersPerPixel:1,includeCoverageMap:true,environment:{...environment,sun:{azimuthDeg:180,elevationDeg:90}}});
  const cell=(x,y)=>result.coverageMap.cells[Math.floor(y/5)*result.coverageMap.width+Math.floor(x/5)];
  assert.equal(result.valid,true);
  assert.equal(cell(152.5,202.5),1,'planted-only section must not invent a roof or trees');
  assert.equal(cell(352.5,202.5),2,'mesh begins at its actual section boundary');
  assert.equal(cell(552.5,202.5),2,'financed PC portion casts a shadow');
  assert.equal(cell(652.5,202.5),1,'unfunded PC portion casts no shadow');
  assert.equal(cell(752.5,202.5),1,'pending full corridor casts no shadow');
  assert.ok(Math.abs(result.routeCoverage.shadePercent-37.5)<1);
});

test('mixed canopy sections retain bends instead of shading the start or a diagonal shortcut',()=>{
  const currentRoute=[{x:100,y:202.5},{x:502.5,y:202.5},{x:502.5,y:502.5}];
  const plan={valid:true,type:'mixed',widthM:10,coveragePercent:50,sections:[
    {type:'plants',startFraction:0,endFraction:.5,fundedEndFraction:.5},
    {type:'corridor',startFraction:.5,endFraction:1,fundedEndFraction:1},
  ]};
  const result=evaluate({trees:[],currentRoute,plan,metersPerPixel:1,includeCoverageMap:true,environment:{...environment,sun:{azimuthDeg:180,elevationDeg:90}}});
  const cell=(x,y)=>result.coverageMap.cells[Math.floor(y/5)*result.coverageMap.width+Math.floor(x/5)];
  assert.equal(cell(152.5,202.5),1);
  assert.equal(cell(502.5,352.5),2);
  assert.equal(cell(352.5,352.5),1);
  const noRoofs=evaluate({trees:[],currentRoute,plan:{...plan,sections:plan.sections.map(s=>({...s,type:'plants'}))},metersPerPixel:1,environment:{...environment,sun:{azimuthDeg:180,elevationDeg:90}}});
  assert.equal(noRoofs.coverage.shadePercent,0);
});

test('a tree entirely under existing building shade adds no shade and receives no shade recommendation',()=>{
  const result=evaluate({trees:[{...tree,x:200,y:245}],useSampleObstacles:true,environment:{...environment,sun:{azimuthDeg:0,elevationDeg:45}}});
  assert.equal(result.coverage.addedTreeShadePercent,0);
  assert.equal(result.trees[0].score,0);assert.match(result.trees[0].reason,/未形成额外/);
});

test('weaker light and lower temperature reduce outdoor priorities without inventing a different area',()=>{
  const hot=evaluate({trees:[tree]});
  const cool=evaluate({trees:[tree],environment:{...environment,temperatureC:20,radiationWm2:160}});
  assert.ok(hot.trees[0].score>cool.trees[0].score);
  assert.equal(hot.coverage.shadePercent,cool.coverage.shadePercent);
  assert.match(cool.trees[0].reason,/需求较低/);
});

test('coverage is deterministic; indoor or malformed routes do not replace campus coverage',()=>{
  const first=evaluate({trees:[tree]}),second=evaluate({trees:[tree]});assert.deepEqual(first,second);
  for(const currentRoute of [[],[{x:1,y:1}],[{x:NaN,y:1},{x:100,y:1}],[{x:20,y:20,interior:'图书馆'},{x:100,y:20,interior:'图书馆'}]]){
    const result=evaluate({trees:[tree],currentRoute});assert.deepEqual(result.coverage,first.coverage);assert.equal(result.routeCoverage,null);
  }
  const input={...options,trees:[{...tree}],currentRoute:[{x:440,y:280},{x:470,y:280}]};
  const before=JSON.stringify(input);evaluatePlanting(input);assert.equal(JSON.stringify(input),before);
});

function assertRasterMatchesCoverage(result){
  const {coverageMap:map,coverage}=result;
  assert.equal(map.valid,true);assert.equal(map.night,false);
  assert.equal(map.width,196);assert.equal(map.height,114);
  assert.equal(map.mapWidth,980);assert.equal(map.mapHeight,570);
  assert.equal(map.rowOrder,'north-to-south');
  assert.ok(map.cells instanceof Uint8Array);assert.equal(map.cells.length,196*114);
  const counts=[0,0,0,0];for(const cell of map.cells){assert.ok(cell>=0&&cell<=3);counts[cell]++;}
  const n=counts[1]+counts[2]+counts[3],percent=count=>Math.round(count/n*10000)/100;
  assert.equal(n,coverage.sampleCount);
  assert.equal(percent(counts[1]),coverage.directSunPercent);
  assert.equal(percent(counts[2]+counts[3]),coverage.shadePercent);
  assert.equal(percent(counts[2]),coverage.baselineShadePercent);
  assert.equal(percent(counts[3]),coverage.addedTreeShadePercent);
  return counts;
}

test('coverage raster is opt-in and uses exactly the same samples as campus percentages',()=>{
  const basic=evaluate({trees:[tree],useSampleObstacles:true});
  const mapped=evaluate({trees:[tree],useSampleObstacles:true,includeCoverageMap:true});
  assert.equal(basic.coverageMap,null);
  assert.deepEqual({...mapped,coverageMap:null},basic);
  const counts=assertRasterMatchesCoverage(mapped);
  assert.ok(counts[0]>0);assert.ok(counts[1]>0);assert.ok(counts[2]>0);assert.ok(counts[3]>0);
  for(let row=0;row<mapped.coverageMap.height;row++)for(let column=0;column<mapped.coverageMap.width;column++){
    const x=(column+.5)*5,y=(row+.5)*5;
    const excluded=SAMPLE_BUILDINGS.some(b=>x>b.x&&x<b.x+b.w&&y>b.y&&y<b.y+b.d);
    assert.equal(mapped.coverageMap.cells[row*196+column]===0,excluded);
  }
});

test('raster new-tree shade is removed immediately after deletion or losing budget and overlapping shadows stay unique',()=>{
  const parameters={useSampleObstacles:true,includeCoverageMap:true};
  const baseline=evaluate({...parameters,trees:[]}),planted=evaluate({...parameters,trees:[tree]});
  const removed=evaluate({...parameters,trees:[{...tree,removed:true}]});
  const unfunded=evaluate({...parameters,trees:[tree],budgetInput:{budget:0,reservePct:0,treeUnitPrice:380}});
  const pending=evaluate({...parameters,trees:[{...tree,funded:false}]});
  const duplicate=evaluate({...parameters,trees:[tree,{...tree,id:'duplicate'}]});
  for(const result of [baseline,planted,removed,unfunded,pending,duplicate])assertRasterMatchesCoverage(result);
  assert.ok(planted.coverageMap.cells.includes(3));
  assert.deepEqual(duplicate.coverageMap.cells,planted.coverageMap.cells);
  for(const result of [removed,unfunded,pending])assert.deepEqual(result.coverageMap.cells,baseline.coverageMap.cells);
  for(let i=0;i<baseline.coverageMap.cells.length;i++){
    const before=baseline.coverageMap.cells[i],after=planted.coverageMap.cells[i];
    assert.ok(before===after||(before===1&&after===3));
  }
});

test('raster shadows move opposite the sun and cannot wrap across map borders',()=>{
  const parameters={trees:[tree],includeCoverageMap:true};
  const east=evaluate({...parameters,environment:{...environment,sun:{azimuthDeg:90,elevationDeg:45}}});
  const west=evaluate({...parameters,environment:{...environment,sun:{azimuthDeg:270,elevationDeg:45}}});
  assertRasterMatchesCoverage(east);assertRasterMatchesCoverage(west);
  assert.notDeepEqual(east.coverageMap.cells,west.coverageMap.cells);
  const meanX=map=>{
    let x=0,n=0;for(let i=0;i<map.cells.length;i++)if(map.cells[i]===3){x+=((i%map.width)+.5)*5;n++;}return x/n;
  };
  assert.ok(meanX(east.coverageMap)<tree.x);assert.ok(meanX(west.coverageMap)>tree.x);
  const boundary=evaluate({trees:[{...tree,x:2.5,y:2.5}],includeCoverageMap:true,environment:{...environment,sun:{azimuthDeg:180,elevationDeg:90}}});
  assertRasterMatchesCoverage(boundary);
  assert.equal(boundary.coverageMap.cells[0],3);
  assert.equal(boundary.coverageMap.cells[195],1);
  assert.equal(boundary.coverageMap.cells[113*196],1);
  assert.equal(boundary.coverageMap.cells.at(-1),1);
});

test('funded canopy remains baseline class 2 when new crowns overlap it',()=>{
  const parameters={includeCoverageMap:true,currentRoute:[{x:400,y:280},{x:600,y:280}],plan:{valid:true,type:'corridor',widthM:2.4,coveragePercent:100},environment:{...environment,sun:{azimuthDeg:180,elevationDeg:90}}};
  const baseline=evaluate({...parameters,trees:[]}),planted=evaluate({...parameters,trees:[tree]});
  assertRasterMatchesCoverage(baseline);assertRasterMatchesCoverage(planted);
  assert.ok(baseline.coverageMap.cells.includes(2));
  for(let i=0;i<baseline.coverageMap.cells.length;i++)if(baseline.coverageMap.cells[i]===2)assert.equal(planted.coverageMap.cells[i],2);
  const unfundedRoof=evaluate({...parameters,trees:[],plan:{...parameters.plan,coveragePercent:0}});
  assert.equal(unfundedRoof.coverageMap.cells.includes(2),false);
});

test('night returns a blank raster and invalid scale or environment returns no raster',()=>{
  const night=evaluate({trees:[tree],includeCoverageMap:true,environment:{...environment,radiationWm2:0,sun:{azimuthDeg:0,elevationDeg:-10}}});
  assert.equal(night.coverageMap.valid,true);assert.equal(night.coverageMap.night,true);
  assert.equal(night.coverageMap.cells.length,196*114);assert.ok(night.coverageMap.cells.every(cell=>cell===0));
  for(const overrides of [{metersPerPixel:null},{environment:{...environment,sun:{azimuthDeg:NaN,elevationDeg:30}}},{budgetInput:{budget:'invalid'}}]){
    const result=evaluate({trees:[tree],includeCoverageMap:true,...overrides});
    assert.equal(result.valid,false);assert.equal(result.coverageMap,null);
  }
});

test('mutating returned raster cells does not mutate cached sampling or subsequent results',()=>{
  const parameters={trees:[tree],useSampleObstacles:true,includeCoverageMap:true};
  const first=evaluate(parameters),snapshot=first.coverageMap.cells.slice(),second=evaluate(parameters);
  assert.notEqual(first.coverageMap.cells,second.coverageMap.cells);
  first.coverageMap.cells.fill(255);first.coverageMap.width=1;
  assert.deepEqual(second.coverageMap.cells,snapshot);
  const third=evaluate(parameters);assert.deepEqual(third.coverageMap.cells,snapshot);assertRasterMatchesCoverage(third);
});
