import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from './vendor/three.module.js';
import * as movement from './movement.mjs';
import * as collision from './collision.mjs';
import * as buildings from './campus-buildings.mjs';
import * as pedestrians from './pedestrians.mjs';
import {curveThroughPoint} from './geometry.mjs';
import * as geometry from './geometry.mjs';

// Real Three scene graph, rays, movement and campus geometry. Only the browser
// event/RAF shell and GPU renderer are replaced; this is not a visual browser test.
class Element {
  constructor(){this.style={};this.dataset={};this.events=new Map();this.captured=new Set();this.children=[];this.clientWidth=800;this.clientHeight=600;this.tagName='CANVAS';}
  append(child){this.children.push(child);}
  remove(){}
  setAttribute(){}
  focus(){}
  addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);}
  removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(f=>f!==fn));}
  dispatchEvent(event){for(const fn of this.events.get(event.type)||[])fn(event);}
  fire(type,values={}){this.dispatchEvent({type,target:this,currentTarget:this,preventDefault(){},pointerId:1,button:0,clientX:400,clientY:300,shiftKey:false,...values});}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  getContext(){return new Proxy({},{get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});}
  toDataURL(){return 'data:image/png;base64,';}
}
async function setup({pedestriansEnabled=false,pedestrianRoutes}={}){
  let currentTime=0,nextFrame,lastCamera,lastScene,lastPedestrians;
  const container=new Element(),canvas=new Element(),window=new Element();window.devicePixelRatio=1;
  class Renderer {
    constructor(){this.domElement=canvas;this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>1};}
    setPixelRatio(){}setSize(){}dispose(){}
    render(scene,camera){lastScene=scene;lastCamera=camera;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);}
  }
  class CanvasTexture extends THREE.Texture{constructor(source){super(source);this.isCanvasTexture=true;}}
  const document={createElement:()=>new Element()},locations=[],plants=[],points=[],splits=[],statuses=[],peopleChanges=[];
  const context=vm.createContext({document,window,console,performance:{now:()=>currentTime},requestAnimationFrame:fn=>(nextFrame=fn),ResizeObserver:class{observe(){}disconnect(){}},Image:class{},CustomEvent:class{constructor(type){this.type=type;}}});
  const moduleFor=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});
  const imports=new Map([
    ['./vendor/three.module.js',moduleFor({...THREE,WebGLRenderer:Renderer,CanvasTexture})],
    ['./geometry.mjs',moduleFor(geometry)],
    ['./movement.mjs',moduleFor(movement)],['./collision.mjs',moduleFor(collision)],['./campus-buildings.mjs',moduleFor(buildings)],['./pedestrians.mjs',moduleFor({...pedestrians,createCampusPedestrians:options=>(lastPedestrians=pedestrians.createCampusPedestrians(pedestrianRoutes?{...options,routes:pedestrianRoutes}:options))})],
  ]);
  const source=new vm.SourceTextModule(await readFile(new URL('./scene3d.mjs',import.meta.url),'utf8'),{context});
  await source.link(name=>{assert.ok(imports.has(name),`known scene import ${name}`);return imports.get(name);});await source.evaluate();
  const api=source.namespace.createCampusScene(container,{onLocationChange:value=>locations.push(value),onPlant:value=>plants.push(value),onRoutePoint:value=>points.push(value),onRouteSplit:value=>splits.push(value),onStatus:value=>statuses.push(value),onPedestriansChange:value=>peopleChanges.push(value)});
  api.setPedestriansEnabled(pedestriansEnabled);
  const advance=(frames=1)=>{for(let i=0;i<frames;i++){currentTime+=1000/60;const frame=nextFrame;nextFrame=null;frame(currentTime);}};
  const click=(x=400,y=300)=>{canvas.fire('pointerdown',{clientX:x,clientY:y});canvas.fire('pointerup',{clientX:x,clientY:y});};
  advance();return {api,container,canvas,window,locations,plants,points,splits,statuses,peopleChanges,advance,click,camera:()=>lastCamera,scene:()=>lastScene,pedestrianStates:()=>lastPedestrians.getStates()};
}

