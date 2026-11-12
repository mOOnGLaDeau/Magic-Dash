import {read} from "./catalog.mjs";
import {plain} from "./feed.mjs";

const vault = "https://vaultgames.com.au";
const collections = ["/collections/brisbane-events", "/collections/events"];
const competitive = /\b(?:rcq|regional championship qualifier|store championship|win[- ]a[- ]box)\b/i;
const formats = /\b(?:standard|modern|legacy|7[- ]point highlander)\b/gi;
const months = "january february march april may june july august september october november december".split(" ");

export function parseVaultEvent(html, handle, discoveredOn) {
  const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const formatNames = new Set(Array.from(title.matchAll(formats), ([format])=>format.toLowerCase().replace("7 point","7-point")));
  if (!competitive.test(title) || formatNames.size!==1 || /\b(sealed|draft|limited|commander|cedh)\b/i.test(title)) return null;
  const text = plain(html);
  const venue = text.match(/Event Location:\s*(Vault Games (?:Brisbane City|Clayfield))\b/i)?.[1];
  const date = text.match(/Date\s*&\s*Time of Event:\s*(\d{1,2}):(\d{2})\s*([ap]m)\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i);
  if (!venue || !date) return null;
  const [,hour,minute,meridiem,day,month,year] = date;
  const monthIndex = months.indexOf(month.toLowerCase());
  if (monthIndex<0 || +hour<1 || +hour>12 || +minute>59 || +day<1 || +day>31) return null;
  const two = value=>String(value).padStart(2,"0");
  const dayKey = year+"-"+two(monthIndex+1)+"-"+two(day);
  if (new Date(Date.UTC(+year,monthIndex,+day)).toISOString().slice(0,10)!==dayKey) return null;
  const time = two(+hour%12+(meridiem.toLowerCase()==="pm"?12:0))+":"+minute;
  const format = [...formatNames][0].replace(/\b[a-z]/g,letter=>letter.toUpperCase());
  const kind = /store championship/i.test(title) ? "Store Championship" : /win[- ]a[- ]box/i.test(title) ? "Win-a-box" : "RCQ";
  return {id:"scan-vault-"+handle,scope:"local",category:"Competitive",kind,title,venue,format,
    start:dayKey+"T"+time+":00+10:00",discoveredOn,url:vault+"/products/"+handle};
}

export async function refreshEvents(data, now=new Date()) {
  const previous = await data.get("events","json");
  const day = new Date(now.getTime()+10*3600000).toISOString().slice(0,10);
  const checkedAt = now.toISOString();
  const saved = new Map((previous?.events || []).filter(event=>event.start.slice(0,10)>=day).map(event=>[event.id,event]));
  const pages = await Promise.allSettled(collections.map(async path=>(await read(vault+path)).text()));
  const handles = new Set();
  for (const page of pages) {
    if (page.status!=="fulfilled") continue;
    for (const [,handle] of page.value.matchAll(/href=["'][^"'<>]*?\/products\/([a-z0-9-]+)(?=[?"'#])/gi)) {
      const label = handle.replaceAll("-"," ");
      if (competitive.test(label) && /\b(?:standard|modern|legacy|7 point highlander)\b/i.test(label)) handles.add(handle);
    }
  }
  let partial = pages.some(page=>page.status==="rejected") || handles.size>8;
  for (const handle of [...handles].slice(0,8)) {
    try {
      const html = await (await read(vault+"/products/"+handle)).text();
      const event = parseVaultEvent(html,handle,saved.get("scan-vault-"+handle)?.discoveredOn || day);
      if (event && event.start.slice(0,10)>=day) saved.set(event.id,event);
    } catch { partial = true; }
  }
  await data.put("events",JSON.stringify({checkedAt,partial,events:[...saved.values()]}));
}
