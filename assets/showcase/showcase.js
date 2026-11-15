import { loadSurface, createSurfaceMask } from './uv-seam.js?v=smooth24';
const mount = document.querySelector('#showcase');
const collectionLabels = {western:'Western portraits', asian:'Asian portraits', games:'Game characters', memes:'Memes', unclassified:'Unclassified'};
function balanceCollections(items) {
  // Assign one scheduling bucket per case; filtering still uses all its labels.
  const priority=['games','memes','western','asian','unclassified'];
  const buckets=priority.map(key=>items.filter(c=>priority.find(k=>c.collections.includes(k))===key).sort((a,b)=>a.order-b.order));
  // Evenly space each bucket across the full list so later pages stay varied too.
  return buckets.flatMap((bucket,rank)=>bucket.map((item,i)=>({item,rank,position:(i+.5)/bucket.length})))
    .sort((a,b)=>a.position-b.position || a.rank-b.rank).map(entry=>entry.item);
}
mount.innerHTML = `
  <div class="section-heading"><div><p class="eyebrow"><span class="section-index">01</span> CASE COLLECTION</p><h2>One face.<br>Every detail<span class="red">.</span></h2></div><p>Original portrait and registered render, together. Use the slider below each card to move through the UV surface, then open the details to explore 3D and textures.</p></div>
  <div class="sc-toolbar"><div class="sc-switch" id="scGridModes" role="group" aria-label="Card image"><button data-mode="compare" aria-pressed="true">Compare</button><button data-mode="input" aria-pressed="false">Input</button><button data-mode="render" aria-pressed="false">Render</button><button data-mode="mesh" aria-pressed="false">Mesh</button></div><span class="sc-count" id="scCount">LOADING COLLECTION</span></div>
  <div class="sc-filters"><label for="scSearch">FIND A FACE<input id="scSearch" type="search" placeholder="Search name or case…" autocomplete="off"></label><label for="scBatch">COLLECTION<select id="scBatch"><option value="">All collections</option></select></label></div>
  <div class="sc-grid" id="scGrid"></div><nav class="sc-pagination" aria-label="Case collection pages"><button id="scPagePrev">← Previous</button><span class="sc-count" id="scPageStatus" role="status"></span><button id="scPageNext">Next →</button></nav><p class="sc-section-note" id="scCollectionNote">Move each slider to compare along the native UV surface. Press Home while focused on a slider to restore the midline.</p>`;