test('enter library, place a plant and pick route endpoints using the real scene rays',async()=>{
  const s=await setup();try{
    assert.equal(s.api.enterBuilding('library'),true);s.advance();assert.equal(s.locations.at(-1),'图书馆');
    s.api.setPlanting(true);s.click();assert.equal(s.plants.length,1,s.statuses.at(-1));assert.equal(s.plants[0].interior,'图书馆');
    assert.equal(s.container.dataset.sceneMode,'walk');
    s.api.setRouteEditing(true);s.click(370,300);s.click(430,300);assert.equal(s.points.length,2,s.statuses.at(-1));
    assert.equal(s.points[0].interior,'图书馆');assert.equal(s.points[1].interior,'图书馆');
    assert.notEqual(s.points[0].y,s.points[1].y);assert.equal(s.container.dataset.planting,'false');
  }finally{s.api.dispose();}
});

test('continuous flight upward under an actual funded canopy stops below its roof',async()=>{
  const s=await setup();try{
    s.api.update({route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,coveragePercent:100},widthM:2.4,metersPerPixel:48/570});
    s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(240);s.api.move('up',false);
    const height=Number(s.container.dataset.heightMeters);assert.ok(height>1,'flight rose above the floor');assert.ok(height<=1.59,`canopy limited feet height, got ${height}`);
    const roofUnderside=.145+3.435*(.1/(48/570));assert.ok(s.camera().position.y<roofUnderside);
    s.advance(120);assert.ok(Number(s.container.dataset.heightMeters)<=1.59,'hover cannot tunnel through the roof');
  }finally{s.api.dispose();}
});

test('library doorway is traversable but its side walls stop walking',async()=>{
  const s=await setup();try{
    const library=buildings.describeBuilding(buildings.SAMPLE_BUILDINGS.find(b=>b.id==='library'));
    s.api.enterBuilding('library');s.api.move('backward',true);s.advance(60);s.api.move('backward',false);
    assert.equal(s.locations.at(-1),null,'walked out through the door');assert.ok(s.camera().position.x>library.bounds.maxX);
    s.api.enterBuilding('library');s.api.move('left',true);s.advance(180);s.api.move('left',false);
    assert.ok(s.camera().position.z>library.bounds.minZ+.3&&s.camera().position.z<library.bounds.maxZ-.3,'did not cross either side wall');
    assert.equal(s.locations.at(-1),'图书馆');
  }finally{s.api.dispose();}
});

test('right clicks, cancelled touches and camera drags cannot create plants',async()=>{
  const s=await setup();try{
    s.api.enterBuilding('library');s.api.setPlanting(true);
    s.canvas.fire('pointerdown',{button:2});s.canvas.fire('pointerup',{button:2});
    s.canvas.fire('pointerdown');s.canvas.fire('pointercancel');s.canvas.fire('pointerup');
    s.canvas.fire('pointerdown');s.canvas.fire('pointermove',{clientX:430,clientY:330});s.canvas.fire('pointerup',{clientX:430,clientY:330});
    assert.equal(s.plants.length,0);
  }finally{s.api.dispose();}
});

test('existing tree trunks and funded new trees block walking, while revoking funding removes new collisions',async()=>{
  const s=await setup();try{
    s.api.update({route:[{x:395,y:269},{x:480,y:269}],plan:{valid:false},trees:[]});s.api.setMode('walk');s.api.move('forward',true);s.advance(90);s.api.move('forward',false);
    assert.ok(s.camera().position.x<-4.5,'existing trunk at x=-3.9 stops walking');
    s.api.setMode('orbit');s.api.update({route:[{x:340,y:250},{x:430,y:250}],trees:[{id:'new',x:390,y:250,funded:true}],plan:{valid:false}});s.api.setMode('walk');s.api.move('forward',true);s.advance(90);s.api.move('forward',false);
    assert.ok(s.camera().position.x<-10.5,'new trunk at x=-10 stops walking');
    s.api.update({trees:[{id:'new',x:390,y:250,funded:false}]});s.api.move('forward',true);s.advance(60);s.api.move('forward',false);
    assert.ok(s.camera().position.x>-9,'unfunded tree is a preview and cannot block movement');
  }finally{s.api.dispose();}
});

test('indoor pots block the central aisle and undoing the plant removes its collision',async()=>{
  const s=await setup();try{
    s.api.update({trees:[{id:'pot',x:200,y:433,interior:'图书馆',funded:true}]});s.api.enterBuilding('library');s.api.move('forward',true);s.advance(90);s.api.move('forward',false);
    assert.ok(s.camera().position.x>-28.2,'pot at x=-29 blocks the player body');
    s.api.update({trees:[]});s.api.move('forward',true);s.advance(45);s.api.move('forward',false);
    assert.ok(s.camera().position.x<-29.5,'undo removes the pot collider immediately');
  }finally{s.api.dispose();}
});

