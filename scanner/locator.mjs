import {read} from "./catalog.mjs";

const locator = "https://locator.wizards.com";
const supported = ["Standard","Modern","Legacy","7-Point Highlander","Commander"];

export function locatorEvent(raw, day) {
  const title = raw.title || "";
  const label = raw.eventFormat?.name || "";
  const format = /\b(?:cedh|competitive (?:commander|edh))\b/i.test(title+" "+label) ? "cEDH" :
    supported.find(name=>name.toLowerCase()===label.toLowerCase()) ||
    supported.find(name=>new RegExp("\\b"+name.replaceAll("-","[- ]")+"\\b","i").test(title)) ||
    (/\bedh\b/i.test(title+" "+label) ? "Commander" : null);
  const start = new Date(raw.scheduledStartTime);
  if (!format || !title || !raw.id || !raw.organization?.name || !raw.scheduledStartTime || !Number.isFinite(+start)) return;
  const local = new Date(+start+36000000).toISOString().slice(0,19);
  if (local.slice(0,10)<day) return;
  const tournament = /rcq|qualifier|championship|tournament|league/i.test([title,...(raw.tags || [])].join(" "));
  const casual = /\b(?:casual|social)\b/i.test(title) || (format==="Commander" && !tournament);
  return {id:"wizards-"+raw.id,title,format,venue:raw.organization.name,scope:"local",category:casual?"Casual":"Competitive",
    kind:tournament?"Tournament":"Store event",start:local+"+10:00",discoveredOn:day,
    url:locator+"/search?searchType=magic-events&eventId="+encodeURIComponent(raw.id)};
}

export async function scanLocator(saved,day) {
  const {decode} = await import("turbo-stream");
  for (let page=1;;page++) {
    const params = new URLSearchParams({query:"Brisbane QLD, Australia",searchType:"magic-events",sortBy:"date",sortDirection:"Asc",distance:"25",page:String(page),pageSize:"100"});
    const response = await read(locator+"/search.data?"+params);
    const {value,done} = await decode(response.body);
    await done;
    const route = Object.keys(value).find(key=>key.endsWith(").search"));
    const batch = value[route]?.data?.events?.advancedSearchEvents;
    if (!Array.isArray(batch?.events) || !Number.isFinite(batch.pageInfo?.totalResults) || !(batch.pageInfo.pageSize>0)) throw Error("Unrecognised locator response");
    for (const raw of batch.events) {
      const event = locatorEvent(raw,day);
      if (!event) continue;
      event.discoveredOn = saved.get(event.id)?.discoveredOn || day;
      saved.set(event.id,event);
    }
    if (page*batch.pageInfo.pageSize>=batch.pageInfo.totalResults) return;
    if (!batch.events.length || batch.pageInfo.page!==page) throw Error("Incomplete locator results on page "+page);
  }
}
