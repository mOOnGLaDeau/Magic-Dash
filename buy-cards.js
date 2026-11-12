(() => {
  "use strict";
  const stores = [
    ["The Dragon's Beard","https://thedragonsbeard.com.au","shop"],
    ["Spellroo Gaming","https://spellroogaming.com.au","shop"],
    ["MTG Singles price tracker","https://www.mtgsingles.co.nz/au","tracker"],
    ["Mana Market","https://manamarket.com.au","shop"],
    ["Moon MTG","https://moonmtg.com","shop"],
    ["MTG Mate","https://www.mtgmate.com.au","mate"],
    ["Trade Magic","https://trademagic.com.au","trade"],
    ["The Games Cube","https://www.thegamescube.com","cube"],
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
  const defaultSettings={url:read("scanner",{url:""}).url,key:""};
  let settings=defaultSettings;
  let settingsOwner;
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
    if (type==="shop") return root+"/search?"+new URLSearchParams({q:card,type:"product",country:"AU"});
    if (type==="mate") return root+"/cards/search?"+new URLSearchParams({q:card});
    if (type==="tracker") return root+"/magic-the-gathering/"+encodeURIComponent(card);
    if (type==="trade") return root+"/card.php?"+new URLSearchParams({cardname:card});
    if (type==="cube") return root+"/products/search?"+new URLSearchParams({q:card});
    if (type==="ebay") return root+"/sch/i.html?"+new URLSearchParams({_nkw:card+" MTG",LH_BIN:"1",_sop:"15"});
  }

  function storeLinks(card) {
    return '<ul class="shop-list" aria-label="Store searches">'+stores.map(([name,root,type])=>
      '<li>'+link(storeUrl(root,type,card),name+' ↗')+'</li>').join("")+'</ul>';
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

  function mergeWatchlists(existing,incoming) {
    const cards=new Map(existing.map(card=>[keyFor(card),card]));
    for (const card of incoming) if (!cards.has(keyFor(card))) cards.set(keyFor(card),card);
    return [...cards.values()];
  }

  function setWatchlist(watchlist) {
    if (!persist({...state,watchlist})) throw new Error(saveMessage);
  }

  function renderBuy(app) {
    const owner=accountStorage?.id;
    if (owner!==settingsOwner) {
      settingsOwner=owner;
      settings=owner ? read("scanner:"+owner,defaultSettings) : defaultSettings;
    }
    app.innerHTML='<section class="panel shop-panel"><p class="eyebrow">Australian singles</p><div class="shop-switch" role="group" aria-label="Find Cards view">'+
      '<button type="button" class="button" id="shop-search" aria-pressed="'+(mode==="search")+'">Search stores</button>'+
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
      if (!requireAccount()) return;
      const raw=config.elements.url.value.trim();
      const url=validUrl(raw);
      const status=app.querySelector("#shop-config-status");
      if (!url) { status.textContent="Enter a valid HTTPS scanner URL."; return; }
      const next={url:new URL(url).origin,key:config.elements.key.value.trim() || (new URL(url).origin===settings.url?settings.key:"")};
      if (next.key.length<24) { status.textContent="Enter your private scanner key of at least 24 characters."; return; }
      const controls=config.querySelectorAll("button");
      controls.forEach(button=>{button.disabled=true;});
      status.textContent="Checking the scanner connection…";
      try {
        const data=await api("/api/watch",{signal:AbortSignal.timeout(12000)},true,next);
        if (!Array.isArray(data.watches)) throw new Error("The URL did not return a Magic Dash watchlist.");
        if (!content.isConnected || owner!==accountStorage?.id) return;
        if (!save("scanner:"+owner,next)) throw new Error("This browser could not save the connection.");
        settings=next;
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
      if (!requireAccount()) return;
      if (save("scanner:"+owner,{url:"",key:""})) { settings={url:"",key:""}; tools.feed={}; renderBuy(app); }
    };
    if (mode==="watch") renderWatches(content);
    else renderSearch(content);
  }

  function renderSearch(content) {
    content.innerHTML='<form id="card-shopping-search"><label for="shopping-card">Search for a card</label><div class="shop-search-row">'+
      '<input id="shopping-card" maxlength="120" value="'+escape(query)+'" autocomplete="off" placeholder="e.g. ocelot pr" aria-describedby="shop-hint">'+
      '<button type="submit" class="button primary">Search</button></div><p id="shop-search-status" class="small muted" role="status"></p><div id="shop-suggestions" role="group" aria-label="Card suggestions"></div>'+
      '<p class="small muted" id="shop-hint">Choose a suggested card or enter its name, then open a store’s results in a new tab.</p></form>'+
      '<div id="shop-results"></div>';
    const form=content.querySelector("form");
    const input=content.querySelector("input");
    const suggest=content.querySelector("#shop-suggestions");
    const searchStatus=content.querySelector("#shop-search-status");
    const results=content.querySelector("#shop-results");
    let debounce,controller;
    const select=(card,moveFocus=false)=>{
      if (keyFor(card).length<2) {
        searchStatus.textContent="Enter at least two characters to search.";
        return;
      }
      clearTimeout(debounce);
      controller?.abort();
      suggest.innerHTML="";
      input.value=query=card;
      results.innerHTML='<div class="shop-result-heading"><h3 tabindex="-1">'+escape(card)+'</h3><div class="actions">'+
        '<button type="button" class="button" id="shop-watch-card">Watch card</button></div></div>'+
        '<p class="small muted" id="shop-watch-hint">Watch card saves it to your account. Scheduled scans are optional in Watchlist.</p>'+
        '<p class="small" id="shop-watch-status" role="status"></p>'+storeLinks(card)+
        '<div class="actions shop-bulk-actions"><button type="button" class="button" id="shop-open-all">Open all stores ('+stores.length+')</button>'+
        '<button type="button" class="button" id="shop-open-next" hidden>Open next store</button></div>'+
        '<p class="small" id="shop-open-status" role="status"></p>';
      searchStatus.textContent=stores.length+" store searches ready for "+card+".";
      if (moveFocus) results.querySelector("h3").focus();
      const openStatus=results.querySelector("#shop-open-status");
      const nextStore=results.querySelector("#shop-open-next");
      const openedUrls=new Set();
      const openStores=single=>{
        for (const storeLink of results.querySelectorAll(".shop-list a")) {
          if (openedUrls.has(storeLink.href)) continue;
          const tab=window.open("about:blank","_blank");
          if (tab) {
            tab.opener=null;
            tab.location.replace(storeLink.href);
            openedUrls.add(storeLink.href);
          }
          if (single || !tab) break;
        }
        nextStore.hidden=openedUrls.size===stores.length;
        if (openedUrls.size===stores.length) {
          openStatus.textContent="Opened all "+stores.length+" store searches.";
          openedUrls.clear();
        } else {
          openStatus.textContent="Opened "+openedUrls.size+" of "+stores.length+" store searches. Use Open next store, or allow pop-ups for this site and click Open all stores again.";
        }
      };
      results.querySelector("#shop-open-all").onclick=()=>openStores(false);
      nextStore.onclick=()=>openStores(true);
      const status=results.querySelector("#shop-watch-status");
      const watchButton=results.querySelector("#shop-watch-card");
      const isWatched=()=>state.watchlist.some(name=>keyFor(name)===keyFor(card));
      const updateLabel=()=>{watchButton.textContent=isWatched()?"Stop watching":"Watch card";};
      updateLabel();
      watchButton.onclick=()=>{
        const watch=!isWatched();
        if (!requireAccount(watch ? "watch "+card : "stop watching "+card, () => {
          if (mode!=="search" || query!==card) return;
          const next=app.querySelector("#shop-watch-card");
          if (!next) return;
          next.focus();
          if (next.textContent===(watch ? "Watch card" : "Stop watching")) next.click();
        })) return;
        try {
          setWatchlist(watch ? mergeWatchlists(state.watchlist,[card]) : state.watchlist.filter(name=>keyFor(name)!==keyFor(card)));
          updateLabel();
          status.textContent=watch ? "Card added to Watchlist." : "Card removed from Watchlist.";
          placeAccountSync(status);
        } catch (error) { status.textContent=error.message; }
      };
    };
    input.oninput=()=>{
      query=input.value;
      clearTimeout(debounce);
      controller?.abort();
      suggest.innerHTML="";
      searchStatus.textContent="";
      const text=query.trim();
      if (text.length<2) return;
      const request=new AbortController();
      controller=request;
      debounce=setTimeout(async ()=>{
        const signal=AbortSignal.any([request.signal,AbortSignal.timeout(7000)]);
        searchStatus.textContent="Looking up card names…";
        try {
          const names=await suggestions(text,signal);
          if (signal.aborted || !suggest.isConnected) return;
          searchStatus.textContent=names.length ? names.length+(names.length===1?" suggestion":" suggestions")+" available." :
            "No suggestions found. You can still search by card name.";
          for (const name of names) {
            const choice=document.createElement("button");
            choice.type="button";
            choice.className="button";
            choice.textContent=name;
            choice.onclick=()=>select(name,true);
            suggest.append(choice);
          }
        } catch {
          if (!request.signal.aborted && suggest.isConnected) searchStatus.textContent="Card suggestions are unavailable. You can still search by card name.";
        }
      },260);
    };
    form.onsubmit=event=>{event.preventDefault(); select(input.value.trim(),true);};
    if (query) select(query);
  }

  async function renderWatches(content) {
    content.innerHTML='<h3>Watched cards</h3><p class="small muted">Your saved cards sync across devices. Use your connected scanner to start or stop scheduled checks for a card.</p>'+
      '<p id="shop-watch-status" class="small" role="status"></p><div id="shop-watched-cards"></div>';
    const status=content.querySelector("#shop-watch-status");
    const list=content.querySelector("#shop-watched-cards");
    if (accountPhase!=="ready") {
      list.innerHTML=accountPlaceholder("your watchlist");
      return;
    }
    const account=accountStorage;
    let scannerWatches=[];
    if (connected() && state.watchlist.length) {
      try { scannerWatches=(await api("/api/watch",{},true)).watches; }
      catch { status.textContent="Scanner results are unavailable."; }
    }
    if (!content.isConnected || account!==accountStorage) return;
    const trackedCards=new Set(scannerWatches.map(item=>keyFor(item.card)));
    const entries=state.watchlist.map(card=>scannerWatches.find(item=>keyFor(item.card)===keyFor(card)) || {card,newOffers:[]});
    list.innerHTML=entries.map((item,index)=>'<article class="shop-watch-card"><div class="shop-result-heading"><h4>'+escape(item.card)+'</h4>'+
      '<button class="button" type="button" data-watch-remove="'+index+'">Remove</button></div>'+
      (connected()?'<button class="button" type="button" data-scan-toggle="'+index+'">'+(trackedCards.has(keyFor(item.card))?"Stop scheduled scan":"Start scheduled scan")+'</button>':'')+
      (item.checkedAt?'<p class="small muted">Last checked '+escape(time.format(new Date(item.checkedAt)))+' Brisbane time</p>':'')+
      (item.newOffers.length?offerList(item.newOffers):'<p class="small muted">'+(item.checkedAt?"No new listings from checked stores on the latest scan.":"No scheduled scan available.")+'</p>')+
      '<details class="shop-sources"><summary>Search stores for '+escape(item.card)+'</summary>'+storeLinks(item.card)+'</details></article>').join("") ||
      '<p class="muted">Search for a card and choose Watch card to add it here.</p>';
    if (connected()) {
      const sync=document.createElement("button");
      sync.type="button";
      sync.className="button";
      sync.textContent="Import cards from connected scanner";
      sync.onclick=async ()=>{
        if (!requireAccount()) return;
        sync.disabled=true;
        try {
          const data=await api("/api/watch",{},true);
          if (!content.isConnected || account!==accountStorage) return;
          setWatchlist(mergeWatchlists(state.watchlist,data.watches.map(item=>item.card)));
          renderWatches(content);
        } catch (error) { status.textContent=error.message; sync.disabled=false; }
      };
      list.prepend(sync);
    }
    list.querySelectorAll("[data-watch-remove]").forEach(button=>{
      button.onclick=()=>{
        if (!requireAccount()) return;
        const card=entries[Number(button.dataset.watchRemove)].card;
        try {
          setWatchlist(state.watchlist.filter(name=>keyFor(name)!==keyFor(card)));
          void renderWatches(content);
          placeAccountSync(content.querySelector("h3"));
        }
        catch (error) { status.textContent=error.message; }
      };
    });
    list.querySelectorAll("[data-scan-toggle]").forEach(button=>{
      button.onclick=async ()=>{
        if (!requireAccount()) return;
        const card=entries[Number(button.dataset.scanToggle)].card;
        button.disabled=true;
        try {
          await api("/api/watch",{method:"PUT",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({card,watch:!trackedCards.has(keyFor(card))})},true);
          if (content.isConnected && account===accountStorage) renderWatches(content);
        } catch (error) { status.textContent=error.message; button.disabled=false; }
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
        '<p class="small muted">Saved results. Connect the live scanner in Find Cards for hourly refreshes.</p>')+
      (links.length?'<ul class="shop-list">'+links.slice(0,8).join("")+'</ul>':'<p class="small muted">No tournament results available for this format.</p>')+
      (links.length>8?'<details><summary>More results</summary><ul class="shop-list">'+links.slice(8).join("")+'</ul></details>':'')+
      '<div class="actions">'+link("https://www.mtgo.com/decklists","All MTGO decklists ↗")+' '+link("https://mtgdecks.net/","Paper results ↗")+'</div></section>';
  }

  async function loadFeed() {
    const connection=accountStorage ? read("scanner:"+accountStorage.id,defaultSettings) : defaultSettings;
    if (!connection.url) return false;
    try { tools.feed=await api("/api/feed",{},false,connection); return Boolean(tools.feed.checkedAt); }
    catch { return false; }
  }

  const tools={renderBuy,recentTournaments,loadFeed,mergeWatchlists,feed:{}};
  window.MagicDashTools=tools;
})();
