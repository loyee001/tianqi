import {calculatePlan} from './budget.mjs';
import {deriveRouteLength,polylineLength,slicePolyline,SAMPLE_METERS_PER_PIXEL} from './geometry.mjs';
import {SAMPLE_BUILDINGS} from './campus-buildings.mjs';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const rad=value=>value*Math.PI/180;
const point=(x,y)=>({x,y});
// These are example outdoor corridors, not inferred from an uploaded picture.
export const SAMPLE_CANDIDATES=Object.freeze([
  {id:'teaching-canteen',from:'教学楼门外',to:'食堂门外',route:[point(316,181),point(398,181),point(398,370),point(681,370)]},
  {id:'library-teaching',from:'图书馆门外',to:'教学楼门外',route:[point(260,433),point(330,433),point(330,290),point(398,290),point(398,181),point(316,181)]},
  {id:'library-canteen',from:'图书馆门外',to:'食堂门外',route:[point(260,433),point(330,433),point(330,290),point(398,290),point(398,370),point(681,370)]},
  {id:'activity-canteen',from:'活动室门外',to:'食堂门外',route:[point(566,442),point(566,370),point(681,370)]},
].map(c=>Object.freeze({...c,route:Object.freeze(c.route.map(p=>Object.freeze(p)))})));

// Existing crowns copied from the example scene; heights/crowns are illustrative.
const EXISTING_CROWNS=[[70,70,19],[113,64,15],[161,70,18],[211,63,13],[268,72,21],[320,69,16],[57,164,19],[53,214,16],[97,329,15],[147,327,19],[201,328,18],[258,328,17],[290,405,15],[289,458,17],[283,512,17],[60,512,18],[108,525,19],[162,523,16],[213,523,15],[451,117,14],[451,163,15],[451,216,15],[451,269,17],[489,309,16],[536,308,17],[583,308,15],[632,308,14],[744,479,20],[789,482,17],[840,480,20],[903,483,17],[924,321,16],[926,367,18],[926,416,17],[909,142,17],[908,194,16],[909,248,16]];
const samePoint=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-8;

