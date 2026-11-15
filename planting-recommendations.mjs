import {calculateTreeBudget} from './budget.mjs';
import {polylineLength,slicePolyline} from './geometry.mjs';
import {SAMPLE_BUILDINGS} from './campus-buildings.mjs';

const WIDTH=980,HEIGHT=570,GRID_STEP=5;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=value=>Math.round(value*100)/100;
const finitePoint=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
// Keep the baseline consistent with scene3d.mjs. The input trees are NEW plants.
const EXISTING_TREES=[[70,70,19],[113,64,15],[161,70,18],[211,63,13],[268,72,21],[320,69,16],[57,164,19],[53,214,16],[97,329,15],[147,327,19],[201,328,18],[258,328,17],[290,405,15],[289,458,17],[283,512,17],[60,512,18],[108,525,19],[162,523,16],[213,523,15],[451,117,14],[451,163,15],[451,216,15],[451,269,17],[489,309,16],[536,308,17],[583,308,15],[632,308,14],[744,479,20],[789,482,17],[840,480,20],[903,483,17],[924,321,16],[926,367,18],[926,416,17],[909,142,17],[908,194,16],[909,248,16]];
const inBuilding=p=>SAMPLE_BUILDINGS.some(b=>p.x>b.x&&p.x<b.x+b.w&&p.y>b.y&&p.y<b.y+b.d);
const inMap=p=>finitePoint(p)&&p.x>=0&&p.x<=WIDTH&&p.y>=0&&p.y<=HEIGHT;

function environmentError(environment){
  if(!Number.isFinite(environment?.temperatureC)||!Number.isFinite(environment?.radiationWm2)||environment.radiationWm2<0)return '请提供有效的模拟温度和非负光照强度。';
  const sun=environment.sun;
  if(!Number.isFinite(sun?.azimuthDeg)||sun.azimuthDeg<0||sun.azimuthDeg>360||!Number.isFinite(sun?.elevationDeg)||sun.elevationDeg<-90||sun.elevationDeg>90)return '请提供有效太阳位置：方位 0–360°、高度 -90–90°。';
  return null;
}

