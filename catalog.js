(function () {
"use strict";
const byId = id => document.getElementById(id);
const DISC = window.MyCinemaDiscovery;
const PAGE_SIZE = 20;
const PROVIDER_CONCURRENCY = 3;
let genresLoaded = false;
const MAX_PROVIDER_CACHE = 300;
const CACHE_TTL_MS = 30 * 60 * 1000;
const providerCache = new Map();
const stateCatalog = {page:0, pages:1, session:0, busy:false, region:"UA", type:"all", shown:0, searched:0, cards:new Map()};
const CATEGORIES = {
  all:"Усі типи доступу",
  free:"Безкоштовно або з рекламою",
  flatrate:"За підпискою",
  rent:"Оренда",
  buy:"Купівля"
};
const CATEGORY_TYPES = {
  all:["flatrate","free","ads","rent","buy"],
  free:["free","ads"],
  flatrate:["flatrate"],
  rent:["rent"],
  buy:["buy"]
};
function node(tag, className, label) {
  const el=document.createElement(tag);
  if(className) el.className=className;
  if(label !== undefined) el.textContent=String(label);
  return el;
}
function message(msg,error=false) {
  const root=byId("exploreProgress");
  root.textContent=msg;
  root.style.color=error?"#ffb5a7":"";
}
function setLoading(value) {
  stateCatalog.busy=value;
  byId("exploreMore").disabled=value;
  byId("exploreApply").disabled=value;
}
function switchToCatalog() {
  if (typeof saveProgress==="function") saveProgress();
  if (typeof player!=="undefined") player.pause();
  byId("watchScreen").hidden=true;
  byId("libraryScreen").hidden=true;
  byId("searchScreen").hidden=true;
  byId("catalogExploreScreen").hidden=false;
  window.scrollTo(0,0);
  document.title="Каталог доступних серіалів — MyCinema";
  if (!stateCatalog.page) reload();
}
function getLocalSeries(row) {
  if (typeof state==="undefined" || !state.series) return null;
  const title=(row.name || row.original_name || "").trim().toLocaleLowerCase("uk");
  if(!title) return null;
  const found=state.series.find(s => s.title.trim().toLocaleLowerCase("uk")===title);
  const checker=window.MyCinemaAvailability;
  if (!found || !checker || checker.summary(found).verified===0) return null;
  return found;
}
function openLocalSeries(found) {
  if(!found || typeof loadEpisode!=="function" || typeof showWatch!=="function") return;
  const season=found.seasons[0];
  if(season && season.episodeUrls.length) {
    loadEpisode(found.id,season.number,1,false);
    showWatch();
  }
}
function poster(row) {
  const src=DISC.imageSrc(row.poster_path,"w342");
  if(!src) return node("div","discovery-poster discovery-placeholder","Постер відсутній");
  const img=node("img","discovery-poster");
  img.loading="lazy";img.alt="Постер: "+(row.name || "");
  img.src=src;
  img.onerror=()=>img.replaceWith(node("div","discovery-poster discovery-placeholder","Без постера"));
  return img;
}
function allProviders(data,types) {
  const seen=new Set(),result=[];
  for(const type of types) for(const p of data?.[type] || []) {
    if(!Number.isInteger(p.provider_id) || seen.has(p.provider_id)) continue;
    seen.add(p.provider_id);result.push(p);
  }
  return result;
}
function listProviderNames(providers) {
  const names=providers.slice(0,3).map(p=>p.provider_name).filter(Boolean);
  const rest=providers.length-names.length;
  return names.join(", ")+(rest>0?" та ще "+rest:"");
}
function renderCard(row, providers, archiveMatch=null) {
  const card=node("article","discovery-item catalog-result");
  card.append(poster(row));
  card.append(node("strong","discovery-name",row.name || row.original_name || "Без назви"));
  const year=(row.first_air_date||"").slice(0,4);
  const rating=Number.isFinite(row.vote_average) && row.vote_count > 0 ?
    " · ★ "+row.vote_average.toFixed(1):"";
  card.append(node("span","discovery-year",(year || "Рік невідомий")+rating));
  const local=getLocalSeries(row);
  if(local) card.append(node("span","catalog-verified","Власний перевірений потік"));
  const sourceLabel=archiveMatch ?
    "Знайдено ліцензований файл: "+archiveMatch.item.license.name :
    providers.length ? "Платформи: "+listProviderNames(providers) :
    local ? "Є перевірене локальне відеоджерело" :
    "Відеоджерело ще не перевірено — натисни «Шукати відкриті відео»";
  const sourceBadge=node("span","catalog-provider",sourceLabel);
  sourceBadge.classList.add("source-availability-label");
  card.append(sourceBadge);
  const buttons=node("div","catalog-result-actions");
  const details=node("button","action","Деталі");
  details.type="button";
  details.addEventListener("click",()=>{
    DISC.openSearch();
    DISC.showDetails(row);
  });
  buttons.append(details);
  const probeSources=node("button","action","Шукати відкриті відео");
  probeSources.type="button";
  probeSources.addEventListener("click",()=>{
    window.MyCinemaSources?.openWithTitle(row.original_name||row.name||"");
  });
  buttons.append(probeSources);
  if(archiveMatch) {
    const importBtn=node("button","action primary","Додати відео");
    importBtn.type="button";
    importBtn.addEventListener("click",()=>{
      try{
        const added=window.MyCinemaSources.addToLibrary(archiveMatch.item,[archiveMatch.file]);
        message("Додано: "+added.title+" · "+added.count+" відеофайл(ів).");
      }catch(e){message(e.message||"Помилка імпорту відео.",true);}
    });
    buttons.append(importBtn);
    const downloadArchive=node("button","action","Завантажити цей файл");
    downloadArchive.type="button";
    downloadArchive.addEventListener("click",()=>{
      try {
        window.MyCinemaSources.addToLibrary(archiveMatch.item,[archiveMatch.file]);
        window.MyCinemaDownloader?.downloadOne();
      }catch(e){message(e.message||"Не вдалося почати завантаження.",true);}
    });
    buttons.append(downloadArchive);
  }
  if(local) {
    const play=node("button","action primary","Моє відео");
    play.type="button";
    play.addEventListener("click",()=>openLocalSeries(local));
    buttons.append(play);
    const download=node("button","action","Завантажити");
    download.type="button";
    download.addEventListener("click",()=>{
      openLocalSeries(local);
      window.MyCinemaDownloader?.downloadOne();
    });
    buttons.append(download);
  } else {
    const official=node("button","action","Де дивитися");
    official.type="button";
    official.addEventListener("click",()=>{
      DISC.openSearch();
      DISC.showDetails(row);
    });
    buttons.append(official);
  }
  card.append(buttons);
  return card;
}
async function checkProviders(row, region, type) {
  const key=region+":"+row.id;
  const remembered=providerCache.get(key);
  let data;
  if(remembered && Date.now()-remembered.stamp<CACHE_TTL_MS) data=remembered.data;
  else {
    const response=await DISC.tmdb("/tv/"+row.id+"/watch/providers",{});
    data=(response.results||{})[region] || {};
    providerCache.set(key,{data,stamp:Date.now()});
    if(providerCache.size>MAX_PROVIDER_CACHE)providerCache.delete(providerCache.keys().next().value);
  }
  const matches=allProviders(data,CATEGORY_TYPES[type] || CATEGORY_TYPES.all);
  return matches;
}
async function checkOpenArchive(row) {
  const adapter=window.MyCinemaSources;
  if(!adapter)return null;
  const name=(row.original_name||row.name||"").trim();
  if(name.length<4)return null;
  const matches=await adapter.find(name,{maxResults:3});
  for(const item of matches.slice(0,3)) {
    // At most one verified episode candidate per item; auto-scan is intentionally bounded.
    for(const file of item.files.slice(0,2)) {
      const head=await adapter.checkFile(file.url);
      if(!head.ok)continue;
      const checker=window.MyCinemaAvailability;
      if(!checker)return null;
      await checker.scan([{seasons:[{episodeUrls:[file.url]}]}],()=>{},()=>{},true);
      const validated=checker.cached(file.url);
      // Reject trailers and short fragments; only probable full episodes.
      if(validated?.status==="available" && validated.duration>=900) {
        return {item,file};
      }
    }
  }
  return null;
}
async function verifyPage(rows, region, type, session, mode) {
  let index=0,checked=0,confirmed=0,failed=0;
  // The broad catalogue must never be hidden merely because no MP4 was found.
  // Render TMDB candidates first, then annotate the source verification outcome.
  async function worker(){
    while(index<rows.length && session===stateCatalog.session){
      const row=rows[index++];
      try {
        if(mode==="downloads"){
          const match=await checkOpenArchive(row);
          if(match && session===stateCatalog.session) {
            confirmed++;
            stateCatalog.shown++;
            byId("exploreResults").append(renderCard(row,[],match));
          }
        } else {
          const providers=await checkProviders(row,region,type);
          if(providers.length && session===stateCatalog.session) {
            confirmed++;
            stateCatalog.shown++;
            byId("exploreResults").append(renderCard(row,providers));
          }
        }
      }catch(_){failed++;}
      checked++;
      if(session!==stateCatalog.session)return;
      message("Перевірено "+checked+" із "+rows.length+" серіалів. "+
        (mode==="all" ? "Знайдено відкритих відеоджерел: " :
          mode==="downloads" ? "Серіалів із перевіреним відео: " :
          "Серіалів із підтвердженими платформами: ")+confirmed+
        (failed?" · технічних помилок: "+failed:"")+".");
    }
  }
  await Promise.all(Array.from({length:Math.min(PROVIDER_CONCURRENCY,rows.length)},()=>worker()));
  return {checked,confirmed,failed,aborted:session!==stateCatalog.session};
}
async function loadNext() {
  if(stateCatalog.busy || stateCatalog.page>=stateCatalog.pages) return;
  const session=stateCatalog.session;
  const next=stateCatalog.page+1;
  const region=stateCatalog.region;
  const type=stateCatalog.type;
  const mode=byId("exploreMode").value;
  setLoading(true);
  message("Завантажую сторінку "+next+" із каталогу TMDB...");
  const query={
    page:next,
    include_adult:false,
    sort_by:byId("exploreSort").value,
  };
  if(mode==="platforms") {
    query.watch_region=region;
    query.with_watch_monetization_types=CATEGORY_TYPES[type].join("|");
  }
  // Never constrain the TMDB discovery catalogue to pre-1980 releases.
  const year=byId("exploreYear").value;
  if(year)query["first_air_date.gte"]=year+"-01-01";
  const genre=byId("exploreGenre").value;
  if(genre)query.with_genres=genre;
  const rating=byId("exploreRating").value;
  if(rating) {query["vote_average.gte"]=rating;query["vote_count.gte"]="60";}
  try {
    const data=await DISC.tmdb("/discover/tv",query);
    if (session!==stateCatalog.session) return;
    const rows=(data.results||[]).slice(0,PAGE_SIZE).filter(row=>Number.isInteger(row.id));
    const total=Math.max(1,Math.min(500,Number(data.total_pages)||1));
    stateCatalog.pages=total;
    stateCatalog.page=next;
    stateCatalog.searched+=rows.length;
    if(mode==="all"){
      for(const row of rows){
        const card=renderCard(row,[]);
        byId("exploreResults").append(card);
        stateCatalog.cards.set(row.id,card);
        stateCatalog.shown++;
      }
    }
    // Усі серіали TMDB відображаються відразу. Перевірка джерел — окрема дія.
    if(rows.length && mode!=="all") await verifyPage(rows,region,type,session,mode);
    if(session!==stateCatalog.session)return;
    const remaining=stateCatalog.page<stateCatalog.pages;
    byId("exploreMore").hidden=!remaining;
    message("Переглянуто "+stateCatalog.searched+" серіалів · "+
      (mode==="all"?"показано карток: ":
        mode==="downloads"?"з перевіреним відкритим відеофайлом: ":
        "з підтвердженими платформами у "+region+": ")+stateCatalog.shown+
      ". "+(mode==="all"?"Наявність файлів перевіряється окремо для обраного серіалу. ":"")+
      (remaining?"Можна завантажити наступну сторінку.":"Кінець результатів."));
    if(!stateCatalog.shown) {
      byId("exploreEmpty").hidden=false;
      byId("exploreEmpty").textContent=mode==="downloads"?
        "У цій вибірці немає серіалів із перевіреними файлами Internet Archive. Це не означає, що інших способів перегляду немає." :
        mode==="platforms"?"У цій вибірці немає підтверджених платформ у вибраній країні." :
        "TMDB не повернув серіалів для вибраних фільтрів.";
    } else byId("exploreEmpty").hidden=true;
  } catch (error) {
    if(session===stateCatalog.session) message(error.message||"Не вдалося отримати каталог.",true);
  } finally {
    if(session===stateCatalog.session)setLoading(false);
  }
}
function reload() {
  stateCatalog.session++;
  stateCatalog.page=0;
  stateCatalog.pages=1;
  stateCatalog.shown=0;
  stateCatalog.searched=0;
  stateCatalog.cards.clear();
  stateCatalog.region=DISC.region();
  stateCatalog.type=byId("exploreType").value;
  byId("exploreType").disabled=byId("exploreMode").value!=="platforms";
  byId("exploreResults").replaceChildren();
  byId("exploreEmpty").hidden=true;
  byId("exploreMore").hidden=true;
  setLoading(false);
  let hasKey=false;
  try{hasKey=!!localStorage.getItem("mycinema_tmdb_token_v1");}catch(_){}
  byId("exploreNoKey").hidden=hasKey;
  if(!hasKey) {
    message("Потрібен TMDB API-ключ. Натисни «Отримати ключ TMDB» або «Пошук відео без ключа».");
    return;
  }
  loadNext();
}
async function genres() {
  if(genresLoaded)return;
  try {
    const data=await DISC.tmdb("/genre/tv/list",{});
    const select=byId("exploreGenre");
    if(!select)return;
    genresLoaded=true;
    for(const item of data.genres || []) {
      if(!Number.isInteger(item.id))continue;
      const option=node("option","",item.name);
      option.value=String(item.id);
      select.append(option);
    }
  } catch (_) { /* genre picker stays optional */ }
}
byId("openCatalogExplore").addEventListener("click",()=>{switchToCatalog();genres();});
byId("exploreMore").addEventListener("click",loadNext);
byId("exploreFilters").addEventListener("submit",event=>{event.preventDefault();reload();});
byId("exploreSettings").addEventListener("click",()=>byId("openSettings").click());
byId("exploreAddKey").addEventListener("click",()=>byId("openSettings").click());
byId("exploreWithoutKey").addEventListener("click",()=>byId("openSources").click());
byId("settingsDialog").addEventListener("close",()=>{
  if(!byId("catalogExploreScreen").hidden){reload();genres();}
});
byId("exploreType").addEventListener("change",reload);
byId("exploreMode").addEventListener("change",reload);
byId("exploreSort").addEventListener("change",reload);
byId("exploreGenre").addEventListener("change",reload);
byId("exploreRating").addEventListener("change",reload);
byId("exploreYear").addEventListener("change",reload);
window.MyCinemaCatalog={reload,open:switchToCatalog};
})();