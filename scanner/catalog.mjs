const shopify = [
  ["The Dragon's Beard", "https://thedragonsbeard.com.au"],
  ["Spellroo Gaming", "https://spellroogaming.com.au"],
  ["Mana Market", "https://manamarket.com.au"],
  ["Moon MTG", "https://moonmtg.com"],
  ["MTG Singles Australia", "https://www.mtgsinglesaustralia.com"],
  ["Plenty of Games", "https://www.plentyofgames.com.au"],
  ["Eternal Magic", "https://eternalmagic.cc"]
];

export const cardKey = value => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const validCard = value => typeof value==="string" && value.trim().length<=120 && cardKey(value).length>=2;

export async function read(url, options={}) {
  const response = await fetch(url,{signal:AbortSignal.timeout(9500),...options});
  if (!response.ok) throw new Error("Upstream HTTP "+response.status);
  return response;
}

function matchesCard(title,card) {
  const name = cardKey(title);
  const target = cardKey(card);
  const base = cardKey(title.split(/\s+[([–—]|\s+-\s+/u,1)[0]);
  return (name===target || base===target) &&
    !/\b(?:proxy|proxies|playset|booster|sealed|deck box|commander deck|digital|mtgo)\b/.test(name.slice(target.length));
}

function safeProductPath(value) {
  return typeof value==="string" && /^\/(?:[a-z-]+\/)?products\/[a-z0-9][a-z0-9-]*(?:[?#].*)?$/i.test(value)
    ? value.split(/[?#]/)[0] : "";
}

export function shopifyOffers(product,card,store,root,path) {
  if (typeof product.title!=="string" || !matchesCard(product.title,card)) return [];
  return (product.variants || []).filter(v=>v.available===true && Number.isInteger(v.price) && v.price>0 && /^\d+$/.test(String(v.id))).map(v=>({
    id:root+path+"?variant="+v.id,
    title:product.title,
    variant:v.title==="Default Title" ? "" : String(v.title || ""),
    store, price:v.price/100, currency:"AUD",
    url:root+path+"?variant="+v.id
  }));
}

async function searchShopify([store,root],card) {
  const params=new URLSearchParams({q:card,"resources[type]":"product","resources[limit]":"10","resources[options][unavailable_products]":"hide",country:"AU"});
  const suggestions=await (await read(root+"/search/suggest.json?"+params)).json();
  const products=suggestions.resources?.results?.products;
  if (!Array.isArray(products)) throw new Error("No product feed");
  const paths=[...new Set(products.filter(p=>p.available===true && typeof p.title==="string" && matchesCard(p.title,card))
    .map(p=>safeProductPath(p.url)).filter(Boolean))];
  if (!paths.length) return {store,offers:[],status:"checked"};
  const cart=await (await read(root+"/cart.js?country=AU")).json();
  if (cart.currency!=="AUD") return {store,offers:[],status:"AUD not confirmed"};
  const productResults=await Promise.allSettled(paths.slice(0,3).map(async path=>{
    const product=await (await read(root+path+".js?country=AU")).json();
    if (!Array.isArray(product.variants)) throw new Error("No variant data");
    return shopifyOffers(product,card,store,root,path);
  }));
  const offers=productResults.flatMap(r=>r.status==="fulfilled"?r.value:[]);
  const partial=products.length===10 || paths.length>3 || productResults.some(r=>r.status==="rejected");
  return {store,offers,status:partial?"limited coverage":"checked"};
}

let tokenCache;
async function ebayToken(env) {
  if (tokenCache?.expires>Date.now()) return tokenCache.value;
  const credentials=btoa(env.EBAY_CLIENT_ID+":"+env.EBAY_CLIENT_SECRET);
  const response=await read("https://api.ebay.com/identity/v1/oauth2/token",{
    method:"POST",headers:{Authorization:"Basic "+credentials,"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"client_credentials",scope:"https://api.ebay.com/oauth/api_scope"})
  });
  const token=await response.json();
  if (!token.access_token) throw new Error("eBay authorization unavailable");
  tokenCache={value:token.access_token,expires:Date.now()+Math.max(0,token.expires_in-90)*1000};
  return tokenCache.value;
}

export function ebayOffers(items,card) {
  return items.flatMap(item=>{
    const price=Number(item.price?.value);
    let url;
    try { url=new URL(item.itemWebUrl); } catch { return []; }
    const words=cardKey(item.title || "");
    const target=cardKey(card);
    if (!(" "+words+" ").includes(" "+target+" ") || /\b(?:proxy|proxies|playset|digital|mtgo|lot of|bundle)\b/.test(words) ||
        !item.buyingOptions?.includes("FIXED_PRICE") || item.price?.currency!=="AUD" || !Number.isFinite(price) || price<=0 ||
        url.protocol!=="https:" || !["www.ebay.com.au","www.ebay.com"].includes(url.hostname) ||
        !/^\/itm\//.test(url.pathname)) return [];
    return [{id:"ebay:"+item.itemId,title:item.title,variant:item.condition || "",store:"eBay Australia",price,currency:"AUD",url:url.href}];
  });
}

async function searchEbay(card,env) {
  const store="eBay Australia";
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return {store,offers:[],status:"API credentials needed"};
  const params=new URLSearchParams({
    q:card+" Magic the Gathering",category_ids:"183454",limit:"30",
    filter:"buyingOptions:{FIXED_PRICE},deliveryCountry:AU",sort:"price"
  });
  const response=await read("https://api.ebay.com/buy/browse/v1/item_summary/search?"+params,{
    headers:{Authorization:"Bearer "+await ebayToken(env),"X-EBAY-C-MARKETPLACE-ID":"EBAY_AU"}
  });
  const data=await response.json();
  return {store,offers:ebayOffers(data.itemSummaries || [],card),status:"checked"};
}

export async function scanOffers(card,env) {
  const requests=[...shopify.map(s=>[s[0],()=>searchShopify(s,card)]),["eBay Australia",()=>searchEbay(card,env)]];
  const results=[];
  for (let i=0;i<requests.length;i+=2) {
    const batch=await Promise.all(requests.slice(i,i+2).map(async ([store,search])=>{
      try { return await search(); } catch { return {store,offers:[],status:"unavailable"}; }
    }));
    results.push(...batch);
  }
  const unique=new Map(results.flatMap(r=>r.offers).map(offer=>[offer.id,offer]));
  return {card,checkedAt:new Date().toISOString(),offers:[...unique.values()].sort((a,b)=>a.price-b.price),
    sources:results.map(({store,status})=>({store,status}))};
}