function convexHull(points){
  points=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const lower=[],upper=[];
  for(const p of points){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
}
function polygon(points){
  const vertices=convexHull(points);
  return {kind:'polygon',vertices,minX:Math.min(...vertices.map(p=>p.x)),maxX:Math.max(...vertices.map(p=>p.x)),minY:Math.min(...vertices.map(p=>p.y)),maxY:Math.max(...vertices.map(p=>p.y))};
}
function projectBox({cx,cy,halfX,halfY,ux=1,uy=0,minZ=0,maxZ},sun){
  const points=[];
  for(const a of [-1,1])for(const b of [-1,1])for(const z of [minZ,maxZ])points.push({x:cx+a*halfX*ux-b*halfY*uy-z*sun.x,y:cy+a*halfX*uy+b*halfY*ux-z*sun.y});
  return polygon(points);
}
// Orthogonal projection of the two scene ellipsoids onto the ground along
// the sunlight direction. This is an analytic smooth-crown approximation of
// the scene's low-poly opaque crowns, not measured leaf transmissivity.
function projectCrown({x,y,z,rx,ry,rz},sun){
  const a=rx*rx+rz*rz*sun.x*sun.x,b=rz*rz*sun.x*sun.y,c=ry*ry+rz*rz*sun.y*sun.y;
  // Expanded determinant avoids cancellation for a sun close to the horizon.
  const det=rx*rx*ry*ry+rz*rz*(rx*rx*sun.y*sun.y+ry*ry*sun.x*sun.x);
  const cx=x-z*sun.x,cy=y-z*sun.y,ex=Math.sqrt(a),ey=Math.sqrt(c);
  return {kind:'ellipse',cx,cy,invXX:c/det,invXY:-b/det,invYY:a/det,minX:cx-ex,maxX:cx+ex,minY:cy-ey,maxY:cy+ey};
}
function projectTree(x,y,r,sun,{baseZ=0,trunkRadius=.2,topRadius=.12}={}){
  const crowns=[
    projectCrown({x,y,z:baseZ+r*2.1,rx:r,ry:r,rz:r*1.12},sun),
    projectCrown({x:x+r*.5,y:y-r*.15,z:baseZ+r*2.8,rx:r*.64,ry:r*.65,rz:r*.68},sun),
  ];
  const trunk=[];
  for(const [z,radius] of [[Math.max(0,baseZ),trunkRadius],[baseZ+r*1.8,topRadius]])for(let i=0;i<12;i++){const angle=i*Math.PI/6;trunk.push({x:x+Math.cos(angle)*radius-z*sun.x,y:y+Math.sin(angle)*radius-z*sun.y});}
  return [...crowns,polygon(trunk)];
}
function contains(shape,p){
  if(p.x<shape.minX||p.x>shape.maxX||p.y<shape.minY||p.y>shape.maxY)return false;
  if(shape.kind==='ellipse'){const x=p.x-shape.cx,y=p.y-shape.cy;return x*x*shape.invXX+2*x*y*shape.invXY+y*y*shape.invYY<=1+1e-10;}
  const vertices=shape.vertices;
  for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];if((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)<-1e-8)return false;}
  return vertices.length>=3;
}
function canopyShadows(route,plan,metersPerPixel,sun){
  const total=polylineLength(route);
  if(!plan?.valid||plan.layoutOnly||!total||route.some(p=>p.interior)||!Number.isFinite(plan.widthM)||plan.widthM<=0)return [];
  // A mixed route can have planted-only gaps and unfunded sections. Project
  // each financed roof at its actual position, never a combined prefix.
  if(plan.type==='mixed')return (plan.sections||[]).flatMap(section=>{
    if(!['mesh','solid','corridor'].includes(section.type))return [];
    const start=section.startFraction,end=Math.min(section.endFraction,section.fundedEndFraction);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start)return [];
    const portion=slicePolyline(route,start,end);
    return portion?canopyShadows(portion,{valid:true,type:section.type,widthM:plan.widthM,coveragePercent:100},metersPerPixel,sun):[];
  });
  if(plan.type==='plants')return [];
  let remaining=total*clamp(Number(plan.coveragePercent)/100||0,0,1);
  const shapes=[],corridor=plan.type==='corridor';
  for(let i=1;i<route.length&&remaining>0;i++){
    const a=route[i-1],b=route[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!length)continue;
    const built=Math.min(remaining,length),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
    shapes.push(projectBox({cx:a.x+ux*built/2,cy:a.y+uy*built/2,halfX:(built+.07/metersPerPixel)/2,halfY:(plan.widthM+(corridor?1.10:.28))/metersPerPixel/2,ux,uy,minZ:(corridor?3.53:3.435)/metersPerPixel,maxZ:(corridor?3.77:3.565)/metersPerPixel},sun));
    remaining-=built;
  }
  return shapes;
}
function baselineShapes({useSampleObstacles,currentRoute,plan,metersPerPixel,sun}){
  const shapes=canopyShadows(currentRoute,plan,metersPerPixel,sun);
  if(useSampleObstacles){
    for(const b of SAMPLE_BUILDINGS)shapes.push(projectBox({cx:b.x+b.w/2,cy:b.y+b.d/2,halfX:b.w/2,halfY:b.d/2,maxZ:(b.h+.3-.145)/.1},sun));
    for(const [x,y,r] of EXISTING_TREES)shapes.push(...projectTree(x,y,r,sun,{baseZ:-1.45,trunkRadius:2,topRadius:1.2}));
  }
  return shapes;
}