const dialog = document.createElement('dialog');
dialog.className = 'sc-dialog';
dialog.setAttribute('aria-labelledby','scTitle');
dialog.innerHTML = `
  <header class="sc-dialog-header"><div><p class="eyebrow">NERVFACE / CASE STUDY</p><h2 id="scTitle"></h2></div><button class="sc-close" aria-label="Close case">×</button></header>
  <div class="sc-body"><div class="sc-main">
    <div class="sc-switch sc-tabs" role="group" aria-label="Case detail view"><button data-tab="compare" aria-pressed="true">Compare</button><button data-tab="3d" aria-pressed="false">3D asset</button><button data-tab="uv" aria-pressed="false">UV textures</button><button data-tab="prep" aria-pressed="false">Input prep</button></div>
    <div data-panel="compare">
      <div class="sc-stage" id="scCompare"><img id="scBase" alt="Original portrait"><canvas class="sc-layer" id="scOverlay" role="img" aria-label="Registered render masked by native UV"></canvas><svg class="sc-seam" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><path id="scSeamLine" fill="none" stroke="white" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><span class="sc-image-label left">INPUT</span><span class="sc-image-label right" id="scResultLabel">RENDER</span></div>
      <div class="sc-comparison-controls"><div class="sc-switch" id="scCompareModes" role="group" aria-label="Comparison output"><button data-mode="render" aria-pressed="true">Input ↔ Render</button><button data-mode="mesh" aria-pressed="false">Input ↔ Mesh</button></div><div class="sc-slider-row"><label for="scSplit">NATIVE UV CUT</label><input id="scSplit" type="range" min="0" max="1" step="0.001" value="0.5" aria-label="Native UV cut threshold" aria-describedby="scSeamCaption"><output id="scSplitValue">0%</output></div><div class="sc-seam-actions"><button id="scResetSeam">Reset UV midline</button><span class="sc-count" id="scSeamStatus" role="status">LOADING UV MIDLINE</span></div><p class="sc-caption" id="scSeamCaption">Use the slider below to move through the native UV surface. Each U value follows a different contour around the forehead, nose and mouth. U=0.5 restores the midline.</p></div>
    </div>
    <div data-panel="3d" hidden><div class="sc-stage sc-viewer" id="scViewer"><div class="sc-viewer-status" id="scViewerStatus" role="status"></div></div><div class="sc-viewer-controls"><button id="scReset">Reset view</button><button id="scRotate" aria-pressed="false">Auto rotate</button><button id="scGray" aria-pressed="false">Gray mesh</button><label for="scLight" class="sc-count">LIGHT</label><select id="scLight"><option value="source">Source lighting</option><option value="studio">Neutral studio</option></select></div><p class="sc-caption">Drag to orbit · scroll to zoom. Interactive lighting is an approximation; the Compare tab shows the final Cycles result.</p></div>
    <div data-panel="uv" hidden><div class="sc-stage"><img id="scUV" alt="Pro UV texture"></div><div class="sc-switch" id="scUVModes" role="group" aria-label="UV texture"><button data-mode="pro" aria-pressed="true">Pro</button><button data-mode="uniform" aria-pressed="false">Uniform</button><button data-mode="unwarp" aria-pressed="false">Unwarp</button></div><p class="sc-caption" id="scUVCaption">Pro · final appearance texture used by this case.</p></div>
    <div data-panel="prep" hidden><div class="sc-prep-grid"><figure><img id="scPrepInput" alt="Original input"><figcaption>01 / ORIGINAL PORTRAIT</figcaption></figure><figure><img id="scBald" alt="Bald preparation used for reconstruction"><figcaption>02 / RECONSTRUCTION INPUT</figcaption></figure></div><p class="sc-caption">The original portrait and the prepared bald image are kept as separate assets.</p></div>
  </div><aside class="sc-aside"><p class="eyebrow">SOURCE PORTRAIT</p><figure><img id="scReference" alt="Original source portrait"><figcaption>ORIGINAL INPUT / FULL FRAME</figcaption></figure><h3>From image to asset.</h3><p>Compare the final appearance with the original portrait, then inspect the same registered head and eyes in 3D.</p><div class="sc-tags" id="scTags"></div><h3>Aligned, together.</h3><p>Input, render, and gray mesh share one image frame. No independent face crops.</p></aside></div>
  <footer class="sc-footer"><span class="sc-count" id="scPosition"></span><div><button id="scPrev" aria-label="Previous case">← Previous</button> <button id="scNext" aria-label="Next case">Next →</button></div></footer>`;
