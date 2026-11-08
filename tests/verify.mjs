import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const playerScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(playerScript, "Inline player script must exist");
new vm.Script(playerScript, { filename: "index-inline.js" });

const discoveryScript = readFileSync(new URL("../discovery.js", import.meta.url), "utf8");
new vm.Script(discoveryScript, { filename: "discovery.js" });
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
console.log("MyCinema checks passed: JS syntax, UI hooks, discovery and safe initial state.");
