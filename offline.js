(function () {
"use strict";
const $=id=>document.getElementById(id);
const STORAGE="mycinema_offline_progress_v1";
const queue=[];
let index=0,objectUrl=null,resume=null,lastSaved=-100;
const player=$("player");
const controls=["downloadEpisode","downloadSeason","editSeason","deleteSeason"];
function active(){return queue.length>0;}
function key(file){return JSON.stringify([file.name,file.size,file.lastModified]);}
function readProgress(){
  try{const parsed=JSON.parse(localStorage.getItem(STORAGE)||"{}");
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};}
  catch(_){return {};}
}
function store(file,time,duration){
  if(!file||!Number.isFinite(duration)||duration<=0)return;
  const records=readProgress();
  records[key(file)]={time:Math.max(0,Math.min(time,duration)),duration,at:Date.now()};
  const sorted=Object.entries(records).sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0)).slice(0,250);
  try{localStorage.setItem(STORAGE,JSON.stringify(Object.fromEntries(sorted)));}catch(_){}
}
function persistCurrent(){
  const file=queue[index];
  if(file && Number.isFinite(player.currentTime))store(file,player.currentTime,player.duration);
}
function clearUrl(){
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
}
function setOfflineControls(disabled){
  for(const id of controls){
    const element=$(id);
    if(element)element.disabled=disabled;
  }
}
function stop(){
  if(!active())return;
  persistCurrent();
  clearUrl();
  queue.length=0;index=0;resume=null;lastSaved=-100;
  setOfflineControls(false);
}
function show(n,autoplay=false){
  if(n<0||n>=queue.length)return;
  if(objectUrl)persistCurrent();
  clearUrl();
  index=n;
  const file=queue[index];
  const saved=readProgress()[key(file)];
  resume={time:Number.isFinite(saved?.time)?saved.time:0,autoplay};
  lastSaved=-100;
  objectUrl=URL.createObjectURL(file);
  player.src=objectUrl;
  player.load();
  $("watchTitle").textContent="Локальні відеофайли";
  $("watchEyebrow").textContent="Відтворення з диска";
  $("watchSubtitle").textContent=queue.length+" файлів · без інтернету";
  $("episodeTitle").textContent=file.name;
  $("episodePosition").textContent="Файл "+(index+1)+" із "+queue.length;
  $("qualityLabel").textContent="LOCAL";
  $("rightsBadge").hidden=true;
  $("rightsBadge").replaceChildren();
  $("seasonTabs").replaceChildren();
  $("episodeCount").textContent=queue.length+" файлів";
  $("previous").disabled=index===0;
  $("next").disabled=index>=queue.length-1;
  $("downloadProgress").textContent="Відтворюється локальний файл. Завантаження з мережі не потрібне.";
  setOfflineControls(true);
  renderList();
  document.title=file.name+" — MyCinema";
}
function renderList(){
  const container=$("episodeList");
  container.replaceChildren();
  for(let i=0;i<queue.length;i++){
    const file=queue[i];
    const button=document.createElement("button");
    button.className="episode"+(i===index?" active":"");
    button.type="button";
    const number=document.createElement("span");
    number.className="episode-number";
    number.textContent=String(i+1).padStart(2,"0");
    const title=document.createElement("span");
    title.className="episode-name";
    title.textContent=file.name;
    button.append(number,title);
    button.addEventListener("click",()=>show(i,true));
    container.append(button);
  }
}
function openFiles(files){
  if(!$("cancelDownload").hidden){
    $("status").textContent="Спочатку зупини поточне завантаження.";
    return;
  }
  const accepted=Array.from(files||[]).filter(file=>
    typeof file.name==="string" && /\.(mp4|webm)$/i.test(file.name));
  if(!accepted.length){
    $("status").textContent="Не обрано файлів MP4/WebM.";
    return;
  }
  if(!active() && typeof saveProgress==="function")saveProgress();
  if(active())stop();
  accepted.sort((a,b)=>a.name.localeCompare(b.name,"uk",{numeric:true}));
  queue.push(...accepted);
  if(typeof showWatch==="function")showWatch();
  show(0,false);
}
function next(){if(active()&&index+1<queue.length)show(index+1,true);}
function previous(){if(active()&&index>0)show(index-1,true);}
function ended(){
  if(!active())return;
  store(queue[index],player.duration,player.duration);
  if($("autoNext").checked && index+1<queue.length)next();
}
$("openOfflineFiles").addEventListener("click",()=>$("offlineFiles").click());
$("offlineFiles").addEventListener("change",e=>{
  openFiles(e.target.files);
  e.target.value="";
});
player.addEventListener("loadedmetadata",()=>{
  if(!active()||!resume)return;
  const pending=resume;resume=null;
  if(pending.time>5 && Number.isFinite(player.duration)&&pending.time<player.duration-12) {
    try{player.currentTime=pending.time;}catch(_){}
  }
  if(pending.autoplay)player.play().catch(()=>{});
});
player.addEventListener("timeupdate",()=>{
  if(!active())return;
  if(Math.abs(player.currentTime-lastSaved)>=5) {
    lastSaved=player.currentTime;
    persistCurrent();
  }
});
player.addEventListener("pause",()=>{
  if(active())persistCurrent();
});
window.addEventListener("pagehide",()=>{if(active())persistCurrent();});
window.MyCinemaOffline={isActive:active,openFiles,stop,next,previous,ended};
})();