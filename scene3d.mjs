import * as THREE from './vendor/three.module.js';
import {createMovement} from './movement.mjs';
import {blocksBody,verticalLimits,rayColliderDistance} from './collision.mjs';
import {createCampusBuildings,SAMPLE_BUILDINGS,getBuildingAt} from './campus-buildings.mjs';
import {createCampusPedestrians} from './pedestrians.mjs';
import {slicePolyline} from './geometry.mjs';

// Coordinates follow the uploaded 980 × 570 plan. Geometry is illustrative;
// neither the sun position nor the building heights represent a site survey.
const MAP_W = 980, MAP_H = 570, UNIT = 0.1;
const BUILDINGS = SAMPLE_BUILDINGS;
const EXISTING_TREES = [[70,70,19],[113,64,15],[161,70,18],[211,63,13],[268,72,21],[320,69,16],[57,164,19],[53,214,16],[97,329,15],[147,327,19],[201,328,18],[258,328,17],[290,405,15],[289,458,17],[283,512,17],[60,512,18],[108,525,19],[162,523,16],[213,523,15],[451,117,14],[451,163,15],[451,216,15],[451,269,17],[489,309,16],[536,308,17],[583,308,15],[632,308,14],[744,479,20],[789,482,17],[840,480,20],[903,483,17],[924,321,16],[926,367,18],[926,416,17],[909,142,17],[908,194,16],[909,248,16]];
const toWorld = p => new THREE.Vector3((p.x-MAP_W/2)*UNIT, 0, (p.y-MAP_H/2)*UNIT);
const toMap = p => ({x:Math.round((p.x/UNIT+MAP_W/2)*10)/10,y:Math.round((p.z/UNIT+MAP_H/2)*10)/10});
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

// Keep picking independent of browser events so ray/boundary regressions are testable.
export function resolveGroundPick(ray,{surfaceY=0,buildings=BUILDINGS,clearance=0}={}){
  if(ray.direction.y>=-1e-8)return {status:'no-ground',message:'这里没有可选地面，请向下看，再点击校园地面。'};
  const point=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-surfaceY);
  if(!ray.intersectPlane(plane,point))return {status:'no-ground',message:'这里没有可选地面，请向下看，再点击校园地面。'};
  const distance=ray.origin.distanceTo(point);
  for(const building of buildings){
    const start=toWorld(building),maxX=start.x+building.w*UNIT,maxZ=start.z+building.d*UNIT;
    const bounds=new THREE.Box3(new THREE.Vector3(start.x,0,start.z),new THREE.Vector3(maxX,building.h+.3,maxZ)),hit=new THREE.Vector3();
    const behindWall=ray.intersectBox(bounds,hit)&&ray.origin.distanceTo(hit)<=distance+.001;
    const inside=point.x>start.x&&point.x<maxX&&point.z>start.z&&point.z<maxZ;
    if(behindWall||inside)return {status:'building',point,message:`你点到了${building.name}，请选择建筑外的地面。`};
    if(clearance>0&&point.x>start.x-clearance&&point.x<maxX+clearance&&point.z>start.z-clearance&&point.z<maxZ+clearance)return {status:'clearance',point,message:`这里离${building.name}太近，请把树种在旁边更开阔的空地。`};
  }
  if(point.x<-MAP_W*UNIT/2||point.x>MAP_W*UNIT/2||point.z<-MAP_H*UNIT/2||point.z>MAP_H*UNIT/2)return {status:'out-of-bounds',point,message:'这里已超出校园图边界，请点击图内地面。'};
  return {status:'ready',point,mapPoint:toMap(point)};
}