test('planting cannot stack plants or enclose the player, with explicit invalid-location feedback',async()=>{
  const s=await setup();try{
    s.api.enterBuilding('library');s.api.setPlanting(true);s.click();assert.equal(s.plants.length,1);
    const point=s.plants[0];s.api.update({trees:[{id:'first',...point,funded:true}]});s.click();assert.equal(s.plants.length,1);assert.match(s.statuses.at(-1),/^这里无法种树：.*绿植/);
    s.api.update({trees:[]});s.canvas.fire('pointerdown');s.canvas.fire('pointermove',{clientY:650});s.canvas.fire('pointerup',{clientY:650});s.click();assert.equal(s.plants.length,1);assert.match(s.statuses.at(-1),/^这里无法种树：.*正站/);
  }finally{s.api.dispose();}
});

test('simulated sun uses north/east compass directions and no direct sunlight below the horizon',async()=>{
  const s=await setup();try{
    s.api.setEnvironment({sun:{azimuthDeg:90,elevationDeg:30},radiationWm2:850,cloudCoverPercent:20});s.advance();
    const sun=s.scene().children.find(child=>child.isDirectionalLight);assert.ok(sun.position.x>80);assert.ok(Math.abs(sun.position.z)<1e-8);assert.ok(Math.abs(sun.position.y-50)<1e-8);assert.ok(sun.intensity>0);
    s.api.setEnvironment({sun:{azimuthDeg:0,elevationDeg:45}});s.advance();assert.ok(sun.position.z<0);assert.ok(Math.abs(sun.position.x)<1e-8);
    s.api.setEnvironment({sun:{elevationDeg:-5},radiationWm2:900});s.advance();assert.equal(sun.intensity,0);assert.equal(s.container.dataset.sunElevationDeg,'-5');
  }finally{s.api.dispose();}
});

test('funding a preview at the viewer position moves the viewer safely clear of the new trunk',async()=>{
  const s=await setup();try{
    s.api.update({route:[{x:340,y:250},{x:430,y:250}],plan:{valid:false}});s.api.setMode('walk');s.advance();
    const before=s.camera().position.clone(),tree={id:'preview',x:before.x/.1+490,y:before.z/.1+285,funded:false};
    s.api.update({trees:[tree]});assert.equal(s.camera().position.x,before.x);
    s.api.update({trees:[{...tree,funded:true}]});s.advance();
    assert.ok(Math.hypot(s.camera().position.x-before.x,s.camera().position.z-before.z)>.7,'solid tree cannot enclose the viewer');assert.match(s.statuses.at(-1),/旁边空地/);
  }finally{s.api.dispose();}
});

test('2D planting validation is read-only and shares indoor, tree and boundary rules with 3D',async()=>{
  const s=await setup();try{
    const input={x:200,y:433},snapshot={...input};const indoor=s.api.validatePlantPoint(input);assert.equal(indoor.valid,true);assert.equal(indoor.interior,'图书馆');assert.deepEqual(input,snapshot);
    s.api.update({trees:[{id:'reserved',...input,interior:'图书馆',funded:false}]});assert.equal(s.api.validatePlantPoint(input).valid,false);assert.match(s.api.validatePlantPoint(input).message,/^这里无法种树：/);
    assert.equal(s.api.validatePlantPoint({x:451,y:269}).valid,false,'existing tree trunk is blocked in 2D too');assert.equal(s.api.validatePlantPoint({x:990,y:200}).valid,false);
    s.api.update({trees:[]});assert.equal(s.api.validatePlantPoint(input).valid,true);assert.equal(s.plants.length,0,'validation cannot plant or change the project');
  }finally{s.api.dispose();}
});

test('complete corridor has an opaque roof, substantial columns, paving, drainage and lights, with open route ends',async()=>{
  const s=await setup();try{
    const scale=.1/(48/570);
    s.api.update({type:'corridor',route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,coveragePercent:100},widthM:2.4,metersPerPixel:48/570});s.advance();
    const route=s.scene().getObjectByName('campus-route'),parts=part=>route.children.filter(mesh=>mesh.userData.part===part);
    assert.ok(parts('corridor-roof').length);assert.ok(parts('corridor-roof').every(mesh=>mesh.material.opacity===1&&!mesh.material.transparent));
    assert.ok(parts('corridor-column').every(mesh=>Math.abs(mesh.scale.x-.3*scale)<1e-8));
    for(const part of ['corridor-floor','corridor-gutter','corridor-downpipe','corridor-lighting'])assert.ok(parts(part).length,`${part} exists`);
    assert.ok(parts('corridor-lighting').every(mesh=>mesh.material.emissiveIntensity>0));
    s.api.setMode('walk');s.api.move('forward',true);s.advance(90);s.api.move('forward',false);assert.ok(s.camera().position.x>-6,'can walk through the full corridor and out its end');
    s.api.setMode('orbit');s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(180);s.api.move('up',false);
    assert.ok(Number(s.container.dataset.heightMeters)<=1.36,'solid ceiling fixtures stop flight below the roof');
    assert.equal(s.api.validatePlantPoint({x:385,y:250}).valid,false,'cannot grow a tree through the completed corridor');
  }finally{s.api.dispose();}
});

