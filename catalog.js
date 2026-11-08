(function () {
"use strict";
const byId = id => document.getElementById(id);
const DISC = window.MyCinemaDiscovery;
const PAGE_SIZE = 20;
const PROVIDER_CONCURRENCY = 4;
const MAX_PROVIDER_CACHE = 300;
const CACHE_TTL_MS = 30 * 60 * 1000;
const providerCache = new Map();
const stateCatalog = {page:0, pages:1, session:0, busy:false, region:"UA", type:"all", shown:0, searched:0};
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
function renderCard(row, providers) {
  const card=node("article","discovery-item catalog-result");
  card.append(poster(row));
  card.append(node("strong","discovery-name",row.name || row.original_name || "Без назви"));
  const year=(row.first_air_date||"").slice(0,4);
  const rating=Number.isFinite(row.vote_average) && row.vote_count > 0 ?
    " · ★ "+row.vote_average.toFixed(1):"";
  card.append(node("span","discovery-year",(year || "Рік невідомий")+rating));
  const local=getLocalSeries(row);
  if(local) card.append(node("span","catalog-verified","Власний перевірений потік"));
  card.append(node("span","catalog-provider",listProviderNames(providers)));
  const buttons=node("div","catalog-result-actions");
  const details=node("button","action","Деталі");
  details.type="button";
  details.addEventListener("click",()=>{
    DISC.openSearch();
    DISC.showDetails(row);
  });
  buttons.append(details);
  if(local) {
    const play=node("button","action primary","Моє відео");
    play.type="button";
    play.addEventListener("click",()=>openLocalSeries(local));
    buttons.append(play);
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
async function verifyPage(rows, region, type, session) {
  let index=0;
  let checked=0;
  let successful=0;
  let failures=0;
  const accepted=new Array(rows.length).fill(null);
  const worker=async ()=>{
    while(index<rows.length && session===stateCatalog.session) {
      const position=index++;
      const row=rows[position];
      try {
        const providers=await checkProviders(row,region,type);
        if(providers.length) {accepted[position]={row,providers};successful++;}
      } catch (_) {failures++;}
      checked++;
      if(session!==stateCatalog.session)return;
      message("Перевірено платформ для "+checked+" із "+rows.length+
        " серіалів на сторінці · підтверджено "+successful+
        (failures?" · з помилками "+failures:"")+".");
    }
  };
  await Promise.all(Array.from({length:Math.min(PROVIDER_CONCURRENCY,rows.length)},()=>worker()));
  if (session!==stateCatalog.session) return {aborted:true};
  for(const item of accepted) if(item) {
    byId("exploreResults").append(renderCard(item.row,item.providers));
    stateCatalog.shown++;
  }
  return {successful,failures,checked};
}
async function loadNext() {
  if(stateCatalog.busy || stateCatalog.page>=stateCatalog.pages) return;
  const session=stateCatalog.session;
  const next=stateCatalog.page+1;
  const region=stateCatalog.region;
  const type=stateCatalog.type;
  setLoading(true);
  message("Завантажую сторінку "+next+" із каталогу TMDB...");
  const query={
    page:next,
    include_adult:false,
    sort_by:byId("exploreSort").value,
    watch_region:region,
    with_watch_monetization_types:CATEGORY_TYPES[type].join("|")
  };
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
    if(rows.length)await verifyPage(rows,region,type,session);
    if(session!==stateCatalog.session)return;
    const remaining=stateCatalog.page<stateCatalog.pages;
    byId("exploreMore").hidden=!remaining;
    message("Переглянуто "+stateCatalog.searched+" кандидатів · "+
      "підтверджено платформу для "+stateCatalog.shown+
      " серіалів у "+region+". "+
      (remaining?"Можна завантажити наступну сторінку.":"Кінець результатів."));
    if(!stateCatalog.shown) {
      byId("exploreEmpty").hidden=false;
      byId("exploreEmpty").textContent="У цій вибірці поки не знайшлося підтверджених платформ. Зміни фільтри або завантаж наступну сторінку.";
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
  stateCatalog.region=DISC.region();
  stateCatalog.type=byId("exploreType").value;
  byId("exploreResults").replaceChildren();
  byId("exploreEmpty").hidden=true;
  byId("exploreMore").hidden=true;
  setLoading(false);
  if(!localStorage.getItem("mycinema_tmdb_token_v1")) {
    message("Для каталогу введи TMDB API-ключ у налаштуваннях. Ключ зберігається локально.");
    return;
  }
  loadNext();
}
async function genres() {
  try {
    const data=await DISC.tmdb("/genre/tv/list",{});
    const select=byId("exploreGenre");
    if(!select)return;
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
byId("exploreType").addEventListener("change",reload);
byId("exploreSort").addEventListener("change",reload);
byId("exploreGenre").addEventListener("change",reload);
byId("exploreRating").addEventListener("change",reload);
window.MyCinemaCatalog={reload,open:switchToCatalog};
})();