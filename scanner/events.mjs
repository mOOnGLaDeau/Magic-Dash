import {read} from "./catalog.mjs";
import {scanGoodGames} from "./goodgames.mjs";
import {commanderFormat,scanLocator} from "./locator.mjs";
import {plain} from "./feed.mjs";

const vault = "https://vaultgames.com.au";
const collections = ["/collections/brisbane-events", "/collections/events"];
const competitive = /\b(?:rcq|regional championship qualifier|store championship|win[- ]a[- ]box)\b/i;
const formats = /\b(?:standard|modern|legacy|7[- ]point highlander)\b/gi;
const months = "january february march april may june july august september october november december".split(" ");

export function parseVaultEvent(html, handle, discoveredOn) {
  const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const formatNames = new Set(Array.from(title.matchAll(formats), ([format])=>format.toLowerCase().replace("7 point","7-point")));
  const namedFormat = commanderFormat(title);
  const isCedh = namedFormat==="cEDH";
  const isCompetitive = isCedh || competitive.test(title);
  if (!namedFormat && (!isCompetitive || formatNames.size!==1 || /\b(sealed|draft|limited)\b/i.test(title))) return null;
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
  const format = namedFormat || [...formatNames][0].replace(/\b[a-z]/g,letter=>letter.toUpperCase());
  const kind = /store championship/i.test(title) ? "Store Championship" : /win[- ]a[- ]box/i.test(title) ? "Win-a-box" : /rcq|regional championship qualifier/i.test(title) ? "RCQ" : isCedh ? "cEDH" : "Commander night";
  return {id:"scan-vault-"+handle,scope:"local",category:isCompetitive ? "Competitive" : "Casual",kind,title,venue,format,
    start:dayKey+"T"+time+":00+10:00",discoveredOn,url:vault+"/products/"+handle};
}

function playmantisEvents(html, day) {
  const events = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["'](?:https:\/\/playmantis\.com\.au)?(?:\/collections\/events)?\/products\/([a-z0-9-]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [,handle,body] = match;
    const name = handle.replaceAll("-"," ");

    const label = plain(body);
    const format = commanderFormat(label+" "+name);
    if (!format) continue;
    const date = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat),?\s+(\w{3})\s+(\d{1,2})\b.*?\b(\d{1,2}):(\d{2})\s*([AP]M)\b/i.exec(label);
    if (!date) continue;
    const month = months.findIndex(m=>m.startsWith(date[2].toLowerCase()));
    if (month<0) continue;
    const year = Number(day.slice(0,4));
    const dates = [year,year+1].map(y=>new Date(Date.UTC(y,month,+date[3])));
    const start = dates.find(d=>d.toISOString().slice(0,10)>=day && d.getUTCDate()===+date[3] && d.toUTCString().startsWith(date[1]));
    if (!start) continue;
    const time = String(+date[4]%12+(date[6].toLowerCase()==="pm"?12:0)).padStart(2,"0")+":"+date[5];

    const title = label.slice(0,date.index).replace(/^(?:Commander|cEDH)\s+/i,"").trim() || name;
    events.push({id:"playmantis-"+handle,scope:"local",format,category:/\b(social|casual)\b/i.test(name) ? "Casual" : "Competitive",
      kind:/league/i.test(name) ? "League" : "Store event",title,venue:"Playmantis, Annerley",start:start.toISOString().slice(0,10)+"T"+time+":00+10:00",
      discoveredOn:day,url:"https://playmantis.com.au/products/"+handle});
  }
  return events;
}

function failureReason(error) {
  if (error?.name==="TimeoutError") return "request timed out";
  return error?.message || "request failed";
}

export async function refreshEvents(data, now=new Date()) {
  const previous = await data.get("events","json");
  const day = new Date(now.getTime()+10*3600000).toISOString().slice(0,10);
  const checkedAt = now.toISOString();
  const saved = new Map((previous?.events || []).filter(event=>event.start.slice(0,10)>=day).map(event=>[event.id,event]));
  const pages = await Promise.allSettled(collections.map(async path=>(await read(vault+path)).text()));
  const handles = new Set();
  const issues = [];
  for (const [index,page] of pages.entries()) {
    if (page.status!=="fulfilled") {
      issues.push(collections[index]+": "+failureReason(page.reason));
      continue;
    }
    for (const [,handle] of page.value.matchAll(/href=["'][^"'<>]*?\/products\/([a-z0-9-]+)(?=[?"'#])/gi)) {
      const label = handle.replaceAll("-"," ");
      if (commanderFormat(label) || competitive.test(label) && /\b(?:standard|modern|legacy|7 point highlander)\b/i.test(label)) handles.add(handle);
    }
  }
  if (handles.size>8) issues.push("Checked 8 of "+handles.size+" candidate listings (scan limit).");
  for (const handle of [...handles].slice(0,8)) {
    try {
      const html = await (await read(vault+"/products/"+handle)).text();
      const event = parseVaultEvent(html,handle,saved.get("scan-vault-"+handle)?.discoveredOn || day);
      if (event && event.start.slice(0,10)>=day) saved.set(event.id,event);
    } catch (error) { issues.push("/products/"+handle+": "+failureReason(error)); }
  }
  try {
    const html = await (await read("https://playmantis.com.au/collections/events")).text();
    for (const event of playmantisEvents(html,day)) {
      event.discoveredOn = saved.get(event.id)?.discoveredOn || day;
      saved.set(event.id,event);
    }
  } catch (error) { issues.push("Playmantis events: "+failureReason(error)); }
  try { await scanLocator(saved,day); }
  catch (error) { issues.push("Wizards Event Locator: "+failureReason(error)); }
  try { await scanGoodGames(saved,day); }
  catch (error) { issues.push("Good Games calendar: "+failureReason(error)); }
  const distinct = new Map();
  for (const event of saved.values()) {
    const key = [Date.parse(event.start),event.venue.trim().toLowerCase(),event.format,event.title.trim().toLowerCase()].join("|");
    if (!distinct.has(key) || event.id.startsWith("wizards-")) distinct.set(key,event);
  }
  await data.put("events",JSON.stringify({checkedAt,partial:issues.length>0,issues,events:[...distinct.values()]}));
}