test('only the funded corridor fraction is solid; pending roof and frames are transparent and do not block flight',async()=>{
  const s=await setup();try{
    s.api.update({type:'corridor',route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,coveragePercent:50},widthM:2.4});s.advance();
    const route=s.scene().getObjectByName('campus-route'),roofs=part=>route.children.filter(mesh=>mesh.userData.part===part);
    assert.ok(Math.abs(roofs('corridor-roof').reduce((n,mesh)=>n+mesh.scale.z,0)-4.5)<1e-8);
    const pending=roofs('corridor-pending-roof');assert.ok(Math.abs(pending.reduce((n,mesh)=>n+mesh.scale.z,0)-4.5)<1e-8);assert.ok(pending.every(mesh=>mesh.material.transparent&&!mesh.castShadow));
    s.api.setMode('walk');s.api.move('forward',true);s.advance(30);s.api.move('forward',false);s.api.toggleFlight();s.api.move('up',true);s.advance(120);s.api.move('up',false);
    assert.ok(Number(s.container.dataset.heightMeters)>4,'pending corridor is not a physical obstruction');
  }finally{s.api.dispose();}
});

test('plants-only mode removes every retained route/canopy object and collision while retaining funded tree shadows',async()=>{
  const s=await setup();try{
    s.api.update({type:'corridor',route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,coveragePercent:100},trees:[{id:'shade',x:520,y:400,funded:true},{id:'pending',x:550,y:400,funded:false}]});s.advance();
    assert.ok(s.scene().getObjectByName('campus-route').children.length>0);
    s.api.update({type:'plants',plan:{valid:true,treeOnly:true,layoutOnly:true}});s.advance();
    assert.equal(s.scene().getObjectByName('campus-route').children.length,0);
    const greens=s.scene().getObjectByName('planned-greens');assert.equal(greens.children.length,2);assert.equal(greens.children[0].children.filter(mesh=>mesh.castShadow).length,3);assert.equal(greens.children[1].children.filter(mesh=>mesh.castShadow).length,0);
    s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(120);s.api.move('up',false);assert.ok(Number(s.container.dataset.heightMeters)>4,'removed corridor has no stale collision');
    s.api.update({type:'mesh',plan:{valid:true,treeOnly:true,layoutOnly:true}});s.advance();assert.equal(s.scene().getObjectByName('campus-route').children.length,0,'treeOnly plan also suppresses a retained route');
  }finally{s.api.dispose();}
});

test('indoor layout remains a floor route even with corridor selected',async()=>{
  const s=await setup();try{
    s.api.update({type:'corridor',route:[{x:190,y:433,interior:'图书馆'},{x:215,y:433,interior:'图书馆'}],plan:{valid:true,layoutOnly:true,coveragePercent:0}});s.advance();
    const route=s.scene().getObjectByName('campus-route');assert.ok(route.children.length>0);assert.equal(route.children.filter(mesh=>mesh.userData.part?.startsWith('corridor')).length,0);
    assert.ok(route.children.every(mesh=>mesh.position.y<1),'interior labels and floor markings stay below the ceiling');
  }finally{s.api.dispose();}
});

