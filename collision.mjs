const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function local(point,box){
  const cx=box.cx??(box.minX+box.maxX)/2,cz=box.cz??(box.minZ+box.maxZ)/2,angle=box.angle||0,dx=point.x-cx,dz=point.z-cz;
  return {x:dx*Math.cos(angle)-dz*Math.sin(angle),z:dx*Math.sin(angle)+dz*Math.cos(angle),hx:box.halfWidth??(box.maxX-box.minX)/2,hz:box.halfDepth??(box.maxZ-box.minZ)/2};
}
export function overlapsFootprint(point,box,radius=0){const p=local(point,box);return Math.hypot(p.x-clamp(p.x,-p.hx,p.hx),p.z-clamp(p.z,-p.hz,p.hz))<=radius+1e-8;}
export function blocksBody(point,{feetY,height,radius=0,colliders,stepHeight=0}){
  return colliders.some(box=>box.maxY>feetY+stepHeight+1e-6&&box.minY<feetY+height-1e-6&&overlapsFootprint(point,box,radius));
}
export function verticalLimits(point,{feetY,height,radius=0,baseY=0,colliders,stepHeight=0}){
  let floorY=baseY,ceilingFeetY=Infinity;
  for(const box of colliders){
    if(!overlapsFootprint(point,box,radius))continue;
    if(box.maxY<=feetY+stepHeight+1e-6)floorY=Math.max(floorY,box.maxY);
    if(box.minY>=feetY+height-1e-6)ceilingFeetY=Math.min(ceilingFeetY,box.minY-height);
  }
  return {floorY,ceilingFeetY};
}
export function rayColliderDistance(origin,direction,box){
  const p=local(origin,box),angle=box.angle||0,d={x:direction.x*Math.cos(angle)-direction.z*Math.sin(angle),y:direction.y,z:direction.x*Math.sin(angle)+direction.z*Math.cos(angle)};
  let enter=0,exit=Infinity;
  for(const [axis,start,min,max] of [['x',p.x,-p.hx,p.hx],['y',origin.y,box.minY,box.maxY],['z',p.z,-p.hz,p.hz]]){
    if(Math.abs(d[axis])<1e-12){if(start<min||start>max)return null;continue;}
    let first=(min-start)/d[axis],last=(max-start)/d[axis];if(first>last)[first,last]=[last,first];enter=Math.max(enter,first);exit=Math.min(exit,last);if(enter>exit)return null;
  }
  return exit>=0?enter:null;
}
