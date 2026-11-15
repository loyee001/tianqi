import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as budget from './budget.mjs';
import * as geometry from './geometry.mjs';
import {recommendRoutes} from './climate-recommendations.mjs';
import {createClimateSimulation} from './climate-simulation.mjs';

// DOM integration harness: execute the real app module and dispatch its real
// button handlers. The scene is stubbed only at its renderer boundary; geometry,
// budget validation and all application state transitions run unchanged.
class Element {
  constructor(){this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.style={};this.attributes={};this.children=[];this.events={};this.textContent='';this.innerHTML='';this.classList={add(){},remove(){},toggle(){}};}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  fire(type){for(const fn of this.events[type]??[])fn({target:this,currentTarget:this,preventDefault(){},key:''});}
  click(){this.fire('click');}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(key,value){this.attributes[key]=value;}
  getAttribute(key){return this.attributes[key]??null;}
}
async function setup({realClimate=false}={}){
  const elements=new Map(),all=new Map();
  const el=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
  for(const [selector,value] of Object.entries({'#length':'48','#width':'2.4','#budget':'50000','#reserve':'10','#tree-price':'380'}))el(selector).value=value;
  for(const [selector,key,values] of [['[data-mode]','mode',['orbit','walk']],['[data-view]','view',['3d','2d']],['[data-tab]','tab',['design','materials','guide']]])all.set(selector,values.map(v=>{const e=new Element();e.dataset[key]=v;return e;}));
  const document={body:new Element(),querySelector:el,querySelectorAll:selector=>all.get(selector)??[],createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){}};
  let callbacks,climateCallbacks,lastScene,lastBlob,lastLightMap,lightVisible=true,pedestriansVisible=true,sceneMode='orbit',planting=false,routeEditing=false;
  const scene={update(value){lastScene=value;},setLightCoverage(map){lastLightMap=map;},setLightCoverageVisible(value){lightVisible=value;},setPedestriansEnabled(value){pedestriansVisible=value;},setMode(value){sceneMode=value;},setPlanting(value){planting=value;},setRouteEditing(value){routeEditing=value;},setEnvironment(){},resize(){},resetView(){},move(){},jump(){},toggleFlight(){}};
  const context=vm.createContext({document,console,structuredClone,Blob,URL:{createObjectURL:blob=>(lastBlob=blob,'blob:unit-test'),revokeObjectURL(){}},requestAnimationFrame:fn=>fn(),setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},DOMPoint:class{},Image:class{}});
  function moduleFor(values){return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});}
  const imports=new Map([['./climate-ui.mjs',moduleFor({createClimatePanel(options){climateCallbacks=options;return {refreshRecommendations(){}};}})],['./budget.mjs',moduleFor(budget)],['./geometry.mjs',moduleFor(geometry)],['./scene3d.mjs',moduleFor({createCampusScene(container,options){callbacks=options;return scene;}})]]);
  if(realClimate){
    const modules=new Map();
    for(const name of ['climate-simulation','climate-recommendations','planting-recommendations'])modules.set(`./${name}.mjs`,moduleFor(await import(`./${name}.mjs`)));
    const ui=new vm.SourceTextModule(await readFile(new URL('./climate-ui.mjs',import.meta.url),'utf8'),{context});
    await ui.link(name=>modules.get(name));await ui.evaluate();
    imports.set('./climate-ui.mjs',moduleFor({createClimatePanel(options){climateCallbacks=options;return ui.namespace.createClimatePanel(options);}}));
  }
  const source=await readFile(new URL('./app.mjs',import.meta.url),'utf8');
  const app=new vm.SourceTextModule(source,{context,importModuleDynamically:async name=>{const m=imports.get(name);if(m.status==='unlinked')await m.link(()=>{});if(m.status==='linked')await m.evaluate();return m;}});
  await app.link(name=>imports.get(name));await app.evaluate();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(callbacks,'scene initializes');
  return {el,callbacks,climate:()=>climateCallbacks,download:()=>lastBlob,scene:()=>lastScene,lightMap:()=>lastLightMap,lightVisible:()=>lightVisible,pedestriansVisible:()=>pedestriansVisible,mode:()=>sceneMode,planting:()=>planting,routeEditing:()=>routeEditing,clickMode:mode=>all.get('[data-mode]').find(e=>e.dataset.mode===mode).click(),fill(selector,value){el(selector).value=value;el(selector).fire('input');}};
}