const coverageMap=cells=>({width:2,height:2,mapWidth:980,mapHeight:570,cells:new Uint8Array(cells),rowOrder:'north-to-south',valid:true,night:false});
function coverageShader(scene){
  let target;scene.traverse(object=>{if(!target&&object.material?.userData.campusLightCoverage)target=object.material;});assert.ok(target,'ground material supports the coverage layer');
  const shader={uniforms:{},vertexShader:'#include <common>\nvoid main(){ vec3 transformed=position;\n#include <project_vertex>\n}',fragmentShader:'#include <common>\nvoid main(){ vec4 diffuseColor=vec4(1.0);\n#include <color_fragment>\n}'};
  target.onBeforeCompile(shader);return shader;
}
test('light coverage preserves north-to-south cells and uses one projected texture only on outdoor ground materials',async()=>{
  const s=await setup();try{
    const map=coverageMap([1,2,3,0]);s.api.setLightCoverage(map);s.advance();const shader=coverageShader(s.scene()),texture=shader.uniforms.uCampusCoverageMap.value;
    assert.equal(texture.flipY,false);assert.deepEqual([...texture.image.data],[242,196,85,90,100,134,124,150,56,182,107,185,0,0,0,0]);
    assert.match(shader.vertexShader,/campusCoverageWorld\.xz \+ vec2\(49\.0,28\.5\)/,'north (-z) maps to first texture row, south (+z) to later rows');
    assert.match(shader.fragmentShader,/mix\(diffuseColor\.rgb,campusCoverageColor\.rgb,campusCoverageColor\.a\)/,'underlying texture remains visible');
    const excluded=[];s.scene().traverse(object=>{if(object.userData.buildingId||object.geometry?.type==='IcosahedronGeometry')excluded.push(object);});assert.ok(excluded.length>0);assert.ok(excluded.every(object=>!object.material?.userData.campusLightCoverage),'building interiors and tree bodies are not tinted');
    let texturedGround=0;s.scene().traverse(object=>{if(object.material?.map&&object.material?.userData.campusLightCoverage)texturedGround++;});assert.ok(texturedGround>0,'sports field texture participates');
    assert.equal(s.container.dataset.lightCoverage,'visible');assert.equal(shader.uniforms.uCampusCoverageEnabled.value,1);
  }finally{s.api.dispose();}
});

test('coverage updates reuse texture storage, toggles/night/invalid clear it, and replacing dimensions disposes the old texture',async()=>{
  const s=await setup();let finalTexture;try{
    s.api.setLightCoverage(coverageMap([1,1,1,1]));const shader=coverageShader(s.scene()),first=shader.uniforms.uCampusCoverageMap.value,firstBuffer=first.image.data;
    s.api.setLightCoverage(coverageMap([3,1,2,0]));assert.equal(shader.uniforms.uCampusCoverageMap.value,first);assert.equal(first.image.data,firstBuffer);assert.deepEqual([...first.image.data.slice(0,4)],[56,182,107,185]);
    s.api.setLightCoverageVisible(false);assert.equal(shader.uniforms.uCampusCoverageEnabled.value,0);assert.equal(s.container.dataset.lightCoverage,'hidden');
    s.api.setLightCoverageVisible(true);assert.equal(shader.uniforms.uCampusCoverageEnabled.value,1);
    s.api.setLightCoverage({...coverageMap([1,2,3,1]),night:true});assert.equal(shader.uniforms.uCampusCoverageEnabled.value,0);assert.ok(first.image.data.every(value=>value===0));assert.equal(s.container.dataset.lightCoverage,'night');
    s.api.setLightCoverage(coverageMap([1,2,3,0]));s.api.setLightCoverage(null);assert.equal(shader.uniforms.uCampusCoverageEnabled.value,0);assert.equal(s.container.dataset.lightCoverage,'unavailable');
    let disposed=0;first.addEventListener('dispose',()=>disposed++);s.api.setLightCoverage({...coverageMap([1,2,3,0]),width:1,height:4});assert.equal(disposed,1);finalTexture=shader.uniforms.uCampusCoverageMap.value;assert.notEqual(finalTexture,first);
    let disposedFinal=0;finalTexture.addEventListener('dispose',()=>disposedFinal++);s.api.dispose();assert.equal(disposedFinal,1);return;
  }finally{if(!finalTexture)s.api.dispose();}
});

test('coverage changes add no geometry/collisions and do not interfere with planting or exported views',async()=>{
  const s=await setup();try{
    s.api.enterBuilding('library');s.api.setPlanting(true);s.click();const count=s.plants.length,sceneChildren=s.scene().children.length,route=s.scene().getObjectByName('campus-route'),routeCount=route.children.length;
    s.api.setLightCoverage(coverageMap([1,2,3,0]));s.api.setLightCoverageVisible(false);s.api.setLightCoverageVisible(true);s.advance();s.click();
    assert.equal(s.plants.length,count+1,'ground ray still reaches the room floor');assert.equal(s.scene().children.length,sceneChildren);assert.equal(route.children.length,routeCount);assert.match(s.api.capture(),/^data:image\/png/);
    s.api.update({type:'corridor',route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,coveragePercent:100}});s.advance();
    const floor=s.scene().getObjectByName('campus-route').children.find(mesh=>mesh.userData.part==='corridor-floor');assert.equal(floor.material.userData.campusLightCoverage,true,'paved paths receive coverage on their actual surface');
  }finally{s.api.dispose();}
});

