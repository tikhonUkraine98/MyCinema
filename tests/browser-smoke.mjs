import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const load = path => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const html=load("index.html");
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline,"Inline player code missing");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,"Duplicate DOM ids");
const listeners=new Map();
class FakeNode{
  constructor(tag="div"){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.dataset={};
    this.value="";this.textContent="";this.checked=false;this.disabled=false;this.hidden=false;
    this.className="";this.classList={add(){},remove(){},toggle(){},contains(){return false}};
    this.href="";this.readyState=0;this.duration=1800;this._currentTime=0;}
  append(...items){this.children.push(...items);}
  appendChild(node){this.append(node);return node;}
  replaceChildren(...items){this.children=[...items];}
  get firstElementChild(){return this.children[0]||null;}
  addEventListener(name,callback){
    if(!listeners.has(this))listeners.set(this,new Map());
    listeners.get(this).set(name,callback);
  }
  dispatchEvent(event){
    const fn=listeners.get(this)?.get(event.type);
    if(fn)return fn(event);
  }
  click(){return this.dispatchEvent({type:"click",preventDefault(){}});}
  focus(){}
  setAttribute(name,value){this[name]=value;}
  pause(){}
  play(){return Promise.resolve();}
  load(){if(this.src && this.tagName==="VIDEO" && this.onloadedmetadata)this.onloadedmetadata();}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent({type:"close"});}
  scrollIntoView(){}
  removeAttribute(name){if(name==="src")this.src="";}
  remove(){}
  get currentTime(){return this._currentTime;}
  set currentTime(value){
    this._currentTime=Number(value);
    this.readyState=3;
    if(this.onseeked)this.onseeked();
  }
}
const elements=new Map();
for(const id of ids){
  const n=new FakeNode(id==="player"?"video":"div");
  n.id=id;
  if(id==="libraryScreen"||id==="searchScreen"||id==="catalogExploreScreen")n.hidden=true;
  if(id==="exploreMode")n.value="all";
  if(id==="exploreType")n.value="all";
  if(id==="exploreSort")n.value="popularity.desc";
  if(id==="providerRegion")n.value="UA";
  elements.set(id,n);
}
const document={
  title:"Test",
  body:new FakeNode("body"),
  getElementById(id){return elements.get(id)||null;},
  createElement(tag){return new FakeNode(tag);}
};
const entries=new Map();
const localStorage={
  getItem(key){return entries.has(key)?entries.get(key):null;},
  setItem(key,val){entries.set(key,String(val));},
  removeItem(key){entries.delete(key);}
};
const window={scrollTo(){},addEventListener(){},isSecureContext:true};
const FAKE_BYTES=17*1024*1024;
const mockStream=()=>({
  getReader(){
    let used=false;
    return {
      async read(){
        if(used)return {done:true};
        used=true;return {done:false,value:{byteLength:FAKE_BYTES}};
      },
      async cancel(){}
    };
  }
});
const PEER_UUID="9c9de5e8-0a1e-484a-b099-e80766180a6d";
const PEER_ORIGIN="https://video.peertube.example";
const PEER_FILE=PEER_ORIGIN+"/static/web-videos/episode01.mp4";
let latestTmdbDiscoverUrl="";
const fakeFetch=async (input,options={})=>{
  const url=String(input);
  if(url.startsWith("https://sepiasearch.org/api/v1/search/videos")) {
    return {ok:true,status:200,json:async()=>({data:[{
      uuid:PEER_UUID,name:"Independent Creative Drama — Episode 1",
      url:PEER_ORIGIN+"/videos/watch/"+PEER_UUID,
      privacy:{id:1,label:"Public"},licence:{id:1,label:"Attribution"},
      duration:1800,isLive:false,nsfw:false,account:{displayName:"Independent Creator"}
    }]})};
  }
  if(url.startsWith(PEER_ORIGIN+"/api/v1/videos/"+PEER_UUID)){
    return {ok:true,status:200,json:async()=>({
      uuid:PEER_UUID,name:"Independent Creative Drama — Episode 1",
      url:PEER_ORIGIN+"/videos/watch/"+PEER_UUID,
      privacy:{id:1,label:"Public"},licence:{id:1,label:"Attribution"},
      duration:1800,isLive:false,nsfw:false,downloadEnabled:true,
      account:{displayName:"Independent Creator"},
      files:[{size:FAKE_BYTES,fileUrl:PEER_FILE,resolution:{label:"720p"}}]
    })};
  }
  if(options.method==="HEAD" && url===PEER_FILE){
    return {ok:true,status:200,headers:new Headers({"content-type":"video/mp4",
      "content-length":String(FAKE_BYTES)})};
  }
  if(url.startsWith("https://api.themoviedb.org/3/discover/tv")){
    latestTmdbDiscoverUrl=url;
    return {ok:true,status:200,json:async()=>({page:1,total_pages:1,total_results:2,results:[
      {id:1918,name:"Modern Sci Fi",original_name:"Modern Sci Fi",first_air_date:"2025-01-01",vote_average:8.2,vote_count:200},
      {id:1927,name:"New Mystery",original_name:"New Mystery",first_air_date:"2026-02-14",vote_average:7.1,vote_count:100}
    ]})};
  }
  if(url.startsWith("https://archive.org/advancedsearch.php"))
    return {ok:true,status:200,json:async()=>({response:{docs:[
      {identifier:"demo-series",title:"Demo Archive Series Episode 1"}
    ]}})};
  if(url.startsWith("https://archive.org/metadata/demo-series"))
    return {ok:true,status:200,json:async()=>({metadata:{
      title:"Demo Archive Series Episode 1",creator:"Creator",
      licenseurl:"https://creativecommons.org/licenses/by/4.0/"
    },files:[{name:"episode01.mp4",format:"MPEG4",size:"50000000"}]})};
  if(options.method==="HEAD" && url.startsWith("https://archive.org/download/demo-series/"))
    return {ok:true,status:200,headers:new Headers({
      "content-type":"video/mp4","content-length":String(FAKE_BYTES)
    })};
  if(!options.method && url.startsWith("https://archive.org/download/demo-series/"))
    return {ok:true,status:200,headers:new Headers({
      "content-type":"video/mp4","content-length":String(FAKE_BYTES)
    }),body:mockStream()};
  throw Error("Unexpected network request in smoke test: "+url);
};
class TestURL extends URL {
  static createObjectURL(){return "blob:mycinema-test";}
  static revokeObjectURL(){}
}
const sandbox=vm.createContext({
  document,window,localStorage,
  console,URL:TestURL,URLSearchParams,AbortController,DOMException,
  HTMLMediaElement:{HAVE_CURRENT_DATA:2},
  setTimeout,clearTimeout,
  confirm(){return true;},alert(message){throw Error("Unexpected alert: "+message);},
  Event:class Event{constructor(type){this.type=type;}},
  Blob,Headers,fetch:fakeFetch
});
vm.runInContext(inline,sandbox,{filename:"index-inline.js"});
for(const path of ["availability.js","discovery.js","catalog.js","downloader.js","sources.js","peertube.js","offline.js"])
  vm.runInContext(load(path),sandbox,{filename:path});