test('3D start and end clicks finish automatically without leaving walk mode',async()=>{
  const a=await setup();a.clickMode('walk');a.el('#edit-route').click();assert.equal(a.mode(),'walk');assert.equal(a.routeEditing(),true);
  a.callbacks.onRoutePoint({x:350,y:250});assert.equal(a.scene().route.length,1);assert.equal(a.scene().plan.valid,false);
  a.callbacks.onRoutePoint({x:400,y:250});assert.equal(a.routeEditing(),false);assert.equal(a.scene().route.length,2);assert.equal(a.scene().plan.valid,true);assert.equal(a.mode(),'walk');assert.equal(Number(a.el('#length').value),50*geometry.SAMPLE_METERS_PER_PIXEL);
});

test('3D curve picks endpoints then a through point, budgets the curved length and keeps walk mode',async()=>{
  const a=await setup();a.clickMode('walk');a.el('#route-shape').value='curve';a.el('#route-shape').fire('change');a.el('#edit-route').click();
  a.callbacks.onRoutePoint({x:520,y:400});a.callbacks.onRoutePoint({x:650,y:420});assert.equal(a.routeEditing(),true);assert.equal(a.scene().plan.valid,false);assert.match(a.el('#interaction-status').textContent,/经过/);
  a.callbacks.onRoutePoint({x:580,y:380});assert.equal(a.routeEditing(),false);assert.equal(a.mode(),'walk');assert.equal(a.scene().plan.valid,true);assert.equal(a.scene().routeShape,'curve');
  assert.ok(a.scene().route.length>3);assert.ok(a.scene().route.some(p=>p.x===580&&p.y===380));assert.equal(a.scene().route.at(-1).x,650);assert.equal(a.scene().route.at(-1).y,420);
  const length=geometry.deriveRouteLength(a.scene().route,geometry.SAMPLE_METERS_PER_PIXEL),chord=Math.hypot(130,20)*geometry.SAMPLE_METERS_PER_PIXEL;
  assert.ok(length>chord);assert.equal(a.scene().plan.lengthM,length);assert.ok(BigInt(a.scene().plan.exact.fundedTotalCents)<=BigInt(a.scene().plan.exact.budgetCents));
});

test('3D polyline accepts successive turns and finishes only on the finish button',async()=>{
  const a=await setup();a.el('#route-shape').value='polyline';a.el('#route-shape').fire('change');a.el('#edit-route').click();
  a.callbacks.onRoutePoint({x:350,y:250});a.callbacks.onRoutePoint({x:390,y:250});assert.equal(a.routeEditing(),true);assert.equal(a.el('#finish-route').hidden,false);
  a.callbacks.onRoutePoint({x:390,y:300});assert.equal(a.scene().route.length,3);a.el('#finish-route').click();assert.equal(a.routeEditing(),false);assert.equal(a.scene().plan.valid,true);assert.equal(a.scene().route.length,3);
});

test('out-of-map curve is rejected and cancelling its draft restores the previous route',async()=>{
  const a=await setup(),before=structuredClone(a.scene().route);a.el('#route-shape').value='curve';a.el('#route-shape').fire('change');a.el('#edit-route').click();
  a.callbacks.onRoutePoint({x:5,y:100});a.callbacks.onRoutePoint({x:5,y:450});a.callbacks.onRoutePoint({x:1000,y:270});assert.equal(a.routeEditing(),true);assert.equal(a.scene().route.length,2);assert.match(a.el('#toast').textContent,/超出图纸/);
  a.el('#cancel-route').click();assert.deepEqual(a.scene().route,before);assert.equal(a.scene().plan.valid,true);
});