test('campus pedestrians are human-shaped and animate, with toggle and uploaded-plan exclusion',async()=>{
  const s=await setup({pedestriansEnabled:true});try{
    const group=s.scene().getObjectByName('campus-pedestrians'),actors=group.children.filter(actor=>actor.visible);assert.equal(actors.length,8);
    assert.ok(actors.every(actor=>actor.getObjectByName('head')&&actor.getObjectByName('torso')&&actor.getObjectByName('left-leg')&&actor.getObjectByName('right-arm')));
    const before=s.pedestrianStates();s.advance(60);const after=s.pedestrianStates();assert.ok(after.some((actor,i)=>Math.hypot(actor.x-before[i].x,actor.z-before[i].z)>.5&&actor.phase!==before[i].phase),'walking moves bodies and animates the limbs');
    assert.equal(s.container.dataset.pedestriansEnabled,'true');assert.equal(s.container.dataset.pedestrianCount,'8');
    s.api.setPedestriansEnabled(false);assert.equal(group.visible,false);assert.equal(s.container.dataset.pedestrianCount,'0');assert.ok(s.pedestrianStates().every(actor=>!actor.active));
    s.api.setPedestriansEnabled(true);assert.equal(group.visible,true);s.api.update({image:'data:image/png;base64,example-upload'});assert.equal(s.container.dataset.pedestrians,'unavailable');assert.equal(group.visible,false);assert.equal(s.api.setPedestriansEnabled(true),false);
    s.api.update({image:null});assert.equal(s.container.dataset.pedestrians,'enabled');assert.ok(s.pedestrianStates().some(actor=>actor.active));
  }finally{s.api.dispose();}
});

test('pedestrian movement and low flight remain mutually collision-safe and cannot be used as planting sites',async()=>{
  const s=await setup({pedestriansEnabled:true,pedestrianRoutes:[{points:[{x:-9.2,z:-10},{x:-9.2,z:5}],fraction:.1,direction:1,speed:1.08}]});try{
    const target=s.pedestrianStates().find(actor=>actor.active);assert.ok(target);const mapY=target.z/.1+285;
    s.api.update({type:'plants',plan:{valid:true,treeOnly:true,layoutOnly:true},route:[{x:340,y:mapY},{x:440,y:mapY}],trees:[]});s.api.setMode('walk');s.api.toggleFlight();
    const occupied=s.pedestrianStates().find(actor=>actor.active);const invalid=s.api.validatePlantPoint({x:occupied.x/.1+490,y:occupied.z/.1+285});assert.equal(invalid.valid,false);assert.match(invalid.message,/行人/);
    s.api.move('forward',true);let nearest=Infinity;
    for(let frame=0;frame<100;frame++){
      s.advance();const camera=s.camera(),scale=.1/(48/570),feetY=camera.position.y-1.7*scale;
      for(const actor of s.pedestrianStates().filter(actor=>actor.active)){
        nearest=Math.min(nearest,Math.hypot(camera.position.x-actor.x,camera.position.z-actor.z));
        const box={minX:actor.x-actor.radius,maxX:actor.x+actor.radius,minZ:actor.z-actor.radius,maxZ:actor.z+actor.radius,minY:actor.feetY,maxY:actor.feetY+actor.height};
        assert.equal(collision.blocksBody(camera.position,{feetY,height:1.85*scale,radius:.4*scale,colliders:[box]}),false,'player and pedestrian bodies must not intersect');
      }
    }
    s.api.move('forward',false);assert.ok(nearest<1.3,'the movement test actually encounters a pedestrian');
  }finally{s.api.dispose();}
});

