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
  const old=await fileHandle.getFile();
  let start=old.size;
  let total=0;
  if(start>0) {
    // A local existing file is not automatically considered complete.
    const head=await fetch(url,{method:"HEAD",mode:"cors",signal:controller.signal,redirect:"follow"});
    if(!head.ok)throw Error(label+": неможливо перевірити наявний файл (HTTP "+head.status+").");
    total=Number(head.headers.get("content-length"))||0;
    const ct=(head.headers.get("content-type")||"").toLowerCase();
    if(!ct.startsWith("video/") && !ct.includes("octet-stream"))
      throw Error(label+": сервер не підтвердив тип відеофайлу.");
    if(!total || total<MIN_MEDIA_BYTES)
      throw Error(label+": сервер не надав повний розмір для безпечного відновлення.");
    if(start===total)return {bytes:total,skipped:true,resumed:false};
    if(start>total)throw Error(label+": локальний файл більший за серверний; не перезаписую.");
  }
  const headers=start>0?{"Range":"bytes="+start+"-"}:{};
  const res=await fetch(url,{mode:"cors",headers,signal:controller.signal,redirect:"follow"});
  if(!res.ok)throw Error(label+": сервер відповів HTTP "+res.status+".");
  const mime=(res.headers.get("content-type")||"").toLowerCase();
  if(!mime.startsWith("video/") && !mime.includes("octet-stream"))
    throw Error(label+": сервер повернув "+(mime||"невідомий тип")+" замість відеофайлу.");
  const length=Number(res.headers.get("content-length"))||0;
  if(res.status===206){
    const partial=res.headers.get("content-range")||"";
    const match=partial.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    if(!match || Number(match[1])!==start ||
       Number(match[2])+1!==Number(match[3])) {
      throw Error(label+": сервер віддав неповну або невідповідну частину відео.");
    }
    const full=Number(match[3]);
    if(total && full!==total)throw Error(label+": розмір файлу змінився після попереднього завантаження.");
    total=full;
  }else if(start>0){
    throw Error(label+": сервер не підтримує відновлення Range. Наявний файл збережено.");
  }
  if(!total && length>0)total=length;
  if(total>0 && total<MIN_MEDIA_BYTES)
    throw Error(label+": файл занадто малий ("+prettyBytes(total)+").");
  if(!res.body)throw Error(label+": браузер не підтримує потокове збереження з цього джерела.");
  const file=await fileHandle.createWritable({keepExistingData:start>0});
  if(start>0)await file.seek(start);
  const reader=res.body.getReader();
  let written=0;
  try{
    while(true){
      if(controller.signal.aborted)throw new DOMException("Скасовано","AbortError");
      const {done,value}=await reader.read();
      if(done)break;
      await file.write(value);
      written+=value.byteLength;
      if(typeof onProgress==="function")onProgress(start+written,total);
    }
    if(length>0 && written!==length)
      throw Error(label+": завантажено "+written+" байтів замість "+length+".");
    if(total>0 && start+written!==total)
      throw Error(label+": підсумковий розмір не збігається з серверним.");
    if(start+written<MIN_MEDIA_BYTES)
      throw Error(label+": недостатньо даних для повної серії.");
    await file.close();
    const saved=await fileHandle.getFile();
    if(total>0 && saved.size!==total)
      throw Error(label+": записаний файл має неправильний розмір.");
    return {bytes:saved.size,skipped:false,resumed:start>0};
  }catch(error){
    try{await reader.cancel();}catch(_){}
    // При скасуванні залишаємо вже записані байти для відновлення через HTTP Range.
    try{
      if(error.name==="AbortError" && written>0)await file.close();
      else await file.abort();
    }catch(_){}
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
    const result=await writeRemoteToFile(url,handle,suggested,(written,total)=>{
      status("Завантаження: "+suggested+" — "+prettyBytes(written)+
        (total?" із "+prettyBytes(total)+" ("+Math.round(written/total*100)+"%)":""));
    });
    status((result.skipped?"Файл уже збережено: ":"Збережено: ")+suggested+
      " · "+prettyBytes(result.bytes)+(result.resumed?" (відновлено)":""));
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
        const result=await writeRemoteToFile(url,handle,name,(written,total)=>{
          status("Серія "+(index+1)+"/"+c.season.episodeUrls.length+": "+prettyBytes(written)+
            (total?" із "+prettyBytes(total):"")+". Збережено: "+done);
        });
        if(result.skipped)existing++;
        else done++;
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
window.MyCinemaDownloader={downloadOne,downloadAll};
byId("downloadEpisode").addEventListener("click",downloadOne);
byId("downloadSeason").addEventListener("click",downloadAll);
byId("cancelDownload").addEventListener("click",()=>controller?.abort());
})();