assert.ok(window.MyCinemaAvailability);
assert.ok(window.MyCinemaDiscovery);
assert.ok(window.MyCinemaCatalog);
assert.ok(window.MyCinemaDownloader);
assert.ok(window.MyCinemaSources);
assert.ok(window.MyCinemaPeerTube);
assert.ok(window.MyCinemaOffline);
elements.get("openCatalogExplore").click();
assert.equal(elements.get("catalogExploreScreen").hidden,false);
assert.match(elements.get("exploreProgress").textContent,/TMDB/);
// The default catalogue must show modern series even if no video file exists.
localStorage.setItem("mycinema_tmdb_token_v1","test-key-for-smoke");
window.MyCinemaCatalog.reload();
await new Promise(resolve=>setImmediate(resolve));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(elements.get("exploreResults").children.length,2);
assert.equal(elements.get("exploreResults").children[0].children[1].textContent,"Modern Sci Fi");
assert.match(latestTmdbDiscoverUrl,/\/discover\/tv/);
assert.ok(!latestTmdbDiscoverUrl.includes("first_air_date.lte"),"Modern series were filtered out");
elements.get("openSources").click();
assert.equal(elements.get("sourceDialog").open,true);
const {titleMatches,licenseInfo,videoFiles}=window.MyCinemaSources.helpers;
assert.equal(titleMatches("The Adventures of Ozzie and Harriet - Episode 1","The Adventures of Ozzie and Harriet"),true);
assert.equal(titleMatches("Breaking Bad","The Adventures of Ozzie and Harriet"),false);
assert.ok(licenseInfo("https://creativecommons.org/publicdomain/zero/1.0/"));
assert.ok(licenseInfo("http://creativecommons.org/licenses/by/4.0/"));
assert.equal(licenseInfo("https://example.com/licenses/by/4.0/"),null);
assert.equal(videoFiles([{name:"episode.mp4",size:30000000},
  {name:"preview.mp4",size:30000000},{name:"tiny.mp4",size:100}], "item-1").length,1);
