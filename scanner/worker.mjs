import {cardKey,validCard,scanOffers} from "./catalog.mjs";
import {refreshFeed} from "./feed.mjs";

const watchPrefix="watch:";
const resultPrefix="result:";
const complete=new Set(["checked","limited coverage"]);

export function watchResult(scan,previous) {
  const known={...previous?.known};
  const fresh=[];
  for (const {store,status} of scan.sources) {
    if (!complete.has(status)) continue;
    const ids=new Set(known[store] || []);
    for (const offer of scan.offers.filter(item=>item.store===store)) {
      if (Object.hasOwn(known,store) && !ids.has(offer.id)) fresh.push(offer);
      ids.add(offer.id);
    }
    known[store]=[...ids].slice(-1500);
  }
  return {checkedAt:scan.checkedAt,known,newOffers:fresh.sort((a,b)=>a.price-b.price),sources:scan.sources};
}

function authorized(request,env) {
  const token=request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token || !env.WATCH_KEY || env.WATCH_KEY.length<24 || token.length!==env.WATCH_KEY.length) return false;
  let different=0;
  for (let i=0;i<token.length;i++) different|=token.charCodeAt(i)^env.WATCH_KEY.charCodeAt(i);
  return different===0;
}

async function watches(data) {
  const {keys}=await data.list({prefix:watchPrefix});
  return keys.map(({name,metadata})=>({id:name.slice(watchPrefix.length),...metadata})).filter(item=>validCard(item.card));
}

async function refreshWatches(env) {
  const data=env.DASH_DATA;
  for (const {id,card,generation} of await watches(data)) {
    const key=resultPrefix+id+":"+generation;
    const previous=await data.get(key,"json");
    const scan=await scanOffers(card,env);
    await data.put(key,JSON.stringify(watchResult(scan,previous)),{expirationTtl:30*86400});
  }
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    const origin=request.headers.get("Origin");
    const headers={"Vary":"Origin","Cache-Control":"no-store"};
    if (origin && (env.DASH_ORIGINS || "https://moongladeau.github.io").split(",").map(s=>s.trim()).includes(origin)) {
      Object.assign(headers,{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, PUT, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type"});
    }
    const json=(body,status=200)=>Response.json(body,{status,headers});
    if (origin && !headers["Access-Control-Allow-Origin"]) return json({error:"Origin not allowed"},403);
    if (request.method==="OPTIONS") return new Response(null,{status:204,headers});
    const data=env.DASH_DATA;
    try {
      if (request.method==="GET" && url.pathname==="/api/feed") return json(await data.get("feed","json") || {});
      if (request.method==="GET" && url.pathname==="/api/offers") {
        if (!authorized(request,env)) return json({error:"Enter the private scanner key to check live prices."},401);
        const card=url.searchParams.get("card");
        return validCard(card)?json(await scanOffers(card.trim(),env)):json({error:"Enter a card name."},400);
      }
      if (url.pathname!=="/api/watch") return json({error:"Unknown route"},404);
      if (!authorized(request,env)) return json({error:"Check your private scanner key."},401);
      if (request.method==="GET") {
        const results=await Promise.all((await watches(data)).map(async ({id,card,generation})=>{
          const result=await data.get(resultPrefix+id+":"+generation,"json");
          return {card,checkedAt:result?.checkedAt,newOffers:result?.newOffers || [],sources:result?.sources || []};
        }));
        return json({watches:results.sort((a,b)=>a.card.localeCompare(b.card))});
      }
      if (request.method!=="PUT") return json({error:"Method not allowed"},405);
      const body=await request.json().catch(()=>null);
      if (!validCard(body?.card) || typeof body.watch!=="boolean") return json({error:"Invalid watch request"},400);
      const card=body.card.trim();
      const id=cardKey(card);
      if (!body.watch) await data.delete(watchPrefix+id);
      else {
        const current=await watches(data);
        if (current.some(item=>item.id===id)) return json({card});
        if (current.length>=10) return json({error:"The nightly watchlist holds up to 10 cards."},409);
        await data.put(watchPrefix+id,"1",{metadata:{card,generation:crypto.randomUUID()}});
      }
      return json({card});
    } catch (error) {
      console.error(error);
      return json({error:"Scanner temporarily unavailable. Try again later."},503);
    }
  },
  async scheduled(_controller,env) {
    const failures=[];
    try { await refreshFeed(env.DASH_DATA); } catch (error) { failures.push(error); }
    try { await refreshWatches(env); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures,"Nightly scan partially failed");
  }
};