test('cancelling a route also restores the original scale after a draft length was edited',async()=>{
  const a=await setup(),before=a.scene().metersPerPixel,length=a.el('#length').value;
  a.el('#route-shape').value='curve';a.el('#route-shape').fire('change');a.el('#edit-route').click();a.callbacks.onRoutePoint({x:520,y:400});a.callbacks.onRoutePoint({x:650,y:420});
  a.fill('#length','100');assert.notEqual(a.scene().metersPerPixel,before);a.el('#cancel-route').click();assert.equal(a.scene().metersPerPixel,before);assert.equal(a.el('#length').value,length);
});

test('a straight route slightly longer than a module budgets its actual length consistently',async()=>{
  const a=await setup();a.el('#edit-route').click();a.callbacks.onRoutePoint({x:400,y:50});a.callbacks.onRoutePoint({x:471.2501,y:50});
  assert.ok(a.scene().plan.lengthM>6);assert.equal(a.scene().plan.fullModules,2);assert.equal(a.scene().plan.lengthM,geometry.deriveRouteLength(a.scene().route,geometry.SAMPLE_METERS_PER_PIXEL));
});

test('plants-only mode works without route dimensions and restores the corridor when switched back',async()=>{
  const a=await setup();a.el('#plan-type').value='plants';a.el('#plan-type').fire('change');
  a.fill('#length','');a.fill('#width','');assert.equal(a.scene().plan.valid,true);assert.equal(a.scene().plan.treeOnly,true);assert.equal(a.scene().route.length,0);
  assert.equal(a.el('#edit-route').hidden,true);assert.equal(a.el('#export-plan').disabled,false);assert.equal(a.el('#materials-body').children.length,1);
  a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:350,y:250});assert.equal(a.scene().plan.fundedCost,380);assert.deepEqual(Array.from(a.scene().plan.items,x=>x.id),['trees']);
  a.el('#export-csv').click();const csv=await a.download().text();assert.match(csv,/全校园绿植清单/);assert.doesNotMatch(csv,/路径尚未|路线尚未|支撑构件|PC 板/);
  a.fill('#length','48');a.fill('#width','2.4');a.el('#plan-type').value='corridor';a.el('#plan-type').fire('change');
  assert.equal(a.scene().type,'corridor');assert.equal(a.scene().route.length,4);assert.equal(a.scene().trees.length,1);assert.equal(a.scene().plan.valid,true);
  const ids=a.scene().plan.items.map(x=>x.id);for(const id of ['coverage','flooring','drainage','lighting'])assert.ok(ids.includes(id));
  assert.ok(BigInt(a.scene().plan.exact.fundedTotalCents)<=BigInt(a.scene().plan.exact.budgetCents));
  a.el('#export-csv').click();const corridorCSV=await a.download().text();assert.match(corridorCSV,/完整走廊/);assert.match(corridorCSV,/不透光走廊屋面/);assert.doesNotMatch(corridorCSV,/PC 板/);
});

test('planting in the real app updates light coverage and reasons immediately, and undo reverses them',async()=>{
  const a=await setup({realClimate:true});a.el('#plan-type').value='plants';a.el('#plan-type').fire('change');
  const before=a.el('#coverage-direct').textContent;
  assert.equal(a.el('#current-route-assessment').hidden,true);assert.equal(a.el('#climate-recommendations').children.length,0);
  a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:580,y:200});
  assert.ok(parseFloat(a.el('#coverage-direct').textContent)<parseFloat(before));
  assert.ok(parseFloat(a.el('#coverage-added').textContent)>0);assert.match(a.el('#planting-score').textContent,/%/);
  const tree=a.el('#tree-assessments').children[0];assert.match(tree.children[0].textContent,/#1.*推荐度/);assert.ok(tree.children[1].textContent.length>20);assert.match(a.el('#toast').textContent,/推荐度/);
  a.el('#undo-tree-scene').click();assert.equal(a.el('#coverage-direct').textContent,before);assert.equal(a.el('#coverage-added').textContent,'+0.00 个百分点');
});