function screenPoint(s,point){const world=new THREE.Vector3((point.x-490)*.1,.145,(point.y-285)*.1).project(s.camera());return [(world.x*.5+.5)*800,(.5-world.y*.5)*600];}
test('curve controls may have a blocked chord, but final sampled curves must actually avoid walls',async()=>{
  const s=await setup();try{
    const start={x:480,y:490},end={x:650,y:490},through={x:565,y:370};
    s.api.update({routeShape:'curve',route:[start],plan:{valid:false}});s.api.setRouteEditing(true);s.advance();
    s.click(...screenPoint(s,end));assert.equal(s.points.length,1,s.statuses.at(-1));assert.ok(Math.hypot(s.points[0].x-end.x,s.points[0].y-end.y)<.2,'blocked straight chord does not reject the endpoint');
    s.api.update({routeShape:'curve',route:[start,end],plan:{valid:false}});s.advance();s.click(...screenPoint(s,through));assert.equal(s.points.length,2,s.statuses.at(-1));
    assert.equal(s.api.validateRoute([start,end]).valid,false,'the direct route crosses the activity building walls');
    const blockedCurve=curveThroughPoint(start,end,{x:565,y:490});assert.equal(s.api.validateRoute(blockedCurve).valid,false,'actual invalid curve still cannot cross a building');
    const curve=curveThroughPoint(start,end,through);assert.ok(curve.length>3);const valid=s.api.validateRoute(curve);assert.equal(valid.valid,true,valid.message);
  }finally{s.api.dispose();}
});

test('polyline checks its latest segment and final validation preserves room metadata and map boundaries',async()=>{
  const s=await setup();try{
    const start={x:480,y:490},end={x:650,y:490};
    s.api.update({routeShape:'polyline',route:[{x:470,y:490},start],plan:{valid:false}});s.api.setRouteEditing(true);s.advance();s.click(...screenPoint(s,end));assert.equal(s.points.length,0);assert.match(s.statuses.at(-1),/穿过/);
    const indoor=[{x:190,y:433,interior:'图书馆'},{x:215,y:433,interior:'图书馆'}];assert.equal(s.api.validateRoute(indoor).valid,true);
    assert.equal(s.api.validateRoute([indoor[0],{x:215,y:433}]).valid,false,'metadata cannot switch spaces');
    assert.equal(s.api.validateRoute([{x:980,y:560},{x:981,y:560}]).valid,false,'curve samples outside the plan are rejected');
  }finally{s.api.dispose();}
});

test('pedestrian room counts use actual indoor positions and publish only on summary changes',async()=>{
  const library=buildings.describeBuilding(buildings.SAMPLE_BUILDINGS.find(building=>building.id==='library'));
  const s=await setup({pedestriansEnabled:true,pedestrianRoutes:[{points:[library.door.outside,library.door.inside,library.center],fraction:.5,direction:1,speed:1}]});try{
    assert.equal(s.container.dataset.pedestrianCount,'1');assert.equal(s.container.dataset.pedestriansIndoors,'1');assert.equal(s.container.dataset.pedestrianLocations,'图书馆 1');
    const current=s.peopleChanges.at(-1);assert.equal(current.total,1);assert.equal(current.indoors,1);assert.equal(current.locations['图书馆'],1);
    const count=s.peopleChanges.length;s.advance(30);assert.equal(s.peopleChanges.length,count,'unchanged room counts do not generate repeated callbacks');
    s.api.setPedestriansEnabled(false);assert.equal(s.peopleChanges.at(-1).total,0);assert.equal(s.peopleChanges.at(-1).indoors,0);assert.equal(s.container.dataset.pedestriansIndoors,'0');assert.equal(s.container.dataset.pedestrianLocations,'暂无行人');
  }finally{s.api.dispose();}
});

test('mixed routes render the chosen material at each curved section, with planting as an unbuilt indication',async()=>{
  const s=await setup();try{
    const route=curveThroughPoint({x:330,y:250},{x:670,y:250},{x:500,y:310});
    const sections=['mesh','solid','corridor','plants'].map((type,i)=>({id:`section-${i}`,type,startFraction:i/4,endFraction:(i+1)/4,fundedEndFraction:(i+1)/4}));
    s.api.update({type:'mixed',route,plan:{valid:true,type:'mixed',sections},widthM:2.4});s.advance();
    const meshes=s.scene().getObjectByName('campus-route').children;
    for(const [index,part] of ['mesh-roof','pc-roof','corridor-roof','planting-route-indicator'].entries()){
      const sectionMeshes=meshes.filter(mesh=>mesh.userData.sectionId===`section-${index}`),parts=sectionMeshes.filter(mesh=>mesh.userData.part===part);
      assert.ok(parts.length>1,`${part} follows several curve chords`);
      const limits=geometry.slicePolyline(route,index/4,(index+1)/4),minX=Math.min(...limits.map(point=>(point.x-490)*.1)),maxX=Math.max(...limits.map(point=>(point.x-490)*.1));
      assert.ok(parts.every(mesh=>mesh.position.x>=minX-1e-6&&mesh.position.x<=maxX+1e-6),'material remains in its assigned arc interval');
      assert.ok(parts.some(mesh=>Math.abs(mesh.rotation.y-Math.PI/2)>.05),'curve sections do not become the direct chord');
    }
    assert.ok(meshes.filter(mesh=>mesh.userData.sectionId==='section-3').every(mesh=>['planting-route-indicator','section-label'].includes(mesh.userData.part)),'plants section creates no roof, paving, supports or trees');
    assert.equal(s.scene().getObjectByName('planned-greens').children.length,0,'section choice does not invent planted trees');
    const pc=meshes.find(mesh=>mesh.userData.part==='pc-roof'),mesh=meshes.find(mesh=>mesh.userData.part==='mesh-roof'),corridor=meshes.find(mesh=>mesh.userData.part==='corridor-roof');
    assert.notEqual(pc.material,mesh.material);assert.equal(pc.material.transparent,true);assert.equal(corridor.material.transparent,false);
  }finally{s.api.dispose();}
});

