import {createClimateSimulation} from './climate-simulation.mjs';
import {recommendRoutes,evaluateRoute} from './climate-recommendations.mjs';
import {evaluatePlanting} from './planting-recommendations.mjs';

const money=cents=>{const n=BigInt(cents);return `${(n/100n).toLocaleString('zh-CN')}${n%100n?'.'+String(n%100n).padStart(2,'0'):''}`;};
const clock=hour=>`${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor((hour%1)*60)).padStart(2,'0')}`;
export function createClimatePanel({getContext,getPlantingContext,applyRoute,onEnvironment,onAssessment=()=>{},onCoverageMap=()=>{},root=document,schedule=setInterval,unschedule=clearInterval}={}){
  const $=selector=>root.querySelector(selector),simulation=createClimateSimulation({seed:57,hour:12,scenario:'sunny'});
  let playing=true,ticks=0,history=[],lastResult=null,lastEnvironment,lastAssessment=null,lastPlantingAssessment=null;
  function write(selector,text){$(selector).textContent=text;}
  function drawHistory(sample){
    history.push(sample);if(history.length>90)history.shift();
    const points=(key,min,max)=>history.map((v,i)=>`${history.length<2?0:i/(history.length-1)*360},${78-Math.max(0,Math.min(1,(v[key]-min)/(max-min)))*70}`).join(' ');
    $('#climate-radiation-line').setAttribute('points',points('radiationWm2',0,1100));$('#climate-temperature-line').setAttribute('points',points('temperatureC',15,45));
    write('#climate-chart-caption',history.length>1?`${clock(history[0].hour)}—${clock(sample.hour)} · 模拟趋势；橙线光照，绿线温度`:'开始模拟后显示变化趋势');
  }
  function refreshRecommendations(){
    refreshPlanting();
    const context=getContext();const host=$('#climate-recommendations');host.replaceChildren();
    const plantsOnly=Boolean(context?.plantsOnly);
    for(const id of ['#current-route-assessment','#climate-route-heading','#climate-reason','#climate-recommendations'])$(id).hidden=plantsOnly;
    if(!context||context.blockReason){lastResult=null;write('#climate-reason',context?.blockReason||'请先填写有效预算和路线比例。');renderAssessment(null,context?.blockReason||'请补齐路线与比例。');return;}
    lastResult=recommendRoutes({...context,environment:lastEnvironment??simulation.sample()});
    write('#climate-reason',lastResult.reason||lastResult.error||'');
    const assessment=context.currentInterior?null:evaluateRoute({...context,route:context.currentRoute,environment:lastEnvironment??simulation.sample()});
    renderAssessment(assessment,context.currentInterior?'当前为室内方案，不使用室外日晒评分。':'画完路线后自动评估。');
    if(!lastResult.valid)return;
    for(const candidate of (lastResult.candidates??[]).slice(0,3)){
      const card=root.createElement('article');card.className='climate-route';if(candidate.id===lastResult.recommendedId)card.className+=' recommended';
      const label=root.createElement('span');label.className='climate-rank';label.textContent=`${candidate.id===lastResult.recommendedId?'优先建议':'可比较方案'} · 推荐度 ${candidate.recommendationScore??'—'}%`;
      const title=root.createElement('h3');title.textContent=`${candidate.from} → ${candidate.to}`;
      const stats=root.createElement('p');stats.className='climate-route-stats';stats.textContent=`${candidate.lengthM.toFixed(1)} m · 估算暴晒 ${Math.round(candidate.exposurePercent)}%`;
      const reason=root.createElement('p');reason.textContent=candidate.reason;
      const cost=root.createElement('strong');cost.textContent=`预算占用 ¥${money(candidate.plan.exact.fundedTotalCents)}`;
      const button=root.createElement('button');button.className='secondary-button';button.textContent='采用这条路线';button.disabled=lastResult.status==='low-priority'||!candidate.plan.valid||candidate.plan.fundedModules===0||(candidate.recommendationScore??0)<50;
      button.addEventListener('click',()=>applyRoute(candidate));card.append(label,title,stats,reason,cost,button);host.append(card);
    }
  }
  function refreshPlanting(){
    if(!getPlantingContext)return;
    const assessment=lastPlantingAssessment=evaluatePlanting({...getPlantingContext(),environment:lastEnvironment??simulation.sample(),includeCoverageMap:true});
    onCoverageMap(assessment.coverageMap??null);
    const coverage=assessment.coverage,finite=Number.isFinite;
    const percent=value=>finite(value)?`${value.toFixed(2)}%`:'—';
    write('#coverage-scope',coverage?.label||'校园室外地面 · 模拟估算');
    write('#coverage-direct',percent(coverage?.directSunPercent));
    write('#coverage-shade',coverage?.valid&&coverage.shadePercent===null?'不适用':percent(coverage?.shadePercent));
    write('#coverage-added',finite(coverage?.addedTreeShadePercent)?`+${coverage.addedTreeShadePercent.toFixed(2)} 个百分点`:'—');
    $('#coverage-shade-bar').style.width=`${finite(coverage?.shadePercent)?coverage.shadePercent:0}%`;
    $('.coverage-track').classList.toggle('inactive',!finite(coverage?.shadePercent));
    $('.coverage-track').setAttribute('aria-label',finite(coverage?.shadePercent)?`遮阴 ${percent(coverage.shadePercent)}，直射 ${percent(coverage.directSunPercent)}`:'当前无可用日照覆盖比例');
    write('#coverage-reason',coverage?.reason||'请校准图纸比例后计算光照覆盖。');
    const route=assessment.routeCoverage;
    $('#route-coverage').hidden=!route?.valid;
    write('#route-coverage',route?.valid?`当前路线：直射 ${percent(route.directSunPercent)} · 遮阴 ${percent(route.shadePercent)} · 新增绿植增加遮阴 ${finite(route.addedTreeShadePercent)?route.addedTreeShadePercent.toFixed(2):'—'} 个百分点`:'');
    write('#planting-score',finite(assessment.score)?`${assessment.score}%`:'—');
    write('#planting-score-reason',(assessment.reasons||[]).join(' ')||'布置绿植后显示推荐度和原因。');
    write('#scene-light-summary',coverage?.valid?`室外地面 · 阳光直射 ${percent(coverage.directSunPercent)} · 遮阴 ${finite(coverage.shadePercent)?percent(coverage.shadePercent):'不适用'} · 树荫净增 ${finite(coverage.addedTreeShadePercent)?coverage.addedTreeShadePercent.toFixed(2):'—'} 个百分点`:'光照覆盖待校准：请先设置图纸比例。');
    write('#scene-planting-score',finite(assessment.score)?`绿植推荐度 ${assessment.score}%${assessment.score<50?' · 当前模拟收益较低':''}`:'布置绿植后显示推荐度');
    const host=$('#tree-assessments');host.replaceChildren();
    for(const tree of [...(assessment.trees||[])].reverse()){
      const card=root.createElement('article');card.className='tree-assessment';
      if(finite(tree.score)&&tree.score<50)card.className+=' low';
      const title=root.createElement('strong');title.textContent=`#${tree.id} ${tree.interior?'室内绿植':'室外乔木'} · 推荐度 ${finite(tree.score)?`${tree.score}%`:'待评估'}${tree.funded===false?' · 待追加预算':''}`;
      const reason=root.createElement('p');reason.textContent=tree.reason||(tree.reasons||[]).join(' ');
      card.append(title,reason);host.append(card);
    }
    if(!assessment.trees?.length){const empty=root.createElement('p');empty.className='tree-assessment-empty';empty.textContent='点击「种树」布置第一株，预算、推荐度与光照覆盖会一起更新。';host.append(empty);}
  }
  function renderAssessment(assessment,fallback){
    lastAssessment=assessment;onAssessment(assessment);const valid=assessment?.valid,low=valid&&assessment.score<50;
    $('#current-route-assessment').classList.toggle('low',Boolean(low));write('#current-route-score',valid?`${assessment.score}%`:'—');$('#current-route-score-bar').style.width=valid?`${assessment.score}%`:'0%';
    write('#current-route-score-reason',valid?`${low&&!assessment.reason.startsWith('可行性过低')?'可行性过低，请换一条路线。 ':''}${assessment.reason}`:assessment?.error||fallback);
    const replacement=lastResult?.candidates?.find(c=>c.id===lastResult.recommendedId&&c.recommendationScore>=50);
    $('#replace-low-route').hidden=!low||!replacement;
  }
  $('#replace-low-route').addEventListener('click',()=>{const candidate=lastResult?.candidates?.find(c=>c.id===lastResult.recommendedId&&c.recommendationScore>=50);if(candidate)applyRoute(candidate);});
  function render({record=true,recommend=true}={}){
    const sample=lastEnvironment=simulation.sample();
    write('#climate-temperature',`${sample.temperatureC.toFixed(1)} °C`);write('#climate-radiation',`${Math.round(sample.radiationWm2)} W/m²`);write('#climate-cloud',`${Math.round(sample.cloudCoverPercent)}%`);write('#climate-time-label',clock(sample.hour));$('#climate-time').value=sample.hour;
    write('#scene-sun-time-label',clock(sample.hour));$('#scene-sun-time').value=sample.hour;
    write('#climate-sun',sample.sun.elevationDeg>0?`太阳高度 ${sample.sun.elevationDeg.toFixed(0)}°`:'太阳已落下 · 无直射日光');
    onEnvironment(sample);if(record)drawHistory(sample);if(recommend)refreshRecommendations();else refreshPlanting();
  }
  function togglePlaying(){playing=!playing;write('#climate-play',playing?'暂停变化':'继续模拟');write('#scene-sun-play',playing?'暂停太阳':'继续太阳');for(const id of ['#climate-play','#scene-sun-play'])$(id).setAttribute('aria-pressed',String(playing));}
  for(const id of ['#climate-play','#scene-sun-play'])$(id).addEventListener('click',togglePlaying);
  for(const id of ['#climate-time','#scene-sun-time'])$(id).addEventListener('input',()=>{simulation.setHour(Number($(id).value));history=[];render();});
  $('#climate-scenario').addEventListener('change',()=>{simulation.setScenario($('#climate-scenario').value);render();});
  $('#climate-refresh').addEventListener('click',refreshRecommendations);
  const timer=schedule(()=>{if(!playing||root.hidden)return;simulation.advance(1);ticks++;render({recommend:ticks%10===0});},1000);
  render();
  return {refreshRecommendations,getEnvironment:()=>lastEnvironment,getRecommendations:()=>lastResult,getAssessment:()=>lastAssessment,getPlantingAssessment:()=>lastPlantingAssessment,dispose(){unschedule(timer);},tick(){simulation.advance(1);render();}};
}