function rayBox(origin,direction,box){
  let near=0,far=Infinity;
  for(const axis of ['x','y','z']){
    const min=box['min'+axis.toUpperCase()],max=box['max'+axis.toUpperCase()],v=direction[axis];
    if(Math.abs(v)<1e-10){if(origin[axis]<min||origin[axis]>max)return false;continue;}
    let a=(min-origin[axis])/v,b=(max-origin[axis])/v;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return false;
  }
  return far>1e-7;
}
function rayCrown(origin,direction,crown){
  const ox=origin.x-crown.x,oy=origin.y-crown.y,oz=origin.z-crown.z;
  const along=-(ox*direction.x+oy*direction.y+oz*direction.z);
  return along>0&&ox*ox+oy*oy+oz*oz-along*along<=crown.radius*crown.radius;
}
function shadowScene({metersPerPixel,useSampleObstacles,trees=[]}){
  const boxes=useSampleObstacles?SAMPLE_BUILDINGS.map(b=>({minX:b.x,maxX:b.x+b.w,minY:b.y,maxY:b.y+b.d,minZ:0,maxZ:(b.h+.3)/.1})):[];
  const crowns=useSampleObstacles?EXISTING_CROWNS.map(([x,y,r])=>({x,y,z:r*2.15,radius:r*1.1})):[];
  for(const t of trees){if(t?.funded===false||t?.interior||!Number.isFinite(t?.x)||!Number.isFinite(t?.y))continue;const radius=1.65/metersPerPixel;crowns.push({x:t.x,y:t.y,z:radius*2.1,radius:radius*1.1});}
  return {boxes,crowns};
}
function shadeFraction(point,sun,scene){
  if(sun.elevationDeg<=0)return 1;
  const az=rad(sun.azimuthDeg),el=rad(sun.elevationDeg),direction={x:Math.sin(az)*Math.cos(el),y:-Math.cos(az)*Math.cos(el),z:Math.sin(el)},origin={x:point.x,y:point.y,z:.01};
  if(scene.boxes.some(box=>rayBox(origin,direction,box)))return 1;
  // A schematic crown attenuates direct sun, rather than claiming total blockage.
  return scene.crowns.some(crown=>rayCrown(origin,direction,crown))?.8:0;
}
function pointAt(route,distance){
  let remaining=distance;
  for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(length===0)continue;if(remaining<=length||i===route.length-1){const ratio=clamp(remaining/length,0,1);return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio};}remaining-=length;}
  return {...route.at(-1)};
}
function sliceRoute(route,start,end){
  const result=[pointAt(route,start)];let distance=0;
  for(let i=1;i<route.length;i++){distance+=Math.hypot(route[i].x-route[i-1].x,route[i].y-route[i-1].y);if(distance>start+1e-8&&distance<end-1e-8)result.push({...route[i]});}
  const last=pointAt(route,end);if(!samePoint(result.at(-1),last))result.push(last);return result;
}
function exposure(route,sun,scene){
  const length=polylineLength(route);if(!length)return 0;
  const samples=clamp(Math.ceil(length/3),24,240);let exposed=0;
  for(let i=0;i<samples;i++)exposed+=1-shadeFraction(pointAt(route,length*(i+.5)/samples),sun,scene);
  return exposed/samples;
}
/** Schematic exposed ground fraction. It is not measured irradiance or cooling. */
export function estimateRouteExposure({route,sun,metersPerPixel=SAMPLE_METERS_PER_PIXEL,useSampleObstacles=true,trees=[]}={}){
  if(!deriveRouteLength(route,metersPerPixel)||!Number.isFinite(sun?.azimuthDeg)||!Number.isFinite(sun?.elevationDeg))return null;
  return exposure(route,sun,shadowScene({metersPerPixel,useSampleObstacles,trees}))*100;
}
function segmentCrossesBuilding(a,b,building){
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)return false;
  // Inset avoids treating a boundary-tangent centreline as crossing the interior.
  const box={minX:building.x+.001,maxX:building.x+building.w-.001,minY:building.y+.001,maxY:building.y+building.d-.001};let near=0,far=1;
  for(const [axis,delta] of [['x',dx],['y',dy]]){if(Math.abs(delta)<1e-10){if(a[axis]<box['min'+axis.toUpperCase()]||a[axis]>box['max'+axis.toUpperCase()])return false;continue;}let t1=(box['min'+axis.toUpperCase()]-a[axis])/delta,t2=(box['max'+axis.toUpperCase()]-a[axis])/delta;if(t1>t2)[t1,t2]=[t2,t1];near=Math.max(near,t1);far=Math.min(far,t2);if(near>far)return false;}
  return near<=1&&far>=0;
}
export function routeCrossesSampleBuilding(route){return route.slice(1).some((b,i)=>SAMPLE_BUILDINGS.some(building=>segmentCrossesBuilding(route[i],b,building)));}
function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;
  const ratio=lengthSquared>0?clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared,0,1):0;
  return Math.hypot(point.x-(a.x+ratio*dx),point.y-(a.y+ratio*dy));
}
function routeCrossesTrunk(route,{metersPerPixel,trees,useSampleObstacles}){
  // Clearance matches the walking body, not the much larger soft tree crown.
  // Existing scene trunks have 0.2 world-unit radius (2 map units); newly
  // planted trunks are scaled to 0.2 physical metres like the walking body.
  const trunks=useSampleObstacles?EXISTING_CROWNS.map(([x,y])=>({x,y,radius:2+.4/metersPerPixel})):[];
  for(const tree of trees){if(tree?.funded===false||tree?.interior||!Number.isFinite(tree?.x)||!Number.isFinite(tree?.y))continue;trunks.push({x:tree.x,y:tree.y,radius:.6/metersPerPixel});}
  return trunks.some(trunk=>route.slice(1).some((b,i)=>segmentDistance(trunk,route[i],b)<=trunk.radius));
}
function endpointLabel(candidate,distanceM,totalM){
  if(distanceM<.01)return candidate.from;if(totalM-distanceM<.01)return candidate.to;
  return `从${candidate.from}沿路径 ${distanceM.toFixed(1)} m 处`;
}
function fitCandidate(candidate,{sun,scene,metersPerPixel,budgetInput}){
  const fullLengthM=deriveRouteLength(candidate.route,metersPerPixel),fullPlan=calculatePlan({...budgetInput,lengthM:fullLengthM});
  if(!fullPlan.valid)return {error:fullPlan.error};
  if(fullPlan.fundedModules<1)return null;
  if(fullPlan.type==='mixed'){
    // Preserve where the user placed every material. Cropping a route and
    // reusing its fractions would move those materials to different places.
    const fraction=exposure(candidate.route,sun,scene);
    return {...candidate,route:candidate.route.map(p=>({...p})),lengthM:fullLengthM,plan:fullPlan,fullLengthM,exposurePercent:Math.round(fraction*100),exposedLengthM:fraction*fullLengthM,originalFrom:candidate.from,originalTo:candidate.to,partial:fullPlan.status!=='full',startOffsetM:0,endOffsetM:fullLengthM};
  }
  const totalPx=polylineLength(candidate.route);
  const targetLengthM=Math.min(fullLengthM,fullPlan.coveredLengthM),whole=targetLengthM>=fullLengthM-1e-8;
  // A tiny inward tolerance keeps floating interpolation from buying an extra module.
  const targetPx=whole?totalPx:Math.max(0,targetLengthM-Math.max(1e-8,targetLengthM*1e-12))/metersPerPixel;
  const starts=whole?[0]:Array.from({length:25},(_,i)=>(totalPx-targetPx)*i/24);
  if(!whole){let cumulative=0;for(let i=1;i<candidate.route.length;i++){cumulative+=Math.hypot(candidate.route[i].x-candidate.route[i-1].x,candidate.route[i].y-candidate.route[i-1].y);if(starts.length<280){starts.push(clamp(cumulative,0,totalPx-targetPx),clamp(cumulative-targetPx,0,totalPx-targetPx));}}}
  let best=null;
  for(const start of starts){const route=sliceRoute(candidate.route,start,start+targetPx),fraction=exposure(route,sun,scene);if(!best||fraction>best.fraction+1e-8)best={route,fraction,start};}
  if(!best)return null;
  let lengthM=deriveRouteLength(best.route,metersPerPixel),plan=calculatePlan({...budgetInput,lengthM});
  if(!plan.valid)return {error:plan.error};
  if(plan.status!=='full')return null;
  const startM=best.start*metersPerPixel,endM=startM+lengthM;
  return {...candidate,route:best.route,lengthM,plan,fullLengthM,exposurePercent:Math.round(best.fraction*100),exposedLengthM:best.fraction*lengthM,from:endpointLabel(candidate,startM,fullLengthM),to:endpointLabel(candidate,endM,fullLengthM),originalFrom:candidate.from,originalTo:candidate.to,partial:!whole,startOffsetM:startM,endOffsetM:endM};
}

