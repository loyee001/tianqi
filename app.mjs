import { calculatePlan, calculateTreeBudget, calculatePlantPlan, calculateInteriorPlan, DEFAULT_RATES, RATE_DEFINITIONS } from './budget.mjs';
import {createClimatePanel} from './climate-ui.mjs';
import { polylineLength, deriveRouteLength, calibrationScale, curveThroughPoint, slicePolyline, projectPointOnRoute, SAMPLE_METERS_PER_PIXEL } from './geometry.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svgNS = 'http://www.w3.org/2000/svg';
const sampleRoute = [{x:316,y:181},{x:398,y:181},{x:398,y:370},{x:687,y:370}];
const state = { type:'mesh', sections:[{id:1,type:'mesh',startFraction:0,endFraction:1}], nextSectionId:2, splitting:false, rates:{mesh:DEFAULT_RATES('mesh'),solid:DEFAULT_RATES('solid'),corridor:DEFAULT_RATES('corridor')}, route:structuredClone(sampleRoute), routeShape:'straight', routeKind:'polyline', image:null, editing:false, tab:'design', plan:null, metersPerPixel:SAMPLE_METERS_PER_PIXEL, scaleSource:'sample', calibrating:false, calibration:[], trees:[], nextTreeId:1, view:'3d', mode:'orbit', planting:false, lightCoverage:true, pedestrians:true };
let scene3D=null, routeBackup=null, routeTwoPoint=false, climatePanel=null, simulatedEnvironment=null, latestCoverageMap=null;
const planNames={mixed:'综合路线 · 分段搭配',plants:'仅种绿植',corridor:'完整走廊',mesh:'透气遮阳网',solid:'PC 板连廊'};
const sectionColors={mesh:'#93ad65',solid:'#70a5b0',corridor:'#b08b62',plants:'#4f956b'};
function routeSpace(){const name=state.route[0]?.interior;return name&&state.route.every(p=>p.interior===name)?name:null;}
function treeInput(){return {budget:$('#budget').value.trim(),reservePct:valueOf('#reserve'),treesCount:state.trees.length,treeUnitPrice:valueOf('#tree-price')};}
const money = value => Number(value).toLocaleString('zh-CN',{minimumFractionDigits:Number.isInteger(value)?0:2,maximumFractionDigits:2});
function formatCents(cents){const n=BigInt(cents),absolute=n<0n?-n:n;const units=(absolute/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');const fraction=absolute%100n;return (n<0n?'-':'')+units+(fraction?'.'+String(fraction).padStart(2,'0'):'');}
function planMoney(plan,key){
  if(!plan.exact)return money(plan[key]);
  const keys={budget:'budgetCents',reserveAmount:'reserveCents',fundedCost:'fundedCostCents',fundedTotal:'fundedTotalCents',fullCost:'fullCostCents',treesCost:'treesCostCents'};
  if(keys[key])return formatCents(plan.exact[keys[key]]);
  if(key==='unallocatedAmount')return formatCents(BigInt(plan.exact.budgetCents)-BigInt(plan.exact.reserveCents)-BigInt(plan.exact.fundedCostCents));
  return money(plan[key]);
}
const num = value => Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const valueOf = id => { const value=$(id).value.trim(); return value === '' ? NaN : Number(value); };
const write = (id,value) => $(id).textContent=value;
let toastTimer;
function toast(message){ write('#toast',message); $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,3200); }
function element(name,attrs={},text){const el=document.createElementNS(svgNS,name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
function svgAdd(parent,name,attrs,text){const el=element(name,attrs,text);parent.append(el);return el;}

function drawBase(){
  const base=$('#map-base');base.replaceChildren();$('.map-north').hidden=Boolean(state.image);
  if(state.image){svgAdd(base,'rect',{width:980,height:570,fill:'#f3f4ef'});svgAdd(base,'image',{href:state.image,x:0,y:0,width:980,height:570,preserveAspectRatio:'xMidYMid meet'});return;}
  base.innerHTML=`<rect width="980" height="570" fill="#eef1e7"/><rect width="980" height="570" fill="url(#ground-grid)"/>
  <path d="M0 290H330V570M398 0V535M398 370H980M64 85H938" fill="none" stroke="#e1e5d9" stroke-width="65"/>
  <path d="M0 290H330V570M398 0V535M398 370H980M64 85H938" fill="none" stroke="#f9f8f2" stroke-width="53"/>
  <rect x="478" y="125" width="390" height="161" rx="10" fill="#dce6cf" stroke="#cddcbb"/>
  <path d="M508 145H838M508 170H838M508 195H838M508 220H838M508 245H838" stroke="#cfddc1" stroke-width="1"/>
  <rect x="529" y="140" width="288" height="130" rx="64" fill="none" stroke="#e8edde" stroke-width="5"/>
  <rect x="562" y="151" width="221" height="108" rx="49" fill="none" stroke="#e8edde" stroke-width="2"/>
  <path d="M670 143V269M565 183H785M565 228H785" fill="none" stroke="#e8edde" stroke-width="2"/>
  <g filter="url(#building-shadow)"><rect x="89" y="126" width="219" height="113" rx="4" fill="#e1e7de" stroke="#a9baab"/>
  <rect x="103" y="138" width="190" height="89" rx="2" fill="#edf0e8"/><rect x="103" y="138" width="190" height="89" fill="url(#roof-lines)"/>
  <path d="M112 159H282M112 207H282" stroke="#c7d0c2" stroke-width="5"/><rect x="298" y="164" width="15" height="33" rx="1" fill="#b4c6a7"/>
  <rect x="689" y="321" width="195" height="114" rx="4" fill="#e0e6d9" stroke="#abbda3"/><rect x="702" y="334" width="170" height="88" fill="#edf0e6"/>
  <rect x="702" y="334" width="170" height="88" fill="url(#roof-lines)"/><path d="M718 345H855M718 408H855" stroke="#c6d1bc" stroke-width="5"/><rect x="681" y="355" width="17" height="31" fill="#b5c7a8"/>
  <rect x="92" y="385" width="159" height="96" rx="4" fill="#e2e7dc" stroke="#b7c4ad"/><rect x="104" y="397" width="134" height="72" fill="url(#roof-lines)"/>
  <rect x="507" y="450" width="118" height="77" rx="4" fill="#e1e7d9" stroke="#b9c8b1"/><rect x="517" y="460" width="98" height="57" fill="url(#roof-lines)"/></g>
  <text x="198" y="187" text-anchor="middle" font-size="21" fill="#6b8061" letter-spacing="3">教学楼</text>
  <text x="787" y="381" text-anchor="middle" font-size="21" fill="#6b8061" letter-spacing="5">食堂</text>
  <text x="172" y="440" text-anchor="middle" font-size="17" fill="#a0ac94" letter-spacing="3">图书馆</text>
  <text x="565" y="495" text-anchor="middle" font-size="15" fill="#a0ac94" letter-spacing="2">活动室</text>
  <text x="670" y="213" text-anchor="middle" font-size="17" fill="#a7b994" letter-spacing="5">运动场</text>
  <text x="676" y="65" text-anchor="middle" font-size="11" fill="#b0baa3" letter-spacing="4">CAMPUS MASTERPLAN</text>`;
  const trees=[[70,70,19],[113,64,15],[161,70,18],[211,63,13],[268,72,21],[320,69,16],[57,164,19],[53,214,16],[97,329,15],[147,327,19],[201,328,18],[258,328,17],[290,405,15],[289,458,17],[283,512,17],[60,512,18],[108,525,19],[162,523,16],[213,523,15],[451,117,14],[451,163,15],[451,216,15],[451,269,17],[489,309,16],[536,308,17],[583,308,15],[632,308,14],[744,479,20],[789,482,17],[840,480,20],[903,483,17],[924,321,16],[926,367,18],[926,416,17],[909,142,17],[908,194,16],[909,248,16]];
  for(const [x,y,r] of trees){svgAdd(base,'circle',{cx:x+3,cy:y+4,r,fill:'#cbd7ba',opacity:.45});svgAdd(base,'circle',{cx:x,cy:y,r,fill:'#c1d2ad',stroke:'#afc59a','stroke-width':1});svgAdd(base,'circle',{cx:x-3,cy:y-3,r:r*.63,fill:'#cfdfbb',opacity:.65});}
}
function routeLength(){return polylineLength(state.route)||0;}
function pointAt(distance){let remaining=distance;for(let i=1;i<state.route.length;i++){const a=state.route[i-1],b=state.route[i],d=Math.hypot(b.x-a.x,b.y-a.y);if(remaining<=d||i===state.route.length-1){const t=Math.max(0,Math.min(1,remaining/d));return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};}remaining-=d;}return state.route[0];}
function drawRoute(){
  const g=$('#route-overlay'), labels=$('#map-labels');g.replaceChildren();labels.replaceChildren();
  if(state.type==='plants'||!state.route.length)return;
  const path=state.route.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
  const p=state.plan, valid=p?.valid&&!state.editing, total=routeLength(), covered=valid?(p.type==='mixed'?0:p.layoutOnly?total:total*p.coveragePercent/100):0;
  if(state.route.length>1){
    svgAdd(g,'path',{d:path,fill:'none',stroke:'#fff','stroke-width':34,'stroke-linejoin':'round','stroke-linecap':'round',opacity:.8});
    if(p?.type!=='mixed')svgAdd(g,'path',{d:path,fill:'none',stroke:valid?'#cdab75':'#a5b395','stroke-width':23,'stroke-linejoin':'round','stroke-dasharray':'7 6',opacity:.45});
    if(covered>0){svgAdd(g,'path',{d:path,fill:'none',stroke:'#a7bf85','stroke-width':26,'stroke-linejoin':'round','stroke-linecap':'butt','stroke-dasharray':`${covered} ${total+50}`});svgAdd(g,'path',{d:path,fill:'none',stroke:'#648748','stroke-width':2,'stroke-dasharray':`${covered} ${total+50}`});}
    if(valid&&p.fundedModules&&p.type!=='mixed'){const maxDots=Math.min(p.fundedModules,40);for(let i=0;i<maxDots;i++){const d=covered*(i+.5)/maxDots;if(d>covered)continue;const pt=pointAt(d);svgAdd(g,'line',{x1:pt.x-12,y1:pt.y-17,x2:pt.x+12,y2:pt.y+17,stroke:'#69894f','stroke-width':1,opacity:.6,transform:`rotate(${pt.angle} ${pt.x} ${pt.y})`});}}
    const mid=pointAt(total*.54);const label=valid?(p.type==='mixed'?`${p.sections.length} 段 · 棚廊 ${num(p.coveredLengthM)} m`:p.layoutOnly?`室内路径 ${num(p.lengthM)} m`:`本期 ${num(p.coveredLengthM)} m / 全程 ${num(p.lengthM)} m`):'待完成标注与尺寸';
    svgAdd(labels,'rect',{x:Math.min(770,Math.max(10,mid.x-76)),y:mid.y-56,width:168,height:31,rx:6,fill:'#fff',stroke:'#dce5d1'});svgAdd(labels,'text',{x:Math.min(854,Math.max(94,mid.x+8)),y:mid.y-36,'text-anchor':'middle','font-size':12,fill:'#718b56'},label);
  }
  if(valid&&p.type==='mixed')for(const [i,section] of p.sections.entries()){
    const pathFor=(a,b)=>slicePolyline(state.route,a,b)?.map((point,j)=>`${j?'L':'M'}${point.x} ${point.y}`).join(' ');
    const attrs={fill:'none','stroke-linejoin':'round','stroke-linecap':'butt'};
    svgAdd(g,'path',{...attrs,d:pathFor(section.startFraction,section.endFraction),stroke:section.type==='plants'?sectionColors.plants:'#c99657','stroke-width':section.type==='plants'?5:22,'stroke-dasharray':'7 5',opacity:.7});
    if(section.type!=='plants'&&section.coveredLengthM>0)svgAdd(g,'path',{...attrs,d:pathFor(section.startFraction,section.fundedEndFraction),stroke:sectionColors[section.type],'stroke-width':24});
    const mid=pointAt(total*(section.startFraction+section.endFraction)/2);svgAdd(g,'circle',{cx:mid.x,cy:mid.y,r:10,fill:sectionColors[section.type],stroke:'#fff','stroke-width':2});svgAdd(g,'text',{x:mid.x,y:mid.y+4,fill:'#fff','text-anchor':'middle','font-size':10},String(i+1));
    if(i){const cut=pointAt(total*section.startFraction);svgAdd(g,'circle',{cx:cut.x,cy:cut.y,r:5,fill:'#fff',stroke:'#28533e','stroke-width':2});}
  }
  state.route.forEach((point,i)=>{if(i!==0&&i!==state.route.length-1){if(state.routeKind==='curve')return;svgAdd(g,'circle',{cx:point.x,cy:point.y,r:state.editing?6:3,fill:'#fff',stroke:'#76935d','stroke-width':2});return;}svgAdd(g,'circle',{cx:point.x,cy:point.y,r:11,fill:'#28533e',stroke:'#fff','stroke-width':3});svgAdd(g,'text',{x:point.x,y:point.y+4,'text-anchor':'middle','font-size':10,fill:'#fff','font-weight':600},i===0?'起':'终');});
}
function selectTab(tab){if(tab!=='design'&&state.mode==='walk')setMode('orbit');state.tab=tab;$$('.tab').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});$$('.tab-panel').forEach(panel=>panel.hidden=panel.id!==`panel-${tab}`);if(tab==='design')requestAnimationFrame(()=>scene3D?.resize());}
function currentCostPlan(){
  if(state.plan?.valid)return state.plan;
  const t=state.treePlan;if(!t?.valid)return state.plan;
  const row={id:'trees',name:'全校园绿植与布置（示例）',unit:'株',quantity:t.fundedTrees,unitPrice:valueOf('#tree-price'),total:t.treesCost,exactQuantity:String(t.fundedTrees),exactUnitPriceCents:t.exact.treeUnitPriceCents,exactTotalCents:t.exact.treesCostCents};
  return {...t,treeOnly:true,layoutOnly:true,fundedCost:t.treesCost,fullCost:t.requestedTreesCost,items:[row],reservePct:valueOf('#reserve'),exact:{...t.exact,fundedCostCents:t.exact.treesCostCents,fullCostCents:t.exact.requestedTreesCostCents}};
}
function materialDefinitions(){
 if(state.type==='plants'||state.plan?.valid&&state.plan.layoutOnly)return [];
 if(state.type!=='mixed')return RATE_DEFINITIONS[state.type];
 return [...new Set(state.sections.map(s=>s.type))].filter(type=>type!=='plants').flatMap(type=>RATE_DEFINITIONS[type].map(def=>({...def,id:`${type}:${def.id}`,baseId:def.id,materialType:type,name:`${planNames[type]} · ${def.name}`})));
}
function renderMaterials(){
  const p=currentCostPlan(),tbody=$('#materials-body');tbody.replaceChildren();
  for(const def of materialDefinitions()){
    const item=p?.valid?p.items.find(i=>i.id===def.id):null;
    const tr=document.createElement('tr');
    const title=document.createElement('td');title.textContent=def.name;const small=document.createElement('small');small.textContent=def.scope==='fixed'?'固定费用 · 演示值':'按 6 m 计价模块估算 · 非结构规格';title.append(small);tr.append(title);
    const quantity=document.createElement('td');quantity.dataset.quantity=def.id;quantity.textContent=`${item?num(item.quantity):'0'} ${def.unit}`;tr.append(quantity);
    const price=document.createElement('td');const input=document.createElement('input');input.type='number';input.min='0';input.step='0.01';input.value=Number.isFinite(state.rates[def.materialType||state.type][def.baseId||def.id])?state.rates[def.materialType||state.type][def.baseId||def.id]:'';input.setAttribute('aria-label',`${def.name}单价`);input.dataset.rate=def.id;
    input.addEventListener('input',()=>{state.rates[def.materialType||state.type][def.baseId||def.id]=input.value.trim()===''?NaN:Number(input.value);update(false);const current=state.plan?.valid?state.plan.items.find(x=>x.id===def.id):null;quantity.textContent=`${current?num(current.quantity):'0'} ${def.unit}`;});
    input.addEventListener('change',()=>renderMaterials());price.append(input);tr.append(price);const total=document.createElement('td');total.dataset.total=def.id;total.textContent=p?.valid?`¥${item?.exactTotalCents!==undefined?formatCents(item.exactTotalCents):money(item?.total||0)}`:'—';tr.append(total);tbody.append(tr);
  }
  const treesRow=document.createElement('tr');treesRow.className='tree-cost-row';treesRow.innerHTML=`<td>全校园绿植与布置<small>室外乔木 / 室内盆栽 · 已布置 ${state.trees.length} 棵</small></td><td id="table-trees-quantity">${p?.valid?p.fundedTrees:0} 株</td><td id="table-tree-price">${money(valueOf('#tree-price'))}</td><td id="table-trees-total">${p?.valid?'¥'+planMoney(p,'treesCost'):'—'}</td>`;tbody.append(treesRow);
  renderMaterialTotals();
}
function renderMaterialTotals(){const p=currentCostPlan();if($('#table-trees-quantity')){write('#table-trees-quantity',`${p?.valid?p.fundedTrees:0} 株`);write('#table-tree-price',Number.isFinite(valueOf('#tree-price'))?money(valueOf('#tree-price')):'待填写');write('#table-trees-total',p?.valid?'¥'+planMoney(p,'treesCost'):'—');}$$('[data-quantity]').forEach(el=>{const item=p?.valid?p.items.find(x=>x.id===el.dataset.quantity):null;const def=materialDefinitions().find(x=>x.id===el.dataset.quantity);el.textContent=`${num(item?.quantity||0)} ${def?.unit||''}`;});$$('[data-total]').forEach(el=>{const item=p?.valid?p.items.find(x=>x.id===el.dataset.total):null;el.textContent=p?.valid?`¥${item?.exactTotalCents!==undefined?formatCents(item.exactTotalCents):money(item?.total||0)}`:'—';});$('#materials-footer').innerHTML=p?.valid?`<tr><td colspan="3">${p.treeOnly?'绿植布置概算':p.layoutOnly?'绿植布置概算':'本期建设概算'}</td><td>¥${planMoney(p,'fundedCost')}</td></tr><tr><td colspan="3">预备金（预算的 ${num(p.reservePct)}%）</td><td>¥${planMoney(p,'reserveAmount')}</td></tr><tr><td colspan="3">合计占用预算 / 总预算</td><td>¥${planMoney(p,'fundedTotal')} / ¥${planMoney(p,'budget')}</td></tr>`:'<tr><td colspan="4">请补齐有效尺寸、预算与全部单价后计算。</td></tr>';}
function renderGuide(){
 if(state.type==='mixed'){
  write('#material-guide','每段分别核对对应材料：遮阳网、PC 板、完整走廊和绿植。材料与预算页按材料列出用量，分段表列出位置与费用；相邻异材段的衔接、排水和基础需现场确认。');
  $('#video-resources').innerHTML='<div class="resource-secondary"><strong>综合路线施工资料</strong><p>沿起点到终点的分段表安排施工。各段的材料型号、连接节点与安装视频，需按实际供应商选型补齐。</p><span class="concept-tag">概念规划与示例估价</span></div>';return;
 }
 if(state.type==='plants'||state.type==='corridor'){
  const plants=state.type==='plants';
  write('#material-guide',plants?'核对种植位置、可用土壤或盆器、地下管线与通行空间；结合树种、当地气候和养护条件确认苗木规格与栽植做法。':'完整走廊包含不透光屋面、支撑结构与基础、地面铺装、双侧排水及照明。按现场条件确认结构、排水走向和电气做法，再确定采购规格。');
  $('#video-resources').innerHTML=`<div class="resource-secondary"><strong>${plants?'绿植栽植资料':'完整走廊施工资料'}</strong><p>${plants?'苗木规格、土壤与盆器、栽植和养护说明随供应商选型补齐。':'材料清单已分别计入屋面、结构、铺装、排水和照明；施工图、构件节点与安装视频待具体选型后匹配。'}</p><span class="concept-tag">当前为概念规划与示例估价</span></div>`;
  return;
 }
 const mesh=state.type==='mesh';
 write('#material-guide',mesh?'透气遮阳网只解决遮阳，不提供防雨。最终确认材料的遮阳性能、耐候与防火资料，并由专业人员设计固定点及基础。':'PC 板需要结合板材参数、拼接防水、排水与支撑结构设计。具体型号和配套施工资料需随供应商报价补齐。');
 $('#video-resources').innerHTML=mesh?`<div class="video-card"><a class="video-preview" href="https://www.coolaroousa.com/blog/How-to-Install-a-Shade-Sail" target="_blank" rel="noopener noreferrer" aria-label="打开 Coolaroo 官方遮阳帆安装视频页面"><svg viewBox="0 0 380 180" aria-hidden="true"><path d="M55 157L60 50M325 165L319 45M185 174L182 83" stroke="#748a60" stroke-width="5"/><path d="M60 50 Q160 89 319 45 Q263 112 182 83 Q114 113 60 50" fill="#f1f3da" stroke="#c5d2ad" stroke-width="2"/><path d="M0 162Q100 130 210 160T400 152V180H0" fill="#8fa774" opacity=".5"/></svg><span class="play-icon">▶</span></a><div class="video-copy"><div class="eyebrow">COOLAROO · OFFICIAL RESOURCE</div><h3>遮阳帆安装视频</h3><p>英文厂家示范，帮助了解遮阳帆与连接方式。适用其指定产品，不能直接作为本校园方案的安装说明。</p><a class="resource-link" href="https://www.coolaroousa.com/blog/How-to-Install-a-Shade-Sail" target="_blank" rel="noopener noreferrer">打开官方视频与图文 →</a><p>视频由 YouTube 提供，播放取决于网络环境。</p></div></div><div class="resource-secondary">配套官方手册（英文 PDF）<br>HeatShield / Commercial Grade / Designer Series<a class="resource-link" href="https://www.coolaroo.com/userfiles/files/Instruction%20Manuals/Australia/shade%20sails/Coolaroo-ANZ-ShadeSails-Installation-Guide-2026-03.pdf" target="_blank" rel="noopener noreferrer">查看产品安装手册 ↗</a></div>`:`<div class="video-card"><div class="video-preview"><svg viewBox="0 0 380 180" aria-hidden="true"><path d="M70 160V75M310 160V75M190 168V90" stroke="#6d8862" stroke-width="5"/><path d="M40 75L125 40L343 75L260 109Z" fill="#dce9df" stroke="#8baa94" stroke-width="2"/><path d="M80 61L300 95M120 43L340 77M155 47L71 86M200 53L115 95M245 61L160 103" stroke="#adc9b9"/></svg></div><div class="video-copy"><div class="eyebrow">PC CANOPY · MATERIAL GUIDE</div><h3>先确定板材型号，再匹配安装视频</h3><p>目前是概算用的 PC 板连廊方案，尚未选定供应商。安装视频、节点图和技术资料待型号确认后补充。</p><span class="concept-tag">资料待补齐</span></div></div><div class="resource-secondary">需要收集：板材厚度与等级、配套型材、密封材料、排水做法、厂家安装说明及结构复核。</div>`;
}
function update(materials=true){
 const input=planInput();
 state.treePlan=calculateTreeBudget(treeInput());
 state.plan=state.type==='plants'?calculatePlantPlan(treeInput()):routeSpace()?calculateInteriorPlan({...input,spaceName:routeSpace()}):calculatePlan(input);
 const fineRate=[...(state.type==='plants'||routeSpace()?[]:(state.type==='mixed'?[...new Set(state.sections.map(s=>s.type))].filter(t=>t!=='plants').flatMap(t=>Object.values(state.rates[t])):Object.values(state.rates[state.type]))),valueOf('#tree-price')].some(rate=>Number.isFinite(rate)&&Math.abs(rate*100-Math.round(rate*100))>0.00001);
 if(fineRate)state.plan={valid:false,error:'材料单价最多保留两位小数，请修正后重新计算。'};
 write('#mobile-summary',`${state.plan.valid?'¥'+planMoney(state.plan,'budget'):input.budget!==''&&Number.isFinite(Number(input.budget))?'¥'+input.budget:'预算待填'} · ${planNames[state.type]}`);
 if(state.type!=='plants'&&(state.route.length<2||state.editing))state.plan={valid:false,error:state.editing?(state.routeShape==='curve'?(state.route.length===2?'请选择希望弧线经过的位置。':'请选择弧线的起点和终点。'):routeTwoPoint?(state.route.length?'已选起点，请点击终点。':'请点击地面选择起点，再点击终点。'):'路径标注中：选好终点后点击「完成标注」。'):'请在图中标注起点和终点。'};
 else if(state.type!=='plants'&&!Number.isFinite(input.lengthM))state.plan={valid:false,error:state.metersPerPixel?'请填写有效的路径长度（米）。':'这张图纸还没有比例尺：请校准两点距离，或直接填写当前路径的实测长度。'};
 write('#route-points-count',state.routeKind==='curve'&&!state.editing?'弧线路径 · 按曲线测长':`${state.route.length} 个路径点`);write('#tree-count-label',`${state.trees.length} 棵`);$('#undo-tree').disabled=!state.trees.length;$('#undo-tree-scene').disabled=!state.trees.length;write('#scene-tree-summary',`${state.trees.length} 株 · ${state.treePlan.valid?'¥'+formatCents(state.treePlan.exact.treesCostCents):'预算待填写'}`);
 write('#scale-status',state.metersPerPixel?(state.scaleSource!=='sample'?'已校准图纸比例，重画路线会自动测长。':'按示例图比例自动测长，可输入实测长度修正。'):'图纸尚未校准：选择两点并填写实际距离。');
 const p=state.plan;$('#validation').hidden=p.valid;write('#validation',p.valid?'':p.error);$('#export-plan').disabled=!p.valid;$('#export-csv').disabled=!currentCostPlan()?.valid;
 $$('[data-budget]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.budget)===Number(input.budget)));
 if(!p.valid){$$('.cost-card').forEach(el=>el.classList.add('invalid'));write('#status-pill','待补齐信息');$('#status-pill').className='status-pill insufficient';['cost-amount','build-cost','reserve-cost','total-cost','remaining-cost','trees-cost','metric-length','metric-covered','metric-area','metric-coverage'].forEach(id=>write(`#${id}`,'—'));$('#budget-bar-fill').style.width='0%';$('#reserve-bar-fill').style.width='0%';write('#cost-insight','完成路径与有效输入后，才会生成预算方案。');write('#design-description','尚未生成可计算的方案。');}
 else{
  $('.cost-card').classList.remove('invalid');const status=p.status==='full'?'全程预算可行':p.status==='partial'?'分期建设':p.status==='overbudget'?'有待建树木':'预算不足';write('#status-pill',status);$('#status-pill').className=`status-pill ${p.status}`;
  write('#trees-cost',`¥${planMoney(p,'treesCost')}`);write('#cost-amount',planMoney(p,'fundedCost'));write('#build-cost',`¥${planMoney(p,'fundedCost')}`);write('#reserve-cost',`¥${planMoney(p,'reserveAmount')}`);write('#reserve-percent',`${num(p.reservePct)}%`);write('#total-cost',`¥${planMoney(p,'fundedTotal')}`);write('#remaining-cost',`¥${planMoney(p,'unallocatedAmount')}`);
  $('#budget-bar-fill').style.width=`${p.budget?p.fundedCost/p.budget*100:0}%`;$('#reserve-bar-fill').style.width=`${p.budget?p.reserveAmount/p.budget*100:0}%`;
  $('#cost-insight').className=`cost-insight ${p.status!=='full'?'warning':''}`;
  $('#cost-insight').innerHTML=p.status==='overbudget'?`已安排 <strong>${p.fundedTrees} 棵树</strong>，另有 ${p.unfundedTrees} 棵待追加预算；当前遮阳段暂未建设。`:p.status==='full'?`可完成 <strong>${num(p.lengthM)} m 全程覆盖</strong>，已为现场调整留出预备金。`:p.status==='partial'?`当前预算可建设 <strong>${num(p.coveredLengthM)} m</strong>，尚余 ${num(p.lengthM-p.coveredLengthM)} m。全程建设费为 ¥${planMoney(p,'fullCost')}（含种树，未含预备金）。`:`当前预算不足以建设一个完整模块。全程建设费为 ¥${planMoney(p,'fullCost')}（未含预备金）。`;
  $('#metric-length').innerHTML=`${num(p.lengthM)}<small>m</small>`;$('#metric-covered').innerHTML=`${num(p.coveredLengthM)}<small>m</small>`;$('#metric-area').innerHTML=`${num(p.fundedModules*6*p.widthM)}<small>m²</small>`;write('#metric-coverage',`占路径 ${num(p.coveragePercent)}%`);
  write('#design-title',p.status==='full'?'用一段绿荫，连接校园生活':p.status==='partial'?'先建预算内的一段，让改善开始发生':'保留路径，调整预算后再开始');
  write('#design-description',`${state.type==='corridor'?'完整走廊，包含实体屋面、结构基础、地面铺装、排水及照明':state.type==='mesh'?'透气遮阳网，仅用于遮阳':'PC 板连廊，需确认防水与排水做法'}。本期新增 ${p.fundedTrees} 棵树，按 ${num(p.fundedModules)} 个 6 m 计价模块、${num(p.widthM)} m 净宽估算。沿标注起点依次覆盖；图中位置与构件数量为概念示意，需现场设计复核。`);
 }
 if(!p.valid&&state.treePlan.valid){const t=state.treePlan;write('#trees-cost','¥'+formatCents(t.exact.treesCostCents));write('#cost-amount',formatCents(t.exact.treesCostCents));write('#build-cost','¥'+formatCents(t.exact.treesCostCents));write('#reserve-cost','¥'+formatCents(t.exact.reserveCents));write('#total-cost','¥'+formatCents(t.exact.fundedTotalCents));write('#remaining-cost','¥'+formatCents(t.exact.unallocatedAmountCents));write('#cost-insight','当前仅计算绿植与预备金；完成路线与比例后，才计入路径方案费用。');}
 if(p.valid&&p.type==='mixed'){
  const planned=p.sections.filter(s=>s.type!=='plants').reduce((sum,s)=>sum+s.lengthM,0);
  write('#cost-insight',`${p.sections.length} 段综合规划：本期棚廊 ${num(p.coveredLengthM)} / ${num(planned)} m，另有 ${num(p.lengthM-planned)} m 仅绿植段。${p.status==='full'?'全部所选建设段在预算内。':'预算按起点顺序安排，未资助部分保留为待建。'}`);
  write('#design-title','哪一段怎么建，由你决定');write('#design-description',`按路线顺序：${p.sections.map((s,i)=>`第 ${i+1} 段 ${planNames[s.type]}（${num(s.lengthM)} m）`).join(' → ')}。本期另安排 ${p.fundedTrees} 株绿植；预备金单独预留。`);
 }
 if(p.valid&&p.layoutOnly&&!p.treeOnly){write('#status-pill',p.unfundedTrees?'有待布置绿植':'室内绿植规划');write('#cost-insight',`${p.spaceName}：路线为室内通行指示，仅计绿植与预备金，不采购户外遮阳棚。`);write('#design-title',`${p.spaceName} · 室内绿植与通行规划`);write('#design-description',`已标注 ${num(p.lengthM)} m 室内路径，安排 ${p.fundedTrees} 株绿植。当前费用为可编辑的绿植布置示例价。`);write('#metric-covered','—');write('#metric-coverage','室内无需遮阳棚');write('#metric-area','—');}
 if(p.valid&&p.treeOnly){write('#status-pill',p.unfundedTrees?'有待布置绿植':'绿植预算可行');write('#cost-insight',`已安排 ${p.fundedTrees} 株绿植${p.unfundedTrees?`，${p.unfundedTrees} 株待追加预算`:''}；仅计绿植与预备金，可继续点击空地种植。`);write('#design-title','只种绿植，也能规划校园绿荫');write('#design-description',`本期布置 ${p.fundedTrees} 株绿植，无需绘制路线。新增树荫、阳光直射覆盖率与每株推荐度会随种植和模拟时间更新。`);}
 $('#route-shape-control').hidden=state.type==='plants';$('#route-dimensions').hidden=state.type==='plants';$('#route-points-count').hidden=state.type==='plants';$('#construction-metrics').hidden=state.type==='plants';$('#reset-rates').hidden=state.type==='plants';
 write('.cost-sub',state.type==='plants'?'绿植与布置费用':'材料 + 施工 + 种树 + 固定费用');
 $('#toggle-pedestrians').disabled=Boolean(state.image);write('#toggle-pedestrians',state.image?'行人：待标注通行区':state.pedestrians?'校园行人：开启':'校园行人：关闭');
 write('.legend-tail',state.type==='plants'?'已安排绿植 · 每株计入预算':'模块长度 6 m · 仅用于概算');
 renderSegments();renderEditing();drawRoute();drawTrees();drawCalibration();syncScene();if(materials)renderMaterials();else renderMaterialTotals();climatePanel?.refreshRecommendations();
}
function setSegmentEditing(enabled){
 state.splitting=Boolean(enabled&&state.type==='mixed'&&!routeSpace()&&state.route.length>1&&!state.editing);
 scene3D?.setSegmentEditing?.(state.splitting);$('#split-route').setAttribute('aria-pressed',String(state.splitting));write('#split-route',state.splitting?'✓ 完成分段':'在图上点击分段');renderEditing();
}
function splitAtFraction(fraction){
 if(!Number.isFinite(fraction)||fraction<=0||fraction>=1){toast('分界须在起点与终点之间。');return false;}
 const index=state.sections.findIndex(s=>fraction>s.startFraction&&fraction<s.endFraction);
 if(index<0||state.sections.some(s=>Math.abs(s.startFraction-fraction)<Number.EPSILON*8||Math.abs(s.endFraction-fraction)<Number.EPSILON*8)){toast('这里已有分界，请换一个位置。');return false;}
 const section=state.sections[index],next={...section,id:state.nextSectionId++,startFraction:fraction};section.endFraction=fraction;state.sections.splice(index+1,0,next);update();toast(`已分成 ${state.sections.length} 段，现在可以逐段选择材料。`);return true;
}
function splitRouteAtPoint(point){
 if(!state.splitting)return;
 const projected=projectPointOnRoute(state.route,point);
 if(!projected||projected.distance>Math.max(14,valueOf('#width')/(state.metersPerPixel||1))){toast('请点击已有路线附近，分界会吸附到路线上。');return;}
 splitAtFraction(projected.fraction);
}
function renderSegments(){
 const visible=state.type==='mixed';$('#segment-editor').hidden=!visible;$('#enable-mixed').hidden=visible||state.type==='plants';if(!visible)return;
 const length=valueOf('#length'),ready=Number.isFinite(length)&&length>0&&!state.editing&&!routeSpace();
 for(const id of ['#split-route','#split-at-distance','#add-section','#segment-example'])$(id).disabled=!ready;
 const list=$('#segment-list'),strip=$('#segment-strip');list.replaceChildren();strip.replaceChildren();
 if(!ready){write('#segment-summary',routeSpace()?'当前是室内通行路线，仅安排绿植，不建户外棚廊。':'先完成路线与比例校准，再设置每段的材料。');return;}
 state.sections.forEach((section,index)=>{
  const computed=state.plan?.valid?state.plan.sections?.[index]:null;
  const block=document.createElement('span');block.style.flex=String(section.endFraction-section.startFraction);block.style.background=sectionColors[section.type];block.textContent=String(index+1);block.setAttribute('title',`第 ${index+1} 段 ${planNames[section.type]}`);strip.append(block);
  const row=document.createElement('div');row.className='segment-row';row.dataset.section=section.id;row.style.borderLeftColor=sectionColors[section.type];
  const heading=document.createElement('div');heading.className='segment-row-title';const number=document.createElement('strong');number.textContent=`第 ${index+1} 段`;const range=document.createElement('span');range.textContent=`${num(section.startFraction*length)} → ${num(section.endFraction*length)} m`;heading.append(number,range);row.append(heading);
  const label=document.createElement('label');label.className='segment-material';label.textContent='建设方式';const select=document.createElement('select');select.dataset.sectionType=String(index);select.setAttribute('aria-label',`第 ${index+1} 段建设方式`);
  for(const type of ['corridor','solid','mesh','plants']){const option=document.createElement('option');option.value=type;option.textContent=planNames[type];select.append(option);}select.value=section.type;
  select.addEventListener('change',()=>{if(!['mesh','solid','corridor','plants'].includes(select.value))return;section.type=select.value;update();});label.append(select);row.append(label);
  const endLabel=document.createElement('label');endLabel.className='segment-end';endLabel.textContent=index===state.sections.length-1?'终点（m）':'分界（距起点 m）';const end=document.createElement('input');end.type='number';end.step='any';end.value=String(section.endFraction*length);end.disabled=index===state.sections.length-1;end.setAttribute('aria-label',`第 ${index+1} 段结束位置（米）`);
  end.addEventListener('change',()=>{const fraction=Number(end.value)/length,next=state.sections[index+1];if(!next||!end.value.trim()||!Number.isFinite(fraction)||fraction<=section.startFraction||fraction>=next.endFraction){toast('分界必须在前后两段的外侧边界之间。');renderSegments();return;}section.endFraction=fraction;next.startFraction=fraction;update();});endLabel.append(end);row.append(endLabel);
  const cost=document.createElement('div');cost.className='segment-cost';const amount=document.createElement('strong');amount.textContent=computed?`本期 ¥${planMoney(computed,'fundedCost')}`:'费用待计算';const detail=document.createElement('small');detail.textContent=section.type==='plants'?'不建棚廊 · 实际种植费用统一计入绿植':computed?`全段 ¥${planMoney(computed,'fullCost')} · 已安排 ${num(computed.coveredLengthM)} / ${num(computed.lengthM)} m`:'';cost.append(amount,detail);row.append(cost);
  const merge=document.createElement('button');merge.className='text-button';merge.textContent='并入前段';merge.disabled=index===0;merge.setAttribute('aria-label',`将第 ${index+1} 段并入前段`);merge.addEventListener('click',()=>{if(index===0)return;state.sections[index-1].endFraction=section.endFraction;state.sections.splice(index,1);update();});row.append(merge);list.append(row);
 });
 write('#segment-summary',state.plan?.valid?`${state.sections.length} 段 · 本期建设 ¥${planMoney(state.plan,'fundedCost')} + 预备金 ¥${planMoney(state.plan,'reserveAmount')} = ¥${planMoney(state.plan,'fundedTotal')} / 总预算 ¥${planMoney(state.plan,'budget')}`:'修正预算或单价后，将统一计算各段费用。');
}

function syncLengthFromRoute(){
  const length=deriveRouteLength(state.route,state.metersPerPixel);
  $('#length').value=length===null?'':String(length);
}
function renderEditing(){
  $('#map-wrap').classList.toggle('editing',state.editing||state.splitting);$('#edit-hint').hidden=!state.editing&&!state.splitting;
  $('#finish-route').hidden=!state.editing||routeTwoPoint||state.routeShape==='curve';$('#undo-route').hidden=!state.editing;$('#cancel-route').hidden=!state.editing;$('#edit-route').hidden=state.editing||state.type==='plants';
  write('#edit-route',state.routeShape==='curve'?'⌒ 绘制弧线':state.routeShape==='polyline'?'⌁ 绘制折线':'⌁ 起点 → 终点');
  const hint=state.splitting?'点击已有路线附近设置分界；可连续添加，完成后再为各段选择材料。':state.editing?(state.routeShape==='curve'?(['① 选择弧线起点','② 选择弧线终点','③ 点击希望弧线经过的位置，自动完成'][state.route.length]||'正在生成弧线'):routeTwoPoint?(state.route.length?'② 点击地面选终点，自动完成路线':'① 点击地面选起点，再点击终点'):'依次点击路径点，再点「完成标注」。'):state.planting?'种树中：点击空地布置绿植，拖动只转动视角。':state.type==='plants'?'仅种绿植：点击「种树」即可布置，无需画路线。':'选择「种树」或「起点 → 终点」，规划和漫游均可编辑。';
  write('#edit-hint',hint);write('#interaction-status',hint);
}
function cancelRoute(restore=true){
  if(!state.editing)return;
  if(restore&&routeBackup){state.route=routeBackup.route;state.routeKind=routeBackup.kind;state.metersPerPixel=routeBackup.metersPerPixel;state.scaleSource=routeBackup.scaleSource;$('#length').value=routeBackup.length;}
  state.editing=false;routeBackup=null;scene3D?.setRouteEditing(false);renderEditing();update();
}
function finishRoute(){
  if(state.routeShape==='curve'&&state.editing&&state.route.length<3){toast('请先选择起点、终点，再点希望弧线经过的位置。');return;}
  if(state.route.length<2||!routeLength()){toast('请标注两个不同的路径点。');return;}
  state.editing=false;routeBackup=null;scene3D?.setRouteEditing(false);syncLengthFromRoute();renderEditing();update();
  const assessment=climatePanel?.getAssessment?.();if(assessment?.valid&&assessment.score<50){toast(`路线推荐度 ${assessment.score}%，可行性过低，请换一条路线。`);return;}
  toast(state.metersPerPixel?`路径已完成，按图纸比例测得 ${num(valueOf('#length'))} m。`:'路径已完成，请校准图纸比例或填写这条路径的实测长度。');
}
function addRoutePoint(point){
  if(!state.editing)return;
  const last=state.route.at(-1);if(last&&Math.hypot(point.x-last.x,point.y-last.y)<.001){toast('终点不能与起点重合，请点击另一处。');return;}
  if(last&&(last.interior||null)!==(point.interior||null)){toast('室内和室外请分别规划，选择同一空间内的终点。');return;}
  if(state.routeShape==='curve'&&state.route.length===2){
    const curve=curveThroughPoint(state.route[0],state.route[1],point);
    if(!curve){toast('这三个位置无法形成有效弧线，请换一个经过点。');return;}
    if(curve.some(p=>p.x<0||p.x>980||p.y<0||p.y>570)){toast('弧线超出图纸范围，请把经过点选得靠近起终点一些。');return;}
    const validation=scene3D?.validateRoute?.(curve);if(validation&&!validation.valid){toast(validation.message||'弧线穿过建筑或障碍，请重新选择经过点。');return;}
    state.route=curve;syncLengthFromRoute();finishRoute();return;
  }
  state.route.push({...point});syncLengthFromRoute();
  if(routeTwoPoint&&state.route.length===2)finishRoute();else {update();if(state.routeShape==='curve')toast(state.route.length===1?'起点已选，请选终点。':'终点已选，再点击希望弧线经过的位置。');else if(routeTwoPoint)toast('起点已标记，请点击终点。');}
}
function startRoute(){
  if(state.editing||state.type==='plants')return;
  setSegmentEditing(false);setPlanting(false);cancelCalibration();selectTab('design');routeBackup={route:structuredClone(state.route),length:$('#length').value,kind:state.routeKind,metersPerPixel:state.metersPerPixel,scaleSource:state.scaleSource};routeTwoPoint=state.routeShape==='straight';state.routeKind=state.routeShape;
  state.editing=true;state.route=[];$('#length').value='';scene3D?.setRouteEditing(state.view==='3d');update();closeSettings();
  toast(state.routeShape==='curve'?'依次选起点、终点和希望经过的位置，第三次点击自动生成弧线。':routeTwoPoint?'点击地面选起点，再点终点即可完成；拖动可转动视角。':'依次标记路径点，再点「完成标注」。');
}
function closeSettings(){document.body.classList.remove('settings-open');$('#toggle-settings').setAttribute('aria-expanded','false');}
function togglePlanting(){
  setSegmentEditing(false);
  if(state.editing)cancelRoute();cancelCalibration();selectTab('design');setPlanting(!state.planting);closeSettings();
  if(state.planting)toast('点击地面布置绿植；室内布置为盆栽，费用计入预算。');
}
async function loadImage(file){
 if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('请上传 JPG、PNG 或 WebP 图片。');return;}if(file.size>10*1024*1024){toast('图片不能超过 10 MB。');return;}
 try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const img=new Image();img.src=data;await img.decode();setSegmentEditing(false);cancelRoute(false);state.route=[];state.image=data;state.metersPerPixel=null;state.scaleSource='unknown';state.trees=[];write('#file-name',file.name);write('#map-caption','已上传校园图 · 请按实测尺寸规划');$('#length').value='';drawBase();selectTab('design');if(state.type==='plants'){update();setPlanting(true);toast('图纸已载入，可以布置绿植；校准比例后计算遮阴覆盖率。');return;}startRoute();toast(state.view==='3d'?'图片已载入：在 3D 底图点击起点、再点终点。':'图片已载入：请依次标记路径点。');}catch{toast('图片读取失败，请换一张有效图片。');}
}
function resetSample(){setSegmentEditing(false);cancelRoute(false);cancelCalibration();setPlanting(false);state.metersPerPixel=SAMPLE_METERS_PER_PIXEL;state.scaleSource='sample';state.trees=[];state.image=null;state.route=structuredClone(sampleRoute);state.routeKind='polyline';state.editing=false;$('#length').value='48';$('#width').value='2.4';$('#plan-file').value='';write('#file-name','正在使用：示例校园');write('#map-caption','示例校园 · 非真实场地测绘');$('#map-wrap').classList.remove('editing');$('#edit-hint').hidden=true;$('#finish-route').hidden=true;$('#undo-route').hidden=true;$('#edit-route').hidden=false;drawBase();syncLengthFromRoute();update();toast('已恢复示例校园，保留当前预算。');}
function download(contents,type,name){const url=URL.createObjectURL(new Blob([contents],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function exportPlan(){
 const p=state.plan;if(!p?.valid)return;
 if(state.view==='3d'&&scene3D){await exportSceneImage();return;}
 const svg=$('#campus-map').cloneNode(true);svg.setAttribute('viewBox','0 0 980 750');svg.setAttribute('width','980');svg.setAttribute('height','750');
 svgAdd(svg,'rect',{x:0,y:570,width:980,height:180,fill:'#fff'});svgAdd(svg,'text',{x:28,y:607,'font-size':22,fill:'#28533e','font-family':'sans-serif'},p.treeOnly?'绿荫森林 · 绿植规划':p.layoutOnly?`绿荫森林 · ${p.spaceName}室内规划`:'绿荫森林 · 校园遮阳概念方案');
 svgAdd(svg,'text',{x:28,y:640,'font-size':14,fill:'#4b6140','font-family':'sans-serif'},`预算 ¥${planMoney(p,'budget')} ｜ 建设 ¥${planMoney(p,'fundedCost')} ｜ 预备金 ¥${planMoney(p,'reserveAmount')} ｜ 合计 ¥${planMoney(p,'fundedTotal')}`);
 svgAdd(svg,'text',{x:28,y:668,'font-size':14,fill:'#4b6140','font-family':'sans-serif'},p.treeOnly?`本期安排 ${p.fundedTrees} 株绿植 ｜ 仅计绿植与预备金`:p.layoutOnly?`室内通行路径 ${num(p.lengthM)} m ｜ 全校园已安排 ${p.fundedTrees} 株绿植 ｜ 仅计绿植与预备金`:`本期覆盖 ${num(p.coveredLengthM)} / ${num(p.lengthM)} m ｜ 净宽 ${num(p.widthM)} m ｜ ${planNames[state.type]} ｜ ${p.status==='full'?'全程预算可行':'尚未实现全程覆盖'}`);
 svgAdd(svg,'text',{x:28,y:699,'font-size':12,fill:'#8c977f','font-family':'sans-serif'},'示例估价；图示与构件数量用于概算，不是施工图。结构、基础、规格和报价须现场复核。');
 svgAdd(svg,'text',{x:28,y:722,'font-size':12,fill:'#8c977f','font-family':'sans-serif'},p.treeOnly?'仅种绿植方案；图示树冠与光照为模拟估算。':p.layoutOnly?'室内绿线为通行指示，不采购户外遮阳棚。绿植费用包含全校园已安排的绿植。':p.type==='mixed'?'各段按材料着色并标号；橙色虚线待建，绿植段不建棚廊。详见分段预算清单。':'绿色为本期建设段，虚线为待建设段。路径按图纸比例换算，图形不构成测绘结果。');
 download(new XMLSerializer().serializeToString(svg),'image/svg+xml;charset=utf-8','绿荫森林-校园遮阳概念图.svg');toast('设计图已导出，包含预算与概念说明。');
}
function exportCSV(){
 const p=currentCostPlan();if(!p?.valid)return;
 const name=p.treeOnly?'全校园绿植清单':p.layoutOnly?`${p.spaceName} · 室内路径与绿植`:planNames[state.type];
 const rows=[['绿荫森林 规划预算清单（示例估价，非采购订单）'],['方案',name],['总预算',planMoney(p,'budget').replaceAll(',','')]];
 if(!p.treeOnly){rows.push(['规划路径(m)',p.lengthM],['净宽(m)',p.widthM]);if(!p.layoutOnly)rows.push(['本期遮阳覆盖(m)',p.coveredLengthM]);}
 if(p.type==='mixed')rows.push([],['分段','距起点(m)','至(m)','建设方式','段长(m)','本期棚廊(m)','本期费用(元)','全段费用(元)'],...p.sections.map((s,i)=>[i+1,s.startFraction*p.lengthM,s.endFraction*p.lengthM,planNames[s.type],s.lengthM,s.coveredLengthM,planMoney(s,'fundedCost').replaceAll(',',''),planMoney(s,'fullCost').replaceAll(',','')]));
 rows.push([],['材料/服务','单位','本期数量','示例单价(元)','小计(元)'],...p.items.map(x=>[x.id==='trees'?'全校园绿植与布置（示例）':x.name,x.id==='trees'?'株':x.unit,x.exactQuantity??x.quantity,x.exactUnitPriceCents!==undefined?formatCents(x.exactUnitPriceCents).replaceAll(',',''):x.unitPrice,x.exactTotalCents!==undefined?formatCents(x.exactTotalCents).replaceAll(',',''):x.total]),[],['本期费用',planMoney(p,'fundedCost').replaceAll(',','')],['预备金',planMoney(p,'reserveAmount').replaceAll(',','')],['合计占用预算',planMoney(p,'fundedTotal').replaceAll(',','')],['剩余预算',planMoney(p,'unallocatedAmount').replaceAll(',','')],[],[p.treeOnly?'仅含已安排绿植与预备金，不采购路径工程。':p.layoutOnly?'室内路线为通行示意，仅计绿植和预备金，不采购户外遮阳棚。':'室外数量按6m计价模块估算，结构与供应商报价须现场复核。'],['绿植数量为全校园已安排的室外乔木与室内盆栽合计，按可编辑示例单价估算。']);
 download('\ufeff'+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n'),'text/csv;charset=utf-8','绿荫森林-材料预算清单.csv');toast('材料清单已导出。');
}

function planInput(){return {sections:state.sections,ratesByType:state.rates,lengthM:valueOf('#length'),widthM:valueOf('#width'),budget:$('#budget').value.trim(),reservePct:valueOf('#reserve'),type:state.type,rates:state.rates[state.type],treesCount:state.trees.length,treeUnitPrice:valueOf('#tree-price')};}
function syncScene(){
  if(!scene3D)return;
  if(simulatedEnvironment)scene3D.setEnvironment(simulatedEnvironment);
  scene3D.update({route:state.type==='plants'?[]:state.route,routeShape:state.routeShape,plan:state.plan,image:state.image,type:state.type,widthM:valueOf('#width'),metersPerPixel:state.metersPerPixel,trees:state.trees.map((tree,i)=>({...tree,funded:state.treePlan?.valid&&i<state.treePlan.fundedTrees}))});
  scene3D.setLightCoverageVisible?.(state.lightCoverage);scene3D.setLightCoverage?.(latestCoverageMap);scene3D.setPedestriansEnabled?.(state.pedestrians&&!state.image);
  write('#scene-badge',state.image?'上传图纸作为底图 · 建筑体块待补充':'示例校园 · 建筑高度为示意');
}
function setView(view){
  if(state.editing&&view!==state.view)cancelRoute();
  state.view=view;$('#map-wrap').classList.toggle('view-3d',view==='3d');
  $$('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  write('#view-caption',view==='3d'?'3D 概念场景':'平面标注');write('#export-plan',view==='3d'?'↓ 导出 3D 方案':'↓ 导出平面图');
  if(view==='2d'&&state.mode==='walk')setMode('orbit');
  renderEditing();renderLightCoverageStatus();requestAnimationFrame(()=>scene3D?.resize());
}
function setMode(mode){
  state.mode=mode;scene3D?.setMode(mode);$('#walk-controls').hidden=mode!=='walk';$('#map-wrap').classList.toggle('walking',mode==='walk');
  $$('[data-mode]').forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  if(mode==='walk')renderMovement({flying:false,grounded:true,heightM:0});
  else write('#scene-help','拖动旋转 · 滚轮缩放');
}
function renderMovement({flying,grounded,heightM}){
  write('#movement-status',flying?`飞行中 · ${num(heightM)} m`:grounded?'地面行走':'空中 · 正在跳跃或下落');
  $('#flight-action').setAttribute('aria-pressed',String(flying));write('#flight-action',flying?'结束飞行':'飞行');
  $('#flight-controls').hidden=!flying;$('#jump-action').disabled=flying||!grounded;
  if(state.mode==='walk')write('#scene-help',flying?'WASD 移动 · 空格上升 / Shift 下降 · 双击空格结束飞行':'WASD 走动 · 空格跳跃 · 双击空格飞行 · 拖动转头');
}
function setPlanting(enabled){
  if(enabled)setSegmentEditing(false);
  state.planting=enabled;scene3D?.setPlanting(enabled);$('#plant-tree').classList.toggle('active',enabled);$('#plant-tree').setAttribute('aria-pressed',String(enabled));write('#plant-tree',enabled?'✓ 结束种树':'♧ 开始种树');$('#plant-hint').hidden=!enabled;$('#map-wrap').classList.toggle('planting',enabled);$('#plant-tree-scene').classList.toggle('active',enabled);$('#plant-tree-scene').setAttribute('aria-pressed',String(enabled));write('#plant-tree-scene',enabled?'✓ 结束种树':'♧ 种树');renderEditing();
}
function plantAt(point){
  if(!state.planting)return;
  const placement=scene3D?.validatePlantPoint?.(point);if(placement&&!placement.valid){toast(placement.message||'这里无法种树，请选择其他空地。');return;}if(placement?.interior)point={...point,interior:placement.interior};
  if(!state.treePlan?.valid){toast(state.treePlan?.error||'请填写有效预算和绿植单价。');return;}
  if(!state.image&&!point.interior){const buildings=[[89,126,219,113],[689,321,195,114],[92,385,159,96],[507,450,118,77]];if(buildings.some(([x,y,w,h])=>point.x>=x&&point.x<=x+w&&point.y>=y&&point.y<=y+h)){toast('这里无法种树：建筑内部请先从门口进入，再选择室内空地放置盆栽。');return;}}
  const proposal=calculateTreeBudget({...treeInput(),treesCount:state.trees.length+1});
  if(!proposal.valid){toast(proposal.error||'请填写有效预算和绿植单价。');return;}
  if(!proposal.treeAffordable){toast(`可用预算不足以再种一棵树（示例单价 ¥${money(valueOf('#tree-price'))}）。`);return;}
  const id=state.nextTreeId++;state.trees.push({id,x:point.x,y:point.y,interior:point.interior||null});update();
  const assessment=climatePanel?.getPlantingAssessment?.(),tree=assessment?.trees?.find(t=>t.id===id);
  toast(tree&&Number.isFinite(tree.score)?`已布置 #${id}，推荐度 ${tree.score}%。树荫范围已更新，具体原因见绿植评分。`:`已布置 ${state.trees.length} 株绿植，费用已计入预算；光照覆盖率已更新。`);
}
function drawTrees(){
  const group=$('#tree-overlay');group.replaceChildren();
  state.trees.forEach((tree,i)=>{const funded=state.treePlan?.valid&&i<state.treePlan.fundedTrees;svgAdd(group,'circle',{cx:tree.x,cy:tree.y,r:12,fill:funded?'#7d9e57':'#ddbb83',stroke:'#fff','stroke-width':2});svgAdd(group,'text',{x:tree.x,y:tree.y+4,'text-anchor':'middle','font-size':11,fill:'#fff'},'♧');});
}
function drawCalibration(){
  const group=$('#calibration-overlay');group.replaceChildren();
  if(!state.calibrating)return;
  if(state.calibration.length===2)svgAdd(group,'line',{x1:state.calibration[0].x,y1:state.calibration[0].y,x2:state.calibration[1].x,y2:state.calibration[1].y,stroke:'#bf8942','stroke-width':3,'stroke-dasharray':'6 4'});
  state.calibration.forEach((point,i)=>{svgAdd(group,'circle',{cx:point.x,cy:point.y,r:9,fill:'#bf8942',stroke:'#fff','stroke-width':2});svgAdd(group,'text',{x:point.x,y:point.y+4,'text-anchor':'middle','font-size':10,fill:'#fff'},String(i+1));});
}
function cancelCalibration(){state.calibrating=false;state.calibration=[];$('#calibration-panel').hidden=true;$('#map-wrap').classList.remove('calibrating');drawCalibration();}
async function initializeScene(){
  try{const {createCampusScene}=await import('./scene3d.mjs');scene3D=createCampusScene($('#campus-scene'),{onPlant:plantAt,onRoutePoint:addRoutePoint,onRouteSplit:splitRouteAtPoint,onPedestriansChange:({total=0,indoors=0,locations={}}={})=>{const rooms=Object.entries(locations).filter(([,count])=>count>0).map(([name,count])=>`${name} ${count} 人`).join(' · ');write('#pedestrian-status',state.image?'上传图：需先明确可通行区域':!state.pedestrians?'校园行人已关闭':`${total} 名行人 · 室内 ${indoors} 名${rooms?' · '+rooms:''}`);},onLocationChange:location=>write('#scene-location',location?`${location} · 室内可布置盆栽和路径`:'室外校园 · 从门口可进入建筑'),onStatus:message=>toast(message),onMovementChange:renderMovement,onModeChange:mode=>{if(state.mode!==mode)setMode(mode);}});$('#scene-loading').hidden=true;syncScene();setMode(state.mode);scene3D.resize();}
  catch(error){console.error('3D scene initialization failed',error);write('#scene-loading','3D 场景暂未加载，请刷新或切换平面图。');toast('3D 初始化失败，平面规划仍可使用。');}
}
async function exportSceneImage(){
  try{const source=await scene3D.capture();const img=new Image();img.src=source;await img.decode();const canvas=document.createElement('canvas');canvas.width=Math.max(1000,img.width);canvas.height=Math.round(img.height*canvas.width/img.width)+180;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height-180);const p=state.plan,y=canvas.height-145;ctx.fillStyle='#28533e';ctx.font='bold 24px sans-serif';ctx.fillText(p.treeOnly?'绿荫森林 · 绿植规划':p.layoutOnly?`绿荫森林 · ${p.spaceName}室内规划`:'绿荫森林 · 3D 校园规划概念方案',28,y);ctx.font='17px sans-serif';ctx.fillText(`预算 ¥${planMoney(p,'budget')}  /  本期建设 ¥${planMoney(p,'fundedCost')}  /  预备金 ¥${planMoney(p,'reserveAmount')}`,28,y+38);ctx.fillText(p.treeOnly?`本期安排 ${p.fundedTrees} 株绿植 · 仅计绿植与预备金`:p.layoutOnly?`室内通行路径 ${num(p.lengthM)} m · 全校园已安排 ${p.fundedTrees} 株绿植 · 不采购遮阳棚`:`覆盖 ${num(p.coveredLengthM)} / ${num(p.lengthM)} m · 已安排 ${p.fundedTrees} 株绿植`,28,y+69);ctx.fillStyle='#839479';ctx.font='14px sans-serif';ctx.fillText('示例估价与概念体块，不是施工图；树冠与光照为示意，不代表实测遮阴效果。',28,y+108);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG encoding failed');download(blob,'image/png','绿荫森林-3D校园方案.png');toast('3D 方案已导出，包含当前视角与预算。');}catch{toast('3D 图片导出失败，请切换平面图导出。');}
}

$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
$('#show-costs').addEventListener('click',()=>selectTab('materials'));
['#budget','#width','#reserve','#tree-price'].forEach(id=>$(id).addEventListener('input',()=>update()));
$$('[data-budget]').forEach(b=>b.addEventListener('click',()=>{$('#budget').value=b.dataset.budget;update();}));
function setPlanType(type){
 if(!Object.hasOwn(planNames,type))return;
 setSegmentEditing(false);cancelRoute();cancelCalibration();if(type==='mixed'&&state.type!=='mixed'&&state.sections.length===1)state.sections[0].type=state.type;state.type=type;$('#plan-type').value=type;
 $$('[data-type]').forEach(x=>{const selected=x.dataset.type===type;x.classList.toggle('selected',selected);x.setAttribute('aria-pressed',String(selected));});
 write('#plan-type-description',type==='mixed'?'同一路线按段选材料，3D、光照与总预算同步更新。':type==='plants'?'无需画路线，直接布置绿植；按绿植与预备金计算。':type==='corridor'?'实体屋面、结构基础、地面铺装、排水与照明，分别计入预算。':type==='mesh'?'按路线估算遮阳网与绿植费用。':'按路线估算 PC 板连廊与绿植费用。');
 $('.page-heading h1').textContent=type==='plants'?'校园绿植规划':`${planNames[type]} · 校园规划`;
 update();renderGuide();
}
$$('[data-type]').forEach(b=>b.addEventListener('click',()=>setPlanType(b.dataset.type)));
$('#route-shape').addEventListener('change',()=>{cancelRoute();state.routeShape=$('#route-shape').value;renderEditing();});
$('#plan-type').addEventListener('change',()=>setPlanType($('#plan-type').value));
$('#enable-mixed').addEventListener('click',()=>{setPlanType('mixed');toast('综合路线已开启，可以在图上分段或输入分界距离。');});
$('#split-route').addEventListener('click',()=>{if(state.editing)cancelRoute();setPlanting(false);cancelCalibration();setSegmentEditing(!state.splitting);});
$('#split-at-distance').addEventListener('click',()=>{const raw=$('#split-distance').value.trim();if(!raw){toast('请输入距离起点的米数。');return;}splitAtFraction(Number(raw)/valueOf('#length'));});
$('#add-section').addEventListener('click',()=>{const longest=state.sections.reduce((a,b)=>(b.endFraction-b.startFraction)>(a.endFraction-a.startFraction)?b:a);splitAtFraction((longest.startFraction+longest.endFraction)/2);});
$('#segment-example').addEventListener('click',()=>{state.sections=['mesh','solid','corridor'].map((type,i)=>({id:state.nextSectionId++,type,startFraction:i/3,endFraction:(i+1)/3}));update();toast('已搭配遮阳网、PC 连廊和完整走廊；每段都能继续修改。');});
$('#generate').addEventListener('click',()=>{update();selectTab('design');if(state.plan.valid){document.body.classList.remove('settings-open');$('#toggle-settings').setAttribute('aria-expanded','false');}toast(state.plan.valid?'方案已更新，设计图与清单已同步。':state.type==='plants'?'请填写有效预算和绿植单价。':'请先完成路径，并补齐有效的尺寸和价格。');});
$('#cancel-route').addEventListener('click',()=>{cancelRoute();toast('已取消重画，保留原路线。');});$('#edit-route').addEventListener('click',startRoute);$('#finish-route').addEventListener('click',finishRoute);$('#undo-route').addEventListener('click',()=>{state.route.pop();syncLengthFromRoute();update();});
$('#campus-map').addEventListener('click',e=>{
  if(!state.editing&&!state.calibrating&&!state.planting&&!state.splitting)return;
  const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(e.currentTarget.getScreenCTM().inverse());
  if(pt.x<0||pt.x>980||pt.y<0||pt.y>570)return;
  const point={x:Math.round(pt.x*100)/100,y:Math.round(pt.y*100)/100};
  if(state.splitting){splitRouteAtPoint(point);return;}
  if(state.planting){plantAt(point);return;}
  if(state.calibrating){if(state.calibration.length===2)state.calibration=[];state.calibration.push(point);drawCalibration();return;}
  addRoutePoint(point);
});
$('#plan-file').addEventListener('change',e=>loadImage(e.target.files[0]));
$('#dropzone').addEventListener('dragover',e=>{e.preventDefault();$('#dropzone').classList.add('dragover');});$('#dropzone').addEventListener('dragleave',()=>$('#dropzone').classList.remove('dragover'));$('#dropzone').addEventListener('drop',e=>{e.preventDefault();$('#dropzone').classList.remove('dragover');loadImage(e.dataTransfer.files[0]);});
$('#use-sample').addEventListener('click',resetSample);$('#export-plan').addEventListener('click',exportPlan);$('#export-csv').addEventListener('click',exportCSV);$('#reset-rates').addEventListener('click',()=>{if(state.type==='plants')return;if(state.type==='mixed')for(const type of ['mesh','solid','corridor'])state.rates[type]=DEFAULT_RATES(type);else state.rates[state.type]=DEFAULT_RATES(state.type);update();toast('已恢复本方案的示例单价。');});
$('#toggle-settings').addEventListener('click',()=>{const opened=document.body.classList.toggle('settings-open');$('#toggle-settings').setAttribute('aria-expanded',String(opened));});
$('#length').addEventListener('input',()=>{const length=valueOf('#length'),pixels=routeLength();if(Number.isFinite(length)&&length>0&&pixels>0){state.metersPerPixel=length/pixels;state.scaleSource='manual';}update();});
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
$$('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
$$('[data-enter]').forEach(button=>button.addEventListener('click',()=>{setView('3d');scene3D?.enterBuilding(button.dataset.enter);}));
function renderLightCoverageStatus(){
 $('#light-coverage-legend').hidden=state.view!=='3d'||!state.lightCoverage;
 $('#toggle-light-coverage').classList.toggle('active',state.lightCoverage);$('#toggle-light-coverage').setAttribute('aria-pressed',String(state.lightCoverage));
 write('#light-coverage-status',latestCoverageMap?.night?'夜间无直射日光，范围着色已隐藏':latestCoverageMap?.valid?'模拟覆盖 · 新增树荫为原有遮阴之外的净增区域':'校准图纸比例后显示覆盖范围');
}
$('#toggle-light-coverage').addEventListener('click',()=>{state.lightCoverage=!state.lightCoverage;scene3D?.setLightCoverageVisible?.(state.lightCoverage);renderLightCoverageStatus();});
$('#toggle-pedestrians').addEventListener('click',()=>{state.pedestrians=!state.pedestrians;scene3D?.setPedestriansEnabled?.(state.pedestrians&&!state.image);$('#toggle-pedestrians').classList.toggle('active',state.pedestrians);$('#toggle-pedestrians').setAttribute('aria-pressed',String(state.pedestrians));write('#toggle-pedestrians',state.pedestrians?'校园行人：开启':'校园行人：关闭');});
$('#scene-reset').addEventListener('click',()=>{setMode('orbit');scene3D?.resetView();});
$('#jump-action').addEventListener('click',()=>scene3D?.jump());
$('#flight-action').addEventListener('click',()=>scene3D?.toggleFlight());
$('#plant-tree').addEventListener('click',togglePlanting);$('#plant-tree-scene').addEventListener('click',togglePlanting);
function undoTree(){state.trees.pop();update();toast('已撤销上一株绿植，预算已同步。');}$('#undo-tree').addEventListener('click',undoTree);$('#undo-tree-scene').addEventListener('click',undoTree);
$('#calibrate-scale').addEventListener('click',()=>{setSegmentEditing(false);cancelRoute();setPlanting(false);state.calibrating=true;state.calibration=[];setView('2d');selectTab('design');$('#calibration-panel').hidden=false;$('#map-wrap').classList.add('calibrating');drawCalibration();toast('点击图中两个已知实际距离的位置。');});
$('#cancel-calibration').addEventListener('click',cancelCalibration);
$('#apply-calibration').addEventListener('click',()=>{if(state.calibration.length!==2){toast('请先在图上选择两个校准点。');return;}const scale=calibrationScale(state.calibration[0],state.calibration[1],valueOf('#calibration-distance'));if(!scale){toast('校准点必须不同，实际距离须大于 0。');return;}state.metersPerPixel=scale;state.scaleSource='calibrated';cancelCalibration();syncLengthFromRoute();update();toast('比例已校准，路径长度与预算已重新计算。');});
$$('[data-move]').forEach(button=>{button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);scene3D?.move(button.dataset.move,true);});['pointerup','pointercancel','lostpointercapture'].forEach(event=>button.addEventListener(event,()=>scene3D?.move(button.dataset.move,false)));});
$('#campus-scene').addEventListener('campus-escape',()=>{setSegmentEditing(false);cancelRoute();setPlanting(false);if(state.mode!=='orbit')setMode('orbit');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){setSegmentEditing(false);cancelRoute();setPlanting(false);if(state.mode==='walk')setMode('orbit');}});
drawBase();syncLengthFromRoute();update();renderGuide();initializeScene();

function recommendationContext(){
  if(state.type==='mixed'&&state.sections.every(s=>s.type==='plants'))return {plantsOnly:true,blockReason:'这条路线各段仅布置绿植；种植后查看绿植推荐度和光照覆盖。'};
  if(state.type==='plants')return {plantsOnly:true,blockReason:'当前仅种绿植；查看每株推荐度和种植后的光照覆盖即可。'};
  if(state.editing)return {blockReason:'先完成起终点选择，再评估这条路线的推荐度。'};
  if(!state.metersPerPixel)return {blockReason:'先校准图纸比例，才能按真实长度和预算比较路线。'};
  const context={budgetInput:planInput(),metersPerPixel:state.metersPerPixel,trees:state.trees.filter((t,i)=>!t.interior&&state.treePlan?.valid&&i<state.treePlan.fundedTrees),useSampleObstacles:!state.image,currentRoute:state.route,currentInterior:routeSpace()};
  if(state.image)context.candidates=state.route.length>=2&&!routeSpace()?[{id:'uploaded-route',from:'当前起点',to:'当前终点',route:state.route}]:[];
  return context;
}
function applyRecommendedRoute(candidate){
  if(state.type==='plants'||!candidate?.route?.length)return;
  const length=deriveRouteLength(candidate.route,state.metersPerPixel),p=calculatePlan({...planInput(),lengthM:length});
  if(!p.valid||(!p.fundedModules&&!(p.type==='mixed'&&p.status==='full'))){toast('当前预算不足或输入无效，请调整后重新推荐。');return;}
  if(candidate.recommendationScore!==undefined&&candidate.recommendationScore<50){toast('可行性过低，请换一条路线。');return;}
  setSegmentEditing(false);cancelRoute(false);cancelCalibration();setPlanting(false);state.route=structuredClone(candidate.route);state.routeKind='polyline';$('#length').value=String(length);selectTab('design');setView('3d');update();setMode('orbit');scene3D?.resetView();
  $('.page-heading h1').textContent=`${candidate.from} → ${candidate.to}`;write('#metric-route-context','环境推荐路线');
  toast('已采用推荐路线，预算、材料清单与 3D 已同步。');
}
function plantingContext(){return {trees:state.trees.map((tree,i)=>({...tree,funded:Boolean(state.treePlan?.valid&&i<state.treePlan.fundedTrees)})),environment:simulatedEnvironment,budgetInput:treeInput(),metersPerPixel:state.metersPerPixel,useSampleObstacles:!state.image,currentRoute:state.type==='plants'||state.editing||routeSpace()?[]:state.route,plan:state.type==='plants'?null:state.plan};}
climatePanel=createClimatePanel({getContext:recommendationContext,getPlantingContext:plantingContext,onCoverageMap:map=>{latestCoverageMap=map;scene3D?.setLightCoverage?.(map);renderLightCoverageStatus();},applyRoute:applyRecommendedRoute,onAssessment:assessment=>{write('#route-recommendation-chip',assessment?.valid?`推荐度 ${assessment.score}%${assessment.score<50?' · 可行性过低，请换一条路线':''}`:state.type==='plants'?'仅种绿植':routeSpace()?'室内：不按日晒评分':'推荐度待评估');$('#route-recommendation-chip').classList.toggle('low',Boolean(assessment?.valid&&assessment.score<50));},onEnvironment:environment=>{simulatedEnvironment=environment;scene3D?.setEnvironment(environment);}});
