(function () {
"use strict";
const CACHE_KEY = "mycinema_availability_v1";
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 10 * 60 * 1000;
const MIN_EPISODE_SECONDS = 120; // короткі paywall-заглушки не вважаємо серією
const TIMEOUT_MS = 12000;
const MAX_CACHE_ENTRIES = 600;
let cache = {};
let scanning = false;

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [url, value] of Object.entries(parsed).slice(-MAX_CACHE_ENTRIES)) {
        if (typeof url === "string" && /^https?:\/\//.test(url) &&
          value && ["available", "preview", "error", "unknown"].includes(value.status) &&
          Number.isFinite(value.checkedAt)) {
          cache[url] = {status:value.status, checkedAt:value.checkedAt,
            duration:Number.isFinite(value.duration) ? value.duration : 0};
        }
      }
    }
  } catch (_) { cache = {}; }
}
function persist() {
  try {
    const sorted = Object.entries(cache).sort((a,b) => b[1].checkedAt - a[1].checkedAt)
      .slice(0,MAX_CACHE_ENTRIES);
    cache = Object.fromEntries(sorted);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_) { /* may be unavailable in private file mode */ }
}
readCache();
function cached(url) {
  const item = cache[url];
  if (!item) return null;
  const ttl = item.status === "available" ? SUCCESS_TTL : FAILURE_TTL;
  if (Date.now() - item.checkedAt > ttl) return null;
  return item;
}
function summary(show) {
  const result = {total:0, checked:0, verified:0, preview:0, failed:0, unknown:0};
  for (const season of show.seasons || []) for (const url of season.episodeUrls || []) {
    result.total++;
    const status = cached(url)?.status;
    if (status) {
      result.checked++;
      if (status === "available") result.verified++;
      else if (status === "preview") result.preview++;
      else if (status === "error") result.failed++;
      else result.unknown++;
    }
  }
  return result;
}
function probe(url) {
  return new Promise((resolve) => {
    let done = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let timer;
    const finish = (status, duration=0) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
      resolve({status, duration, checkedAt:Date.now()});
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return finish("unknown");
      finish(duration >= MIN_EPISODE_SECONDS ? "available" : "preview", duration);
    };
    video.onerror = () => finish("error");
    timer = setTimeout(() => finish("unknown"), TIMEOUT_MS);
    try { video.src = url; video.load(); } catch (_) { finish("error"); }
  });
}
async function scan(series, onUpdate, onProgress, all=false) {
  if (scanning) return;
  scanning = true;
  const urls = [];
  const distinct = new Set();
  for (const show of series || []) {
    for (const season of show.seasons || []) {
      const batch = all ? season.episodeUrls : season.episodeUrls.slice(0,1);
      for (const url of batch) {
        if (/^https?:\/\//.test(url) && !distinct.has(url) && !cached(url)) {
          distinct.add(url);
          urls.push(url);
        }
      }
    }
  }
  let index = 0;
  let completed = 0;
  const report = () => {
    if (typeof onProgress === "function") {
      onProgress(urls.length ? "Перевірено " + completed + " із " + urls.length +
        " нових відеоджерел. Перевірка підтверджує лише відтворення." :
        "Перевірка актуальна. За потреби скористайся кнопкою «Перевірити всі серії».");
    }
  };
  report();
  const worker = async () => {
    while (index < urls.length) {
      const url = urls[index++];
      cache[url] = await probe(url);
      completed++;
      persist();
      if (typeof onUpdate === "function") onUpdate();
      report();
    }
  };
  try { await Promise.all([worker(), worker()]); }
  finally { scanning = false; }
}
function reset() {
  cache = {};
  try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
}
window.MyCinemaAvailability = {summary, scan, reset, cached, minSeconds:MIN_EPISODE_SECONDS};
function initialize() {
  const only = document.getElementById("onlyPlayable");
  const first = document.getElementById("verifySources");
  const all = document.getElementById("verifyAll");
  const label = document.getElementById("verificationProgress");
  if (!only || !first || !all || !label) return;
  const redraw = () => { if (typeof renderLibrary === "function") renderLibrary(); };
  const update = text => { label.textContent = text; };
  const run = allSources => scan(state.series, redraw, update, allSources);
  only.addEventListener("change", redraw);
  first.addEventListener("click", () => {reset(); redraw(); run(false);});
  all.addEventListener("click", () => {reset(); redraw(); run(true);});
  // Automatically check the first episode of each saved season when opening.
  const originalShowLibrary = showLibrary;
  window.showLibrary = function () {
    originalShowLibrary();
    run(false);
  };
  if (!document.getElementById("libraryScreen").hidden) run(false);
}
initialize();
})();