test('3D receives the same live coverage map after planting, time changes and undo',async()=>{
  const a=await setup({realClimate:true});a.el('#plan-type').value='plants';a.el('#plan-type').fire('change');
  const initial=a.lightMap();assert.equal(initial.valid,true,'map reaches even a late scene initialization');assert.equal(initial.cells.includes(3),false);
  a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:580,y:200});assert.equal(a.lightMap().cells.includes(3),true);
  const atNoon=Array.from(a.lightMap().cells);a.fill('#scene-sun-time','8');assert.notDeepEqual(Array.from(a.lightMap().cells),atNoon);assert.equal(a.el('#climate-time').value,8);
  a.fill('#scene-sun-time','1');assert.equal(a.lightMap().night,true);assert.equal(a.lightMap().cells.some(Boolean),false);assert.match(a.el('#light-coverage-status').textContent,/夜间/);
  a.fill('#scene-sun-time','12');a.el('#undo-tree-scene').click();assert.equal(a.lightMap().cells.includes(3),false);
});

test('coverage and pedestrian toggles preserve the plan and budget',async()=>{
  const a=await setup({realClimate:true}),before=a.scene().plan;
  a.el('#toggle-light-coverage').click();assert.equal(a.lightVisible(),false);assert.equal(a.el('#light-coverage-legend').hidden,true);
  a.el('#toggle-pedestrians').click();assert.equal(a.pedestriansVisible(),false);assert.equal(a.scene().plan,before);
  a.el('#toggle-light-coverage').click();a.el('#toggle-pedestrians').click();assert.equal(a.lightVisible(),true);assert.equal(a.pedestriansVisible(),true);assert.equal(a.scene().plan,before);
});
test('switching unfinished route to planting restores route and allows a budgeted tree',async()=>{
  const a=await setup();a.clickMode('walk');a.el('#edit-route').click();a.callbacks.onRoutePoint({x:350,y:250});a.el('#plant-tree-scene').click();
  assert.equal(a.planting(),true);assert.equal(a.routeEditing(),false);assert.equal(a.scene().route.length,4);assert.equal(a.mode(),'walk');
  a.callbacks.onPlant({x:350,y:250});assert.equal(a.scene().trees.length,1);assert.equal(a.scene().trees[0].funded,true);assert.equal(a.scene().plan.treesCost,380);
});
test('planting remains possible with an uncalibrated route but never exceeds budget',async()=>{
  const a=await setup();a.fill('#length','');a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:350,y:250});assert.equal(a.scene().trees.length,1);assert.equal(a.scene().trees[0].funded,true);
  assert.equal(a.el('#trees-cost').textContent,'¥380');a.fill('#budget','100');a.callbacks.onPlant({x:360,y:260});assert.equal(a.scene().trees.length,1);assert.equal(a.scene().trees[0].funded,false);
  a.fill('#tree-price','0.004');a.callbacks.onPlant({x:360,y:260});assert.equal(a.scene().trees.length,1);
});
test('indoor two-point plan counts plants only and keeps indoor placement metadata',async()=>{
  const a=await setup();a.clickMode('walk');a.el('#edit-route').click();a.callbacks.onRoutePoint({x:150,y:410,interior:'图书馆'});a.callbacks.onRoutePoint({x:170,y:420,interior:'图书馆'});
  assert.equal(a.scene().plan.layoutOnly,true);assert.equal(a.scene().plan.fundedModules,0);a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:180,y:430,interior:'图书馆'});
  assert.equal(a.scene().trees[0].interior,'图书馆');assert.equal(a.scene().plan.fundedCost,380);assert.equal(a.scene().plan.items.length,1);assert.equal(a.mode(),'walk');
});
test('duplicate or mixed indoor/outdoor endpoints do not finish an invalid route; cancel restores it',async()=>{
  const a=await setup();a.el('#edit-route').click();a.callbacks.onRoutePoint({x:350,y:250});a.callbacks.onRoutePoint({x:350,y:250});assert.equal(a.scene().route.length,1);
  a.callbacks.onRoutePoint({x:160,y:420,interior:'图书馆'});assert.equal(a.scene().route.length,1);a.el('#cancel-route').click();assert.equal(a.scene().route.length,4);assert.equal(a.scene().plan.valid,true);
});