export function createCampusScene(container, {onPlant=()=>{},onRoutePoint=()=>{},onRouteSplit=()=>{},onStatus=()=>{},onModeChange=()=>{},onMovementChange=()=>{},onLocationChange=()=>{},onPedestriansChange=()=>{}}={}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  } catch (error) {
    const message='当前浏览器未能启动 3D。请启用硬件加速，或继续使用平面规划。';
    const fallback=document.createElement('div');fallback.className='scene-fallback';fallback.textContent=message;container.append(fallback);onStatus(message);
    return {update(){},setEnvironment(){},setLightCoverage(){},setLightCoverageVisible(){},setPedestriansEnabled(){return false;},setMode(){},setPlanting(){},setRouteEditing(){},setSegmentEditing(){},validatePlantPoint(){return null;},validateRoute(){return null;},enterBuilding(){},resetView(){},move(){},jump(){},toggleFlight(){},zoom(){},resize(){},capture(){return null;},dispose(){fallback.remove();}};
  }
  const canvas=renderer.domElement;
  canvas.tabIndex=0;canvas.setAttribute('aria-label','3D 校园：拖动旋转，滚轮缩放；漫游时 WASD 或方向键走动，空格跳跃，双击空格切换飞行，飞行时空格上升、Shift 下降');
  Object.assign(canvas.style,{display:'block',width:'100%',height:'100%',outline:'none',touchAction:'none'});
  container.append(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xe9efe7);scene.fog=new THREE.Fog(0xe9efe7,150,330);
  const camera=new THREE.PerspectiveCamera(44,1,0.08,500);
  const hemisphere=new THREE.HemisphereLight(0xf1f8ff,0xb3b698,2.2);scene.add(hemisphere);
  const sunlight=new THREE.DirectionalLight(0xfff3d6,2.7);sunlight.position.set(-32,65,-38);sunlight.castShadow=true;
  Object.assign(sunlight.shadow.camera,{left:-75,right:75,top:65,bottom:-65,near:1,far:160});
  sunlight.shadow.mapSize.set(2048,2048);sunlight.shadow.bias=-0.0004;sunlight.shadow.normalBias=0.035;scene.add(sunlight);
  const baseGroup=new THREE.Group(), routeGroup=new THREE.Group(), treeGroup=new THREE.Group();
  baseGroup.name='campus-base';routeGroup.name='campus-route';treeGroup.name='planned-greens';
  let campusBuildings=null,buildingColliders=[],canopyColliders=[],existingPlantColliders=[],plantedColliders=[],staticColliders=[],pedestrianColliders=[],solidColliders=[];
  const refreshColliders=()=>{staticColliders=[...buildingColliders,...canopyColliders,...existingPlantColliders,...plantedColliders];solidColliders=[...staticColliders,...pedestrianColliders];};
  scene.add(baseGroup,routeGroup,treeGroup);
  const pedestrians=createCampusPedestrians();let pedestriansPreference=true,lastPedestriansSummary='';scene.add(pedestrians.group);
  const resources=new Set(), labelTextures=new Set();
  const keep=value=>(resources.add(value),value);
  const coveragePalette=[[0,0,0,0],[242,196,85,90],[100,134,124,150],[56,182,107,185]];
  function coverageTextureFor(width,height){
    const texture=keep(new THREE.DataTexture(new Uint8Array(width*height*4),width,height,THREE.RGBAFormat));
    texture.name='campus-light-coverage';texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
  }
  let lightCoverageTexture=coverageTextureFor(1,1),lightCoverageVisible=true,lightCoverageAvailable=false,lightCoverageNight=false;
  const coverageUniforms={uCampusCoverageMap:{value:lightCoverageTexture},uCampusCoverageEnabled:{value:0},uCampusCoverageWorldSize:{value:new THREE.Vector2(MAP_W*UNIT,MAP_H*UNIT)}};
  function withLightCoverage(mat){
    mat.userData.campusLightCoverage=true;
    mat.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,coverageUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vCampusCoverageUv;\nuniform vec2 uCampusCoverageWorldSize;')
        .replace('#include <project_vertex>',`vec4 campusCoverageWorld = modelMatrix * vec4( transformed, 1.0 );\nvCampusCoverageUv = ( campusCoverageWorld.xz + vec2(49.0,28.5) ) / uCampusCoverageWorldSize;\n#include <project_vertex>`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vCampusCoverageUv;\nuniform sampler2D uCampusCoverageMap;\nuniform float uCampusCoverageEnabled;')
        .replace('#include <color_fragment>',`#include <color_fragment>\nif (uCampusCoverageEnabled > 0.5 && all(greaterThanEqual(vCampusCoverageUv,vec2(0.0))) && all(lessThanEqual(vCampusCoverageUv,vec2(1.0)))) {\n  vec4 campusCoverageColor = texture2D(uCampusCoverageMap,vCampusCoverageUv);\n  diffuseColor.rgb = mix(diffuseColor.rgb,campusCoverageColor.rgb,campusCoverageColor.a);\n}`);
    };
    mat.customProgramCacheKey=()=> 'campus-ground-light-coverage-v1';return mat;
  }
  const material=(color,extra={})=>keep(new THREE.MeshStandardMaterial({color,roughness:0.86,...extra}));
  const unitBox=keep(new THREE.BoxGeometry(1,1,1));
  const trunkGeometry=keep(new THREE.CylinderGeometry(0.12,0.2,1,7));
  const crownGeometry=keep(new THREE.IcosahedronGeometry(1,1));
  const potGeometry=keep(new THREE.CylinderGeometry(.36,.27,.5,14)),potMaterial=material(0xb38662);
  const treeMaterials=[material(0x6d9553),material(0x8baa69),material(0x759d59),material(0xa1bb79)];
  const trunkMaterial=material(0x95775a);
  const unfundedMaterial=material(0xd7a65f,{transparent:true,opacity:0.43,depthWrite:false});
  const postMaterial=material(0x315b46,{metalness:0.22,roughness:0.55});
  const meshRoofMaterial=material(0x588744,{side:THREE.DoubleSide,roughness:0.95});
  const solidRoofMaterial=material(0xa5c8bc,{metalness:0.12,roughness:0.36,transparent:true,opacity:0.86});
  const corridorRoofMaterial=material(0xdce2d1,{metalness:.1,roughness:.62}),corridorColumnMaterial=material(0x365647,{metalness:.15,roughness:.65});
  const corridorFloorMaterial=material(0xd8d8ca),corridorJointMaterial=material(0xb4bcab),corridorDrainMaterial=material(0x6d8272,{metalness:.48,roughness:.45});
  const corridorLightMaterial=material(0xfff2c9,{emissive:0xffe0a0,emissiveIntensity:1.8,roughness:.4});
  const corridorPendingMaterial=material(0xd3a568,{transparent:true,opacity:.18,depthWrite:false,roughness:.9});
  const fundedPathMaterial=material(0xc6d8ab), pendingPathMaterial=material(0xe3bd81), previewPathMaterial=material(0xc9d2be);
  const plantingRouteMaterial=material(0x6e9b54);
  const roadMaterial=material(0xe8e8d9), borderMaterial=material(0xc5ceb6), grassMaterial=material(0xc8d8b5);
  [grassMaterial,roadMaterial,borderMaterial,fundedPathMaterial,pendingPathMaterial,previewPathMaterial,corridorFloorMaterial,corridorJointMaterial].forEach(withLightCoverage);
  let mode='orbit',planting=false,routeEditing=false,segmentEditing=false,disposed=false,dirty=true,lastFrame=performance.now(),imageKey=Symbol('initial'),imageGeneration=0;
  let latest={route:[],trees:[],plan:null,image:null,widthM:2.4,type:'mesh',metersPerPixel:48/570};
  let displayScale=UNIT/latest.metersPerPixel,scaleWarning=false;
  let environment={sun:{azimuthDeg:320,elevationDeg:53},radiationWm2:850,cloudCoverPercent:15};
  // All human-scale objects use the same conversion as the calibrated map.
  // These limits protect GPU floating-point display only, never project data.
  const safeDisplayScale=mpp=>clamp(UNIT/mpp,1e-4,1e4);
  const surfaceHeight=()=>latest.image ? 0.075 : 0.145;
  let orbit={theta:0.47,phi:0.71,radius:120,target:new THREE.Vector3(0,0,0)},yaw=0,pitch=0;
  const held=new Set(),pointers=new Map();let drag=null,pinchDistance=0,lastPointer=null;
  const movement=createMovement();let lastMovementState='',lastMovementHeight=-Infinity,lastMovementNotification=0,lastLocation;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const ghostMaterial=keep(new THREE.MeshBasicMaterial({color:0x4d8954,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false,depthTest:false}));
  const ghost=new THREE.Mesh(keep(new THREE.RingGeometry(1.05,1.3,40)),ghostMaterial);ghost.rotation.x=-Math.PI/2;ghost.position.y=0.1;ghost.visible=false;ghost.renderOrder=100;scene.add(ghost);

  function box(parent,x,y,z,w,h,d,mat,shadow=true) {
    const mesh=new THREE.Mesh(unitBox,mat);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function clearGroup(group){
    group.traverse(obj=>{if(obj.userData.temporaryGeometry)obj.geometry?.dispose();if(obj.userData.label){obj.material.map?.dispose();labelTextures.delete(obj.material.map);obj.material.dispose();}if(obj.userData.temporaryMaterial){obj.material.map?.dispose();obj.material.dispose();}});
    group.clear();
  }
  function label(text,position,{width=10,color='#294f3e',background='#ffffffeb'}={}) {
    const bitmap=document.createElement('canvas');bitmap.width=512;bitmap.height=128;const ctx=bitmap.getContext('2d');
    ctx.fillStyle=background;ctx.beginPath();ctx.roundRect(5,7,502,108,26);ctx.fill();
    ctx.font='600 47px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,256,61);
    const texture=new THREE.CanvasTexture(bitmap);texture.colorSpace=THREE.SRGBColorSpace;labelTextures.add(texture);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));sprite.scale.set(width,width/4,1);sprite.position.copy(position);sprite.userData.label=true;sprite.renderOrder=5;return sprite;
  }
  function addTree(group,x,y,r=1.65,index=0,unfunded=false,scale=1) {
    const position=toWorld({x,y}),tree=new THREE.Group();tree.position.copy(position);
    const trunk=new THREE.Mesh(trunkGeometry,unfunded?unfundedMaterial:trunkMaterial);trunk.scale.set(scale,r*1.8,scale);trunk.position.y=r*0.9;trunk.castShadow=!unfunded;tree.add(trunk);
    const crown=new THREE.Mesh(crownGeometry,unfunded?unfundedMaterial:treeMaterials[index%treeMaterials.length]);crown.scale.set(r,r*1.12,r);crown.position.y=r*2.1;crown.rotation.y=index*1.7;crown.castShadow=!unfunded;crown.receiveShadow=true;tree.add(crown);
    const second=new THREE.Mesh(crownGeometry,unfunded?unfundedMaterial:treeMaterials[(index+1)%treeMaterials.length]);second.scale.set(r*.64,r*.68,r*.65);second.position.set(r*.5,r*2.8,-r*.15);second.castShadow=!unfunded;tree.add(second);
    group.add(tree);return tree;
  }
  function treeSolids(x,y,r,scale,{baseY=0,indoor=false,id}={}){
    const p=toWorld({x,y}),colliders=[],solid=(dx,dz,halfX,halfZ,minY,maxY,kind)=>colliders.push({minX:p.x+dx-halfX,maxX:p.x+dx+halfX,minZ:p.z+dz-halfZ,maxZ:p.z+dz+halfZ,minY,maxY,kind,plantId:id});
    // Trunks and pots are solid. Only the upper crown core is solid foliage;
    // outer/lower leaves remain soft, so the full shade footprint never blocks a path.
    solid(0,0,.2*scale,.2*scale,baseY,baseY+r*1.8,'tree-trunk');
    solid(0,0,r*.58,r*.58,baseY+r*2.1,baseY+r*3.05,'tree-crown');
    solid(r*.5,-r*.15,r*.3,r*.3,baseY+r*2.9,baseY+r*3.35,'tree-crown');
    if(indoor)solid(0,0,.36*scale,.36*scale,surfaceHeight(),surfaceHeight()+.5*scale,'plant-pot');
    return colliders;
  }
  function addBuilding(building) {
    const {x,y,w,d,h,name,color}=building,c=toWorld({x:x+w/2,y:y+d/2}),ww=w*UNIT,dd=d*UNIT;
    box(baseGroup,c.x,h/2,c.z,ww,h,dd,material(color));
    box(baseGroup,c.x,h+.15,c.z,ww+.5,.3,dd+.5,material(0xb8c7b5));
    box(baseGroup,c.x,.3,c.z,ww+.5,.6,dd+.5,material(0xcbd0bd));
    const pane=material(0x6e9291,{metalness:.22,roughness:.3}),frame=material(0xf1eddf);
    const floors=Math.max(1,Math.floor(h/2.5));
    for(let floor=0;floor<floors;floor++){
      const py=1.6+floor*2.45;
      for(let wx=-ww/2+1.3;wx<ww/2-.6;wx+=2.3){
        box(baseGroup,c.x+wx,py,c.z+dd/2+.04,1.3,1.2,.07,pane,false);
        box(baseGroup,c.x+wx,py,c.z-dd/2-.04,1.3,1.2,.07,pane,false);
      }
      box(baseGroup,c.x,py+.9,c.z+dd/2+.11,ww,.12,.2,frame,false);
    }
    for(let wz=-dd/2+1.4;wz<dd/2-.7;wz+=2.5){box(baseGroup,c.x+ww/2+.04,2,c.z+wz,.07,1.3,1.4,pane,false);}
    baseGroup.add(label(name,new THREE.Vector3(c.x,h+2,c.z),{width:name.length>2?9.2:7}));
  }
  function addRoad(a,b,width=5.3) {
    const start=toWorld(a),end=toWorld(b),length=start.distanceTo(end),middle=start.clone().add(end).multiplyScalar(.5);
    const border=box(baseGroup,middle.x,.025,middle.z,width+.65,.13,length,borderMaterial,false);border.rotation.y=Math.atan2(end.x-start.x,end.z-start.z);
    const road=box(baseGroup,middle.x,.105,middle.z,width,.07,length,roadMaterial,false);road.rotation.y=border.rotation.y;
  }
  function makeSportsField(){
    const bitmap=document.createElement('canvas');bitmap.width=1024;bitmap.height=512;const ctx=bitmap.getContext('2d');ctx.fillStyle='#b88c70';ctx.fillRect(0,0,1024,512);
    for(let i=0;i<6;i++){ctx.strokeStyle='#ead9c5';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(40+i*15,30+i*14,944-i*30,452-i*28,210-i*14);ctx.stroke();}
    ctx.fillStyle='#8fbc73';ctx.fillRect(265,125,495,262);ctx.strokeStyle='#e7eed2';ctx.lineWidth=4;ctx.strokeRect(275,135,475,242);ctx.beginPath();ctx.moveTo(512,135);ctx.lineTo(512,377);ctx.stroke();ctx.beginPath();ctx.arc(512,256,60,0,Math.PI*2);ctx.stroke();ctx.strokeRect(275,203,65,106);ctx.strokeRect(685,203,65,106);
    const texture=new THREE.CanvasTexture(bitmap);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const mat=withLightCoverage(new THREE.MeshStandardMaterial({map:texture,roughness:1}));const center=toWorld({x:673,y:205.5});
    const field=box(baseGroup,center.x,.11,center.z,39,.18,16.1,mat,false);field.userData.temporaryMaterial=true;
    baseGroup.add(label('运动场',new THREE.Vector3(center.x,1.6,center.z),{width:8,color:'#59754a',background:'#ffffffbb'}));
  }
  function buildBase(image){
    const generation=++imageGeneration;clearGroup(baseGroup);campusBuildings?.dispose();campusBuildings=null;buildingColliders=[];existingPlantColliders=[];refreshColliders();
    box(baseGroup,0,-.56,0,98,1.1,57,material(0xb9c9a8));
    box(baseGroup,0,.005,0,98,.08,57,grassMaterial,false);
    if(image){
      const img=new Image();img.onload=()=>{
        if(disposed||generation!==imageGeneration)return;
        const bitmap=document.createElement('canvas');bitmap.width=1960;bitmap.height=1140;const ctx=bitmap.getContext('2d');ctx.fillStyle='#f3f4ef';ctx.fillRect(0,0,bitmap.width,bitmap.height);
        const scale=Math.min(bitmap.width/img.width,bitmap.height/img.height),w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(bitmap.width-w)/2,(bitmap.height-h)/2,w,h);
        const texture=new THREE.CanvasTexture(bitmap);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        const mat=withLightCoverage(new THREE.MeshStandardMaterial({map:texture,roughness:1}));const ground=new THREE.Mesh(new THREE.PlaneGeometry(98,57),mat);ground.rotation.x=-Math.PI/2;ground.position.y=.06;ground.receiveShadow=true;ground.userData.temporaryGeometry=true;ground.userData.temporaryMaterial=true;baseGroup.add(ground);dirty=true;
      };img.onerror=()=>onStatus('校园图未能载入 3D，可继续平面规划。');img.src=image;
    }else{
      addRoad({x:0,y:290},{x:330,y:290});addRoad({x:330,y:290},{x:330,y:570});addRoad({x:398,y:0},{x:398,y:535});addRoad({x:398,y:370},{x:980,y:370});addRoad({x:64,y:85},{x:938,y:85});
      addRoad({x:308,y:181},{x:398,y:181},3.4);addRoad({x:398,y:535},{x:980,y:535},3.4);
      makeSportsField();campusBuildings=createCampusBuildings({label});baseGroup.add(campusBuildings.group);buildingColliders=campusBuildings.colliders;
      EXISTING_TREES.forEach(([x,y,r],i)=>{addTree(baseGroup,x,y,r*.1,i);existingPlantColliders.push(...treeSolids(x,y,r*.1,1,{id:`existing-${i}`}));});refreshColliders();
      // Low edge hedges make the boundary legible from walking height.
      const hedge=material(0x829c65);box(baseGroup,-48,.55,0,.7,1.1,55,hedge);box(baseGroup,48,.55,0,.7,1.1,55,hedge);box(baseGroup,0,.55,-28,96,1.1,.7,hedge);
    }
    dirty=true;
  }
  function routeMetrics(points){
    const segments=[];let total=0;for(let i=1;i<points.length;i++){const a=toWorld(points[i-1]),b=toWorld(points[i]),length=a.distanceTo(b);if(length>1e-7){segments.push({a,b,length,start:total});total+=length;}}
    return {segments,total};
  }
  function routePoint(segments,distance){
    let lo=0,hi=segments.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(segments[mid].start+segments[mid].length<distance)lo=mid+1;else hi=mid;}
    const segment=segments[lo];return {point:segment.a.clone().lerp(segment.b,clamp((distance-segment.start)/segment.length,0,1)),segment};
  }
  function segmentsForDisplay(metrics){
    if(metrics.segments.length<=1400)return metrics.segments;
    const result=[];let a=routePoint(metrics.segments,0).point;
    for(let i=1;i<=1400;i++){const originalStart=metrics.total*(i-1)/1400,originalEnd=metrics.total*i/1400,b=routePoint(metrics.segments,originalEnd).point;result.push({a,b,length:a.distanceTo(b),start:originalStart,span:originalEnd-originalStart});a=b;}
    return result;
  }
  function corridorBox(part,x,y,z,w,h,d,mat,{angle=0,funded=true,collision=false}={}){
    const mesh=box(routeGroup,x,y,z,w,h,d,mat,funded);mesh.rotation.y=angle;mesh.userData.part=part;mesh.userData.funded=funded;mesh.receiveShadow=funded;
    if(collision)canopyColliders.push({cx:x,cz:z,halfWidth:w/2,halfDepth:d/2,angle,minY:y-h/2,maxY:y+h/2,kind:part});
    return mesh;
  }
  function drawCorridorSpan(a,b,width,s,ground,funded){
    const length=a.distanceTo(b);if(length<=1e-7)return;
    const mid=a.clone().add(b).multiplyScalar(.5),angle=Math.atan2(b.x-a.x,b.z-a.z),mat=funded?corridorRoofMaterial:corridorPendingMaterial;
    corridorBox(funded?'corridor-roof':'corridor-pending-roof',mid.x,ground+3.65*s,mid.z,width+1.1*s,.24*s,length,mat,{angle,funded,collision:funded});
    if(!funded)return;
    corridorBox('corridor-floor',mid.x,ground+.05*s,mid.z,width,.1*s,length,corridorFloorMaterial,{angle,collision:true});
    for(const side of [-1,1]){
      const offset=side*(width/2+.52*s);
      corridorBox('corridor-gutter',mid.x+Math.cos(angle)*offset,ground+3.5*s,mid.z-Math.sin(angle)*offset,.18*s,.16*s,length,corridorDrainMaterial,{angle,collision:true});
    }
    corridorBox('corridor-lighting',mid.x,ground+3.21*s,mid.z,.1*s,.04*s,length,corridorLightMaterial,{angle,collision:true});
    const joints=Math.min(48,Math.floor(length/(2*s)));
    for(let i=1;i<=joints;i++){
      const point=a.clone().lerp(b,i/(joints+1));corridorBox('corridor-paving-joint',point.x,ground+.103*s,point.z,width,.005*s,.018*s,corridorJointMaterial,{angle,collision:false});
    }
  }
  function drawCorridorSupports(metrics,covered,width,s,ground){
    const clearOfRoute=(x,z)=>metrics.segments.every(segment=>{
      const dx=segment.b.x-segment.a.x,dz=segment.b.z-segment.a.z,t=clamp(((x-segment.a.x)*dx+(z-segment.a.z)*dz)/(segment.length*segment.length),0,1);
      return Math.hypot(x-segment.a.x-t*dx,z-segment.a.z-t*dz)>=width/2+.25*s-.01*s;
    });
    function supports(start,end,funded){
      if(end-start<=1e-7)return;
      const count=Math.min(funded?240:120,Math.max(1,Math.ceil((end-start)/(5*s))));
      for(let i=0;i<=count;i++){
        // Do not duplicate the final funded frame with a pending frame.
        if(!funded&&start>0&&i===0)continue;
        const {point,segment}=routePoint(metrics.segments,start+(end-start)*i/count),angle=Math.atan2(segment.b.x-segment.a.x,segment.b.z-segment.a.z),mat=funded?corridorColumnMaterial:corridorPendingMaterial;
        for(const side of [-1,1]){
          const offset=side*(width/2+.28*s),x=point.x+Math.cos(angle)*offset,z=point.z-Math.sin(angle)*offset;
          if(!clearOfRoute(x,z))continue; // Keep inner corners and route entrances unobstructed.
          corridorBox(funded?'corridor-column':'corridor-pending-column',x,ground+1.765*s,z,.3*s,3.53*s,.3*s,mat,{angle,funded,collision:funded});
          if(funded){
            corridorBox('corridor-column-base',x,ground+.09*s,z,.5*s,.18*s,.5*s,corridorColumnMaterial,{angle,collision:true});
            if(side===1){const outside=.24*s;corridorBox('corridor-downpipe',x+Math.cos(angle)*outside,ground+1.7*s,z-Math.sin(angle)*outside,.09*s,3.4*s,.09*s,corridorDrainMaterial,{angle,collision:true});}
          }
        }
        corridorBox(funded?'corridor-beam':'corridor-pending-beam',point.x,ground+3.38*s,point.z,width+.86*s,.24*s,.24*s,mat,{angle,funded,collision:funded});
      }
    }
    supports(0,covered,true);supports(covered,metrics.total,false);
  }
  function drawRoutePart(points,type,plan,{sectionId,sectionIndex}={}){
    const firstChild=routeGroup.children.length,firstCollider=canopyColliders.length;
    const metrics=routeMetrics(points),valid=plan?.valid,total=metrics.total;
    const layoutOnly=Boolean(plan?.layoutOnly||points[0]?.interior),fraction=valid?(layoutOnly?1:clamp(Number(plan.coveragePercent)/100||0,0,1)):0,covered=total*fraction;
    const s=displayScale,ground=surfaceHeight();
    const width=(Number(latest.widthM)>0?Number(latest.widthM):2.4)*s;
    const corridor=type==='corridor'&&!layoutOnly,segments=segmentsForDisplay(metrics),roofMat=type==='solid'?solidRoofMaterial:meshRoofMaterial;
    if(type==='plants'&&!layoutOnly){
      // This is an indication of a planting zone, not purchased paving or trees.
      // Draw continuous-distance dashes so curves preserve their full shape.
      const dashLength=Math.max(.7*s,total/500),period=dashLength*1.7;
      for(const segment of segments){
        const {a,b,length,start}=segment,span=segment.span??length;
        if(span<=1e-7)continue;
        for(let k=Math.floor(start/period);k*period<start+span;k++){
          const from=Math.max(start,k*period),to=Math.min(start+span,k*period+dashLength);
          if(to-from<=1e-7)continue;
          const p=a.clone().lerp(b,(from-start)/span),q=a.clone().lerp(b,(to-start)/span),mid=p.clone().add(q).multiplyScalar(.5);
          const dash=box(routeGroup,mid.x,ground+.022*s,mid.z,.13*s,.016*s,p.distanceTo(q),plantingRouteMaterial,false);dash.rotation.y=Math.atan2(q.x-p.x,q.z-p.z);dash.userData.part='planting-route-indicator';
        }
      }
    }else{
    for(const segment of segments){
      const {a,b,length,start}=segment;if(length<=1e-7)continue;const span=segment.span??length,middle=a.clone().add(b).multiplyScalar(.5),angle=Math.atan2(b.x-a.x,b.z-a.z);
      const strip=box(routeGroup,middle.x,ground+(layoutOnly||corridor ? .012 : .065)*s,middle.z,width,(layoutOnly||corridor ? .018 : .13)*s,length+.03*s,valid?pendingPathMaterial:previewPathMaterial,false);strip.rotation.y=angle;
      const builtFraction=clamp((covered-start)/span,0,1);
      if(corridor){
        const split=a.clone().lerp(b,builtFraction);if(builtFraction>0)drawCorridorSpan(a,split,width,s,ground,true);if(builtFraction<1)drawCorridorSpan(split,b,width,s,ground,false);continue;
      }
      if(builtFraction>0){
        const end=a.clone().lerp(b,builtFraction),mid=a.clone().add(end).multiplyScalar(.5),builtLength=length*builtFraction;
        const floor=box(routeGroup,mid.x,ground+(layoutOnly ? .026 : .1475)*s,mid.z,width,(layoutOnly ? .01 : .035)*s,builtLength,fundedPathMaterial,false);floor.rotation.y=angle;
        if(layoutOnly)continue;
        const roof=box(routeGroup,mid.x,ground+3.5*s,mid.z,width+.28*s,.13*s,builtLength+.07*s,roofMat);roof.rotation.y=angle;roof.userData.part=type==='solid'?'pc-roof':'mesh-roof';
        canopyColliders.push({cx:mid.x,cz:mid.z,halfWidth:(width+.28*s)/2,halfDepth:(builtLength+.07*s)/2,angle,minY:ground+3.435*s,maxY:ground+3.565*s,kind:'canopy'});
        const edge1=box(routeGroup,mid.x+Math.cos(angle)*(width/2+.1*s),ground+3.37*s,mid.z-Math.sin(angle)*(width/2+.1*s),.1*s,.22*s,builtLength,postMaterial);edge1.rotation.y=angle;
        const edge2=box(routeGroup,mid.x-Math.cos(angle)*(width/2+.1*s),ground+3.37*s,mid.z+Math.sin(angle)*(width/2+.1*s),.1*s,.22*s,builtLength,postMaterial);edge2.rotation.y=angle;
        for(const edge of [edge1,edge2])canopyColliders.push({cx:edge.position.x,cz:edge.position.z,halfWidth:.05*s,halfDepth:builtLength/2,angle,minY:ground+3.26*s,maxY:ground+3.48*s,kind:'canopy-beam'});
      }
    }
    if(corridor&&metrics.segments.length)drawCorridorSupports(metrics,covered,width,s,ground);
    if(covered>0&&metrics.segments.length&&!layoutOnly&&!corridor){
      // The support count is a drawing detail, not a structural specification.
      // Sampling is only a rendering safeguard; the entire funded route remains visible.
      const supportCount=Math.min(400,Math.max(1,Math.ceil(covered/(5*s))));
      for(let i=0;i<=supportCount;i++){
        const {point,segment}=routePoint(metrics.segments,covered*i/supportCount),angle=Math.atan2(segment.b.x-segment.a.x,segment.b.z-segment.a.z);
        for(const side of [-1,1]){const x=point.x+Math.cos(angle)*width*.48*side,z=point.z-Math.sin(angle)*width*.48*side;box(routeGroup,x,ground+1.75*s,z,.16*s,3.5*s,.16*s,postMaterial);canopyColliders.push({minX:x-.08*s,maxX:x+.08*s,minZ:z-.08*s,maxZ:z+.08*s,minY:ground,maxY:ground+3.5*s,kind:'post'});}
      }
    }
    }
    if(sectionId!==undefined){
      for(const mesh of routeGroup.children.slice(firstChild)){mesh.userData.sectionId=sectionId;mesh.userData.materialType=type;}
      for(const collider of canopyColliders.slice(firstCollider)){collider.sectionId=sectionId;collider.materialType=type;}
      if(metrics.segments.length){
        const point=routePoint(metrics.segments,total/2).point;
        const names={mesh:'遮阳网',solid:'PC 连廊',corridor:'完整走廊',plants:'仅绿植'};
        const marker=label(`${sectionIndex+1} · ${names[type]||type}`,point.add(new THREE.Vector3(0,ground+(type==='plants'?1.2:5.05)*s,0)),{width:5.2*s,color:'#28543f',background:'#ffffffed'});
        marker.userData.sectionId=sectionId;marker.userData.part='section-label';routeGroup.add(marker);
      }
    }
  }
  function rebuildRoute(){
    clearGroup(routeGroup);canopyColliders=[];refreshColliders();
    if(latest.type==='plants'||latest.plan?.treeOnly){dirty=true;return;}
    const points=latest.route.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!points.length)return;
    const layoutOnly=Boolean(latest.plan?.layoutOnly||points[0]?.interior),s=displayScale,ground=surfaceHeight();
    if(latest.type==='mixed'&&latest.plan?.valid&&!layoutOnly&&Array.isArray(latest.plan.sections)){
      latest.plan.sections.forEach((section,index)=>{
        const sectionPoints=slicePolyline(points,section.startFraction,section.endFraction);
        if(!sectionPoints?.length)return;
        const fraction=section.endFraction>section.startFraction&&Number.isFinite(section.fundedEndFraction)
          ?(section.fundedEndFraction-section.startFraction)/(section.endFraction-section.startFraction)
          :section.lengthM>0?section.coveredLengthM/section.lengthM:0;
        drawRoutePart(sectionPoints,section.type,{valid:true,coveragePercent:clamp(fraction||0,0,1)*100},{sectionId:section.id??index,sectionIndex:index});
      });
    }else drawRoutePart(points,latest.type,latest.plan);
    const start=toWorld(points[0]),end=toWorld(points.at(-1));
    const labelHeight=ground+(layoutOnly ? .6 : 4.65)*s,labelWidth=(layoutOnly?1.5:4.8)*s;
    routeGroup.add(label('起点',start.clone().add(new THREE.Vector3(0,labelHeight,0)),{width:labelWidth,color:'#fff',background:'#28543ff2'}));
    if(points.length>1)routeGroup.add(label('终点',end.clone().add(new THREE.Vector3(0,labelHeight,0)),{width:labelWidth,color:'#fff',background:'#28543ff2'}));
    refreshColliders();dirty=true;
  }
  function rebuildTrees(){
    clearGroup(treeGroup);plantedColliders=[];
    latest.trees.forEach((tree,i)=>{
      if(!Number.isFinite(tree.x)||!Number.isFinite(tree.y))return;
      const indoor=Boolean(tree.interior),r=(indoor ? .45 : 1.65)*displayScale,baseY=surfaceHeight()+(indoor ? .25*displayScale : 0),planted=addTree(treeGroup,tree.x,tree.y,r,i,tree.funded===false,displayScale);planted.position.y=baseY;
      if(indoor){const pot=new THREE.Mesh(potGeometry,tree.funded===false?unfundedMaterial:potMaterial),p=toWorld(tree);pot.scale.setScalar(displayScale);pot.position.set(p.x,surfaceHeight()+.25*displayScale,p.z);pot.castShadow=tree.funded!==false;treeGroup.add(pot);}
      if(tree.funded!==false)plantedColliders.push(...treeSolids(tree.x,tree.y,r,displayScale,{baseY,indoor,id:tree.id}));
    });refreshColliders();clearPlayerPlantOverlap();dirty=true;
  }
  function clearPlayerPlantOverlap(){
    if(mode!=='walk')return;
    const feetY=surfaceHeight()+movement.snapshot().heightM*displayScale;
    if(!blocksBody(camera.position,{feetY,height:1.85*displayScale,radius:.4*displayScale,colliders:plantedColliders,stepHeight:.12*displayScale}))return;
    const originBuilding=campusBuildings?getBuildingAt(camera.position,campusBuildings.buildings)?.id:null;
    // Budget changes can turn a preview into a solid while the viewer stands there.
    // Move only to a nearby free point in the same room/outdoor space.
    for(let ring=1;ring<=24;ring++)for(let index=0;index<16;index++){
      const distance=ring*.3*displayScale,angle=index*Math.PI/8,candidate=camera.position.clone();candidate.x+=Math.cos(angle)*distance;candidate.z+=Math.sin(angle)*distance;
      const nextBuilding=campusBuildings?getBuildingAt(candidate,campusBuildings.buildings)?.id:null;
      if(nextBuilding!==originBuilding||blocked(candidate,.4*displayScale,feetY))continue;
      camera.position.x=candidate.x;camera.position.z=candidate.z;onStatus('新确认的绿植占用了当前位置，已把视角移到旁边空地。');return;
    }
  }
  function setEnvironment(next={}){
    const numeric=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
    const azimuth=((numeric(next.sun?.azimuthDeg,environment.sun.azimuthDeg)%360)+360)%360,elevation=clamp(numeric(next.sun?.elevationDeg,environment.sun.elevationDeg),-90,90);
    const radiation=Math.max(0,numeric(next.radiationWm2,environment.radiationWm2)),cloud=clamp(numeric(next.cloudCoverPercent,environment.cloudCoverPercent),0,100);
    environment={sun:{azimuthDeg:azimuth,elevationDeg:elevation},radiationWm2:radiation,cloudCoverPercent:cloud};
    const az=azimuth*Math.PI/180,el=elevation*Math.PI/180,distance=100;
    // Compass azimuth: 0° north (-z), 90° east (+x). Light rays point toward its target at campus centre.
    sunlight.position.set(distance*Math.cos(el)*Math.sin(az),distance*Math.sin(el),-distance*Math.cos(el)*Math.cos(az));
    const daylight=elevation>0,visualRadiation=clamp(radiation/850,0,1.8);
    sunlight.intensity=daylight?2.7*visualRadiation:0;sunlight.shadow.radius=1+cloud*.035;
    hemisphere.intensity=daylight?1.5+cloud*.008+.58*Math.min(visualRadiation,1):.3;
    const sky=new THREE.Color(daylight?0xe9efe7:0x243248);if(daylight)sky.lerp(new THREE.Color(0xcbd5dc),cloud/100*.7);
    scene.background.copy(sky);scene.fog.color.copy(sky);sunlight.color.set(elevation>0&&elevation<15?0xffd8a4:0xfff3d6);
    container.dataset.sunAzimuthDeg=String(azimuth);container.dataset.sunElevationDeg=String(elevation);container.dataset.radiationWm2=String(radiation);container.dataset.cloudCoverPercent=String(cloud);
    dirty=true;return {...environment,sun:{...environment.sun}};
  }
  function syncLightCoverageVisibility(){
    coverageUniforms.uCampusCoverageEnabled.value=lightCoverageVisible&&lightCoverageAvailable?1:0;
    container.dataset.lightCoverageVisible=String(lightCoverageVisible);container.dataset.lightCoverage=lightCoverageNight?'night':!lightCoverageAvailable?'unavailable':lightCoverageVisible?'visible':'hidden';dirty=true;
  }
  function setLightCoverageVisible(visible){lightCoverageVisible=Boolean(visible);syncLightCoverageVisibility();}
  function setLightCoverage(map){
    const valid=map?.valid===true&&Number.isInteger(map.width)&&Number.isInteger(map.height)&&map.width>0&&map.height>0&&map.width*map.height<=16777216&&map.cells?.length===map.width*map.height&&map.rowOrder==='north-to-south'&&Number(map.mapWidth)>0&&Number(map.mapHeight)>0;
    lightCoverageNight=Boolean(map?.valid&&map?.night);lightCoverageAvailable=Boolean(valid&&!lightCoverageNight);
    if(!lightCoverageAvailable){lightCoverageTexture.image.data.fill(0);lightCoverageTexture.needsUpdate=true;syncLightCoverageVisibility();return false;}
    if(lightCoverageTexture.image.width!==map.width||lightCoverageTexture.image.height!==map.height){
      const previous=lightCoverageTexture;lightCoverageTexture=coverageTextureFor(map.width,map.height);coverageUniforms.uCampusCoverageMap.value=lightCoverageTexture;resources.delete(previous);previous.dispose();
    }
    // Source row zero is north. World z increases south, so v=0 is north with flipY=false.
    const data=lightCoverageTexture.image.data;for(let i=0;i<map.cells.length;i++)data.set(coveragePalette[map.cells[i]]||coveragePalette[0],i*4);
    coverageUniforms.uCampusCoverageWorldSize.value.set(Number(map.mapWidth)*UNIT,Number(map.mapHeight)*UNIT);lightCoverageTexture.needsUpdate=true;
    container.dataset.lightCoverageWidth=String(map.width);container.dataset.lightCoverageHeight=String(map.height);syncLightCoverageVisibility();return true;
  }
  function pedestrianPlayer(){return mode==='walk'?{x:camera.position.x,z:camera.position.z,feetY:surfaceHeight()+movement.snapshot().heightM*displayScale,height:1.85*displayScale,radius:.4*displayScale}:null;}
  function refreshPedestrianColliders(){
    pedestrianColliders=pedestrians.getColliders();solidColliders=[...staticColliders,...pedestrianColliders];
    const counts=new Map();let indoors=0;
    for(const actor of pedestrians.getStates()){
      if(!actor.active||!campusBuildings)continue;
      const building=getBuildingAt({x:actor.x,z:actor.z},campusBuildings.buildings);
      if(building&&actor.feetY+actor.height*.5<building.ceilingY){counts.set(building.name,(counts.get(building.name)||0)+1);indoors++;}
    }
    const locations={};for(const building of campusBuildings?.buildings||[])if(counts.has(building.name))locations[building.name]=counts.get(building.name);
    const summary={total:pedestrianColliders.length,indoors,locations},key=JSON.stringify(summary);
    container.dataset.pedestrianCount=String(summary.total);container.dataset.pedestriansIndoors=String(indoors);container.dataset.pedestrianLocations=indoors?Object.entries(locations).map(([name,count])=>`${name} ${count}`).join(' · '):summary.total?'全部室外':'暂无行人';
    if(key!==lastPedestriansSummary){lastPedestriansSummary=key;onPedestriansChange(summary);}
  }
  function syncPedestrians(){
    const enabled=pedestriansPreference&&!latest.image;pedestrians.setEnabled(enabled);
    if(enabled){
      // A newly funded tree/corridor can occupy an actor's former position.
      // Re-place only when necessary; other actors retain their current positions.
      const obstructed=pedestrians.getStates().some(actor=>actor.active&&blocksBody({x:actor.x,z:actor.z},{feetY:actor.feetY,height:actor.height,radius:actor.radius,colliders:staticColliders,stepHeight:.18}));
      if(obstructed){pedestrians.setEnabled(false);pedestrians.setEnabled(true);}
      pedestrians.update(0,{colliders:staticColliders,player:pedestrianPlayer()});
    }
    refreshPedestrianColliders();container.dataset.pedestriansEnabled=String(enabled);container.dataset.pedestrians=latest.image?'unavailable':enabled?'enabled':'disabled';dirty=true;return enabled;
  }
  function setPedestriansEnabled(enabled){pedestriansPreference=Boolean(enabled);return syncPedestrians();}
  function blocked(point,margin=.35*displayScale,feetWorld=surfaceHeight()){
    if(point.x<-48+margin||point.x>48-margin||point.z<-27.5+margin||point.z>27.5-margin)return true;
    return blocksBody(point,{feetY:feetWorld,height:1.85*displayScale,radius:margin,colliders:solidColliders,stepHeight:.12*displayScale});
  }
  function publishMovement(force=false){
    const current=movement.snapshot(),now=performance.now(),changed=current.state!==lastMovementState;
    if(force||changed||(now-lastMovementNotification>=100&&Math.abs(current.heightM-lastMovementHeight)>=.025)){
      container.dataset.movement=current.flying?'flying':current.grounded?'grounded':'airborne';container.dataset.heightMeters=current.heightM.toFixed(2);
      container.dataset.movementState=current.state;container.dataset.heightM=current.heightM.toFixed(2);
      lastMovementState=current.state;lastMovementHeight=current.heightM;lastMovementNotification=now;onMovementChange(current);
    }
    return current;
  }
  function publishLocation(){
    const building=mode==='walk'&&campusBuildings?getBuildingAt(camera.position,campusBuildings.buildings):null;
    const location=building&&camera.position.y<building.ceilingY?building.name:null;
    if(location!==lastLocation){lastLocation=location;container.dataset.location=location||'室外';onLocationChange(location);}
  }
  function jump(){if(mode!=='walk')return;movement.jump();publishMovement(true);dirty=true;}
  function toggleFlight(){
    if(mode!=='walk')return;const state=movement.toggleFlight();publishMovement(true);dirty=true;
    onStatus(state.flying?'飞行已开启：按住空格上升，Shift 下降；双击空格退出飞行。':'已退出飞行，正在自然下落；落地后可继续走动。');
  }
  function positionCamera(){
    if(mode==='orbit'){
      const radius=orbit.radius;camera.position.set(orbit.target.x+radius*Math.sin(orbit.phi)*Math.sin(orbit.theta),orbit.target.y+radius*Math.cos(orbit.phi),orbit.target.z+radius*Math.sin(orbit.phi)*Math.cos(orbit.theta));camera.lookAt(orbit.target);
    }else{camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);}
    dirty=true;
  }
  function fitView(){
    const aspect=Math.max(.35,container.clientWidth/Math.max(1,container.clientHeight));
    orbit={theta:.38,phi:.66,radius:Math.max(105,112/Math.min(aspect,1.7)),target:new THREE.Vector3(0,0,0)};
    if(mode==='orbit')positionCamera();
  }
  function setMode(next){
    if(!['orbit','walk'].includes(next)||next===mode)return;
    held.clear();movement.reset();mode=next;container.dataset.sceneMode=mode;ghost.visible=false;publishMovement(true);
    if(mode==='walk'){
      const points=latest.route.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));let spawn=toWorld(points[0]||{x:398,y:350}),target=toWorld(points[1]||{x:398,y:180});
      const direction=target.clone().sub(spawn).normalize();spawn.addScaledVector(direction,2.2*displayScale);
      if(blocked(spawn,.6*displayScale)){
        let found=false;for(let step=1;step<=13&&!found;step++){const radius=2*step*displayScale;for(let i=0;i<16;i++){const p=spawn.clone().add(new THREE.Vector3(Math.cos(i*Math.PI/8)*radius,0,Math.sin(i*Math.PI/8)*radius));if(!blocked(p,.6*displayScale)){spawn=p;found=true;break;}}}
        if(!found)spawn=toWorld({x:398,y:340});
      }
      camera.position.set(spawn.x,surfaceHeight()+1.7*displayScale,spawn.z);const look=target.clone().sub(spawn);yaw=Math.atan2(-look.x,-look.z);pitch=-.03;camera.fov=68;
      onStatus('漫游已开启：WASD / 方向键走动，空格跳跃，双击空格飞行；Esc 返回规划。');
    }else{camera.fov=44;onStatus('规划视角：拖动旋转，滚轮缩放；按住 Shift 拖动可平移。');}
    camera.updateProjectionMatrix();positionCamera();if(activeTool())aimEditingAtGround();syncPedestrians();onModeChange(mode);publishLocation();canvas.focus({preventScroll:true});
  }
  function enterBuilding(id){
    const building=campusBuildings?.buildings.find(b=>b.id===id);
    if(!building){onStatus('当前校园图没有可进入的示例建筑。');return false;}
    if(blocked(building.door.inside,.35*displayScale)){onStatus('当前比例下入口空间不足，请先核对校园比例。');return false;}
    if(mode!=='walk')setMode('walk');held.clear();movement.reset();
    camera.position.set(building.door.inside.x,building.floorY+1.7*displayScale,building.door.inside.z);
    const direction=new THREE.Vector3(building.center.x-camera.position.x,0,building.center.z-camera.position.z);yaw=Math.atan2(-direction.x,-direction.z);pitch=-.1;
    positionCamera();if(activeTool())aimEditingAtGround();publishMovement(true);publishLocation();canvas.focus({preventScroll:true});
    onStatus(`已进入${building.name}，可沿门洞自由进出，也可放置盆栽和标注室内路线。`);return true;
  }
  function activeTool(){return planting?'plant':routeEditing?'route':segmentEditing?'segment':null;}
  function aimEditingAtGround(){
    if(mode==='walk'){
      const desired=Math.atan2(Math.max(.01,camera.position.y-surfaceHeight()),3.5*displayScale);
      pitch=Math.min(pitch,-Math.max(.65,Math.min(1.5,desired)));positionCamera();
    }
    const rect=canvas.getBoundingClientRect();lastPointer={clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};ghostAt(lastPointer);
  }
  function syncEditingTool(){
    canvas.style.cursor=activeTool()?'crosshair':'grab';container.dataset.planting=String(planting);container.dataset.routeEditing=String(routeEditing);container.dataset.segmentEditing=String(segmentEditing);
    ghost.scale.setScalar(displayScale*(routeEditing||segmentEditing ? .3 : 1));ghost.visible=false;
    if(!activeTool()){container.dataset.pickState='inactive';delete container.dataset.pickMessage;}
    dirty=true;
  }
  function setPlanting(enabled){const entering=Boolean(enabled)&&!planting;planting=Boolean(enabled);if(planting){routeEditing=false;segmentEditing=false;}syncEditingTool();if(entering)aimEditingAtGround();else if(activeTool()&&lastPointer)ghostAt(lastPointer);}
  function setRouteEditing(enabled){const entering=Boolean(enabled)&&!routeEditing;routeEditing=Boolean(enabled);if(routeEditing){planting=false;segmentEditing=false;}syncEditingTool();if(entering)aimEditingAtGround();else if(activeTool()&&lastPointer)ghostAt(lastPointer);}
  function setSegmentEditing(enabled){const entering=Boolean(enabled)&&!segmentEditing;segmentEditing=Boolean(enabled);if(segmentEditing){planting=false;routeEditing=false;}syncEditingTool();if(entering)aimEditingAtGround();else if(activeTool()&&lastPointer)ghostAt(lastPointer);}
  function validatePlantPoint(mapPoint){
    const fail=(status,message)=>({valid:false,status,message:`这里无法种树：${message}`});
    if(!mapPoint||!Number.isFinite(mapPoint.x)||!Number.isFinite(mapPoint.y))return fail('no-ground','没有有效地面坐标，请换一个空着的地面位置。');
    if(mapPoint.x<0||mapPoint.x>MAP_W||mapPoint.y<0||mapPoint.y>MAP_H)return fail('out-of-bounds','该位置已超出校园图边界，请点击图内地面。');
    const point=toWorld(mapPoint),building=campusBuildings?getBuildingAt(point,campusBuildings.buildings):null,newRadius=(building ? .36 : .2)*displayScale;
    if(mapPoint.interior&&mapPoint.interior!==building?.name)return fail('wrong-interior','该位置不在所选室内空间，请重新选择。');
    const duplicate=latest.trees.some(tree=>{if(!Number.isFinite(tree.x)||!Number.isFinite(tree.y))return false;const p=toWorld(tree),radius=(tree.interior ? .36 : .2)*displayScale;return Math.hypot(p.x-point.x,p.z-point.z)<newRadius+radius+.08*displayScale;});
    if(duplicate)return fail('plant-overlap','该位置已经有一株绿植（含待建方案），请换个位置或先撤销原来的绿植。');
    const feetWorld=surfaceHeight()+movement.snapshot().heightM*displayScale,newTop=surfaceHeight()+(building?1.9:5.7)*displayScale;
    if(mode==='walk'&&feetWorld<newTop&&feetWorld+1.85*displayScale>surfaceHeight()&&Math.hypot(camera.position.x-point.x,camera.position.z-point.z)<newRadius+.45*displayScale)return fail('player-overlap','你正站在这个种植位置，请先往旁边移动，再放置绿植。');
    const radius=(building ? .45 : 1.3)*displayScale,height=(building?1.9:5.7)*displayScale;
    if(blocksBody(point,{feetY:surfaceHeight(),height,radius,colliders:pedestrianColliders,stepHeight:.05*displayScale}))return fail('pedestrian','该位置有行人经过，请稍候或换一个位置。');
    if(blocksBody(point,{feetY:surfaceHeight(),height,radius,colliders:solidColliders,stepHeight:.05*displayScale}))return fail('clearance',building?'该位置离绿植、墙或家具太近，请在室内空地放置盆栽。':'该位置有树木、建筑、棚顶或支柱，请在旁边空地种树。');
    return {valid:true,interior:building?.name};
  }
  function pickGroundCandidate(event){
    const rect=canvas.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return {status:'no-ground',message:'3D 画面尚未展开，请展开画面后再点击地面。'};
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    // A tool can be enabled before the next animation frame updates this matrix.
    camera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);
    const result=resolveGroundPick(raycaster.ray,{surfaceY:surfaceHeight(),buildings:[]});if(result.status!=='ready')return result;
    const distance=raycaster.ray.origin.distanceTo(result.point);
    const obstruction=buildingColliders.find(c=>c.kind!=='floor'&&(()=>{const d=rayColliderDistance(raycaster.ray.origin,raycaster.ray.direction,c);return d!==null&&d<distance-.002;})());
    if(obstruction){const building=campusBuildings.buildings.find(b=>b.id===obstruction.buildingId);return {...result,status:'building',message:obstruction.kind==='furniture'?'这里是室内家具，请点击旁边空着的地面。':`这里被${building?.name||'建筑'}的${obstruction.kind==='roof'?'屋顶':'墙体'}遮住，请从入口走入或换个角度选择地面。`};}
    const building=campusBuildings?getBuildingAt(result.point,campusBuildings.buildings):null;
    if(building)result.mapPoint.interior=building.name;
    if(planting){
      const validation=validatePlantPoint(result.mapPoint);if(!validation.valid)return {...result,status:validation.status,message:validation.message};
    }
    return result;
  }
  function pickGround(event){
    const result=pickGroundCandidate(event);
    if(planting&&result.status!=='ready'&&!result.message?.startsWith('这里无法种树：'))result.message=`这里无法种树：${(result.message||'请换一个空着的地面位置。').replace(/^这里/,'该位置')}`;
    return result;
  }
  function ghostAt(event){
    if(!activeTool())return;const hit=pickGround(event);container.dataset.pickState=hit.status;container.dataset.pickMessage=hit.message||'';
    if(!hit.point){ghostMaterial.color.set(0xd18454);dirty=true;return;}
    if(hit.status==='out-of-bounds'){ghost.position.set(clamp(hit.point.x,-49,49),surfaceHeight()+.02*displayScale,clamp(hit.point.z,-28.5,28.5));ghost.visible=true;ghostMaterial.color.set(0xd18454);dirty=true;return;}
    ghost.scale.setScalar(displayScale*(routeEditing||segmentEditing ? .3 : hit.mapPoint?.interior ? .35 : 1));ghost.position.set(hit.point.x,surfaceHeight()+.02*displayScale,hit.point.z);ghost.visible=true;ghostMaterial.color.set(hit.status==='ready'?(routeEditing||segmentEditing?0x2f7796:0x3c8554):0xd18454);dirty=true;
  }
  function routePassesThroughSolid(start,end){
    const a=toWorld(start),b=toWorld(end);a.y=surfaceHeight()+.02*displayScale;b.y=a.y;const length=a.distanceTo(b);if(length<1e-7)return false;
    const direction=b.clone().sub(a).divideScalar(length),radius=.3*displayScale,height=1.85*displayScale;
    return staticColliders.some(c=>{
      if(c.kind==='floor'||c.kind==='corridor-floor')return false;
      const expanded=c.cx===undefined?{...c,minX:c.minX-radius,maxX:c.maxX+radius,minZ:c.minZ-radius,maxZ:c.maxZ+radius,minY:c.minY-height}:{...c,halfWidth:c.halfWidth+radius,halfDepth:c.halfDepth+radius,minY:c.minY-height};
      const distance=rayColliderDistance(a,direction,expanded);return distance!==null&&distance<=length+1e-7;
    });
  }
  function validateRoute(points){
    if(!Array.isArray(points)||points.length<2)return {valid:false,message:'请至少选择两个不同的路径点。'};
    const space=points[0]?.interior||null;let hasLength=false;
    for(let i=0;i<points.length;i++){
      const point=points[i];if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return {valid:false,message:'路径中有无效坐标，请重新选择经过点。'};
      if(point.x<0||point.x>MAP_W||point.y<0||point.y>MAP_H)return {valid:false,message:'路径超出校园图边界，请把经过点选得靠近起终点一些。'};
      if((point.interior||null)!==space)return {valid:false,message:'室内和室外请分别规划，所有路径点需在同一空间内。'};
      const actualSpace=campusBuildings?getBuildingAt(toWorld(point),campusBuildings.buildings)?.name||null:null;
      if(actualSpace!==space)return {valid:false,message:'这条路径穿入建筑或跨越了室内外边界，请在同一空间内调整经过点。'};
      if(i>0){
        if(Math.hypot(point.x-points[i-1].x,point.y-points[i-1].y)>1e-7)hasLength=true;
        if(routePassesThroughSolid(points[i-1],point))return {valid:false,message:'这条路径会穿过墙体、家具、树木或支柱，请调整经过点绕开障碍。'};
      }
    }
    return hasLength?{valid:true}:{valid:false,message:'请至少选择两个不同的路径点。'};
  }
  function pointerDown(event){
    canvas.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);
    if(pointers.size===2){const points=[...pointers.values()];pinchDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);if(drag)drag.moved=true;return;}
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,pan:event.button===2||event.shiftKey,button:event.button,tool:activeTool()};
  }
  function pointerMove(event){
    lastPointer={clientX:event.clientX,clientY:event.clientY};ghostAt(lastPointer);if(!pointers.has(event.pointerId)||!drag)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){const points=[...pointers.values()],distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);if(mode==='orbit'&&pinchDistance>0)zoom(pinchDistance/distance);pinchDistance=distance;drag.moved=true;return;}
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>5)drag.moved=true;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.moved)return;
    if(mode==='orbit'){
      if(drag.pan){const speed=orbit.radius*.0015;orbit.target.x+=(-dx*Math.cos(orbit.theta)-dy*Math.sin(orbit.theta))*speed;orbit.target.z+=(dx*Math.sin(orbit.theta)-dy*Math.cos(orbit.theta))*speed;orbit.target.x=clamp(orbit.target.x,-60,60);orbit.target.z=clamp(orbit.target.z,-40,40);}
      else{orbit.theta-=dx*.006;orbit.phi=clamp(orbit.phi-dy*.006,.14,1.42);}
    }else{yaw-=dx*.004;pitch=clamp(pitch-dy*.004,-1.5,1.25);}
    positionCamera();
  }
  function pointerUp(event){
    pointers.delete(event.pointerId);if(drag?.id===event.pointerId){
      const isClick=event.button===0&&drag.button===0&&!drag.pan&&!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<=5&&pointers.size===0&&drag.tool===activeTool();
      if(isClick&&activeTool()){
        const hit=pickGround(event);lastPointer={clientX:event.clientX,clientY:event.clientY};ghostAt(lastPointer);
        if(hit.status!=='ready')onStatus(hit.message);
        else if(planting)onPlant(hit.mapPoint);
        else if(segmentEditing)onRouteSplit(hit.mapPoint);
        else if(routeEditing){if(latest.routeShape!=='curve'&&latest.route.length&&routePassesThroughSolid(latest.route.at(-1),hit.mapPoint))onStatus('这一段路径会穿过墙体、家具、树木或支柱，请换一个能直达的位置。');else onRoutePoint(hit.mapPoint);}
      }
      drag=null;
    }
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  }
  function pointerCancel(event){pointers.delete(event.pointerId);if(drag?.id===event.pointerId)drag=null;ghost.visible=false;dirty=true;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
  function wheel(event){event.preventDefault();if(mode==='orbit')zoom(Math.exp(event.deltaY*.001));}
  function zoom(factor){if(mode!=='orbit'||!Number.isFinite(factor)||factor<=0)return;orbit.radius=clamp(orbit.radius*factor,8,240);positionCamera();}
  const keyDirections={KeyW:'forward',ArrowUp:'forward',KeyS:'backward',ArrowDown:'backward',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
  function keyDown(event){
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.target.isContentEditable)return;
    if(event.code==='Escape'){setPlanting(false);setRouteEditing(false);setSegmentEditing(false);if(mode==='walk')setMode('orbit');else onStatus('已退出编辑工具，可拖动查看校园。');container.dispatchEvent(new CustomEvent('campus-escape'));return;}
    if(mode==='walk'&&event.code==='Space'){
      event.preventDefault();held.add('space');const before=movement.snapshot();const after=movement.spaceDown(performance.now(),{repeat:event.repeat});publishMovement(true);dirty=true;
      if(before.flying!==after.flying)onStatus(after.flying?'飞行已开启：按住空格上升，Shift 下降；双击空格退出飞行。':'已退出飞行，正在自然下落；落地后可继续走动。');
      return;
    }
    if(mode==='walk'&&['ShiftLeft','ShiftRight'].includes(event.code)){held.add(event.code);return;}
    if(mode==='walk'&&keyDirections[event.code]){event.preventDefault();held.add(keyDirections[event.code]);}
  }
  function keyUp(event){if(keyDirections[event.code])held.delete(keyDirections[event.code]);if(event.code==='Space')held.delete('space');if(['ShiftLeft','ShiftRight'].includes(event.code))held.delete(event.code);}
  function move(direction,pressed){const aliases={back:'backward'};direction=aliases[direction]||direction;if(['forward','backward','left','right','up','down'].includes(direction)){if(pressed)held.add(direction);else held.delete(direction);}}
  function resize(){const w=container.clientWidth,h=container.clientHeight;if(w<=0||h<=0)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;}
  function update(next={}){
    latest={...latest,...next};latest.route=Array.isArray(latest.route)?latest.route:[];latest.trees=Array.isArray(latest.trees)?latest.trees:[];
    const mpp=Number(latest.metersPerPixel)>0&&Number.isFinite(Number(latest.metersPerPixel))?Number(latest.metersPerPixel):.1;
    displayScale=safeDisplayScale(mpp);ghost.scale.setScalar(displayScale*(routeEditing||segmentEditing ? .3 : 1));
    camera.near=Math.max(.000001,Math.min(.08,.04*displayScale));camera.far=Math.max(500,displayScale*30);camera.updateProjectionMatrix();
    if(mode==='walk')camera.position.y=surfaceHeight()+(1.7+movement.snapshot().heightM)*displayScale;
    const protectedScale=displayScale!==UNIT/mpp;if(protectedScale&&!scaleWarning)onStatus('尺寸跨度很大，3D 使用可见的示意比例；路径长度与预算仍按输入计算。');scaleWarning=protectedScale;
    if(imageKey!==latest.image){imageKey=latest.image;buildBase(latest.image);}
    rebuildRoute();rebuildTrees();syncPedestrians();dirty=true;
  }
  function blur(){held.clear();pointers.clear();drag=null;movement.clearTap();}
  const events=[['pointerdown',pointerDown],['pointermove',pointerMove],['pointerup',pointerUp],['pointercancel',pointerCancel],['lostpointercapture',pointerCancel],['pointerleave',()=>{ghost.visible=false;lastPointer=null;dirty=true;}],['contextmenu',event=>event.preventDefault()],['wheel',wheel]];
  events.forEach(([name,fn])=>canvas.addEventListener(name,fn,{passive:false}));window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',blur);
  const observer=new ResizeObserver(resize);observer.observe(container);
  function frame(now){
    if(disposed)return;const dt=Math.min(.06,(now-lastFrame)/1000);lastFrame=now;
    if(pedestriansPreference&&!latest.image){if(pedestrians.update(dt,{colliders:staticColliders,player:pedestrianPlayer()}))dirty=true;refreshPedestrianColliders();}
    if(mode==='walk'){
      const before=movement.snapshot();
      if(held.size){
        const forward=(held.has('forward')?1:0)-(held.has('backward')?1:0),side=(held.has('right')?1:0)-(held.has('left')?1:0),norm=Math.hypot(forward,side)||1;
        const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*dt*5*displayScale/norm,dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*dt*5*displayScale/norm;
        const feetWorld=surfaceHeight()+before.heightM*displayScale,candidate=camera.position.clone();candidate.x+=dx;if(!blocked(candidate,.4*displayScale,feetWorld))camera.position.x=candidate.x;candidate.copy(camera.position);candidate.z+=dz;if(!blocked(candidate,.4*displayScale,feetWorld))camera.position.z=candidate.z;
        if(dx||dz)dirty=true;
      }
      const feetWorld=surfaceHeight()+before.heightM*displayScale,limits=verticalLimits(camera.position,{feetY:feetWorld,height:1.85*displayScale,radius:.3*displayScale,baseY:surfaceHeight(),colliders:solidColliders,stepHeight:.12*displayScale});
      const floorM=Math.max(0,(limits.floorY-surfaceHeight())/displayScale),ceilingM=(limits.ceilingFeetY-surfaceHeight())/displayScale;
      const after=movement.advance(dt,{up:held.has('up')||held.has('space'),down:held.has('down')||held.has('ShiftLeft')||held.has('ShiftRight'),floorM,ceilingM});
      camera.position.y=surfaceHeight()+(1.7+after.heightM)*displayScale;
      if(before.heightM!==after.heightM||before.state!==after.state)dirty=true;
      publishMovement();publishLocation();
    }
    if(dirty&&container.clientWidth&&container.clientHeight){if(activeTool()&&lastPointer)ghostAt(lastPointer);renderer.render(scene,camera);dirty=false;}
    requestAnimationFrame(frame);
  }
  function resetView(){if(mode==='walk')setMode('orbit');fitView();}
  function capture(){renderer.render(scene,camera);return canvas.toDataURL('image/png');}
  function dispose(){disposed=true;imageGeneration++;observer.disconnect();events.forEach(([name,fn])=>canvas.removeEventListener(name,fn));window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);[baseGroup,routeGroup,treeGroup].forEach(clearGroup);campusBuildings?.dispose();pedestrians.dispose();resources.forEach(resource=>resource.dispose());labelTextures.forEach(texture=>texture.dispose());renderer.dispose();canvas.remove();}
  resize();fitView();update();publishMovement(true);syncLightCoverageVisibility();requestAnimationFrame(frame);
  return {update,setEnvironment,setLightCoverage,setLightCoverageVisible,setPedestriansEnabled,setMode,setPlanting,setRouteEditing,setSegmentEditing,validatePlantPoint,validateRoute,enterBuilding,resetView,move,jump,toggleFlight,zoom,resize,capture,dispose};
}