// Ground points and their denominator are FIXED before planting. Newly planted
// tree bases do not remove ground points and inflate the apparent improvement.
const GRID_CACHE=new Map();
function groundGrid(useSampleObstacles){
  if(GRID_CACHE.has(useSampleObstacles))return GRID_CACHE.get(useSampleObstacles);
  const points=[],indices=new Int32Array(WIDTH/GRID_STEP*HEIGHT/GRID_STEP).fill(-1);
  const columns=WIDTH/GRID_STEP,rows=HEIGHT/GRID_STEP;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const point={x:(column+.5)*GRID_STEP,y:(row+.5)*GRID_STEP};if(useSampleObstacles&&inBuilding(point))continue;
    indices[row*columns+column]=points.length;points.push(point);
  }
  const grid={points,indices,columns,rows};GRID_CACHE.set(useSampleObstacles,grid);return grid;
}
function markShapes(shapes,sampling){
  const mask=new Uint8Array(sampling.points.length);
  if(sampling.indices){
    for(const shape of shapes){
      const left=clamp(Math.floor(shape.minX/GRID_STEP),0,sampling.columns-1),right=clamp(Math.floor(shape.maxX/GRID_STEP),0,sampling.columns-1);
      const top=clamp(Math.floor(shape.minY/GRID_STEP),0,sampling.rows-1),bottom=clamp(Math.floor(shape.maxY/GRID_STEP),0,sampling.rows-1);
      for(let row=top;row<=bottom;row++)for(let column=left;column<=right;column++){
        const i=sampling.indices[row*sampling.columns+column];if(i>=0&&!mask[i]&&contains(shape,sampling.points[i]))mask[i]=1;
      }
    }
  }else for(let i=0;i<sampling.points.length;i++)if(shapes.some(shape=>contains(shape,sampling.points[i])))mask[i]=1;
  return mask;
}
function routeSampling(route,useSampleObstacles){
  const length=polylineLength(route);
  if(!length||route.some(p=>p.interior)||route.some(p=>!inMap(p)))return null;
  const count=clamp(Math.ceil(length/1.5),80,600),points=[];
  let segment=1,cumulative=0;
  for(let i=0;i<count;i++){
    const distance=(i+.5)*length/count;
    while(segment<route.length-1&&cumulative+Math.hypot(route[segment].x-route[segment-1].x,route[segment].y-route[segment-1].y)<distance){cumulative+=Math.hypot(route[segment].x-route[segment-1].x,route[segment].y-route[segment-1].y);segment++;}
    const a=route[segment-1],b=route[segment],span=Math.hypot(b.x-a.x,b.y-a.y),fraction=span?(distance-cumulative)/span:0;
    const p={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};if(useSampleObstacles&&inBuilding(p))return null;
    points.push(p);
  }
  return {points};
}
function scopeInfo(scope,useSampleObstacles){
  return {scope,label:scope==='route'?'当前室外路线':useSampleObstacles?'校园室外地面（排除建筑占地）':'上传图室外地面假设范围',assumptions:useSampleObstacles?'按示例建筑、既有树和已建棚顶估算；树冠为不透光椭球示意。':'上传图未识别实际建筑和既有树，按整幅图为室外平地估算；树冠为不透光椭球示意。'};
}
function emptyCoverage(reason,{scope='campus',useSampleObstacles=true,valid=false,sampleCount=0,night=false}={}){
  return {...scopeInfo(scope,useSampleObstacles),valid,directSunPercent:night?0:null,shadePercent:null,baselineShadePercent:null,addedTreeShadePercent:night?0:null,sampleCount,reason};
}
// Each returned raster owns its storage. Neither callers nor a renderer can
// mutate the cached point/index grid, or a later evaluation, through cells.
function coverageRaster(sampling,{baseline,counts,night=false}={}){
  const cells=new Uint8Array(sampling.columns*sampling.rows);
  if(!night)for(let cell=0;cell<cells.length;cell++){
    const i=sampling.indices[cell];
    if(i>=0)cells[cell]=baseline[i]?2:counts[i]?3:1;
  }
  return {width:sampling.columns,height:sampling.rows,mapWidth:WIDTH,mapHeight:HEIGHT,cells,rowOrder:'north-to-south',valid:true,night};
}
function measure(sampling,baseShapes,newShapes,{scope,useSampleObstacles,includeCoverageMap=false}){
  const baseline=markShapes(baseShapes,sampling),counts=new Uint32Array(sampling.points.length),masks=newShapes.map(shapes=>markShapes(shapes,sampling));
  for(const mask of masks)for(let i=0;i<mask.length;i++)if(mask[i])counts[i]++;
  let baseCount=0,shadeCount=0;
  for(let i=0;i<baseline.length;i++){baseCount+=baseline[i];if(baseline[i]||counts[i])shadeCount++;}
  const treeStats=masks.map(mask=>{
    let total=0,potential=0,unique=0;
    for(let i=0;i<mask.length;i++)if(mask[i]){total++;if(!baseline[i]){potential++;if(counts[i]===1)unique++;}}
    return {total,potential,unique};
  });
  const n=baseline.length;
  const coverage={...scopeInfo(scope,useSampleObstacles),valid:true,directSunPercent:round((n-shadeCount)/n*100),shadePercent:round(shadeCount/n*100),baselineShadePercent:round(baseCount/n*100),addedTreeShadePercent:round((shadeCount-baseCount)/n*100),sampleCount:n,reason:`${n} 个固定地面采样点；新植树阴影取并集，与同一建筑、既有树和已建棚架基线比较，重叠不重复计入。几何遮阴比例不代表实测照度或降温幅度。`};
  return {coverage,treeStats,coverageMap:includeCoverageMap?coverageRaster(sampling,{baseline,counts}):null};
}