function environmentError(environment){
  if(!Number.isFinite(environment?.temperatureC)||!Number.isFinite(environment?.radiationWm2)||environment.radiationWm2<0||!Number.isFinite(environment?.sun?.azimuthDeg)||!Number.isFinite(environment?.sun?.elevationDeg))return '温度、光照或太阳位置数据尚未有效，请先更新环境数据。';
  if(environment.sun.azimuthDeg<0||environment.sun.azimuthDeg>360||environment.sun.elevationDeg<-90||environment.sun.elevationDeg>90)return '太阳方位须在 0–360°、太阳高度须在 -90–90° 内，请更新有效环境数据。';
  return null;
}
function priceError(budgetInput){
  const rates=budgetInput?.type==='mixed'?[...new Set((budgetInput.sections||[]).map(section=>section.type))].flatMap(type=>Object.values(budgetInput.ratesByType?.[type]||{})):Object.values(budgetInput?.rates||{});
  const priceValues=[...rates,budgetInput?.treeUnitPrice??380];
  return priceValues.some(v=>Number.isFinite(v)&&Math.abs(v*100-Math.round(v*100))>.00001)?'材料与绿植单价最多保留两位小数，请修正后推荐。':null;
}
const assumptionsFor=sample=>sample?'建筑高度、树冠与路径为示例，阴影比例是简化估算。':'上传图缺少三维障碍资料，按无遮挡估算，不代表已识别实际阴影。';

function fundedExposureFraction(route,plan,sun,scene){
  let fraction=0;
  for(const section of plan.sections||[]){
    if(!['mesh','solid','corridor'].includes(section.type))continue;
    const start=section.startFraction,end=Math.min(section.endFraction,section.fundedEndFraction);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>1||end<=start)continue;
    const portion=slicePolyline(route,start,end);
    if(portion)fraction+=exposure(portion,sun,scene)*(end-start);
  }
  return clamp(fraction,0,1);
}