test('tree-only material table and export preserve actual funded plants without a route',async()=>{
  const a=await setup();a.fill('#length','');a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:350,y:250});
  assert.equal(a.el('#table-trees-quantity').textContent,'1 株');assert.equal(a.el('#table-trees-total').textContent,'¥380');assert.equal(a.el('#export-csv').disabled,false);
  a.el('#export-csv').click();const csv=await a.download().text();assert.match(csv,/全校园绿植清单/);assert.match(csv,/"本期费用","380"/);assert.doesNotMatch(csv,/6m|透气遮阳网/);
});
test('indoor material rows and CSV omit outdoor canopy and module costs',async()=>{
  const a=await setup();a.el('#edit-route').click();a.callbacks.onRoutePoint({x:150,y:410,interior:'图书馆'});a.callbacks.onRoutePoint({x:170,y:420,interior:'图书馆'});
  a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:180,y:430,interior:'图书馆'});assert.equal(a.el('#materials-body').children.length,1);
  a.el('#export-csv').click();const csv=await a.download().text();assert.match(csv,/图书馆 · 室内路径与绿植/);assert.match(csv,/"本期费用","380"/);assert.doesNotMatch(csv,/6m|透气遮阳网|支撑构件/);
});

test('applying a climate recommendation keeps its exact route length and budget',async()=>{
  const a=await setup(),environment=createClimateSimulation().sample();
  const result=recommendRoutes({...a.climate().getContext(),environment});assert.equal(result.valid,true);const candidate=result.candidates.find(c=>c.id===result.recommendedId);assert.ok(candidate);
  a.climate().applyRoute(candidate);assert.equal(a.scene().plan.valid,true);assert.equal(a.scene().plan.lengthM,geometry.deriveRouteLength(a.scene().route,geometry.SAMPLE_METERS_PER_PIXEL));
  assert.ok(BigInt(a.scene().plan.exact.fundedTotalCents)<=BigInt(a.scene().plan.exact.budgetCents));
});