document.body.append(dialog);
const $ = s => dialog.querySelector(s);
let cases = [], index=0, gridMode='compare', tab='compare', viewer=null, viewerTask=null, generation=0;
let surfaceData=null, seamU=.5, seamRequest=0, surfaceMask=null, compareMode='render';
const seamCache=new Map();
const pageSize=24;
let page=0, query='', group='', cardObserver=null, cardGeneration=0;
const cardLoaders=new WeakMap();
function filteredCases() {
  return cases.filter(c=>(!group || c.collections.includes(group)) && (!query || (c.label+' '+c.category+' '+c.id+' '+(c.aliases||[]).join(' ')).toLowerCase().includes(query)));
}
function fetchSeam(root) {
  if(!seamCache.has(root)) seamCache.set(root,loadSurface(root).catch(error=>{seamCache.delete(root);throw error;}));
  const result=seamCache.get(root);
  if(seamCache.size>16) seamCache.delete(seamCache.keys().next().value);
  return result;
}
const asset = name => `${cases[index].root}/${name}`;
function pressed(container, selected) { container.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===selected))); }
function setImage(selector,name,alt) { const img=$(selector); img.src=asset(name); if(alt) img.alt=alt; }
function split(value) {
  seamU=Math.round(Math.max(0,Math.min(1,value))*1000)/1000;
  $('#scSplit').value=seamU;
  $('#scSplitValue').value=`U=${seamU.toFixed(3)}`;
  $('#scSplit').setAttribute('aria-valuetext',`Native U threshold ${seamU.toFixed(3)}`);
  if(!surfaceMask)return;
  const shape=surfaceMask.update(seamU);
  $('#scSeamLine').setAttribute('d',shape.path);
  $('#scSeamStatus').textContent=seamU===.5?'UV MIDLINE · U=0.500':'NATIVE UV SURFACE CUT';
}
async function loadSeam(reset=true) {
  const request=++seamRequest, root=cases[index].root, threshold=reset?.5:seamU;
  surfaceData=null; surfaceMask=null;
  $('#scCompare').dataset.seam='loading';
  $('#scSplit').disabled=true; $('#scResetSeam').disabled=true;
  $('#scSeamStatus').textContent='LOADING UV SURFACE';
  split(threshold);
  try {
    const data=await fetchSeam(root);
    const canvas=document.createElement('canvas'); canvas.id='scOverlay'; canvas.className='sc-layer';
    canvas.setAttribute('role','img'); canvas.setAttribute('aria-label',`Registered ${compareMode}, masked by native UV`);
    const mask=await createSurfaceMask(canvas,data,`${root}/${compareMode}.webp`);
    if(request!==seamRequest)return;
    $('#scOverlay').replaceWith(canvas);
    surfaceData=data; surfaceMask=mask; $('#scCompare').dataset.seam='ready';
    $('#scSplit').disabled=false; $('#scResetSeam').disabled=false;
    split(threshold);
  } catch(error) {
    if(request!==seamRequest)return;
    $('#scCompare').dataset.seam='error';
    $('#scSeamStatus').textContent=`${error.message} Reopen this case to retry.`;
  }
}
function disposeViewer() { generation++; viewer?.dispose(); viewer=null; viewerTask=null; }
async function loadViewer() {
  if(viewer) { viewer.setActive(true); return; }
  if(viewerTask) return viewerTask;
  const token=generation, root=cases[index].root;
  const status=$('#scViewerStatus'); status.hidden=false; status.textContent='Loading the registered 3D asset…';
  viewerTask=(async()=>{
    try {
      const {createShowcaseViewer}=await import('./viewer.bundle.js');
      if(token!==generation) return;
      const instance=await createShowcaseViewer($('#scViewer'),root);
      if(token!==generation) { instance.dispose(); return; }
      viewer=instance; viewer.setLighting($('#scLight').value); viewer.setActive(dialog.open && tab==='3d'); status.hidden=true;
    } catch(error) {
      if(token!==generation) return;
      status.replaceChildren();
      const p=document.createElement('p'); p.textContent=`3D preview unavailable: ${error.message}`;
      const retry=document.createElement('button'); retry.textContent='Retry 3D preview'; retry.onclick=loadViewer;
      status.append(p,retry);
    } finally { if(token===generation) viewerTask=null; }
  })();
  return viewerTask;
}
function selectTab(next) {
  tab=next;
  $('.sc-tabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
  dialog.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==tab);
  viewer?.setActive(tab==='3d' && dialog.open);
  if(tab==='3d') loadViewer();
  if(tab==='uv' && !$('#scUV').getAttribute('src')) setImage('#scUV','uv/pro.webp');
  if(tab==='prep') { setImage('#scPrepInput','input.webp'); setImage('#scBald','bald.webp'); }
}
function openCase(i) {
  disposeViewer(); index=i;
  const c=cases[index]; $('#scTitle').textContent=c.label;
  $('#scBald').alt=c.prepLabel || 'Prepared reconstruction input';
  $('[data-panel="prep"] .sc-caption').textContent=c.prepLabel || 'Original portrait and reconstruction input.';
  $('[data-panel="prep"] figure:last-child figcaption').textContent='02 / '+(c.prepLabel || 'RECONSTRUCTION INPUT').toUpperCase();
  $('#scPosition').textContent=`${String(index+1).padStart(2,'0')} / ${String(cases.length).padStart(2,'0')} · ${c.category.toUpperCase()}`;
  $('#scPrev').disabled=index===0; $('#scNext').disabled=index===cases.length-1;
  setImage('#scBase','input.webp'); compareMode='render'; setImage('#scReference','input.webp');
  $('#scResultLabel').textContent='RENDER'; loadSeam();
  pressed($('#scCompareModes'),$('#scCompareModes button'));
  pressed($('#scUVModes'),$('#scUVModes button')); $('#scUV').removeAttribute('src');
  $('#scUVCaption').textContent='Pro · final appearance texture used by this case.';
  $('#scRotate').setAttribute('aria-pressed','false'); $('#scGray').setAttribute('aria-pressed','false'); $('#scLight').value='source';
  $('#scTags').replaceChildren(...c.tags.map(t=>{ const e=document.createElement('span'); e.textContent=t; return e; }));
  if(!dialog.open) dialog.showModal();
  selectTab('compare');
}
function renderCards() {
  cardObserver?.disconnect();
  const token=++cardGeneration, matches=filteredCases(), pages=Math.max(1,Math.ceil(matches.length/pageSize));
  page=Math.max(0,Math.min(page,pages-1));
  document.querySelector('#scCount').textContent=query||group ? `${matches.length} / ${cases.length} CASES` : `${cases.length} SELECTED CASES`;
  document.querySelector('#scPageStatus').textContent=matches.length ? `${page*pageSize+1}–${Math.min(matches.length,(page+1)*pageSize)} OF ${matches.length} · PAGE ${page+1} / ${pages}` : 'NO MATCHING CASES';
  document.querySelector('#scPagePrev').disabled=page===0;
  document.querySelector('#scPageNext').disabled=page>=pages-1;
  cardObserver=new IntersectionObserver(entries=>{
    for(const entry of entries) if(entry.isIntersecting) {
      cardObserver.unobserve(entry.target);
      cardLoaders.get(entry.target)?.();
    }
  },{rootMargin:'150px'});
  document.querySelector('#scGrid').replaceChildren(...matches.slice(page*pageSize,(page+1)*pageSize).map(c=>{
    const i=cases.indexOf(c);
    const card=document.createElement('article'); card.className='sc-card'; card.id=`compare-${c.id}`; card.tabIndex=-1; card.setAttribute('aria-label',`${c.label} comparison`);
    card.innerHTML=`<div class="sc-card-image"><img class="sc-card-base" loading="lazy" width="512" height="512"><canvas class="sc-card-overlay" width="512" height="512" role="img"></canvas><svg class="sc-seam" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><path fill="none" stroke="white" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><span class="sc-image-label left">INPUT</span><span class="sc-image-label right">RENDER</span></div><div class="sc-card-controls"><input type="range" min="0" max="1" step="0.001" value="0.5" disabled><span class="sc-card-status" role="status">Loading UV midline…</span></div><div class="sc-card-caption"><strong></strong><button class="sc-card-open">Explore more</button></div>`;
    const q=s=>card.querySelector(s), picture=q('.sc-card-image'), base=q('.sc-card-base'), overlay=q('.sc-card-overlay'), slider=q('input'), status=q('.sc-card-status');
    const comparing=gridMode==='compare'; card.dataset.comparing=String(comparing);
    base.src=`${c.root}/${comparing?'input':gridMode}.webp`; base.alt=`${c.label} ${comparing?'original portrait':gridMode}`;
    overlay.setAttribute('aria-label',`${c.label} registered render masked by native UV`);
    q('strong').textContent=c.label; q('strong').title=c.label;
    q('.sc-card-open').setAttribute('aria-label',`Explore ${c.label} in 3D and UV`); q('.sc-card-open').onclick=()=>openCase(i);
    slider.setAttribute('aria-label',`${c.label} Native UV cut threshold`);
    if(comparing) {
      let rows=null, offset=.5, mask=null;
      function update(value) {
        if(!mask)return;
        offset=Math.round(Math.max(0,Math.min(1,value))*1000)/1000;
        const shape=mask.update(offset);
        q('path').setAttribute('d',shape.path);
        slider.value=offset; slider.setAttribute('aria-valuetext',`Native U threshold ${offset.toFixed(3)}`);
        slider.style.setProperty('--cut',`${offset*100}%`);
        status.textContent=offset===.5?'UV MIDLINE · U=0.500':`NATIVE SURFACE · U=${offset.toFixed(3)}`;
      }
      slider.oninput=e=>update(Number(e.target.value));
      slider.onkeydown=e=>{if(e.key==='Home'){e.preventDefault();update(.5);}};
      status.textContent='UV comparison loads when visible';
      cardLoaders.set(card,()=>fetchSeam(c.root).then(async data=>{
        if(token!==cardGeneration)return;
        const resolution=Math.min(1024,Math.max(256,Math.ceil(picture.getBoundingClientRect().width*Math.max(2,window.devicePixelRatio||1))));
        rows=data; mask=await createSurfaceMask(overlay,data,`${c.root}/render.webp`,resolution);
        if(token!==cardGeneration)return;
        card.dataset.ready='true';slider.disabled=false;update(.5);
      }).catch(error=>{status.textContent=error.message;card.dataset.error='true';}));
      cardObserver.observe(card);
    }
    return card;
  }));
}
function jumpToCase(id, updateHash=true) {
  const i=cases.findIndex(c=>c.id===id);
  if(i<0)return;
  query=''; group=''; page=Math.floor(i/pageSize); gridMode='compare';
  document.querySelector('#scSearch').value=''; document.querySelector('#scBatch').value='';
  pressed(document.querySelector('#scGridModes'),document.querySelector('#scGridModes [data-mode="compare"]'));
  renderCards();
  if(updateHash) history.pushState(null,'',`#compare-${id}`);
  requestAnimationFrame(()=>{
    const card=document.getElementById(`compare-${id}`);
    card.classList.add('sc-jump-target');
    card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    card.focus({preventScroll:true});
  });
}
function followHash() {
  if(location.hash.startsWith('#compare-')) jumpToCase(decodeURIComponent(location.hash.slice(9)),false);
}
window.addEventListener('hashchange',followHash);
document.querySelector('#scSearch').oninput=e=>{query=e.target.value.trim().toLowerCase();page=0;renderCards();};
document.querySelector('#scBatch').onchange=e=>{group=e.target.value;page=0;renderCards();};
for(const [id,step] of [['#scPagePrev',-1],['#scPageNext',1]]) document.querySelector(id).onclick=()=>{
  page+=step;renderCards();
  document.querySelector('#scGrid').scrollIntoView({block:'start'});
};

