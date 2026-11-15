import * as THREE from './vendor/three.module.js';
import {blocksBody,verticalLimits} from './collision.mjs';
import {SAMPLE_BUILDINGS,describeBuilding,getBuildingAt} from './campus-buildings.mjs';

// Known sample-campus roads and surveyed-by-the-demo door openings only.
// Uploaded plans have no inferred walkable map or invented building entrances.
const world=([x,y])=>({x:(x-490)*.1,z:(y-285)*.1});
const roadRoute=(points,extra)=>({points:points.map(world),...extra});
function buildingRoute(id,approach,{fraction=.04,speed=1.08}={}){
  const b=describeBuilding(SAMPLE_BUILDINGS.find(building=>building.id===id)),{position,normal,inside,outside}=b.door;
  return {buildingId:id,points:[world(approach),outside,position,inside,{x:position.x-normal.x*4.2,z:position.z-normal.z*4.2}],fraction,direction:1,speed};
}
export const SAMPLE_PEDESTRIAN_ROUTES=Object.freeze([
  buildingRoute('teaching',[360,181],{speed:1.12}),
  buildingRoute('library',[300,433],{speed:1.02}),
  roadRoute([[398,105],[398,505]],{fraction:.22,direction:1,speed:1.08}),
  roadRoute([[398,105],[398,505]],{fraction:.81,direction:-1,speed:.98}),
  buildingRoute('canteen',[650,370],{speed:1.13}),
  buildingRoute('activity',[566,370],{fraction:.1,speed:.96}),
  roadRoute([[425,370],[660,370]],{fraction:.65,direction:-1,speed:1.05}),
  roadRoute([[425,535],[940,535]],{fraction:.58,direction:1,speed:1.17}),
].map(route=>Object.freeze({...route,points:Object.freeze(route.points.map(p=>Object.freeze({...p})))})));
const BASE_Y=.145,BASE_HEIGHT=1.81,BASE_RADIUS=.34,PATH_CLEARANCE=1.8;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const palettes=[
  {shirt:0x567b9a,pants:0x303d4d,skin:0xd8a77f,hair:0x28231f,bag:0xc69753},
  {shirt:0xc98660,pants:0x3c4547,skin:0xba825b,hair:0x25201c,bag:0x586e58},
  {shirt:0xf2e7ce,pants:0x475b72,skin:0xe7b999,hair:0x47362a,bag:0x855a52},
  {shirt:0x637e57,pants:0x343c42,skin:0x986342,hair:0x211e1d,bag:0xb9a37c},
  {shirt:0x9c7180,pants:0x555968,skin:0xddac83,hair:0x30241f,bag:0x465f6f},
  {shirt:0x4c7c79,pants:0x3b4550,skin:0xc39170,hair:0x28211e,bag:0xa37548},
  {shirt:0xe4bb66,pants:0x515d69,skin:0xb67f5a,hair:0x30251f,bag:0x5c6c54},
  {shirt:0x9babb8,pants:0x49544c,skin:0xe5bc9b,hair:0x4e3528,bag:0x8c6262},
];
function nearestRouteDistance(point,points){
  let nearest=Infinity;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
    const t=length?clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/length,0,1):0;
    nearest=Math.min(nearest,Math.hypot(point.x-a.x-dx*t,point.z-a.z-dz*t));
  }
  return nearest;
}
function pointAlong(points,fraction){
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.z-points[i].z));
  let remaining=lengths.reduce((a,b)=>a+b,0)*clamp(fraction,0,1);
  for(let i=0;i<lengths.length;i++){
    if(remaining<=lengths[i]||i===lengths.length-1){const t=lengths[i]?remaining/lengths[i]:0;return {x:points[i].x+(points[i+1].x-points[i].x)*t,z:points[i].z+(points[i+1].z-points[i].z)*t,segment:i};}
    remaining-=lengths[i];
  }
  return {...points[0],segment:0};
}

/** Human-shaped animated pedestrians, with no network assets or renderer dependency.
 * All positions and collision dimensions use scene world units. Call setEnabled
 * (false) for unknown uploaded plans. A first update(0, context) safely places the
 * actors against the current static geometry and the player before exposing them.
 */
