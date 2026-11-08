import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const playerScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(playerScript, "Inline player script must exist");
new vm.Script(playerScript, { filename: "index-inline.js" });

const discoveryScript = readFileSync(new URL("../discovery.js", import.meta.url), "utf8");
new vm.Script(discoveryScript, { filename: "discovery.js" });
const availabilityScript = readFileSync(new URL("../availability.js", import.meta.url), "utf8");
new vm.Script(availabilityScript, { filename: "availability.js" });
assert.match(html, /src="\.\/availability\.js"/, "Availability module missing");
for (const id of ["onlyPlayable","verifySources","verifyAll","verificationProgress"]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Missing #" + id);
}
assert.match(availabilityScript, /onloadedmetadata/, "Metadata probe missing");
assert.match(availabilityScript, /onseeked/, "Media seek verification missing");
assert.match(availabilityScript, /MIN_EPISODE_SECONDS/, "Short preview filter missing");
assert.match(availabilityScript, /MAX_BATCH_AUTO/, "Automatic scan limit missing");
const offlineScript = readFileSync(new URL("../offline.js", import.meta.url), "utf8");
new vm.Script(offlineScript, {filename:"offline.js"});
assert.match(html, /src="\.\/offline\.js"/, "Offline playback module missing");
const sourcesScript = readFileSync(new URL("../sources.js", import.meta.url), "utf8");
new vm.Script(sourcesScript, {filename:"sources.js"});
assert.match(html, /src="\.\/sources\.js"/, "Open video source module missing");
assert.match(sourcesScript, /licenseInfo/, "License check missing");
assert.match(sourcesScript, /checkFile/, "Archive source verification missing");
assert.match(sourcesScript, /addToLibrary/, "One-click import missing");
assert.match(sourcesScript, /browseOpenEpisodes/, "Title-free archive browsing missing");
const catalogScript = readFileSync(new URL("../catalog.js", import.meta.url), "utf8");
new vm.Script(catalogScript, {filename: "catalog.js"});
const downloaderScript = readFileSync(new URL("../downloader.js", import.meta.url), "utf8");
new vm.Script(downloaderScript, {filename: "downloader.js"});
for(const name of ["catalog.js","downloader.js"]) {
  assert.match(html, new RegExp('src="\\./' + name.replace(".","\\.") + '"'), "Missing module "+name);
}
for (const id of [
  "catalogExploreScreen","openCatalogExplore","exploreFilters","exploreResults","exploreMode",
  "openSources","sourceDialog","sourceSearchForm","sourceQuery","sourceSearch",
  "sourceStatus","sourceResults","closeSources","sourceBrowse","sourceBrowseMore",
  "openOfflineFiles","offlineFiles",
  "exploreProgress","exploreMore","exploreApply","exploreSettings","exploreEmpty",
  "exploreType","exploreSort","exploreGenre","exploreRating",
  "downloadEpisode","downloadSeason","cancelDownload","downloadProgress"
]) assert.match(html, new RegExp('id="' + id + '"'), "Missing #"+id);
assert.match(catalogScript,/checkProviders/, "Catalog lacks per-show availability verification");
assert.match(catalogScript,/checkOpenArchive/, "Catalog lacks licensed file verification");
assert.match(catalogScript,/archiveMatch/, "Catalog cannot surface downloadable sources");
assert.match(catalogScript,/with_watch_monetization_types/, "Watch-region filter absent");
assert.match(offlineScript,/createObjectURL/, "Offline file playback missing");
assert.match(offlineScript,/offline_progress/, "Offline resume missing");
assert.match(downloaderScript,/showSaveFilePicker/, "Episode downloader missing");
assert.match(downloaderScript,/showDirectoryPicker/, "Season downloader missing");
assert.match(downloaderScript,/fetch\(url/, "Streaming download missing");
assert.match(html, /src="\.\/discovery\.js"/);
assert.match(html, /href="\.\/discovery\.css"/);
for (const id of [
  "libraryScreen", "watchScreen", "searchScreen", "tmdbSearchForm",
  "tmdbResults", "tmdbDetails", "settingsDialog", "tmdbFavorites",
  "catalog", "player", "episodeList", "seriesForm"
]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Missing #" + id);
}
assert.doesNotMatch(html, /werkecdn\.me/i, "Do not publish third-party media URLs");
assert.match(discoveryScript, /watch\/providers/, "Provider discovery missing");
assert.match(playerScript, /my_video_library_v2/, "Old local library compatibility missing");
console.log("MyCinema checks passed: JS syntax, UI hooks, verified platform catalog, streaming downloader, and video verification.");