test('mixed funding stops within the assigned section and leaves later corridor geometry as noncolliding proposals',async()=>{
  const s=await setup();try{
    const route=[{x:340,y:250},{x:660,y:250}],sections=[
      {id:'first',type:'mesh',startFraction:0,endFraction:.5,fundedEndFraction:.25},
      {id:'second',type:'corridor',startFraction:.5,endFraction:1,fundedEndFraction:.5},
    ];
    s.api.update({type:'mixed',route,plan:{valid:true,type:'mixed',sections}});s.advance();
    const meshes=s.scene().getObjectByName('campus-route').children;
    const roofs=meshes.filter(mesh=>mesh.userData.part==='mesh-roof');assert.ok(roofs.length);assert.ok(roofs.every(mesh=>mesh.position.x<=-7));
    assert.equal(meshes.filter(mesh=>mesh.userData.part==='corridor-roof').length,0);
    assert.ok(meshes.some(mesh=>mesh.userData.part==='corridor-pending-roof'));
    s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(240);s.api.move('up',false);
    assert.ok(Number(s.container.dataset.heightMeters)<1.6,'funded mesh roof collides with flight');
    s.api.setMode('orbit');s.api.update({route:route.toReversed(),plan:{valid:true,type:'mixed',sections:[{id:'pending',type:'corridor',startFraction:0,endFraction:.5,fundedEndFraction:0},{id:'plants',type:'plants',startFraction:.5,endFraction:1,fundedEndFraction:.5}]}});
    s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(120);s.api.move('up',false);
    assert.ok(Number(s.container.dataset.heightMeters)>5,'pending corridor roof creates no flight collision');
  }finally{s.api.dispose();}
});

test('each funded mixed roofing material blocks flight while a plants-only interval remains open',async()=>{
  const s=await setup();try{
    for(const type of ['solid','corridor','plants']){
      s.api.setMode('orbit');
      s.api.update({type:'mixed',route:[{x:340,y:250},{x:430,y:250}],plan:{valid:true,type:'mixed',sections:[{id:'test',type,startFraction:0,endFraction:1,fundedEndFraction:type==='plants'?0:1}]}});
      s.api.setMode('walk');s.api.toggleFlight();s.api.move('up',true);s.advance(120);s.api.move('up',false);
      const height=Number(s.container.dataset.heightMeters);
      if(type==='plants')assert.ok(height>5,'no invented shade roof over a green interval');
      else assert.ok(height<1.8,`${type} roof limits flight to below its underside, got ${height}`);
    }
  }finally{s.api.dispose();}
});

test('segment picking uses its own callback without appending route points or testing a new straight connection',async()=>{
  const s=await setup();try{
    const start={x:480,y:490},end={x:650,y:490};
    s.api.update({routeShape:'polyline',route:[start],plan:{valid:false}});s.api.setRouteEditing(true);s.api.setSegmentEditing(true);s.advance();s.click(...screenPoint(s,end));
    assert.equal(s.splits.length,1,s.statuses.at(-1));assert.equal(s.points.length,0);assert.equal(s.plants.length,0);
    assert.equal(s.container.dataset.segmentEditing,'true');assert.equal(s.container.dataset.routeEditing,'false');
    s.api.setPlanting(true);assert.equal(s.container.dataset.segmentEditing,'false');
    s.api.setSegmentEditing(true);assert.equal(s.container.dataset.planting,'false');
    s.api.setRouteEditing(true);assert.equal(s.container.dataset.segmentEditing,'false');
    s.api.setSegmentEditing(true);s.window.fire('keydown',{code:'Escape'});assert.equal(s.container.dataset.segmentEditing,'false');
  }finally{s.api.dispose();}
});
