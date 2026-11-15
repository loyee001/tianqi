import * as THREE from './vendor/three.module.js';

// One accessible demonstration floor per building; these are not surveyed interiors.
export const SAMPLE_BUILDINGS = Object.freeze([
  {id:'teaching',x:89,y:126,w:219,d:113,h:8.2,name:'教学楼',color:0xe7e8d8,doorSide:'east'},
  {id:'canteen',x:689,y:321,w:195,d:114,h:5.1,name:'食堂',color:0xf0e7d4,doorSide:'west'},
  {id:'library',x:92,y:385,w:159,d:96,h:5.8,name:'图书馆',color:0xe5e3d5,doorSide:'east'},
  {id:'activity',x:507,y:450,w:118,d:77,h:3.9,name:'活动室',color:0xe7e8dc,doorSide:'north'},
]);
const UNIT=.1,GROUND=.145,THICKNESS=.28,DOOR_WIDTH=3.6,DOOR_HEIGHT=3.2;
const world=(x,y)=>({x:(x-490)*UNIT,z:(y-285)*UNIT});

export function describeBuilding(definition){
  const b=definition,a=world(b.x,b.y),bounds={minX:a.x,maxX:a.x+b.w*UNIT,minZ:a.z,maxZ:a.z+b.d*UNIT};
  const cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2;
  const normal=b.doorSide==='east'?{x:1,z:0}:b.doorSide==='west'?{x:-1,z:0}:b.doorSide==='north'?{x:0,z:-1}:{x:0,z:1};
  const position={x:normal.x>0?bounds.maxX:normal.x<0?bounds.minX:cx,z:normal.z>0?bounds.maxZ:normal.z<0?bounds.minZ:cz};
  const inside={x:position.x-normal.x*2.1,z:position.z-normal.z*2.1},outside={x:position.x+normal.x*2.1,z:position.z+normal.z*2.1};
  return {...b,bounds,floorY:GROUND,ceilingY:b.h,roofY:b.h+.3,center:{x:cx,z:cz},door:{position,inside,outside,normal,width:DOOR_WIDTH,height:DOOR_HEIGHT,yaw:Math.atan2(normal.x,normal.z)}};
}

export function getBuildingAt(point,buildings=SAMPLE_BUILDINGS.map(describeBuilding)){
  return buildings.find(b=>point.x>b.bounds.minX+THICKNESS/2&&point.x<b.bounds.maxX-THICKNESS/2&&point.z>b.bounds.minZ+THICKNESS/2&&point.z<b.bounds.maxZ-THICKNESS/2)||null;
}

