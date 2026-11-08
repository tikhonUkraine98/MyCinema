(function () {
"use strict";
const byId=id=>document.getElementById(id);
const checks=window.MyCinemaAvailability;
let active=false;
let controller=null;
const MIN_MEDIA_BYTES=16*1024*1024;
function status(msg,isError=false) {
  const node=byId("downloadProgress");
  node.textContent=msg;
  node.style.color=isError?"#ffb3a3":"";
}
function buttons(disabled) {
  active=disabled;
  for(const id of ["downloadEpisode","downloadSeason"])
    byId(id).disabled=disabled;
  byId("cancelDownload").hidden=!disabled;
}
function safeName(s) {
  return String(s||"Серіал").normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g," ")
    .replace(/\s+/g," ").trim().slice(0,70)||"Серіал";
}
function extension(url) {
  try{
    const name=new URL(url).pathname.toLowerCase();
    return name.endsWith(".webm")?".webm":".mp4";
  }catch(_){return ".mp4";}
}
function current() {
  if(typeof state==="undefined" || !state.current)return null;
  const show=state.series.find(s=>s.id===state.current.seriesId);
  const season=show?.seasons.find(s=>s.number===state.current.season);
  if(!season)return null;
  return {show,season,episode:state.current.episode};
}
function getCheck(url) {return checks?.cached(url);}
function enoughEvidence(url) {
  const checked=getCheck(url);
  if(!checked)throw Error("Відеоджерело ще не перевірено. Відкрий «Бібліотека» і натисни «Перевірити всі серії».");
  if(checked.status==="preview")throw Error("Це коротка заглушка, а не повна серія.");
  if(checked.status!=="available")throw Error("Доступність відео не підтверджена: "+checked.status+".");
}
function prettyBytes(bytes) {
  return (bytes/(1024*1024)).toFixed(1)+" МБ";
}
async function writeRemoteToFile(url,fileHandle,label,onProgress) {
  enoughEvidence(url);
  const res=await fetch(url,{mode:"cors",signal:controller.signal,redirect:"follow"});
  if(!res.ok)throw Error(label+": сервер відповів HTTP "+res.status+".");
  const mime=(res.headers.get("content-type")||"").toLowerCase();
  if(!mime.startsWith("video/") && !mime.includes("octet-stream"))
    throw Error(label+": сервер повернув "+(mime||"невідомий тип")+" замість відеофайлу.");
  const length=Number(res.headers.get("content-length"))||0;
  if(length>0 && length<MIN_MEDIA_BYTES)
    throw Error(label+": відповідь занадто мала для повної серії ("+prettyBytes(length)+").");
  if(!res.body)throw Error(label+": браузер не підтримує потокове збереження з цього джерела.");
  const file=await fileHandle.createWritable();
  const reader=res.body.getReader();
  let written=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      if(controller.signal.aborted)throw new DOMException("Скасовано","AbortError");
      await file.write(value);
      written+=value.byteLength;
      if(typeof onProgress==="function")onProgress(written,length);
    }
    if(length>0 && written!==length)throw Error(label+": завантажено "+written+" байтів замість "+length+".");
    if(written<MIN_MEDIA_BYTES)throw Error(label+": замало відеоданих ("+prettyBytes(written)+").");
    await file.close();
    return written;
  }catch(error) {
    try{await reader.cancel();}catch(_){}
    try{await file.abort();}catch(_){}
    throw error;
  }
}
function validateBrowser() {
  if(!window.isSecureContext || typeof window.showSaveFilePicker!=="function" ||
      typeof window.showDirectoryPicker!=="function") {
    throw Error("Для збереження потрібен Chrome/Edge із підтримкою File System Access API та безпечний контекст (file:// або localhost).");
  }
}
async function downloadOne() {
  if(active)return;
  let c;
  try {
    c=current();
    if(!c)throw Error("Вибери серію.");
    const url=c.season.episodeUrls[c.episode-1];
    enoughEvidence(url);
    validateBrowser();
    const suggested=safeName(c.show.title)+"_S"+String(c.season.number).padStart(2,"0")+
      "E"+String(c.episode).padStart(2,"0")+extension(url);
    // File picker must be called before any await that loses user activation.
    const handle=await window.showSaveFilePicker({suggestedName:suggested,types:[{
      description:"Відео",accept:{"video/mp4":[".mp4"],"video/webm":[".webm"]}}]});
    buttons(true);
    controller=new AbortController();
    const bytes=await writeRemoteToFile(url,handle,suggested,(written,total)=>{
      status("Завантаження: "+suggested+" — "+prettyBytes(written)+
        (total?" із "+prettyBytes(total)+" ("+Math.round(written/total*100)+"%)":""));
    });
    status("Збережено "+suggested+" · "+prettyBytes(bytes));
  }catch(error) {
    if(error.name!=="AbortError")status(error.message || "Не вдалося завантажити відео.",true);
    else status("Завантаження скасовано.");
  }finally {controller=null;buttons(false);}
}
async function downloadAll() {
  if(active)return;
  let folder;
  let c;
  try{
    c=current();
    if(!c)throw Error("Спочатку вибери серіал.");
    validateBrowser();
    // One folder chooser opens on direct user interaction.
    folder=await window.showDirectoryPicker({mode:"readwrite",id:"mycinema-season"});
    buttons(true);
    controller=new AbortController();
    status("Перевіряю джерела сезону…");
    if(checks)await checks.scan([c.show],()=>{},status,true);
    const output=await folder.getDirectoryHandle(safeName(c.show.title),{create:true});
    const seasonDir=await output.getDirectoryHandle("Season "+c.season.number,{create:true});
    let done=0,skipped=0,failed=0,existing=0;
    for(let index=0;index<c.season.episodeUrls.length;index++){
      if(controller.signal.aborted)throw new DOMException("Скасовано","AbortError");
      const url=c.season.episodeUrls[index];
      if(getCheck(url)?.status!=="available") {skipped++;continue;}
      const name="S"+String(c.season.number).padStart(2,"0")+
        "E"+String(index+1).padStart(2,"0")+extension(url);
      try{
        const handle=await seasonDir.getFileHandle(name,{create:true});
        const present=await handle.getFile();
        if(present.size>0) { existing++; continue; }
        await writeRemoteToFile(url,handle,name,(written,total)=>{
          status("Серія "+(index+1)+"/"+c.season.episodeUrls.length+": "+prettyBytes(written)+
            (total?" із "+prettyBytes(total):"")+". Збережено: "+done);
        });
        done++;
      }catch(error) {
        if(error.name==="AbortError")throw error;
        failed++;
        status("Не вдалося зберегти "+name+": "+(error.message||"помилка"),true);
      }
    }
    status("Готово. Завантажено "+done+" серій; уже було "+existing+
      "; не підтверджено "+skipped+"; помилок "+failed+".");
  }catch(error) {
    if(error.name!=="AbortError")status(error.message||"Помилка збереження.",true);
    else status("Завантаження скасовано.");
  }finally {controller=null;buttons(false);}
}
byId("downloadEpisode").addEventListener("click",downloadOne);
byId("downloadSeason").addEventListener("click",downloadAll);
byId("cancelDownload").addEventListener("click",()=>controller?.abort());
})();