function descendants(element){return [element,...element.children.flatMap(descendants)];}
function sectionControl(a,index,kind){return descendants(a.el('#segment-list')).find(e=>kind==='type'?e.dataset.sectionType===String(index):e.attributes['aria-label']===`第 ${index+1} 段结束位置（米）`);}
function change(element,value){element.value=value;element.fire('change');}
test('mixed route supports arbitrary splits, material choices, one reserve and exact budgeted export',async()=>{
 const a=await setup({realClimate:true});a.el('#enable-mixed').click();assert.equal(a.scene().type,'mixed');assert.equal(a.el('#segment-editor').hidden,false);
 a.fill('#budget','1000000');a.fill('#split-distance','10');a.el('#split-at-distance').click();assert.equal(a.scene().plan.sections.length,2);
 a.fill('#split-distance','30');a.el('#split-at-distance').click();assert.equal(a.scene().plan.sections.length,3);
 change(sectionControl(a,0,'type'),'corridor');change(sectionControl(a,1,'type'),'plants');change(sectionControl(a,2,'type'),'solid');
 const p=a.scene().plan;assert.equal(p.valid,true);assert.equal(p.status,'full');assert.deepEqual(Array.from(p.sections,s=>s.type),['corridor','plants','solid']);assert.equal(p.sections[0].lengthM,10);assert.equal(p.sections[1].lengthM,20);assert.equal(p.sections[1].coveredLengthM,0);assert.ok(p.coveragePercent<100);assert.equal(p.reserveAmount,100000);
 assert.equal(p.fundedCost,p.sections.reduce((sum,s)=>sum+s.fundedCost,0));assert.match(a.el('#cost-insight').textContent,/全部所选建设段在预算内/);assert.ok(a.lightMap().valid);
 a.el('#export-csv').click();const csv=await a.download().text();assert.match(csv,/距起点/);assert.match(csv,/完整走廊/);assert.match(csv,/仅种绿植/);assert.match(csv,/PC 板连廊/);assert.match(csv,/预备金/);
});
test('mixed row boundaries cannot overlap and merging preserves a complete route partition',async()=>{
 const a=await setup();a.el('#enable-mixed').click();a.el('#segment-example').click();let p=a.scene().plan;assert.equal(p.sections.length,3);
 change(sectionControl(a,0,'end'),'5');p=a.scene().plan;assert.equal(p.sections[0].endM,5);assert.equal(p.sections[1].startM,5);
 change(sectionControl(a,0,'end'),'-1');assert.equal(a.scene().plan.sections[0].endM,5);assert.match(a.el('#toast').textContent,/分界必须/);
 descendants(a.el('#segment-list')).find(e=>e.attributes['aria-label']==='将第 2 段并入前段').click();p=a.scene().plan;assert.equal(p.sections.length,2);assert.equal(p.sections[0].startFraction,0);assert.equal(p.sections[0].endFraction,p.sections[1].startFraction);assert.equal(p.sections.at(-1).endFraction,1);
});
test('3D split projects to the existing curved route without changing its geometry and remains usable in walk mode',async()=>{
 const a=await setup();a.clickMode('walk');a.el('#enable-mixed').click();change(a.el('#route-shape'),'curve');a.el('#edit-route').click();a.callbacks.onRoutePoint({x:520,y:400});a.callbacks.onRoutePoint({x:650,y:420});a.callbacks.onRoutePoint({x:580,y:380});
 const route=structuredClone(a.scene().route);a.el('#split-route').click();a.callbacks.onRouteSplit({x:580,y:380});assert.equal(a.scene().plan.sections.length,2);assert.deepEqual(a.scene().route,route);assert.equal(a.mode(),'walk');
 a.callbacks.onRouteSplit({x:5,y:5});assert.equal(a.scene().plan.sections.length,2);assert.match(a.el('#toast').textContent,/路线附近/);
 a.el('#plant-tree-scene').click();a.callbacks.onRouteSplit({x:620,y:395});assert.equal(a.scene().plan.sections.length,2);assert.equal(a.planting(),true);
});
test('mixed material edits recalculate totals and low budgets never fund later expensive sections out of order',async()=>{
 const a=await setup();a.el('#enable-mixed').click();a.el('#segment-example').click();a.fill('#budget','1000000');const initial=a.scene().plan.fundedCost;
 const input=descendants(a.el('#materials-body')).find(e=>e.dataset.rate==='corridor:coverage');input.value='640';input.fire('input');assert.ok(a.scene().plan.fundedCost>initial);
 a.fill('#budget','12000');const p=a.scene().plan;assert.ok(BigInt(p.exact.fundedTotalCents)<=BigInt(p.exact.budgetCents));assert.equal(p.sections[1].fundedModules,0);assert.equal(p.sections[2].fundedModules,0);
});
test('all-green mixed route buys no construction and hides irrelevant canopy recommendation',async()=>{
 const a=await setup({realClimate:true});a.el('#enable-mixed').click();change(sectionControl(a,0,'type'),'plants');assert.equal(a.scene().plan.fundedModules,0);assert.equal(a.scene().plan.fundedCost,0);assert.equal(a.scene().plan.status,'full');assert.equal(a.el('#current-route-assessment').hidden,true);
 a.el('#plant-tree-scene').click();a.callbacks.onPlant({x:580,y:200});assert.equal(a.scene().plan.fundedCost,380);assert.equal(a.scene().plan.coveredLengthM,0);assert.ok(a.lightMap().cells.includes(3));
});
