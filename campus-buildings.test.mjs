import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three.module.js';
import {createCampusBuildings,getBuildingAt,SAMPLE_BUILDINGS,describeBuilding} from './campus-buildings.mjs';

const hasCapsuleCollision=(colliders,p,{radius=.48,height=2.03,floorY=.145}={})=>colliders.some(c=>
  c.maxY>floorY+.005&&c.minY<floorY+height&&
  p.x+radius>c.minX&&p.x-radius<c.maxX&&p.z+radius>c.minZ&&p.z-radius<c.maxZ);
const rayHit=(ray,c)=>ray.intersectBox(new THREE.Box3(new THREE.Vector3(c.minX,c.minY,c.minZ),new THREE.Vector3(c.maxX,c.maxY,c.maxZ)),new THREE.Vector3());

test('all four entrances have a continuous full-height passage from outdoors to the centre aisle',()=>{
  const campus=createCampusBuildings();
  try{
    assert.equal(campus.buildings.length,4);
    for(const b of campus.buildings){
      assert.ok(b.door.width>=2.5);
      const relevant=campus.colliders.filter(c=>c.buildingId===b.id);
      for(let i=0;i<=60;i++){
        const t=i/60,p={x:b.door.outside.x+(b.center.x-b.door.outside.x)*t,z:b.door.outside.z+(b.center.z-b.door.outside.z)*t};
        assert.equal(hasCapsuleCollision(relevant,p),false,`${b.name} entrance obstructed at ${JSON.stringify(p)}`);
      }
      assert.equal(getBuildingAt(b.door.inside,campus.buildings)?.id,b.id);
      assert.equal(getBuildingAt(b.door.outside,campus.buildings),null);
    }
  }finally{campus.dispose();}
});

test('each editable centre floor can be picked from inside while roof blocks picking through the building',()=>{
  const campus=createCampusBuildings();
  try{
    for(const b of campus.buildings){
      const colliders=campus.colliders.filter(c=>c.buildingId===b.id),origin=new THREE.Vector3(b.center.x,b.floorY+2,b.center.z),down=new THREE.Vector3(0,-1,0);
      const hits=colliders.map(c=>({c,point:rayHit(new THREE.Ray(origin,down),c)})).filter(h=>h.point).sort((a,b)=>origin.distanceTo(a.point)-origin.distanceTo(b.point));
      assert.equal(hits[0].c.kind,'floor',b.name);
      const above=new THREE.Vector3(b.center.x,b.roofY+3,b.center.z);
      const roofHits=colliders.map(c=>({c,point:rayHit(new THREE.Ray(above,down),c)})).filter(h=>h.point).sort((a,b)=>above.distanceTo(a.point)-above.distanceTo(b.point));
      assert.equal(roofHits[0].c.kind,'roof',b.name);
      assert.ok(Math.abs(roofHits[0].point.y-b.roofY)<1e-9);
    }
  }finally{campus.dispose();}
});

test('rendered wall, glass and furniture colliders match their actual box geometry',()=>{
  const campus=createCampusBuildings();
  try{
    assert.ok(campus.colliders.some(c=>c.kind==='glass'));
    for(const b of campus.buildings){
      for(const kind of ['wall','glass','floor','roof','furniture'])assert.ok(campus.colliders.some(c=>c.buildingId===b.id&&c.kind===kind),`${b.name} ${kind}`);
    }
    for(const c of campus.colliders){
      const mesh=c.mesh;
      for(const [axis,min,max] of [['x','minX','maxX'],['y','minY','maxY'],['z','minZ','maxZ']]){
        assert.equal(c[min],mesh.position[axis]-mesh.scale[axis]/2);
        assert.equal(c[max],mesh.position[axis]+mesh.scale[axis]/2);
      }
    }
  }finally{campus.dispose();}
});

test('sample metadata preserves building footprint and floor height',()=>{
  for(const definition of SAMPLE_BUILDINGS){
    const b=describeBuilding(definition);
    assert.equal(b.bounds.minX,(definition.x-490)*.1);
    assert.equal(b.bounds.minZ,(definition.y-285)*.1);
    assert.equal(b.floorY,.145);
    assert.equal(b.roofY,definition.h+.3);
  }
});