/**
 * Evaluate the ORIGINAL whole route. 0–100 is an explainable heuristic score,
 * never a probability or engineering approval. Under-funded lengths are not
 * silently removed, and less than half coverage can never pass the 50 threshold.
 */
export function evaluateRoute({route,environment,budgetInput,metersPerPixel=SAMPLE_METERS_PER_PIXEL,trees=[],useSampleObstacles=true}={}){
  const fail=error=>({valid:false,score:null,belowThreshold:null,reason:error,error,plan:null,exposurePercent:null,obstructed:false});
  const invalidEnvironment=environmentError(environment);if(invalidEnvironment)return fail(invalidEnvironment);
  if(!Number.isFinite(metersPerPixel)||metersPerPixel<=0)return fail('请先校准图纸比例，才能评估路线推荐度。');
  const lengthM=deriveRouteLength(route,metersPerPixel);if(!lengthM)return fail('请先画出至少两个不同的有效路径点。');
  if(route.some(p=>p.interior))return fail('当前评分用于室外遮阳路线；室内路线请按通行与盆栽需求规划。');
  if(!budgetInput)return fail('请填写预算、通道净宽和材料单价。');
  const invalidPrice=priceError(budgetInput);if(invalidPrice)return fail(invalidPrice);
  const plan=calculatePlan({...budgetInput,lengthM});if(!plan.valid)return fail(plan.error);
  const throughBuilding=useSampleObstacles&&routeCrossesSampleBuilding(route);
  const throughTrunk=routeCrossesTrunk(route,{metersPerPixel,trees,useSampleObstacles});
  const obstructed=throughBuilding||throughTrunk;
  const exposurePercent=estimateRouteExposure({route,sun:environment.sun,metersPerPixel,useSampleObstacles,trees});
  const heatNeed=clamp((environment.temperatureC-22)/14,0,1),sunNeed=clamp(environment.radiationWm2/800,0,1);
  const lowSun=environment.sun.elevationDeg<=0||environment.radiationWm2<80;
  const coverage=clamp(plan.coveredLengthM/lengthM,0,1),fraction=exposurePercent/100;
  const mixed=plan.type==='mixed';
  const benefitFraction=mixed?fundedExposureFraction(route,plan,environment.sun,shadowScene({metersPerPixel,useSampleObstacles,trees})):fraction*coverage;
  // Hot days favour useful exposed length; milder days favour focused short work.
  // Bounded weights keep a fully exposed short path feasible if funds cover it.
  const broadBenefit=.55+.45*Math.min(lengthM/48,1);
  const focusedBenefit=.7+.3/(1+lengthM/30);
  const lengthPreference=heatNeed*broadBenefit+(1-heatNeed)*focusedBenefit;
  const climateNeed=.68+.32*heatNeed;
  let score=obstructed||lowSun?0:Math.round(100*benefitFraction*sunNeed*lengthPreference*climateNeed);
  score=clamp(score,0,100);if(coverage<.5)score=Math.min(score,49);
  const belowThreshold=score<50;
  let detail;
  if(throughBuilding)detail='路线穿过已知建筑内部，不能作为室外遮阳通道，请绕开建筑。';
  else if(throughTrunk)detail='路线穿过现有或已安排树木的树干通行范围，请绕开树干后重新规划。';
  else if(lowSun)detail='当前处于夜间或弱光，遮阳收益很低；可查看白天条件后重新评估。';
  else if(coverage===0)detail='预留绿植与预备金后，预算无法完成一个遮阳模块。';
  else detail=`约 ${Math.round(exposurePercent)}% 的路径处于示意直射日光中；当前 ${environment.temperatureC.toFixed(1)}℃、${Math.round(environment.radiationWm2)} W/m²，预算可覆盖整条路线的 ${Math.round(coverage*100)}%。${heatNeed>=.5?'温度较高，评分偏重可改善的暴晒长度。':'温度较温和，评分偏重暴晒集中的短段。'}`;
  if(mixed)detail+=`各段按所选材料与实际资助位置计算，已安排棚架覆盖的暴晒路段占全程约 ${Math.round(benefitFraction*100)}%；仅绿植段不计为棚架遮阳，实际树荫与种植推荐度另行统计。`;
  return {valid:true,score,belowThreshold,reason:(belowThreshold?'可行性过低，请换一条路线。':'')+detail,plan,exposurePercent:Math.round(exposurePercent),obstructed,lengthM,budgetCoveragePercent:coverage*100,...(mixed?{fundedExposedRoutePercent:benefitFraction*100}:{}),assumptions:assumptionsFor(useSampleObstacles),scoreLabel:'规则推荐度，不是成功概率或施工审批'};
}

