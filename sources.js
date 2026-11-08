(function() {
"use strict";
const DOM = id => document.getElementById(id);
const IA = "https://archive.org";
const CACHE_MS = 15*60*1000;
const MAX_VIDEO_FILES = 60;
const MAX_METADATA_RESULTS = 10;
const MAX_SEARCH_ROWS = 18;
const MIN_BYTES = 15*1024*1024;
const pool = new Map();
let serial=0;
let busy=false;
const ACCEPTED_LICENSES=[
  /^\/publicdomain\/zero\/1\.0\/?$/i,
  /^\/publicdomain\/mark\/1\.0\/?$/i,
  /^\/licenses\/by\/(3\.0|4\.0)\/?$/i,
  /^\/licenses\/by-sa\/(3\.0|4\.0)\/?$/i
];
function clean(s) {
  return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9\u0400-\u052f]+/g," ").replace(/\s+/g," ").trim();
}
function titleMatches(candidate,query) {
  const c=clean(candidate),q=clean(query);
  return q.length>=4 && (c===q || c.startsWith(q+" ") || c.endsWith(" "+q)
    || c.includes(" "+q+" "));
}
function licenseInfo(raw) {
  const rawUrl=Array.isArray(raw)?raw[0]:raw;
  if(typeof rawUrl!=="string")return null;
  try {
    const u=new URL(rawUrl);
    if(u.protocol!=="https:" && u.protocol!=="http:")return null;
    if(u.hostname!=="creativecommons.org" && u.hostname!=="www.creativecommons.org")return null;
    if(!ACCEPTED_LICENSES.some(re=>re.test(u.pathname)))return null;
    const isPD=u.pathname.includes("publicdomain");
    const isShareAlike=u.pathname.includes("by-sa");
    const name=isPD?"Public Domain / CC0":isShareAlike?"CC BY-SA":"CC BY";
    return {name,url:u.href,attribution:!isPD};
  }catch(_){return null;}
}
function validId(identifier) {return typeof identifier==="string" && /^[a-zA-Z0-9_\-.]{2,180}$/.test(identifier);}
function videoFiles(files,id) {
  if(!validId(id)||!Array.isArray(files))return [];
  const results=[];
  const seen=new Set();
  for(const file of files){
    if(!file||typeof file.name!=="string")continue;
    const name=file.name;
    if(!/\.(mp4|webm)$/i.test(name) || /(?:sample|preview|trailer|thumb|clip|_meta)\b/i.test(name)) continue;
    if(/\.{2}|\\|^\//.test(name))continue;
    const size=Number(file.size)||0;
    if(size<MIN_BYTES || size>30*1024*1024*1024)continue;
    if(seen.has(name))continue;
    seen.add(name);
    const url=IA+"/download/"+encodeURIComponent(id)+"/"+
      name.split("/").map(encodeURIComponent).join("/");
    results.push({name,url,size,format:file.format||""});
  }
  return results.sort((a,b)=>a.name.localeCompare(b.name,"en",{numeric:true})).slice(0,MAX_VIDEO_FILES);
}
async function getJson(url) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const res=await fetch(url,{mode:"cors",credentials:"omit",signal:controller.signal});
    if(!res.ok)throw Error("Internet Archive повернув HTTP "+res.status);
    return await res.json();
  }finally{clearTimeout(timeout);}
}
function pickTitle(text) {return Array.isArray(text)?String(text[0]||""):String(text||"");}
async function find(title,options={}) {
  const normalized=String(title||"").trim();
  const candidateLimit=Math.max(1,Math.min(MAX_METADATA_RESULTS,Number(options.maxResults)||MAX_METADATA_RESULTS));
  if(normalized.length<3||normalized.length>140)throw Error("Введи повну назву (3–140 символів).");
  const cacheKey=clean(normalized)+":"+candidateLimit;
  const old=pool.get(cacheKey);
  if(old&&Date.now()-old.when<CACHE_MS)return old.items;
  const q='title:("'+normalized.replace(/["\\]/g," ").replace(/\s+/g," ").trim()+'") AND mediatype:movies';
  const params=new URLSearchParams({q,rows:String(MAX_SEARCH_ROWS),page:"1",output:"json"});
  ["identifier","title"].forEach(field=>params.append("fl[]",field));
  const response=await getJson(IA+"/advancedsearch.php?"+params);
  const docs=(response.response?.docs||[]).filter(item=>
    validId(item.identifier)&&titleMatches(pickTitle(item.title),normalized)).slice(0,candidateLimit);
  const items=[];
  let at=0;
  async function worker() {
    while(at<docs.length){
      const doc=docs[at++];
      try{
        const data=await getJson(IA+"/metadata/"+encodeURIComponent(doc.identifier));
        const meta=data.metadata||{};
        const license=licenseInfo(meta.licenseurl);
        if(!license)continue;
        const originalTitle=pickTitle(meta.title)||pickTitle(doc.title);
        if(!titleMatches(originalTitle,normalized))continue;
        const files=videoFiles(data.files,doc.identifier);
        if(!files.length)continue;
        items.push({identifier:doc.identifier,title:originalTitle,
          license, files, itemUrl:IA+"/details/"+encodeURIComponent(doc.identifier),
          creator:pickTitle(meta.creator).slice(0,180)});
      }catch(_){/* unavailable item is not presented as verified */}
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  items.sort((a,b)=>b.files.length-a.files.length||a.title.localeCompare(b.title));
  pool.set(cacheKey,{when:Date.now(),items});
  return items;
}
async function browseOpenEpisodes(page=1,onProgress=()=>{}) {
  const pageNo=Math.max(1,Math.min(10000,Number(page)||1));
  // Archive.org indexes licenseurl: prefilter openly licensed items *before*
  // expensive per-file metadata and byte-range checks. Never infer rights from titles.
  const allowedLicenseQuery='(licenseurl:http*by/4.0* OR licenseurl:http*by/3.0* OR '+
    'licenseurl:http*by-sa/4.0* OR licenseurl:http*by-sa/3.0* OR '+
    'licenseurl:http*zero/1.0* OR licenseurl:http*mark/1.0*)';
  const q='mediatype:movies AND '+allowedLicenseQuery+
    ' AND (subject:television OR title:episode OR title:series)';
  const params=new URLSearchParams({q,rows:"30",page:String(pageNo),output:"json"});
  ["identifier","title"].forEach(field=>params.append("fl[]",field));
  params.append("sort[]","downloads desc");
  const data=await getJson(IA+"/advancedsearch.php?"+params);
  const docs=(data.response?.docs||[]).filter(x=>validId(x.identifier)).slice(0,18);
  const accepted=[];
  const stats={candidates:docs.length,withoutLicense:0,withoutVideo:0,
    unreachable:0,notPlayable:0,errors:0};
  let index=0,done=0;
  async function worker() {
    while(index<docs.length) {
      const doc=docs[index++];
      try {
        const data=await getJson(IA+"/metadata/"+encodeURIComponent(doc.identifier));
        const meta=data.metadata||{};
        const license=licenseInfo(meta.licenseurl);
        if(!license){stats.withoutLicense++;continue;}
        const files=videoFiles(data.files,doc.identifier);
        if(!files.length){stats.withoutVideo++;continue;}
        const first=files[0];
        const head=await checkFile(first.url);
        if(!head.ok){stats.unreachable++;continue;}
        const checker=window.MyCinemaAvailability;
        if(!checker){stats.notPlayable++;continue;}
        await checker.scan([{seasons:[{episodeUrls:[first.url]}]}],()=>{},()=>{},true);
        const cached=checker.cached(first.url);
        if(cached?.status!=="available" || cached.duration<900){stats.notPlayable++;continue;}
        accepted.push({
          identifier:doc.identifier,
          title:pickTitle(meta.title)||pickTitle(doc.title),
          license,files,
          itemUrl:IA+"/details/"+encodeURIComponent(doc.identifier),
          creator:pickTitle(meta.creator).slice(0,180),
          preVerified:[first]
        });
      }catch(_) { stats.errors++; }
      finally {
        done++;
        onProgress("Перевірено "+done+" із "+docs.length+" записів · "+
          "відеофайлів із перевіреним відтворенням: "+accepted.length+".");
      }
    }
  }
  await Promise.all([worker(),worker()]);
  return {items:accepted,page:pageNo,hasMore:docs.length>0,stats};
}
async function checkFile(url) {
  // Direct CORS HEAD request; do not infer file availability from the title alone.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),13000);
  try{
    const response=await fetch(url,{method:"HEAD",redirect:"follow",mode:"cors",
      credentials:"omit",signal:controller.signal});
    const contentType=(response.headers.get("content-type")||"").toLowerCase();
    const len=Number(response.headers.get("content-length")||0);
    if(!response.ok)return {ok:false,reason:"HTTP "+response.status};
    if(!/^video\/|octet-stream|application\/mp4/.test(contentType))
      return {ok:false,reason:"Не відеофайл ("+contentType+")"};
    if(len>0&&len<MIN_BYTES)return {ok:false,reason:"Файл замалий"};
    return {ok:true,size:len||null,contentType};
  }catch(e){return {ok:false,reason:"Не вдалося підтвердити доступ браузером (можливий CORS/мережа)."};}
  finally{clearTimeout(timer);}
}
function make(tag,klass,text) {
  const n=document.createElement(tag);
  if(klass)n.className=klass;
  if(text!=null)n.textContent=String(text);
  return n;
}
function setStatus(text,error) {
  const n=DOM("sourceStatus");
  n.textContent=text;
  n.style.color=error?"#ffb4a6":"";
}
function render(results) {
  const box=DOM("sourceResults");
  box.replaceChildren();
  if(!results.length){
    box.append(make("p","micro","Немає відеофайлів із підтвердженими дозволеними ліцензіями для цієї назви. Це нормально для сучасних серіалів."));
    return;
  }
  for(const item of results) {
    const card=make("article","source-card");
    card.append(make("h3","",item.title));
    const info=make("p","micro",item.files.length+" MP4/WebM · "+item.license.name+
      (item.creator?" · "+item.creator:""));
    card.append(info);
    const link=make("a","action","Джерело й ліцензія");
    link.href=item.itemUrl;link.target="_blank";link.rel="noopener noreferrer";
    const licenseLink=make("a","action","Умови "+item.license.name);
    licenseLink.href=item.license.url;licenseLink.target="_blank";licenseLink.rel="noopener noreferrer";
    const actions=make("div","source-actions");
    actions.append(link,licenseLink);
    const check=make("button","action primary","Перевірити файли");
    check.type="button";
    const add=make("button","action","Додати до бібліотеки");
    add.type="button";add.disabled=true;
    let passing=Array.isArray(item.preVerified)?item.preVerified:[];
    add.disabled=!passing.length;
    if(passing.length)check.textContent="Попередньо перевірено "+passing.length+" файл";
    check.addEventListener("click",async()=>{
      check.disabled=true;add.disabled=true;passing=[];
      setStatus("Перевіряю файли з "+item.title+"…");
      let at=0;
      const total=item.files.length;
      const verified=new Array(total).fill(false);
      async function worker(){
        while(at<total){
          const i=at++;
          const current=item.files[i];
          const status=await checkFile(current.url);
          verified[i]=status.ok;
        }
      }
      try{
        await Promise.all([worker(),worker(),worker()]);
        passing=item.files.filter((_,index)=>verified[index]);
        check.textContent="Доступно: "+passing.length+" із "+total;
        add.disabled=!passing.length;
        setStatus(passing.length?
          "Є "+passing.length+" файлів, до яких браузер отримав підтверджену відповідь. Перед завантаженням перевір умови ліцензії.":
          "Не вдалося підтвердити доступність файлів. Можливо, сервер відхиляє HEAD/CORS.",!passing.length);
      }finally{check.disabled=false;}
    });
    add.addEventListener("click",()=>{
      if(!passing.length)return;
      try {
        const added=addToLibrary(item,passing.slice(0,1));
        DOM("sourceDialog").close();
        setStatus("Додано "+added.title+".");
      }catch(error){setStatus(error.message||"Не вдалося додати відео.",true);}
    });
    actions.append(check,add);
    const whole=make("button","action","Заповнити форму всіма файлами");
    whole.type="button";
    whole.addEventListener("click",()=>{
      if(!passing.length||typeof openEditor!=="function")return;
      openEditor();
      DOM("seriesName").value=item.title.slice(0,120);
      DOM("seasonNumber").value="1";
      DOM("episodeTotal").value=String(Math.min(60,passing.length));
      DOM("qualityInput").value="Archive MP4/WebM";
      DOM("sourceMode").value="manual";
      DOM("sourceMode").dispatchEvent(new Event("change"));
      DOM("urlInput").value=passing.slice(0,60).map(f=>f.url).join("\n");
      DOM("urlHint").textContent="Перевір відповідність файлів номерам серій. Ліцензія: "+
        item.license.name+". Посилання: "+item.itemUrl;
    });
    actions.append(whole);
    card.append(actions);
    const files=make("p","source-file-names",item.files.slice(0,4).map(f=>f.name).join(" · ")+
      (item.files.length>4?" · …":""));
    card.append(files);
    box.append(card);
  }
}
function openWithTitle(title) {
  DOM("sourceDialog").showModal();
  if(title)DOM("sourceQuery").value=title;
  DOM("sourceResults").replaceChildren();
  setStatus("Знайдемо відкриті ліцензовані MP4/WebM у Internet Archive.");
  if(title && title.length>2)submit();
}
async function submit(){
  if(busy)return;
  const title=DOM("sourceQuery").value.trim();
  if(title.length<3){setStatus("Введи назву серіалу.",true);return;}
  const current=++serial;
  busy=true;
  DOM("sourceSearch").disabled=true;
  DOM("sourceResults").replaceChildren();
  setStatus("Шукаю відкриті ліцензовані відеофайли для «"+title+"»…");
  try{
    const results=await find(title);
    if(current===serial){render(results);setStatus("Перевірка ліцензій завершена. Для фактичної перевірки файлів натисни «Перевірити файли».");}
  }catch(e){if(current===serial)setStatus(e.message||"Помилка пошуку.",true);}
  finally{busy=false;DOM("sourceSearch").disabled=false;}
}
let browsePage=0;
async function browseNext() {
  if(busy)return;
  busy=true;
  DOM("sourceBrowse").disabled=true;
  DOM("sourceBrowseMore").disabled=true;
  const page=browsePage+1;
  setStatus("Перевіряю відкриті архівні записи. Сторінка "+page+"…");
  try {
    const result=await browseOpenEpisodes(page,text=>setStatus(text));
    browsePage=result.page;
    DOM("sourceBrowseMore").hidden=!result.hasMore;
    render(result.items);
    setStatus(result.items.length?
      "Перевірені відкриті відео цієї сторінки: "+result.items.length+
      ". Можеш додати файл у бібліотеку." :
      "На цій сторінці немає відео, яке пройшло перевірку. Спробуй наступну сторінку.");
  }catch(e){setStatus(e.message||"Помилка архівного каталогу.",true);}
  finally{busy=false;DOM("sourceBrowse").disabled=false;DOM("sourceBrowseMore").disabled=false;}
}
DOM("sourceBrowse").addEventListener("click",()=>{browsePage=0;browseNext();});
DOM("sourceBrowseMore").addEventListener("click",browseNext);
DOM("sourceSearchForm").addEventListener("submit",e=>{e.preventDefault();submit();});
DOM("openSources").addEventListener("click",()=>openWithTitle(""));
DOM("closeSources").addEventListener("click",()=>DOM("sourceDialog").close());
DOM("sourceDialog").addEventListener("close",()=>{serial++;busy=false;DOM("sourceSearch").disabled=false;});
function addToLibrary(item,files) {
  if (!item || !item.license || !Array.isArray(files) || !files.length ||
    typeof state==="undefined" || typeof persist!=="function")throw Error("Джерело некоректне.");
  const urls=files.map(x=>x.url).filter(url=>typeof url==="string" &&
    url.startsWith(IA+"/download/")).slice(0,60);
  if(!urls.length)throw Error("Не знайдено дозволених відеофайлів.");
  const title=String(item.title||"Без назви").slice(0,120);
  let show=state.series.find(x=>x.title.toLocaleLowerCase("uk")===title.toLocaleLowerCase("uk"));
  if(!show) {
    if(state.series.length>=100)throw Error("Бібліотека заповнена (100 серіалів).");
    show={id:"archive-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),
      title,seasons:[]};
    state.series.push(show);
  }
  const duplicate=show.seasons.find(season=>
    season.episodeUrls.some(url=>urls.includes(url)));
  if(duplicate) {
    if(typeof loadEpisode==="function" && typeof showWatch==="function") {
      loadEpisode(show.id,duplicate.number,1,false);
      showWatch();
    }
    return {title,seriesId:show.id,season:duplicate.number,
      count:duplicate.episodeUrls.length,existing:true};
  }
  let seasonNo=1;
  while(show.seasons.some(x=>x.number===seasonNo))seasonNo++;
  if(seasonNo>30)throw Error("У серіалі вже 30 сезонів.");
  show.seasons.push({
    number:seasonNo,quality:"Archive MP4/WebM",
    episodeUrls:urls,
    rights:{name:item.license.name,url:item.license.url,creator:item.creator||"",
      itemUrl:item.itemUrl,verifiedAt:Date.now()}
  });
  persist();
  if(typeof loadEpisode==="function" && typeof showWatch==="function"){
    loadEpisode(show.id,seasonNo,1,false);
    showWatch();
  }else if(typeof showLibrary==="function")showLibrary();
  return {title,seriesId:show.id,season:seasonNo,count:urls.length};
}
window.MyCinemaSources={openWithTitle,find,checkFile,addToLibrary,browseOpenEpisodes,helpers:{titleMatches,licenseInfo,videoFiles}};
})();