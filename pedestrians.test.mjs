import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampusPedestrians} from './pedestrians.mjs';
import {blocksBody,verticalLimits} from './collision.mjs';
import {createCampusBuildings,SAMPLE_BUILDINGS,describeBuilding} from './campus-buildings.mjs';

const route=(points=[{x:0,z:0},{x:10,z:0}],extra={})=>({points,fraction:0,direction:1,speed:1,...extra});
const advance=(people,frames=60,context={})=>{for(let i=0;i<frames;i++)people.update(1/60,context);};
const point=state=>({x:state.x,z:state.z});
function assertNoOverlap(people,extra=[]){
  const colliders=people.getColliders();
  for(const state of people.getStates().filter(p=>p.active))assert.equal(blocksBody(point(state),{feetY:state.feetY,height:state.height,radius:state.radius,colliders:[...extra,...colliders.filter(c=>c.pedestrianId!==state.id)]}),false,`person ${state.id} overlaps an obstacle/person`);
}

test('sample walkers are articulated people with faces, outfits, feet and moving limbs',()=>{
  const people=createCampusPedestrians();try{
    assert.equal(people.getColliders().length,0,'hidden until collision-aware initialization');people.update(0);assert.equal(people.getColliders().length,8);
    const initial=people.getStates();advance(people,60);const moved=people.getStates();
    assert.equal(moved.filter((p,i)=>Math.hypot(p.x-initial[i].x,p.z-initial[i].z)>.5).length,8);
    for(const model of people.group.children){
      for(const name of ['head','torso','left-arm','right-arm','left-leg','right-leg','shoe','eye--1','eye-1'])assert.ok(model.getObjectByName(name),name);
      assert.ok(Math.abs(model.getObjectByName('left-leg').rotation.x)>0);assert.equal(model.userData.moving,true);
    }
    assertNoOverlap(people);
  }finally{people.dispose();}
});

test('walkers stop at a wall, pause their gait, and resume after the obstacle is removed',()=>{
  const people=createCampusPedestrians({routes:[route()]});const wall={minX:1.5,maxX:1.52,minZ:-3,maxZ:3,minY:0,maxY:4,kind:'wall'};
  try{
    people.update(0,{colliders:[wall]});advance(people,300,{colliders:[wall]});const stopped=people.getStates()[0];
    assert.ok(stopped.x<1.5-stopped.radius);assert.equal(stopped.moving,false);assertNoOverlap(people,[wall]);
    const phase=stopped.phase;advance(people,30,{colliders:[wall]});assert.equal(people.getStates()[0].phase,phase);
    assert.equal(people.group.children[0].getObjectByName('left-leg').rotation.x,0);
    advance(people,120);assert.ok(people.getStates()[0].x>stopped.x+1.5);assert.equal(people.getStates()[0].moving,true);
  }finally{people.dispose();}
});

test('a normal tree trunk is avoided in small continuous steps within the road',()=>{
  const people=createCampusPedestrians({routes:[route()]});const tree={minX:1.8,maxX:2.2,minZ:-.2,maxZ:.2,minY:.145,maxY:4,kind:'tree-trunk'};
  try{
    people.update(0,{colliders:[tree]});
    for(let i=0;i<600;i++){people.update(1/60,{colliders:[tree]});assertNoOverlap(people,[tree]);}
    const state=people.getStates()[0];assert.ok(state.x>3,'made a small detour around the trunk');assert.ok(Math.abs(state.z)<=1.8);
  }finally{people.dispose();}
});

test('opposing pedestrians and a player never intersect',()=>{
  const points=[{x:0,z:0},{x:6,z:0}];
  const people=createCampusPedestrians({routes:[route(points,{fraction:.2,direction:1}),route(points,{fraction:.8,direction:-1})]});
  const player={x:3,z:0,feetY:.145,height:1.85,radius:.4};
  const playerBox={minX:2.6,maxX:3.4,minZ:-.4,maxZ:.4,minY:.145,maxY:1.995,kind:'player'};
  try{
    people.update(0,{player});
    for(let i=0;i<600;i++){people.update(1/60,{player});assertNoOverlap(people,[playerBox]);}
  }finally{people.dispose();}
});

test('spawns do not enclose the player, and player flight uses the same solid body bounds',()=>{
  const people=createCampusPedestrians({routes:[route()]});const player={x:0,z:0,feetY:.145,height:1.85,radius:.4};
  try{
    people.update(0,{player});const state=people.getStates()[0];assert.ok(state.x>state.radius+player.radius,'initial spawn moved to a free point along the road');
    const colliders=people.getColliders();
    assert.equal(blocksBody(point(state),{feetY:.145,height:1.85,radius:.3,colliders}),true,'walking into a person is blocked');
    assert.equal(blocksBody(point(state),{feetY:state.feetY+state.height+.05,height:1.85,radius:.3,colliders}),false,'flying above a person is allowed');
    const limits=verticalLimits(point(state),{feetY:state.feetY+state.height+.2,height:1.85,radius:.3,baseY:.145,colliders});assert.equal(limits.floorY,state.feetY+state.height,'falling onto the person meets a solid head/body top');
  }finally{people.dispose();}
});

