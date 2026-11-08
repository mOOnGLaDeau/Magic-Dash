(() => {
  "use strict";
  const stores = [
    ["The Dragon's Beard","https://thedragonsbeard.com.au","shop"],
    ["Spellroo Gaming","https://spellroogaming.com.au","shop"],
    ["MTG Singles price tracker","https://www.mtgsingles.co.nz/au"],
    ["Mana Market","https://manamarket.com.au","shop"],
    ["Moon MTG","https://moonmtg.com","shop"],
    ["MTG Mate","https://www.mtgmate.com.au","mate"],
    ["Trade Magic","https://trademagic.com.au"],
    ["The Games Cube","https://www.thegamescube.com"],
    ["MTG Singles Australia","https://www.mtgsinglesaustralia.com","shop"],
    ["Plenty of Games","https://plentyofgames.com.au","shop"],
    ["Eternal Magic","https://eternalmagic.cc","shop"],
    ["eBay Australia","https://www.ebay.com.au","ebay"]
  ];
  const seededOnline = [
    {title:"Standard League",format:"Standard",type:"MTGO League",date:"2026-11-08",url:"https://www.mtgo.com/decklist/standard-league-2026-11-0811129"},
    {title:"Modern Challenge 32",format:"Modern",type:"MTGO Challenge",date:"2026-11-08",url:"https://www.mtgo.com/decklist/modern-challenge-32-2026-11-0812857691"},
    {title:"Legacy Challenge 16",format:"Legacy",type:"MTGO Challenge",date:"2026-11-08",url:"https://www.mtgo.com/decklist/legacy-challenge-16-2026-11-0812857693"}
  ];
  const seededPaper = [
    {title:"Bazaar of Boxes Series 20 · CardCon",format:"Legacy",type:"Paper",date:"2026-11-07",url:"https://mtgdecks.net/Legacy/bazaar-of-boxes-series-20-legacy-main-event-cardcon-2026-edition-tournament-278443"}
  ];
  const escape = value => String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const keyFor = value => value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const money = new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",currencyDisplay:"code"});
  const time = new Intl.DateTimeFormat("en-AU",{dateStyle:"medium",timeStyle:"short",timeZone:"Australia/Brisbane"});
  const validUrl = value => {
    try { const url=new URL(value); return url.protocol==="https:" && !url.username && !url.password ? url.href : ""; }
    catch { return ""; }
  };
  const link = (url,label) => validUrl(url) ? '<a href="'+escape(validUrl(url))+'" target="_blank" rel="noopener noreferrer">'+escape(label)+'</a>' : escape(label);
  const read = (name,fallback) => {
    try { return JSON.parse(localStorage.getItem("magic-dash-"+name)) ?? fallback; }
    catch { return fallback; }
  };
  const save = (name,value) => {
    try { localStorage.setItem("magic-dash-"+name,JSON.stringify(value)); return true; }
    catch { return false; }
  };
  let mode="search";
  let query="";
  let settings=read("scanner",{url:"",key:""});
  let localWatches=read("local-watches",[]);
  let watches=[];
  const connected=()=>Boolean(settings.url && settings.key);

  async function api(path,options={},privateRequest=false,connection=settings) {
    const base=validUrl(connection.url);
    if (!base) throw new Error("Connect a scanner to use live results.");
    const headers={...options.headers};
    if (privateRequest && connection.key) headers.Authorization="Bearer "+connection.key;
    const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(90000),redirect:"error",...options,headers});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error || "Scanner temporarily unavailable.");
    return data;
  }

  function storeUrl(root,type,card) {
    if (!card) return root;
    if (type==="shop") return root+"/search?"+new URLSearchParams({q:card,type:"product",country:"AU"});
    if (type==="mate") return root+"/cards/"+encodeURIComponent(card.replaceAll(" ","_"));
    if (type==="ebay") return root+"/sch/i.html?"+new URLSearchParams({_nkw:card+" MTG",LH_BIN:"1",_sop:"15"});
    return root;
  }

  function storeLinks(card,sources=[]) {
    return '<details class="shop-sources"><summary>Stores and coverage</summary><ul class="shop-list">'+stores.map(([name,root,type])=>{
      const status=sources.find(source=>source.store===name)?.status;
      return '<li>'+link(storeUrl(root,type,card),name)+' <small class="muted">'+escape(status || "Store link")+'</small></li>';
    }).join("")+'</ul></details>';
  }

  function offerList(offers) {
    return '<ul class="shop-list">'+offers.filter(item=>item.currency==="AUD" && Number.isFinite(item.price) && validUrl(item.url))
      .sort((a,b)=>a.price-b.price).map(item=>'<li><div><strong class="shop-item-title">'+escape(item.title)+'</strong>'+
        (item.variant?'<small class="muted">'+escape(item.variant)+'</small>':'')+
        '<small>'+link(item.url,"View at "+item.store+" ↗")+'</small></div><div class="shop-item-stock"><strong>'+money.format(item.price)+'</strong>'+
        '<small class="muted">'+(Number.isSafeInteger(item.quantity) && item.quantity>0 ? item.quantity+" in stock" : "In stock · quantity unavailable")+
        '</small></div></li>').join("")+'</ul>';
  }

  async function suggestions(input,signal) {
    const tokens=input.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || [];
    if (!tokens.length) return [];
    const headers={Accept:"application/json"};
    const res=await fetch("https://api.scryfall.com/cards/autocomplete?"+new URLSearchParams({q:input}),{headers,signal});
    if (!res.ok) throw new Error("Card lookup unavailable");
    const data=await res.json();
    if (data.data?.length) return data.data.slice(0,8);
    if (tokens.length<2) return [];
    const fallback=await fetch("https://api.scryfall.com/cards/search?"+new URLSearchParams({q:tokens.map(word=>"name:"+word).join(" ")+" game:paper"}),{headers,signal});
    if (!fallback.ok) return [];
    return [...new Set((await fallback.json()).data.map(card=>card.name))].slice(0,8);
  }

  async function setWatch(card,watch) {
    if (connected()) {
      await api("/api/watch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({card,watch})},true);
      watches=watch ? [...watches.filter(item=>keyFor(item.card)!==keyFor(card)),{card,newOffers:[]}]
        : watches.filter(item=>keyFor(item.card)!==keyFor(card));
      return;
    }
    const changed=localWatches.filter(name=>keyFor(name)!==keyFor(card));
    if (watch) changed.push(card);
    if (!save("local-watches",changed)) throw new Error("This browser could not save the card.");
    localWatches=changed;
  }

  function renderBuy(app) {
    app.innerHTML='<section class="panel shop-panel"><p class="eyebrow">Australian singles</p><div class="shop-switch" role="group" aria-label="Buy Cards view">'+
      '<button type="button" class="button" id="shop-search" aria-pressed="'+(mode==="search")+'">Find listings</button>'+
      '<button type="button" class="button" id="shop-watch" aria-pressed="'+(mode==="watch")+'">Watchlist</button></div>'+
      '<div id="shop-content"></div><details class="shop-settings"><summary>Live scanner settings</summary>'+
      '<form id="shop-config"><label>Scanner HTTPS URL<input type="url" name="url" placeholder="https://your-scanner.workers.dev" value="'+escape(settings.url)+'"></label>'+
      '<label>Private scanner key<input type="password" name="key" autocomplete="off" placeholder="'+(settings.key?"Saved on this device":"Enter your key")+'"></label>'+
      '<p class="small muted">Use your own scanner URL. This browser sends your key only to that scanner.</p>'+
      '<button class="button" type="submit">Connect scanner</button> <button class="button" type="button" id="shop-disconnect">Disconnect</button>'+
      '<p class="small" id="shop-config-status" role="status"></p></form></details></section>';
    const content=app.querySelector("#shop-content");
    const config=app.querySelector("#shop-config");
    const changeMode=value=>{
      mode=value;
      renderBuy(app);
      app.querySelector(value==="search"?"#shop-search":"#shop-watch").focus();
    };
    app.querySelector("#shop-search").onclick=()=>changeMode("search");
    app.querySelector("#shop-watch").onclick=()=>changeMode("watch");
    config.onsubmit=async event=>{
      event.preventDefault();
      const raw=config.elements.url.value.trim();
      const url=validUrl(raw);
      const status=app.querySelector("#shop-config-status");
      if (!url) { status.textContent="Enter a valid HTTPS scanner URL."; return; }
      const next={url:new URL(url).origin,key:config.elements.key.value.trim() || (new URL(url).origin===settings.url?settings.key:"")};
      if (!next.key) { status.textContent="Enter your private scanner key."; return; }
      const controls=config.querySelectorAll("button");
      controls.forEach(button=>{button.disabled=true;});
      status.textContent="Checking the scanner connection…";
      try {
        const data=await api("/api/watch",{signal:AbortSignal.timeout(12000)},true,next);
        if (!Array.isArray(data.watches)) throw new Error("The URL did not return a Magic Dash watchlist.");
        if (!save("scanner",next)) throw new Error("This browser could not save the connection.");
        settings=next;
        watches=data.watches;
        tools.feed={};
        void loadFeed();
        if (content.isConnected) {
          renderBuy(app);
          app.querySelector(".shop-settings").open=true;
          app.querySelector("#shop-config-status").textContent="Scanner connected.";
        }
      } catch (error) { status.textContent="Connection failed. "+error.message; }
      finally { controls.forEach(button=>{button.disabled=false;}); }
    };
    app.querySelector("#shop-disconnect").onclick=()=>{
      if (save("scanner",{url:"",key:""})) { settings={url:"",key:""}; tools.feed={}; watches=[]; renderBuy(app); }
    };
    if (mode==="watch") renderWatches(content);
    else renderSearch(content);
  }

  function renderSearch(content) {
    content.innerHTML='<form id="card-shopping-search"><label for="shopping-card">Search for a card</label><div class="shop-search-row">'+
      '<input id="shopping-card" maxlength="120" value="'+escape(query)+'" autocomplete="off" placeholder="e.g. ocelot pr" aria-describedby="shop-hint">'+
      '<button type="submit" class="button primary">Search</button></div><div id="shop-suggestions"></div>'+
      '<p class="small muted" id="shop-hint">Choose a suggested card or search the full name. Prices are in AUD before shipping.</p></form>'+
      '<div id="shop-results">'+storeLinks("")+'</div>';
    const form=content.querySelector("form");
    const input=content.querySelector("input");
    const suggest=content.querySelector("#shop-suggestions");
    const results=content.querySelector("#shop-results");
    let debounce,controller;
    let revision=0;
    const select=async card=>{
      if (keyFor(card).length<2) return;
      clearTimeout(debounce);
      controller?.abort();
      suggest.innerHTML="";
      input.value=query=card;
      const current=++revision;
      results.innerHTML='<div class="shop-result-heading"><h3>'+escape(card)+'</h3><button type="button" class="button">Watch card</button></div>'+
        '<p class="small" id="shop-watch-status" role="status"></p><div id="shop-prices" role="status"></div>'+storeLinks(card);
      const prices=results.querySelector("#shop-prices");
      const status=results.querySelector("#shop-watch-status");
      const watchButton=results.querySelector("button");
      const isWatched=()=>(connected()?watches.map(item=>item.card):localWatches).some(name=>keyFor(name)===keyFor(card));
      const updateLabel=()=>{watchButton.textContent=isWatched()?"Stop watching":"Watch card";};
      updateLabel();
      watchButton.onclick=async ()=>{
        watchButton.disabled=true;
        const watch=!isWatched();
        try { await setWatch(card,watch); updateLabel(); status.textContent=watch?(connected()?"Added to the nightly watchlist.":"Saved on this device. Connect the scanner to start nightly checks."):"Removed from watchlist."; }
        catch (error) { status.textContent=error.message; }
        finally { watchButton.disabled=false; }
      };
      if (!connected()) {
        prices.textContent="Connect the live scanner for price comparisons. You can browse stores below.";
        results.querySelector("details").open=true;
        return;
      }
      prices.textContent="Checking seller stock and prices…";
      api("/api/watch",{},true).then(data=>{if (current===revision) {watches=data.watches; updateLabel();}}).catch(()=>{});
      try {
        const data=await api("/api/offers?"+new URLSearchParams({card}),{},true);
        if (current!==revision) return;
        prices.innerHTML=data.offers.length ? offerList(data.offers) : "<p>No in-stock AUD listings were verified. Check store coverage below.</p>";
        results.querySelector("details").outerHTML=storeLinks(card,data.sources);
        results.querySelector("details").open=!data.offers.length;
      } catch (error) {
        if (current!==revision) return;
        prices.textContent=error.message;
        results.querySelector("details").open=true;
      }
    };
    input.oninput=()=>{
      query=input.value;
      clearTimeout(debounce);
      controller?.abort();
      suggest.innerHTML="";
      const text=query.trim();
      if (text.length<2) return;
      controller=new AbortController();
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(7000)]);
      debounce=setTimeout(async ()=>{
        try {
          const names=await suggestions(text,signal);
          if (signal.aborted || !suggest.isConnected) return;
          for (const name of names) {
            const choice=document.createElement("button");
            choice.type="button";
            choice.className="button";
            choice.textContent=name;
            choice.onclick=()=>select(name);
            suggest.append(choice);
          }
        } catch { /* Full-name search remains available. */ }
      },260);
    };
    form.onsubmit=event=>{event.preventDefault(); select(input.value.trim());};
    if (query) select(query);
  }

  async function renderWatches(content) {
    content.innerHTML='<h3>Watched cards</h3><p class="small muted">Each card’s first scan establishes a baseline. Later scans show newly discovered listings.</p>'+
      '<p id="shop-watch-status" class="small" role="status"></p><div id="shop-watched-cards"></div>';
    const status=content.querySelector("#shop-watch-status");
    const list=content.querySelector("#shop-watched-cards");
    if (connected()) {
      status.textContent="Loading private watchlist…";
      try { watches=(await api("/api/watch",{},true)).watches; status.textContent=""; }
      catch (error) { status.textContent=error.message; return; }
    } else status.textContent="Cards saved here stay on this device until you connect a nightly scanner.";
    const entries=connected()?watches:localWatches.map(card=>({card,newOffers:[]}));
    list.innerHTML=entries.map((item,index)=>'<article class="shop-watch-card"><div class="shop-result-heading"><h4>'+escape(item.card)+'</h4>'+
      '<button class="button" type="button" data-watch-remove="'+index+'">Remove</button></div>'+
      (item.checkedAt?'<p class="small muted">Last checked '+escape(time.format(new Date(item.checkedAt)))+' Brisbane time</p>':'')+
      (item.newOffers.length?offerList(item.newOffers):'<p class="small muted">'+(item.checkedAt?"No new listings from checked stores on the latest scan.":"Waiting for a nightly scan.")+'</p>')+
      storeLinks(item.card,item.sources)+'</article>').join("") || '<p class="muted">Search for a card and choose Watch card to add it here.</p>';
    if (connected() && localWatches.length) {
      const sync=document.createElement("button");
      sync.type="button";
      sync.className="button";
      sync.textContent="Move saved cards to nightly watchlist";
      sync.onclick=async ()=>{
        sync.disabled=true;
        try {
          for (const card of localWatches) await setWatch(card,true);
          if (save("local-watches",[])) localWatches=[];
          renderWatches(content);
        } catch (error) { status.textContent=error.message; sync.disabled=false; }
      };
      list.prepend(sync);
    }
    list.querySelectorAll("[data-watch-remove]").forEach(button=>{
      button.onclick=async ()=>{
        button.disabled=true;
        try { await setWatch(entries[Number(button.dataset.watchRemove)].card,false); renderWatches(content); }
        catch (error) { status.textContent=error.message; button.disabled=false; }
      };
    });
  }

  function recentTournaments(format) {
    const online=tools.feed.online || seededOnline;
    const paper=tools.feed.paper || seededPaper;
    const rows=[...online,...paper].filter(item=>item.format===format).sort((a,b)=>b.date.localeCompare(a.date));
    const last=tools.feed.checkedAt;
    const links=rows.map(item=>'<li><div>'+link(item.url,item.title)+'<small class="muted">'+escape(item.type)+'</small></div><time datetime="'+escape(item.date)+'">'+escape(item.date)+'</time></li>');
    return '<section class="panel recent-results"><p class="eyebrow">Decklists and standings</p><h3>Recent '+escape(format)+' tournaments</h3>'+
      (last?'<p class="small muted">Last attempted refresh '+escape(time.format(new Date(last)))+' Brisbane time.'+
        (Object.values(tools.feed.status || {}).includes("previous data kept")?' Some sources kept their previous results.':'')+'</p>':
        '<p class="small muted">Saved results. Connect the live scanner in Buy Cards for nightly refreshes.</p>')+
      (links.length?'<ul class="shop-list">'+links.slice(0,8).join("")+'</ul>':'<p class="small muted">No tournament results available for this format.</p>')+
      (links.length>8?'<details><summary>More results</summary><ul class="shop-list">'+links.slice(8).join("")+'</ul></details>':'')+
      '<div class="actions">'+link("https://www.mtgo.com/decklists","All MTGO decklists ↗")+' '+link("https://mtgdecks.net/","Paper results ↗")+'</div></section>';
  }

  async function loadFeed() {
    if (!settings.url) return false;
    try { tools.feed=await api("/api/feed"); return Boolean(tools.feed.checkedAt); }
    catch { return false; }
  }

  const tools={renderBuy,recentTournaments,loadFeed,feed:{}};
  window.MagicDashTools=tools;
})();
