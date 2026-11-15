import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as simulation from './climate-simulation.mjs';
import * as recommendations from './climate-recommendations.mjs';
import * as planting from './planting-recommendations.mjs';
import {SAMPLE_METERS_PER_PIXEL} from './geometry.mjs';
class Element{
  constructor(){this.children=[];this.events={};this.attributes={};this.style={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.classList={toggle(){}};}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  fire(type){for(const fn of this.events[type]??[])fn();}
  click(){this.fire('click');}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
}
async function setup(){
  const elements=new Map(),el=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
  let tick,applied=[],samples=[],maps=[];
  const root={querySelector:el,createElement:()=>new Element(),hidden:false};
  const input={budgetInput:{budget:'50000',widthM:2.4,reservePct:10,treesCount:0,treeUnitPrice:380},metersPerPixel:SAMPLE_METERS_PER_PIXEL,currentRoute:recommendations.SAMPLE_CANDIDATES[0].route,useSampleObstacles:true,trees:[]};
  const context=vm.createContext({document:root,console,setInterval:fn=>(tick=fn,1),clearInterval(){}});
  const mod=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});
  const modules={'./climate-simulation.mjs':mod(simulation),'./climate-recommendations.mjs':mod(recommendations),'./planting-recommendations.mjs':mod(planting)};
  const ui=new vm.SourceTextModule(await readFile(new URL('./climate-ui.mjs',import.meta.url),'utf8'),{context});await ui.link(name=>modules[name]);await ui.evaluate();
  const panel=ui.namespace.createClimatePanel({root,getContext:()=>input,getPlantingContext:()=>input,applyRoute:c=>applied.push(c),onEnvironment:s=>samples.push(s),onCoverageMap:map=>maps.push(map)});
  return {el,input,panel,tick:()=>tick(),samples,applied,maps};
}
test('live simulation updates metrics without replacing a route and can pause',async()=>{
  const a=await setup();const before=a.samples.at(-1);a.tick();const after=a.samples.at(-1);assert.equal(after.source,'simulation');assert.ok(after.hour>before.hour);assert.ok(Math.abs(after.temperatureC-before.temperatureC)<=.06+1e-9);assert.equal(a.applied.length,0);
  a.el('#climate-play').click();const count=a.samples.length;a.tick();assert.equal(a.samples.length,count);assert.match(a.el('#climate-play').textContent,/继续/);
});

test('3D time controls share the simulation and every live tick publishes a coverage map',async()=>{
  const a=await setup();const count=a.maps.length;a.tick();assert.equal(a.maps.length,count+1);assert.equal(a.maps.at(-1).valid,true);
  a.el('#scene-sun-time').value='8';a.el('#scene-sun-time').fire('input');assert.equal(a.el('#climate-time').value,8);assert.equal(a.el('#scene-sun-time-label').textContent,'08:00');
  const morning=Array.from(a.maps.at(-1).cells);a.el('#scene-sun-time').value='16';a.el('#scene-sun-time').fire('input');assert.notDeepEqual(Array.from(a.maps.at(-1).cells),morning);
  a.el('#scene-sun-play').click();const paused=a.maps.length;a.tick();assert.equal(a.maps.length,paused);assert.match(a.el('#climate-play').textContent,/继续/);assert.match(a.el('#scene-sun-play').textContent,/继续/);
});

test('planting metrics continue in plants-only mode and update when time or funding changes',async()=>{
  const a=await setup();a.input.plantsOnly=true;a.input.blockReason='仅种绿植，无需路线';a.input.trees=[{id:1,x:580,y:200,funded:true}];a.input.budgetInput.treesCount=1;
  a.panel.refreshRecommendations();assert.equal(a.el('#current-route-assessment').hidden,true);assert.match(a.el('#planting-score').textContent,/%/);assert.ok(parseFloat(a.el('#coverage-added').textContent)>0);
  a.input.trees[0].funded=false;a.panel.refreshRecommendations();assert.equal(a.el('#coverage-added').textContent,'+0.00 个百分点');assert.match(a.el('#tree-assessments').children[0].children[0].textContent,/待追加预算/);
  a.input.trees[0].funded=true;a.el('#climate-time').value='1';a.el('#climate-time').fire('input');assert.equal(a.el('#coverage-direct').textContent,'0.00%');assert.equal(a.el('#coverage-shade').textContent,'不适用');assert.equal(a.el('#coverage-added').textContent,'+0.00 个百分点');assert.match(a.el('#coverage-reason').textContent,/夜|无直射|日落/);
});
test('drawn route under 50 percent receives warning and usable alternative',async()=>{
  const a=await setup();a.input.currentRoute=[{x:100,y:150},{x:200,y:150}];a.panel.refreshRecommendations();assert.equal(a.el('#current-route-score').textContent,'0%');assert.match(a.el('#current-route-score-reason').textContent,/可行性过低，请换一条路线/);assert.equal(a.el('#replace-low-route').hidden,false);
  a.el('#replace-low-route').click();assert.equal(a.applied.length,1);assert.ok(a.applied[0].recommendationScore>=50);
});
test('night shows no usable shade recommendation and does not invent light',async()=>{
  const a=await setup();a.el('#climate-time').value='1';a.el('#climate-time').fire('input');assert.equal(a.samples.at(-1).radiationWm2,0);assert.equal(a.el('#current-route-score').textContent,'0%');assert.equal(a.el('#replace-low-route').hidden,true);
  for(const card of a.el('#climate-recommendations').children)assert.equal(card.children.at(-1).disabled,true);assert.equal(a.applied.length,0);
});
test('indoor, uncalibrated and incomplete routes do not show a made-up score',async()=>{
  const a=await setup();a.input.currentInterior='图书馆';a.panel.refreshRecommendations();assert.equal(a.el('#current-route-score').textContent,'—');assert.match(a.el('#current-route-score-reason').textContent,/室内/);
  a.input.blockReason='请先完成路线';a.panel.refreshRecommendations();assert.equal(a.el('#current-route-score').textContent,'—');assert.match(a.el('#current-route-score-reason').textContent,/完成路线/);
});