test('a large elapsed time cannot tunnel through a thin full-width obstacle',()=>{
  const people=createCampusPedestrians({routes:[route()]});const wall={minX:.6,maxX:.61,minZ:-3,maxZ:3,minY:0,maxY:3,kind:'wall'};
  try{people.update(0,{colliders:[wall]});for(let i=0;i<8;i++)people.update(1000,{colliders:[wall]});assertNoOverlap(people,[wall]);assert.ok(people.getStates()[0].x<.3);}finally{people.dispose();}
});

test('a newly solid proposed tree cannot leave a pedestrian trapped inside it',()=>{
  const people=createCampusPedestrians({routes:[route()]});
  try{
    people.update(0);advance(people,45);const before=people.getStates()[0];
    const tree={minX:before.x-.2,maxX:before.x+.2,minZ:before.z-.2,maxZ:before.z+.2,minY:.145,maxY:4,kind:'tree-trunk'};
    people.update(0,{colliders:[tree]});assertNoOverlap(people,[tree]);assert.equal(people.getColliders().length,1);
  }finally{people.dispose();}
});

test('known sample paths avoid actual building geometry; disabling hides all people and collisions',()=>{
  const buildings=createCampusBuildings(),people=createCampusPedestrians();
  try{
    people.update(0,{colliders:buildings.colliders});for(let i=0;i<360;i++){people.update(1/30,{colliders:buildings.colliders});assertNoOverlap(people,buildings.colliders);}
    people.setEnabled(false);const before=people.getStates();advance(people,120,{colliders:buildings.colliders});assert.deepEqual(people.getStates(),before);assert.equal(people.group.visible,false);assert.equal(people.getColliders().length,0);
    people.setEnabled(true);assert.equal(people.getColliders().length,0);people.update(0,{colliders:buildings.colliders});assert.equal(people.getColliders().length,8);assertNoOverlap(people,buildings.colliders);
  }finally{people.dispose();buildings.dispose();}
  assert.equal(people.group.children.length,0);assert.equal(people.getColliders().length,0);assert.equal(people.update(1),false);people.dispose();
});

test('four pedestrians enter and leave the real teaching, library, canteen and activity doorways continuously',()=>{
  const buildings=createCampusBuildings(),people=createCampusPedestrians();
  try{
    people.update(0,{colliders:buildings.colliders});
    const initial=people.getStates(),records=new Map(initial.filter(p=>p.destinationBuildingId).map(p=>[p.id,{building:describeBuilding(SAMPLE_BUILDINGS.find(b=>b.id===p.destinationBuildingId)),entered:false,exited:false,reachedInside:false,crossings:0}]));
    assert.equal(records.size,4);assert.deepEqual(new Set([...records.values()].map(r=>r.building.id)),new Set(['teaching','library','canteen','activity']));
    let previous=initial;
    for(let frame=0;frame<1000;frame++){
      people.update(1/30,{colliders:buildings.colliders});const current=people.getStates();assertNoOverlap(people,buildings.colliders);
      assert.equal(people.getColliders().length,8,'nobody disappears to fake doorway traversal');
      for(const person of current){
        const before=previous.find(p=>p.id===person.id),distance=Math.hypot(person.x-before.x,person.z-before.z);assert.ok(distance<=.04+1e-8,'movement stays continuous; no invisible teleport into a building');
        const record=records.get(person.id);if(!record)continue;
        const {normal,position,width}=record.building.door;
        const signed=p=>(p.x-position.x)*normal.x+(p.z-position.z)*normal.z;
        const was=signed(before),now=signed(person);
        if(person.buildingId===record.building.id&&now<-3)record.reachedInside=true;
        if(was>0&&now<=0||was<0&&now>=0){
          const t=was/(was-now),x=before.x+(person.x-before.x)*t,z=before.z+(person.z-before.z)*t;
          const lateral=Math.abs((x-position.x)*normal.z-(z-position.z)*normal.x);
          assert.ok(lateral+person.radius<width/2,'body crosses the actual open doorway rather than a wall/window');
          record.crossings++;if(was>0)record.entered=true;else if(record.entered)record.exited=true;
        }
      }
      previous=current;
    }
    for(const record of records.values()){
      assert.ok(record.entered,`${record.building.name}: entered through the door`);
      assert.ok(record.reachedInside,`${record.building.name}: walked at least 3m into the open aisle`);
      assert.ok(record.exited,`${record.building.name}: returned outdoors through the same doorway`);
      assert.ok(record.crossings>=2);
    }
  }finally{people.dispose();buildings.dispose();}
});
