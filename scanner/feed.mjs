import {read} from "./catalog.mjs";

export const onlineUrl = "https://www.mtgo.com/decklists";
const paperUrl = "https://mtgdecks.net/";
const formats = ["Standard","Modern","Legacy"];

export function plain(html) {
  return html.replace(/<[^>]*>/g," ").replace(/&(?:nbsp|#160);/gi," ")
    .replace(/&amp;/gi,"&").replace(/&(?:apos|#39|#039|rsquo);/gi,"'")
    .replace(/&quot;/gi,'"').replace(/\s+/g," ").trim();
}

export function parseOnline(html) {
  const entries=new Map();
  for (const [,path,label] of html.matchAll(/href=["'](?:https:\/\/www\.mtgo\.com)?(\/decklist\/[a-z0-9-]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug=path.split("/").pop();
    const format=formats.find(name=>slug.startsWith(name.toLowerCase()+"-"));
    const date=slug.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const kind=slug.match(/\b(challenge|league|showcase|qualifier|super-qualifier|preliminary)\b/i)?.[0];
    if (!format || !date || !kind) continue;
    const title=plain(label);
    const url=new URL(path,onlineUrl).href;
    entries.set(url,{date,format,type:kind==="league"?"MTGO League":kind==="challenge"?"MTGO Challenge":"MTGO",title:title.length>5?title:slug.slice(0,slug.indexOf(date)-1).replaceAll("-"," "),url});
  }
  return [...entries.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,80);
}

export function parsePaper(html,now=new Date()) {
  const entries=new Map();
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    const shortDate=plain(cells[0]?.[1] || "").match(/^(\d{1,2})[- ]([a-z]{3})(?:[- ](\d{4}))?$/i);
    if (!shortDate) continue;
    const [,day,month,year]=shortDate;
    let time=Date.parse(`${day} ${month} ${year || now.getUTCFullYear()} UTC`);
    if (!Number.isFinite(time)) continue;
    if (!year && time>now.getTime()+86400000) time=Date.parse(`${day} ${month} ${now.getUTCFullYear()-1} UTC`);
    const date=new Date(time).toISOString().slice(0,10);
    for (const [,path,format,label] of row.matchAll(/href=["'](?:https:\/\/mtgdecks\.net)?(\/(Standard|Modern|Legacy)\/[^"'<>]+-tournament-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const title=plain(label);
      if (!/\b(?:regional championship|pro tour|grand prix|magiccon|cardcon|eternal weekend|open|super series|bazaar of boxes)\b/i.test(title) ||
          /\b(?:qualifier|rcq|trial|league|mtgo)\b/i.test(title)) continue;
      const url=new URL(path,paperUrl).href;
      entries.set(url,{date,format:formats.find(name=>name.toLowerCase()===format.toLowerCase()),type:"Paper",title,url});
    }
  }
  return [...entries.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,40);
}

export function parseRates(html,days,now=new Date()) {
  const range=plain(html).match(/between\s+(\d{4}-\d\d-\d\d)\s+and\s+(\d{4}-\d\d-\d\d)/i);
  if (!range || Math.abs((Date.parse(range[2])-Date.parse(range[1]))/86400000-days)>5 ||
      Math.abs(now.getTime()-Date.parse(range[2]))>4*86400000) return null;
  const rows=new Map();
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    const name=plain(cells[0]?.[1] || "");
    const value=plain(cells[1]?.[1] || "").match(/(\d+(?:\.\d+)?)%\s*\(?([\d,]+)\s+matches\b/i);
    if (name && value && Number(value[1])<=100) rows.set(name,[name,Number(value[1]),Number(value[2].replaceAll(",",""))]);
  }
  return rows.size>=4 ? {rows:[...rows.values()],window:range[1]+" to "+range[2],source:"MTGDecks.net"} : null;
}

export function parseShare(html) {
  const rows=new Map();
  const links=[...html.matchAll(/href=["'](?:https:\/\/www\.mtggoldfish\.com)?\/archetype\/([a-z0-9-]+)(?:#[^"']*)?["']([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const [i,match] of links.entries()) {
    const [,slug,attrs,body]=match;
    const name=plain(body) || plain(attrs.match(/title=["']([^"']+)["']/i)?.[1] || "");
    const after=html.slice(match.index+match[0].length,links[i+1]?.index).slice(0,10000);
    const share=plain(after).match(/(?:META\s*%\s*(\d+(?:\.\d+)?)%|(\d+(?:\.\d+)?)%\s*META\s*%)/i);
    const value=Number(share?.[1] || share?.[2]);
    if (name && value>0 && value<=100 && !rows.has(slug)) rows.set(slug,[name,value,slug]);
  }
  return rows.size>=4 ? [...rows.values()] : null;
}

export async function refreshFeed(data) {
  const previous=await data.get("feed","json") || {};
  const now=new Date();
  const checkedAt=now.toISOString();
  const feed={...previous,checkedAt,meta:previous.meta || {},status:{}};
  const refresh=async (key,url,parse,save)=>{
    try {
      const result=parse(await (await read(url)).text());
      if (!result || !result.length && Array.isArray(result)) throw new Error("No verified data");
      save(result);
      feed.status[key]="updated";
    } catch { feed.status[key]="previous data kept"; }
  };
  const tasks=[
    ()=>refresh("MTGO",onlineUrl,parseOnline,results=>{feed.online=results;}),
    ()=>refresh("Paper",paperUrl,html=>parsePaper(html,now),results=>{feed.paper=results;})
  ];
  for (const format of formats) {
    const shareUrl="https://www.mtggoldfish.com/metagame/"+format.toLowerCase()+"#paper";
    const entry=feed.meta[format] ||= {};
    entry.rates ||= {};
    tasks.push(()=>refresh(format+" share",shareUrl,parseShare,rows=>{
      entry.share={rows,url:shareUrl,source:"MTGGoldfish",window:"fetched "+checkedAt.slice(0,10)};
    }));
    const ratesUrl="https://mtgdecks.net/"+format+"/winrates";
    tasks.push(()=>refresh(format+" win rates",ratesUrl,html=>parseRates(html,180,now),result=>{
      entry.rates[5]={...result,url:ratesUrl};
    }));
  }
  for (let i=0;i<tasks.length;i+=4) await Promise.all(tasks.slice(i,i+4).map(run=>run()));
  await data.put("feed",JSON.stringify(feed));
}