$('.sc-close').onclick=()=>dialog.close();
dialog.addEventListener('click',e=>{ if(e.target===dialog) {const r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) dialog.close();} });
dialog.addEventListener('close',()=>{++seamRequest;disposeViewer();});
$('.sc-tabs').onclick=e=>{ const b=e.target.closest('[data-tab]'); if(b) selectTab(b.dataset.tab); };
$('#scCompareModes').onclick=e=>{ const b=e.target.closest('[data-mode]'); if(!b)return; pressed($('#scCompareModes'),b); compareMode=b.dataset.mode;loadSeam(false); $('#scResultLabel').textContent=b.dataset.mode.toUpperCase(); };
$('#scUVModes').onclick=e=>{ const b=e.target.closest('[data-mode]'); if(!b)return; pressed($('#scUVModes'),b); setImage('#scUV',`uv/${b.dataset.mode}.webp`,`${b.textContent} UV texture`); $('#scUVCaption').textContent=({pro:'Pro · final appearance texture used by this case.',uniform:'Uniform · alternate generated texture for comparison.',unwarp:'Unwarp · projected observations from the input image.'})[b.dataset.mode]; };
$('#scSplit').oninput=e=>split(Number(e.target.value));
$('#scResetSeam').onclick=()=>split(.5);
$('#scSplit').addEventListener('keydown',e=>{if(e.key==='Home'){e.preventDefault();split(.5);}});
$('#scReset').onclick=()=>viewer?.reset();
for(const [id,method] of [['#scRotate','setRotate'],['#scGray','setMaterial']]) $(id).onclick=()=>{if(!viewer)return; const value=$(id).getAttribute('aria-pressed')!=='true'; $(id).setAttribute('aria-pressed',String(value)); viewer[method](id==='#scGray'?(value?'mesh':'full'):value);};
$('#scLight').onchange=e=>viewer?.setLighting(e.target.value);
$('#scPrev').onclick=()=>{if(index>0)openCase(index-1);}; $('#scNext').onclick=()=>{if(index<cases.length-1)openCase(index+1);};
document.querySelector('#scGridModes').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return; gridMode=b.dataset.mode;pressed(document.querySelector('#scGridModes'),b);renderCards();};
try {
  const response=await fetch('assets/showcase/cases.json?v=multi-label-1'); if(!response.ok)throw new Error('Collection manifest unavailable');
  cases=await response.json();
  cases=balanceCollections(cases);
  document.querySelector('#scCount').textContent=`${String(cases.length).padStart(2,'0')} ${cases.length===1?'CASE':'CASES'}`;
  for(const [value,label] of Object.entries(collectionLabels)) {const count=cases.filter(c=>c.collections.includes(value)).length;if(!count)continue;const option=document.createElement('option');option.value=value;option.textContent=`${label} (${count})`;document.querySelector('#scBatch').append(option);}
  renderCards(); followHash();
  const initial=cases.findIndex(c=>location.hash===`#case-${c.id}`); if(initial>=0)openCase(initial);
} catch(error) {document.querySelector('#scCount').textContent='COLLECTION UNAVAILABLE';document.querySelector('#scCollectionNote').textContent=error.message;}
