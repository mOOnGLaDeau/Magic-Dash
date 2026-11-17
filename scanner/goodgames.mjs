import {read} from "./catalog.mjs";
import {plain} from "./feed.mjs";
import {locatorEvent} from "./locator.mjs";

export async function scanGoodGames(saved,day) {
  const endpoint = "https://events.goodgames.com.au/wp-json/tribe/events/v1/events";
  for (let page=1;;page++) {
    const params = new URLSearchParams({search:"Magic",start_date:day,end_date:new Date(Date.parse(day)+28*86400000).toISOString().slice(0,10),per_page:"50",page:String(page)});
    const batch = await (await read(endpoint+"?"+params)).json();
    if (!Array.isArray(batch.events) || !Number.isInteger(batch.total_pages)) throw Error("Unrecognised calendar response");
    for (const row of batch.events) {
      const venue = row.venue;
      if (!/^4(?:0|1)[0-9]{2}$/.test(String(venue?.zip)) || !row.utc_start_date || !row.url) continue;
      const title = plain(row.title);
      const event = locatorEvent({id:row.id,title,organization:{name:plain(venue.venue || "")},
        scheduledStartTime:row.utc_start_date.replace(" ","T")+"Z"},day);
      if (!event) continue;
      event.id = "goodgames-"+row.id;
      event.url = row.url;
      event.discoveredOn = saved.get(event.id)?.discoveredOn || day;
      saved.set(event.id,event);
    }
    if (page>=batch.total_pages) return;
    if (!batch.events.length) throw Error("Incomplete calendar on page "+page);
  }
}