export function createCampusPedestrians({routes=SAMPLE_PEDESTRIAN_ROUTES}={}){
  const group=new THREE.Group();group.name='campus-pedestrians';
  const resources=new Set(),keep=value=>(resources.add(value),value);
  const cube=keep(new THREE.BoxGeometry(1,1,1)),sphere=keep(new THREE.SphereGeometry(1,12,9)),cylinder=keep(new THREE.CylinderGeometry(1,1,1,10));
  const material=color=>keep(new THREE.MeshStandardMaterial({color,roughness:.82}));
  const shoes=material(0x303537),eyes=material(0x282d2b);
  let enabled=true,disposed=false;
  function mesh(parent,geometry,mat,name,position,scale){
    const part=new THREE.Mesh(geometry,mat);part.name=name;part.position.set(...position);part.scale.set(...scale);part.castShadow=true;part.receiveShadow=true;parent.add(part);return part;
  }
  function makeHuman(index){
    const model=new THREE.Group(),palette=palettes[index%palettes.length];model.name=`pedestrian-${index+1}`;model.userData.pedestrianId=index+1;
    const skin=material(palette.skin),shirt=material(palette.shirt),pants=material(palette.pants),hair=material(palette.hair),bag=material(palette.bag);
    mesh(model,cube,shirt,'torso',[0,1.135,0],[.41,.51,.235]);
    mesh(model,cube,pants,'hips',[0,.855,0],[.335,.17,.235]);
    mesh(model,cylinder,skin,'neck',[0,1.435,0],[.062,.1,.062]);
    mesh(model,sphere,skin,'head',[0,1.61,0],[.145,.18,.14]);
    mesh(model,sphere,hair,'hair',[0,1.705,-.019],[.15,.095,.145]);
    mesh(model,sphere,skin,'nose',[0,1.606,.142],[.025,.033,.028]);
    for(const side of [-1,1]){
      mesh(model,sphere,eyes,`eye-${side}`,[side*.052,1.644,.126],[.012,.016,.012]);
      mesh(model,sphere,skin,`ear-${side}`,[side*.145,1.61,0],[.021,.039,.026]);
    }
    const arms=[],legs=[];
    for(const side of [-1,1]){
      const arm=new THREE.Group();arm.name=side<0?'left-arm':'right-arm';arm.position.set(side*.255,1.365,0);model.add(arm);arms.push(arm);
      mesh(arm,sphere,shirt,'shoulder',[0,-.025,0],[.092,.105,.092]);
      mesh(arm,cylinder,shirt,'upper-arm',[0,-.155,0],[.067,.28,.067]);
      const elbow=new THREE.Group();elbow.name='elbow';elbow.position.y=-.29;elbow.rotation.x=-.12;arm.add(elbow);
      mesh(elbow,sphere,skin,'elbow-joint',[0,0,0],[.055,.055,.055]);
      mesh(elbow,cylinder,skin,'forearm',[0,-.13,0],[.049,.25,.049]);
      mesh(elbow,sphere,skin,'hand',[0,-.28,0],[.054,.075,.038]);
      const leg=new THREE.Group();leg.name=side<0?'left-leg':'right-leg';leg.position.set(side*.105,.805,0);model.add(leg);legs.push(leg);
      mesh(leg,cylinder,pants,'thigh',[0,-.18,0],[.076,.36,.076]);
      const knee=new THREE.Group();knee.name='knee';knee.position.y=-.36;leg.add(knee);
      mesh(knee,sphere,pants,'knee-joint',[0,0,0],[.068,.068,.068]);
      mesh(knee,cylinder,pants,'shin',[0,-.17,0],[.058,.34,.058]);
      mesh(knee,cube,shoes,'shoe',[0,-.39,.052],[.145,.11,.265]);
    }
    if(index%3!==1){
      mesh(model,cube,bag,'backpack',[0,1.12,-.17],[.30,.38,.15]);
      for(const side of [-1,1])mesh(model,cube,bag,'backpack-strap',[side*.145,1.16,.124],[.032,.39,.026]);
    }
    return {model,arms,legs};
  }
  const actors=routes.filter(route=>Array.isArray(route.points)&&route.points.length>=2&&route.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))).map((route,index)=>{
    const rig=makeHuman(index),scale=[.96,.99,.94,.92,.97,1,.95,.98][index%8];rig.model.scale.setScalar(scale);rig.model.visible=false;group.add(rig.model);
    const start=pointAlong(route.points,route.fraction??.15),direction=route.direction===-1?-1:1;
    return {...rig,id:index+1,route:{...route,points:route.points.map(p=>({...p}))},scale,height:BASE_HEIGHT*scale,radius:BASE_RADIUS*scale,x:start.x,z:start.z,feetY:BASE_Y,active:false,needsPlacement:true,target:direction>0?start.segment+1:start.segment,direction,speed:clamp(route.speed??1.05,.3,2),phase:index*.83,moving:false,wait:0,detour:[],detourSide:index%2?1:-1};
  });
  function collider(actor){return {minX:actor.x-actor.radius,maxX:actor.x+actor.radius,minZ:actor.z-actor.radius,maxZ:actor.z+actor.radius,minY:actor.feetY,maxY:actor.feetY+actor.height,kind:'pedestrian',pedestrianId:actor.id};}
  function playerCollider(player){
    if(!player||![player.x,player.z,player.feetY,player.height,player.radius].every(Number.isFinite))return null;
    return {minX:player.x-player.radius,maxX:player.x+player.radius,minZ:player.z-player.radius,maxZ:player.z+player.radius,minY:player.feetY,maxY:player.feetY+player.height,kind:'player'};
  }
  function obstaclesFor(actor,colliders,playerBox){return [...colliders.filter(item=>item.kind!=='pedestrian'),...actors.filter(other=>other!==actor&&other.active).map(collider),...(playerBox?[playerBox]:[])];}
  function safePoint(actor,point,obstacles){
    if(point.x<-48.5||point.x>48.5||point.z<-28||point.z>28||nearestRouteDistance(point,actor.route.points)>PATH_CLEARANCE)return null;
    const bounds=verticalLimits(point,{feetY:actor.feetY,height:actor.height,radius:actor.radius,baseY:BASE_Y,colliders:obstacles,stepHeight:.18});
    const feetY=bounds.floorY;
    if(blocksBody(point,{feetY,height:actor.height,radius:actor.radius,colliders:obstacles,stepHeight:0}))return null;
    return {...point,feetY};
  }
  function pose(actor,distance=0){
    actor.model.position.set(actor.x,actor.feetY,actor.z);actor.model.visible=actor.active&&enabled;
    if(distance>1e-7){actor.phase+=distance*7.8;actor.moving=true;}
    else actor.moving=false;
    const swing=actor.moving?Math.sin(actor.phase)*.39:0;
    actor.arms[0].rotation.x=-swing*.85;actor.arms[1].rotation.x=swing*.85;
    actor.legs[0].rotation.x=swing;actor.legs[1].rotation.x=-swing;
    actor.legs.forEach((leg,i)=>{leg.getObjectByName('knee').rotation.x=actor.moving?Math.max(0,Math.sin(actor.phase+(i?Math.PI:0)))*.35:0;});
    actor.model.userData.moving=actor.moving;actor.model.userData.phase=actor.phase;actor.model.userData.buildingId=getBuildingAt(actor)?.id??null;
  }
  function place(actor,obstacles){
    // Prefer the existing position, then walk the known route looking for a free
    // spawn. Actors are hidden while disabled/initializing, so no visible jump.
    const candidates=[{x:actor.x,z:actor.z,segment:Math.max(0,Math.min(actor.route.points.length-2,actor.target-(actor.direction>0?1:0)))}];
    for(let i=0;i<24;i++)candidates.push(pointAlong(actor.route.points,((actor.route.fraction??.15)+i/24)%1));
    for(const point of candidates){
      const safe=safePoint(actor,point,obstacles);if(!safe)continue;
      actor.x=safe.x;actor.z=safe.z;actor.feetY=safe.feetY;actor.target=actor.direction>0?point.segment+1:point.segment;actor.active=true;actor.needsPlacement=false;
      const target=actor.route.points[actor.target];actor.model.rotation.y=Math.atan2(target.x-actor.x,target.z-actor.z);pose(actor);return true;
    }
    actor.active=false;actor.model.visible=false;return false;
  }
  function updateTarget(actor){
    const last=actor.route.points.length-1;
    if(actor.target===last&&actor.direction>0)actor.direction=-1;
    else if(actor.target===0&&actor.direction<0)actor.direction=1;
    actor.target+=actor.direction;
  }
  function clearSegment(actor,from,to,obstacles){
    const length=Math.hypot(to.x-from.x,to.z-from.z),steps=Math.max(1,Math.ceil(length/.07));
    for(let i=1;i<=steps;i++)if(!safePoint(actor,{x:from.x+(to.x-from.x)*i/steps,z:from.z+(to.z-from.z)*i/steps},obstacles))return false;
    return true;
  }
  function chooseDetour(actor,ux,uz,obstacles){
    for(const side of [actor.detourSide,-actor.detourSide]){
      const across={x:actor.x-uz*side*1.05,z:actor.z+ux*side*1.05};
      const ahead={x:across.x+ux*1.65,z:across.z+uz*1.65};
      if(clearSegment(actor,actor,across,obstacles)&&clearSegment(actor,across,ahead,obstacles))return [across,ahead];
    }
    return [];
  }
  function advanceActor(actor,seconds,obstacles){
    let target=actor.detour[0]||actor.route.points[actor.target],dx=target.x-actor.x,dz=target.z-actor.z,distance=Math.hypot(dx,dz);
    if(distance<.09){
      if(actor.detour.length)actor.detour.shift();else updateTarget(actor);
      target=actor.detour[0]||actor.route.points[actor.target];dx=target.x-actor.x;dz=target.z-actor.z;distance=Math.hypot(dx,dz);
    }
    if(distance<1e-8)return 0;
    const ux=dx/distance,uz=dz/distance,step=Math.min(actor.speed*seconds,distance);
    const next=safePoint(actor,{x:actor.x+ux*step,z:actor.z+uz*step},obstacles);
    if(!next){
      actor.wait+=seconds;
      // Only start a sidestep when its complete short route is clear. A wall
      // across the whole road therefore makes the walker stop rather than
      // shuffling endlessly. Dynamic bodies are checked again at each substep.
      if(actor.wait>.45&&!actor.detour.length)actor.detour=chooseDetour(actor,ux,uz,obstacles);
      else if(actor.wait>1.5&&actor.detour.length){actor.detour=[];actor.wait=0;}
      return 0;
    }
    actor.wait=0;
    const moved=Math.hypot(next.x-actor.x,next.z-actor.z);actor.x=next.x;actor.z=next.z;actor.feetY=next.feetY;
    const heading=Math.atan2(ux,uz),delta=Math.atan2(Math.sin(heading-actor.model.rotation.y),Math.cos(heading-actor.model.rotation.y));actor.model.rotation.y+=clamp(delta,-seconds*5,seconds*5);
    return moved;
  }
  function update(dt,{colliders=[],player=null}={}){
    if(disposed||!enabled)return false;
    const staticColliders=Array.isArray(colliders)?colliders:[],playerBox=playerCollider(player);
    let changed=false;
    // A budget change can make a previously transparent proposed tree solid,
    // and an explicit camera teleport can put the player on an existing actor.
    // Revalidate those discontinuous edits before showing any overlapping body.
    const occupancy=[...staticColliders.filter(item=>item.kind!=='pedestrian'),...(playerBox?[playerBox]:[])];
    for(const actor of actors)if(actor.active&&blocksBody(actor,{feetY:actor.feetY,height:actor.height,radius:actor.radius,colliders:occupancy,stepHeight:.18})){
      actor.active=false;actor.needsPlacement=true;actor.model.visible=false;actor.detour=[];changed=true;
    }
    for(const actor of actors)if(actor.needsPlacement){changed=place(actor,obstaclesFor(actor,staticColliders,playerBox))||changed;}
    const time=Number.isFinite(dt)?clamp(dt,0,.25):0;
    if(!time)return changed;
    const steps=Math.max(1,Math.ceil(time/.025)),seconds=time/steps,distances=new Map(actors.map(actor=>[actor,0]));
    for(let step=0;step<steps;step++)for(const actor of actors){
      if(!actor.active)continue;
      const distance=advanceActor(actor,seconds,obstaclesFor(actor,staticColliders,playerBox));distances.set(actor,distances.get(actor)+distance);
    }
    for(const actor of actors){if(!actor.active)continue;const wasMoving=actor.moving,distance=distances.get(actor);pose(actor,distance);if(distance>0||wasMoving!==actor.moving)changed=true;}
    return changed;
  }
  function setEnabled(value){
    const next=Boolean(value);if(next===enabled)return;
    enabled=next;group.visible=enabled;
    for(const actor of actors){actor.active=false;actor.model.visible=false;actor.needsPlacement=enabled;pose(actor);}
  }
  function getColliders(){return enabled&&!disposed?actors.filter(actor=>actor.active).map(collider):[];}
  function getStates(){return actors.map(actor=>({id:actor.id,x:actor.x,z:actor.z,feetY:actor.feetY,height:actor.height,radius:actor.radius,active:actor.active&&enabled,moving:actor.moving,phase:actor.phase,buildingId:getBuildingAt(actor)?.id??null,destinationBuildingId:actor.route.buildingId??null}));}
  function dispose(){if(disposed)return;disposed=true;for(const actor of actors){actor.active=false;actor.moving=false;}group.clear();group.removeFromParent();resources.forEach(resource=>resource.dispose());resources.clear();}
  return {group,update,getColliders,getStates,setEnabled,dispose};
}