/**
 * Pure demonstration assessment. Scores are explainable planning rules, NOT
 * botanical suitability, climate measurements, or probabilities. No route is
 * required. A missing scale never silently becomes the sample campus scale.
 * Optional coverageMap reuses the exact percentage samples: 0=excluded,
 * 1=direct sun, 2=baseline shade, 3=net new-tree shade. Rows run north to south.
 * Night returns an empty raster; invalid input returns coverageMap:null.
 */
export function evaluatePlanting({trees=[],environment,budgetInput,metersPerPixel,useSampleObstacles=true,currentRoute=[],plan=null,includeCoverageMap=false}={}){
  const placed=Array.isArray(trees)?trees.filter(tree=>tree&&!tree.removed):[];
  const fail=reason=>({valid:false,score:null,reasons:[reason],trees:placed.map((tree,i)=>({id:tree.id??`tree-${i}`,score:null,reason,reasons:[reason],funded:tree.funded,interior:Boolean(tree.interior)})),coverage:emptyCoverage(reason,{useSampleObstacles}),routeCoverage:null,coverageMap:null});
  if(!Array.isArray(trees))return fail('绿植位置数据无效。');
  const invalidEnvironment=environmentError(environment);if(invalidEnvironment)return fail(invalidEnvironment);
  const treeBudget=calculateTreeBudget({...budgetInput,treesCount:placed.length});if(!treeBudget.valid)return fail(treeBudget.error);
  if(!Number.isFinite(metersPerPixel)||metersPerPixel<=0)return fail('请先校准图纸比例，才能计算树冠大小、种植推荐度和光照覆盖率。预算仍按实际绿植数量计算。');
  if(!Number.isFinite(1.65/metersPerPixel))return fail('图纸比例过小，无法稳定表示树冠尺寸，请重新校准。');
  const route=Array.isArray(currentRoute)?currentRoute:[],grid=groundGrid(useSampleObstacles),routePoints=routeSampling(route,useSampleObstacles);
  const isNight=environment.sun.elevationDeg<=0||environment.radiationWm2===0;
  const funded=placed.map((tree,i)=>i<treeBudget.fundedTrees&&tree.funded!==false);
  const usable=placed.map(tree=>!tree.interior&&inMap(tree)&&(!useSampleObstacles||!inBuilding(tree)));
  let coverage,routeCoverage=null,coverageMap=null,stats=placed.map(()=>({total:0,potential:0,unique:0}));
  if(isNight){
    const reason='当前没有直射日光，直射比例为 0；遮阴率不适用，不能把夜间变暗归功于新增树木。';
    coverage=emptyCoverage(reason,{useSampleObstacles,valid:true,sampleCount:grid.points.length,night:true});
    if(includeCoverageMap)coverageMap=coverageRaster(grid,{night:true});
    if(routePoints)routeCoverage=emptyCoverage(reason,{scope:'route',useSampleObstacles,valid:true,sampleCount:routePoints.points.length,night:true});
  }else{
    const az=environment.sun.azimuthDeg*Math.PI/180,el=environment.sun.elevationDeg*Math.PI/180;
    const sun={x:Math.sin(az)/Math.tan(el),y:-Math.cos(az)/Math.tan(el)};
    const base=baselineShapes({useSampleObstacles,currentRoute:route,plan,metersPerPixel,sun});
    const newShapes=placed.map((tree,i)=>funded[i]&&usable[i]?projectTree(tree.x,tree.y,1.65/metersPerPixel,sun,{trunkRadius:.2/metersPerPixel,topRadius:.12/metersPerPixel}):[]);
    if([...base,...newShapes.flat()].some(shape=>![shape.minX,shape.maxX,shape.minY,shape.maxY].every(Number.isFinite)||(shape.kind==='ellipse'&&(![shape.invXX,shape.invXY,shape.invYY].every(Number.isFinite)||shape.invXX<=0||shape.invYY<=0))))return fail('当前比例或太阳位置使阴影超出数值计算范围，请更新有效的比例与环境。');
    const measured=measure(grid,base,newShapes,{scope:'campus',useSampleObstacles,includeCoverageMap});coverage=measured.coverage;stats=measured.treeStats;coverageMap=measured.coverageMap;
    if(routePoints)routeCoverage=measure(routePoints,base,newShapes,{scope:'route',useSampleObstacles}).coverage;
  }
  const heat=clamp((environment.temperatureC-22)/14,0,1),light=clamp(environment.radiationWm2/800,0,1),need=(.45+.55*heat)*light;
  const assessed=placed.map((tree,i)=>{
    const reasons=[],interior=Boolean(tree.interior),stat=stats[i];let score=0;
    if(!inMap(tree))reasons.push('位置不在有效图纸范围内，请重新放置。');
    else if(!funded[i])reasons.push('当前预算未资助这株绿植，仍为待建状态，不计入新增遮阴。');
    else if(interior){score=65;reasons.push('室内绿植的预算已落实，给予室内布置基础推荐度；不计入室外遮阴。','未获得窗边光照、通风、植物品种与养护数据，不能据此判定植物生长适宜性。');}
    else if(!usable[i])reasons.push('位置处于示例建筑占地内，应改为室内盆栽或移到室外空地。');
    else if(isNight)reasons.push('当前没有直射日光，新增室外遮阳需求为 0；请切换白天观察种植收益。');
    else if(!stat.total)reasons.push('这株树的阴影未覆盖统计范围中的采样点，暂无法显示可辨认的遮阴收益；靠近图边或投影小于采样间距时会出现此情况。');
    else{
      const exposed=stat.potential/stat.total,unique=stat.potential?stat.unique/stat.potential:0;
      score=stat.potential?Math.round(100*need*exposed*(.4+.6*unique)):0;
      reasons.push(`当前 ${environment.temperatureC.toFixed(1)}℃、${Math.round(environment.radiationWm2)} W/m²；${need>=.6?'高温强光提高遮阳优先级':'当前遮阳需求较低'}。`);
      if(!stat.potential)reasons.push('这株树的投影已被建筑、既有树或棚架遮住，未形成额外地面遮阴。');
      else reasons.push(`其投影中约 ${Math.round(exposed*100)}% 落在原本受直射的室外地面；其中约 ${Math.round((1-unique)*100)}% 与其他新植树阴影重叠。`,`移除这一株会单独减少约 ${round(stat.unique/grid.points.length*100)} 个百分点的校区遮阴覆盖。`);
      reasons.push('本株费用在预算内；评分只反映当前示意遮阳收益，不代表树种适宜性。');
    }
    return {id:tree.id??`tree-${i}`,score:clamp(score,0,100),reason:reasons.join(' '),reasons,funded:funded[i],interior};
  });
  const score=assessed.length?Math.round(assessed.reduce((sum,tree)=>sum+tree.score,0)/assessed.length):null;
  const reasons=[placed.length?`共 ${placed.length} 株绿植，${funded.filter(Boolean).length} 株已安排预算；总推荐度为各株规则评分的平均值。`:'尚未放置绿植，当前显示建筑、既有树和已建棚架的基线覆盖。',coverage.assumptions,'推荐度是当前模拟规则分，不代表实测降温或植物生长适宜性。'];
  if(treeBudget.unfundedTrees)reasons.push(`预算尚不能覆盖 ${treeBudget.unfundedTrees} 株绿植，待建绿植不产生遮阴收益。`);
  return {valid:true,score,reasons,trees:assessed,coverage,routeCoverage,coverageMap};
}