/**
 * Rank budget-fitting alternatives using exactly the same public route score.
 * No occupancy, pavement temperature or measured cooling is inferred, and this
 * pure function never applies a route to the user's current plan.
 */
export function recommendRoutes({environment,budgetInput,metersPerPixel=SAMPLE_METERS_PER_PIXEL,candidates,trees=[],useSampleObstacles=true}={}){
  const fail=error=>({valid:false,status:'invalid',error,reason:error,candidates:[],recommendedId:null});
  const invalidEnvironment=environmentError(environment);if(invalidEnvironment)return fail(invalidEnvironment);
  if(!Number.isFinite(metersPerPixel)||metersPerPixel<=0)return fail('请先校准图纸比例，才能计算推荐路线与费用。');
  candidates=candidates??(useSampleObstacles?SAMPLE_CANDIDATES:[]);
  if(!budgetInput||!Array.isArray(candidates))return fail('请填写预算并提供有效候选路线。');
  const invalidPrice=priceError(budgetInput);if(invalidPrice)return fail(invalidPrice);
  const validation=calculatePlan({...budgetInput,lengthM:1});if(!validation.valid)return fail(validation.error);
  const usable=candidates.filter(c=>c&&typeof c.id==='string'&&deriveRouteLength(c.route,metersPerPixel)&&!c.route.some(p=>p.interior)&&(!useSampleObstacles||!routeCrossesSampleBuilding(c.route))).map(c=>({...c,from:typeof c.from==='string'?c.from:'当前起点',to:typeof c.to==='string'?c.to:'当前终点'}));
  if(!usable.length)return fail('尚无可用的室外候选路线；请画一条不穿过建筑的室外路径。');
  const scene=shadowScene({metersPerPixel,useSampleObstacles,trees}),sun=environment.sun;
  const ranked=[];
  for(const candidate of usable){const fitted=fitCandidate(candidate,{sun,scene,metersPerPixel,budgetInput});if(fitted?.error)return fail(fitted.error);if(fitted)ranked.push(fitted);}
  const lowSun=sun.elevationDeg<=0||environment.radiationWm2<80;
  if(!ranked.length)return {valid:true,status:'insufficient',reason:'预留绿植和预备金后，预算不足以建设一个完整遮阳模块；暂不推荐新增施工段。',candidates:[],recommendedId:null};
  for(const candidate of ranked){
    const assessment=evaluateRoute({route:candidate.route,environment,budgetInput,metersPerPixel,trees,useSampleObstacles});
    if(!assessment.valid)return fail(assessment.reason);
    candidate.recommendationScore=assessment.score;candidate.priorityScore=assessment.score;candidate.belowThreshold=assessment.belowThreshold;candidate.obstructed=assessment.obstructed;
    candidate.reason=assessment.reason+(candidate.plan.type==='mixed'?(candidate.partial?'分段材料和位置已保留，未获预算的部分仍为待建。':'所有分段均在当前预算内，保留各段材料选择。'):(candidate.partial?'当前预算只推荐其中可负担的连续一段。':'整段在当前预算内。'));
    candidate.assumptions=assessment.assumptions;
  }
  ranked.sort((a,b)=>b.recommendationScore-a.recommendationScore||a.lengthM-b.lengthM||a.id.localeCompare(b.id));
  const status=ranked[0].recommendationScore<50?'low-priority':'recommended';
  return {valid:true,status,reason:lowSun?'当前夜间或光照较弱，不建议仅凭此刻增加遮阳施工；可查看白天条件再比较。':status==='low-priority'?'当前可负担候选路线的推荐度均低于 50%，暂无建议应用的替代路线。':'按当前光照、温度和预算排序；建议先预览，再应用到规划。',candidates:ranked,recommendedId:status==='recommended'?ranked[0].id:null,method:'0–100% 为简化阴影与预算规则推荐度，不是成功概率、实测热舒适度或降温收益。'};
}