const item={title:"Demo Archive Series",license:{name:"CC BY",url:"https://creativecommons.org/licenses/by/4.0/"},
  itemUrl:"https://archive.org/details/demo-series",creator:"Creator"};
const added=window.MyCinemaSources.addToLibrary(item,[
  {url:"https://archive.org/download/demo-series/episode01.mp4"}]);
assert.equal(added.count,1);
assert.equal(elements.get("watchScreen").hidden,false);
const library=JSON.parse(localStorage.getItem("my_video_library_v2"));
assert.equal(library.series.length,1);
assert.equal(library.series[0].seasons[0].rights.creator,"Creator");
const found=await window.MyCinemaSources.find("Demo Archive Series");
assert.equal(found.length,1);
assert.equal(found[0].files[0].name,"episode01.mp4");
const status=await window.MyCinemaSources.checkFile(found[0].files[0].url);
assert.equal(status.ok,true);
const peerCandidates=await window.MyCinemaPeerTube.searchCandidates("Independent Creative Drama");
assert.equal(peerCandidates.items.length,1);
const verifiedPeer=await window.MyCinemaPeerTube.verifyCandidate(peerCandidates.items[0]);
assert.equal(verifiedPeer.file.url,PEER_FILE);
const imported=window.MyCinemaPeerTube.importChecked(verifiedPeer);
assert.match(imported.title,/Independent Creative Drama/);
const savedPeer=JSON.parse(localStorage.getItem("my_video_library_v2"));
assert.equal(savedPeer.series.length,2);
assert.match(savedPeer.series[1].seasons[0].rights.itemUrl,/video.peertube.example/);
const browsed=await window.MyCinemaSources.browseOpenEpisodes(1,()=>{});
assert.equal(browsed.items.length,1);
assert.equal(browsed.items[0].preVerified.length,1);
let savedSize=0;
const fileHandle={
  async getFile(){return {size:savedSize};},
  async createWritable(){
    let next=0;
    return {
      async write(chunk){next+=chunk.byteLength;},
      async seek(position){next=position;},
      async close(){savedSize=next;},
      async abort(){}
    };
  }
};
window.showSaveFilePicker=async()=>fileHandle;
window.showDirectoryPicker=async()=>({getDirectoryHandle:async()=>({})});
await window.MyCinemaDownloader.downloadOne();
assert.equal(savedSize,FAKE_BYTES);
assert.match(elements.get("downloadProgress").textContent,/Збережено/);
await window.MyCinemaDownloader.downloadOne();
assert.equal(savedSize,FAKE_BYTES);
assert.match(elements.get("downloadProgress").textContent,/(?:вже|уже) збережено/);
window.MyCinemaOffline.openFiles([
  {name:"episode02.mp4",size:FAKE_BYTES,lastModified:123},
  {name:"episode01.mp4",size:FAKE_BYTES,lastModified:122}
]);
assert.equal(window.MyCinemaOffline.isActive(),true);
assert.equal(elements.get("episodeTitle").textContent,"episode01.mp4");
window.MyCinemaOffline.next();
assert.equal(elements.get("episodeTitle").textContent,"episode02.mp4");
window.MyCinemaOffline.stop();
assert.equal(window.MyCinemaOffline.isActive(),false);
console.log("Browser smoke passed: Archive, PeerTube federated search and verified MP4, local licence attribution, offline queue and downloads.");
