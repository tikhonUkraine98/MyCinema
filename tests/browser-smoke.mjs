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
  if(id==="exploreMode")n.value="downloads";
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
const sandbox=vm.createContext({
  document,window,localStorage,
  console,URL,URLSearchParams,AbortController,DOMException,
  HTMLMediaElement:{HAVE_CURRENT_DATA:2},
  setTimeout,clearTimeout,
  confirm(){return true;},alert(message){throw Error("Unexpected alert: "+message);},
  Event:class Event{constructor(type){this.type=type;}},
  Blob,fetch(){throw Error("Network should not run during initialization");}
});
vm.runInContext(inline,sandbox,{filename:"index-inline.js"});
for(const path of ["availability.js","discovery.js","catalog.js","downloader.js","sources.js"])
  vm.runInContext(load(path),sandbox,{filename:path});
assert.ok(window.MyCinemaAvailability);
assert.ok(window.MyCinemaDiscovery);
assert.ok(window.MyCinemaCatalog);
assert.ok(window.MyCinemaDownloader);
assert.ok(window.MyCinemaSources);
elements.get("openCatalogExplore").click();
assert.equal(elements.get("catalogExploreScreen").hidden,false);
assert.match(elements.get("exploreProgress").textContent,/TMDB/);
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
console.log("Browser smoke passed: modules, navigation, licensing, validated import and persistent provenance.");
