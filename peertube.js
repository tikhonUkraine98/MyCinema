(function () {
"use strict";
const $ = id => document.getElementById(id);
const SEARCH_API = "https://sepiasearch.org/api/v1/search/videos";
const MIN_DURATION = 15 * 60;
const MIN_BYTES = 15 * 1024 * 1024;
const ALLOWED_LICENCES = {
  1:{name:"CC BY (заявлено)",url:"https://creativecommons.org/licenses/by/4.0/"},
  2:{name:"CC BY-SA (заявлено)",url:"https://creativecommons.org/licenses/by-sa/4.0/"},
  7:{name:"Public Domain (заявлено)",url:"https://creativecommons.org/publicdomain/zero/1.0/"}
};
let busy = false;
let token = 0;

function node(tag,cls,value) {
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(value != null) n.textContent = String(value);
  return n;
}
function message(text,error=false) {
  $("peerStatus").textContent = text;
  $("peerStatus").style.color = error ? "#ffb3a3" : "";
}
function licenceOf(video) {
  const id = typeof video?.licence === "object" ? video.licence.id : video?.licence;
  return ALLOWED_LICENCES[Number(id)] || null;
}
function safeHttps(raw) {
  try {
    const u = new URL(raw);
    if(u.protocol !== "https:" || !u.hostname || u.username || u.password)return null;
    return u.href;
  }catch(_){return null;}
}
function validUuid(id) {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
async function json(url) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),14000);
  try{
    const response = await fetch(url,{mode:"cors",credentials:"omit",signal:controller.signal});
    if(!response.ok)throw Error("PeerTube відповів HTTP "+response.status);
    return await response.json();
  }finally{clearTimeout(timer);}
}
function eligible(video) {
  const privacy = typeof video.privacy === "object" ? video.privacy?.id : video.privacy;
  return validUuid(video.uuid) &&
    Number(video.duration)>=MIN_DURATION &&
    video.isLive!==true && video.nsfw!==true &&
    Number(privacy)===1 && !!licenceOf(video) && !!safeHttps(video.url);
}
async function searchCandidates(query) {
  const search = String(query||"").trim();
  if(search.length < 3 || search.length > 160)throw Error("Введи назву з 3–160 символів.");
  const u = new URL(SEARCH_API);
  u.searchParams.set("search",search);
  u.searchParams.set("count","25");
  u.searchParams.set("nsfw","false");
  u.searchParams.set("isLive","false");
  const result = await json(u.href);
  const all = Array.isArray(result.data) ? result.data : [];
  return {total:all.length,items:all.filter(eligible).slice(0,16)};
}
function detailEndpoint(candidate) {
  if(!eligible(candidate))throw Error("Відео не має підтвердженої відкритої ліцензії або є занадто коротким.");
  const origin = new URL(candidate.url).origin;
  return origin+"/api/v1/videos/"+encodeURIComponent(candidate.uuid);
}
function mp4files(detail) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  const items = [];
  for(const file of files){
    if(!file || Number(file.size)<MIN_BYTES)continue;
    const direct=safeHttps(file.fileUrl);
    if(!direct)continue;
    const path = new URL(direct).pathname;
    if(!/\.(mp4|webm)$/i.test(path))continue;
    items.push({url:direct,size:Number(file.size),
      label:file.resolution?.label || "відео",downloadUrl:safeHttps(file.fileDownloadUrl)});
  }
  return items.sort((a,b)=>b.size-a.size);
}
async function verifyCandidate(candidate) {
  const url=detailEndpoint(candidate);
  const video=await json(url);
  if(!eligible(video) || video.uuid!==candidate.uuid ||
      new URL(video.url).origin!==new URL(candidate.url).origin)
    throw Error("Не збігається ідентифікатор або ліцензія на сервері.");
  if(video.downloadEnabled===false)throw Error("Автор відео заборонив завантаження.");
  const files=mp4files(video);
  if(!files.length)throw Error("Відео не має прямого MP4/WebM, доступного для завантаження.");
  const checker=window.MyCinemaSources;
  if(!checker)throw Error("Модуль перевірки джерел не завантажився.");
  for(const file of files){
    const http=await checker.checkFile(file.url);
    if(!http.ok)continue;
    const media=window.MyCinemaAvailability;
    if(!media)continue;
    await media.scan([{seasons:[{episodeUrls:[file.url]}]}],()=>{},()=>{},true);
    const check=media.cached(file.url);
    if(check?.status==="available" && check.duration>=MIN_DURATION)
      return {candidate:video,file,license:licenceOf(video)};
  }
  throw Error("Неможливо підтвердити повний відеопотік у цьому браузері (CORS, формат або сервер).");
}
function importChecked(verified) {
  if(!verified || !verified.file || !verified.candidate || !verified.license)
    throw Error("Немає перевіреного файлу.");
  if(typeof state==="undefined" || typeof persist!=="function")
    throw Error("Бібліотека недоступна.");
  const title=String(verified.candidate.name || "Відео PeerTube").trim().slice(0,120);
  let show=state.series.find(s=>s.title.toLocaleLowerCase("uk")===title.toLocaleLowerCase("uk"));
  if(!show){
    if(state.series.length>=100)throw Error("Бібліотека заповнена.");
    show={id:"peer-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),title,seasons:[]};
    state.series.push(show);
  }
  const dupe=show.seasons.find(s=>s.episodeUrls.includes(verified.file.url));
  if(dupe){
    loadEpisode(show.id,dupe.number,1,false);showWatch();
    return {title,season:dupe.number,existing:true};
  }
  let season=1;
  while(show.seasons.some(s=>s.number===season))season++;
  if(season>30)throw Error("Перевищено кількість відеозаписів для цього заголовка.");
  show.seasons.push({number:season,quality:"PeerTube "+verified.file.label,
    episodeUrls:[verified.file.url],
    rights:{name:verified.license.name,url:verified.license.url,
      creator:verified.candidate.account?.displayName ||
        verified.candidate.account?.name || "",
      itemUrl:verified.candidate.url,verifiedAt:Date.now()}});
  persist();
  loadEpisode(show.id,season,1,false);
  showWatch();
  return {title,season,existing:false};
}
function render(items) {
  const output=$("peerResults");
  output.replaceChildren();
  if(!items.length){
    output.append(node("p","micro",
      "Не знайдено тривалих публічних записів із заявленою відкритою ліцензією. "+
      "Звичайні комерційні серіали в PeerTube найчастіше відсутні."));
    return;
  }
  for(const item of items){
    const card=node("article","source-card");
    card.append(node("h3","",item.name||"Без назви"));
    const license=licenceOf(item);
    card.append(node("p","micro",
      Math.round(Number(item.duration)/60)+" хв · "+license.name+
      " · "+(item.account?.displayName||item.account?.name||"Автор не вказаний")));
    const row=node("div","source-actions");
    const link=node("a","action","Переглянути першоджерело");
    link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";
    row.append(link);
    const action=node("button","action primary","Перевірити MP4 і додати");
    action.type="button";
    action.addEventListener("click",async()=>{
      action.disabled=true;
      action.textContent="Перевіряю відеофайл…";
      try{
        const verified=await verifyCandidate(item);
        importChecked(verified);
        $("peerDialog").close();
      }catch(error){
        message((item.name||"Відео")+": "+(error.message||"Не вдалося перевірити."),true);
      }finally{action.disabled=false;action.textContent="Перевірити MP4 і додати";}
    });
    row.append(action);
    card.append(row);
    output.append(card);
  }
}
async function submit() {
  if(busy)return;
  busy=true;
  const current=++token;
  $("peerSubmit").disabled=true;
  const text=$("peerQuery").value;
  message("Шукаю у федеративному каталозі PeerTube…");
  $("peerResults").replaceChildren();
  try{
    const found=await searchCandidates(text);
    if(current!==token)return;
    render(found.items);
    message("Переглянуто "+found.total+" результатів PeerTube · "+
      "з відкритою ліцензією і достатньою тривалістю: "+found.items.length+
      ". Натисни перевірку MP4 для конкретного запису.");
  }catch(error){
    if(current===token)message("Пошук PeerTube: "+(error.message||"помилка мережі"),true);
  }finally{busy=false;$("peerSubmit").disabled=false;}
}
function open(query="") {
  $("peerDialog").showModal();
  $("peerQuery").value=String(query||"").slice(0,160);
  $("peerResults").replaceChildren();
  message("PeerTube має публічний API та прямі файли для частини відео. "+
    "Заявлена ліцензія не гарантує, що завантажувач має авторські права.");
  if(query)submit();
}
$("openPeerTube").addEventListener("click",()=>open());
$("peerForm").addEventListener("submit",e=>{e.preventDefault();submit();});
$("peerClose").addEventListener("click",()=>$("peerDialog").close());
$("peerDialog").addEventListener("close",()=>{token++;});
window.MyCinemaPeerTube={open,searchCandidates,verifyCandidate,importChecked,helpers:{eligible,licenceOf,mp4files,detailEndpoint}};
})();