export function createCampusBuildings({label}={}){
  const group=new THREE.Group();group.name='可进入的校园建筑';
  const colliders=[],buildings=SAMPLE_BUILDINGS.map(describeBuilding),resources=new Set();
  const keep=value=>(resources.add(value),value),cube=keep(new THREE.BoxGeometry(1,1,1));
  const mat=(color,extra={})=>keep(new THREE.MeshStandardMaterial({color,roughness:.85,...extra}));
  const trim=mat(0x647d68),glass=mat(0x8ab8bd,{transparent:true,opacity:.28,roughness:.2,metalness:.05,depthWrite:false}),wood=mat(0xb78c60),seat=mat(0x82a28d),white=mat(0xf2f0e4),metal=mat(0x667b73),bookColors=[0xa75e4a,0xc4b66e,0x6b95a3,0x749260,0x9787a0].map(c=>mat(c));
  const floorMats={teaching:mat(0xd4cfb3),library:mat(0xc1b79c),canteen:mat(0xdfd8c4),activity:mat(0xadc4b4)};
  const lit=mat(0xfff4d6,{emissive:0xffe4a8,emissiveIntensity:.8});
  function box(parent,b,x,y,z,w,h,d,material,kind=null){
    const mesh=new THREE.Mesh(cube,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=kind!=='floor';mesh.receiveShadow=true;
    mesh.userData.buildingId=b.id;if(kind)mesh.userData.colliderKind=kind;parent.add(mesh);
    if(kind)colliders.push({minX:x-w/2,maxX:x+w/2,minY:y-h/2,maxY:y+h/2,minZ:z-d/2,maxZ:z+d/2,kind,buildingId:b.id,mesh});
    return mesh;
  }
  function table(parent,b,x,z,w=2.6,d=1.15,chairs=true){
    box(parent,b,x,GROUND+.88,z,w,.16,d,wood,'furniture');
    for(const sideX of [-1,1])for(const sideZ of [-1,1])box(parent,b,x+sideX*(w/2-.18),GROUND+.42,z+sideZ*(d/2-.14),.13,.84,.13,metal,'furniture');
    if(chairs)for(const side of [-1,1]){
      box(parent,b,x,GROUND+.48,z+side*(d/2+.42),w*.55,.13,.6,seat,'furniture');
      box(parent,b,x,GROUND+.83,z+side*(d/2+.68),w*.55,.7,.1,seat,'furniture');
      box(parent,b,x,GROUND+.22,z+side*(d/2+.42),.22,.44,.35,metal,'furniture');
    }
  }
  function bookshelf(parent,b,x,z,w=2.9){
    box(parent,b,x,GROUND+1.25,z,w,2.5,.65,wood,'furniture');
    // The shelves are represented by the matching bounding box so collisions agree.
    box(parent,b,x,GROUND+1.25,z+.34,w-.16,2.25,.04,mat(0x695a44));
    for(let shelf=0;shelf<3;shelf++){
      box(parent,b,x,GROUND+.2+shelf*.76,z+.36,w,.09,.75,wood);
      for(let i=0;i<8;i++)box(parent,b,x-w/2+.28+i*(w-.45)/8,GROUND+.48+shelf*.76,z+.38,.17,.52+(i%3)*.055,.31,bookColors[(i+shelf)%bookColors.length]);
    }
  }
  function wall(parent,b,side,wallMat){
    const horizontal=side==='north'||side==='south',bounds=b.bounds;
    const start=horizontal?bounds.minX:bounds.minZ,end=horizontal?bounds.maxX:bounds.maxZ,center=(start+end)/2;
    const fixed=horizontal?(side==='north'?bounds.minZ:bounds.maxZ):(side==='west'?bounds.minX:bounds.maxX);
    const isDoor=side===b.doorSide;
    const segment=(lo,hi,y,h,material,kind='wall')=>{
      if(hi-lo<=.001||h<=.001)return;
      box(parent,b,horizontal?(lo+hi)/2:fixed,y,horizontal?fixed:(lo+hi)/2,horizontal?hi-lo:THICKNESS,h,horizontal?THICKNESS:hi-lo,material,kind);
    };
    if(isDoor){
      segment(start,center-DOOR_WIDTH/2,GROUND+(b.h-GROUND)/2,b.h-GROUND,wallMat);
      segment(center+DOOR_WIDTH/2,end,GROUND+(b.h-GROUND)/2,b.h-GROUND,wallMat);
      segment(center-DOOR_WIDTH/2,center+DOOR_WIDTH/2,GROUND+DOOR_HEIGHT+(b.h-GROUND-DOOR_HEIGHT)/2,b.h-GROUND-DOOR_HEIGHT,wallMat);
      // Door jambs decorate the opening without narrowing its walkable width.
      segment(center-DOOR_WIDTH/2-.11,center-DOOR_WIDTH/2,GROUND+DOOR_HEIGHT/2,DOOR_HEIGHT,trim);
      segment(center+DOOR_WIDTH/2,center+DOOR_WIDTH/2+.11,GROUND+DOOR_HEIGHT/2,DOOR_HEIGHT,trim);
    }else{
      // Solid sill and lintel with actual transparent window openings between posts.
      segment(start,end,GROUND+.55,1.1,wallMat);
      segment(start,end,GROUND+2.8+(b.h-GROUND-2.8)/2,b.h-GROUND-2.8,wallMat);
      const count=Math.max(2,Math.floor((end-start)/3)),span=(end-start)/count;
      for(let i=0;i<count;i++){
        segment(start+i*span,start+i*span+.2,GROUND+1.95,1.7,wallMat);
        segment(start+i*span+.2,start+(i+1)*span,GROUND+1.95,1.7,glass,'glass');
      }
      segment(end-.2,end,GROUND+1.95,1.7,wallMat);
    }
  }
  for(const b of buildings){
    const interior=new THREE.Group();interior.name=b.name+'一层示意';interior.userData.buildingId=b.id;group.add(interior);b.group=interior;
    const {minX,maxX,minZ,maxZ}=b.bounds,{x:cx,z:cz}=b.center,w=maxX-minX,d=maxZ-minZ,wallMat=mat(b.color);
    box(interior,b,cx,GROUND-.065,cz,w,.13,d,floorMats[b.id],'floor');
    for(const side of ['north','south','east','west'])wall(interior,b,side,wallMat);
    box(interior,b,cx,b.h+.15,cz,w+.5,.3,d+.5,mat(0xb8c7b5),'roof');
    // Ceiling lamps brighten enclosed interiors without needing baked assets.
    box(interior,b,cx,b.h-.04,cz,Math.max(2,w*.55),.06,.18,lit);
    const lamp=new THREE.PointLight(0xfff6e2,55,Math.max(w,d)*1.3,2);lamp.position.set(cx,Math.min(b.h-.5,4),cz);interior.add(lamp);
    // A continuous central aisle connects every entrance to an editable open area.
    const aisleWidth=b.id==='activity'?3.8:3.6;
    box(interior,b,cx,GROUND+.008,cz,b.doorSide==='north'?aisleWidth:w-.6,.012,b.doorSide==='north'?d-.6:aisleWidth,mat(0xdce6ce));
    if(b.id==='teaching'){
      box(interior,b,minX+.3,GROUND+1.7,cz,.12,1.6,3.2,mat(0x3f5e4c),'furniture');
      for(let row=0;row<3;row++)for(const side of [-1,1])table(interior,b,minX+4+row*4.3,cz+side*3.5,2.4,1.05);
    }else if(b.id==='library'){
      for(let shelf=0;shelf<3;shelf++)for(const side of [-1,1])bookshelf(interior,b,minX+2.7+shelf*4.1,cz+side*3.5,3);
      table(interior,b,minX+2.7,cz,2.5,1.05,false);
    }else if(b.id==='canteen'){
      for(let row=0;row<3;row++)for(const side of [-1,1])table(interior,b,minX+5+row*4.2,cz+side*3.45,2.5,1.2);
      box(interior,b,maxX-1,GROUND+.65,cz,1.1,1.3,2.8,white,'furniture');
      box(interior,b,maxX-.3,GROUND+1.7,cz,.12,.8,2.8,mat(0x6b8c6d),'furniture');
    }else{
      for(const side of [-1,1]){
        box(interior,b,cx+side*3.5,GROUND+.4,cz+.6,2,.65,1.5,seat,'furniture');
        box(interior,b,cx+side*3.5,GROUND+.9,cz+1.3,2,.7,.18,seat,'furniture');
      }
      box(interior,b,cx,GROUND+1.7,maxZ-.23,2.7,1.5,.12,mat(0x6a8073),'furniture');
    }
    // Green doorway threshold and exterior name make the openings discoverable.
    const door=b.door,wideX=Math.abs(door.normal.x)<.5;
    box(interior,b,door.position.x,GROUND+.02,door.position.z,wideX?DOOR_WIDTH:1.2,.025,wideX?1.2:DOOR_WIDTH,trim);
    if(label){
      interior.add(label(b.name,new THREE.Vector3(cx,b.h+2,cz),{width:b.name.length>2?9.2:7}));
      const sign=label(`${b.name}入口`,new THREE.Vector3(door.position.x+door.normal.x*.35,GROUND+DOOR_HEIGHT+.35,door.position.z+door.normal.z*.35),{width:3.4,color:'#fff',background:'#31563ef2'});
      sign.material.depthTest=true;sign.renderOrder=0;interior.add(sign);
    }
  }
  return {group,colliders,buildings,dispose(){resources.forEach(resource=>resource.dispose());group.clear();}};
}
