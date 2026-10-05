import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { mapConcurrent } from './concurrency.mjs';

export const channels = {
  neto: { title: 'Trade with Neto', handle: '@TradeWithNeto' },
  kay: { title: 'Kay Capitals', handle: '@KayCapitals' },
};

function playerData(html) {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g;
  const match = marker.exec(html);
  if (!match) throw Error('Video metadata unavailable; do not treat this as no video');
  const start = html.indexOf('{', marker.lastIndex);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw Error('Incomplete video metadata');
}

export function verifyVideoDate(html, date, channelKey, videoId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('Invalid date');
  const channel = channels[channelKey];
  if (!channel) throw Error('Channel must be neto or kay');
  const player = playerData(html);
  const details = player.videoDetails;
  const meta = player.microformat?.playerMicroformatRenderer;
  if (!details || !meta) throw Error('Video metadata unavailable');
  if (details.videoId !== videoId) throw Error('Video ID mismatch');
  const owner = new URL(meta.ownerProfileUrl);
  if (!['youtube.com', 'www.youtube.com'].includes(owner.hostname) || owner.pathname.toLowerCase() !== '/' + channel.handle.toLowerCase()) throw Error('Channel mismatch');
  const published = meta.publishDate ?? null;
  const uploaded = meta.uploadDate ?? null;
  const started = meta.liveBroadcastDetails?.startTimestamp ?? null;
  // Keep YouTube's calendar publication date; convert a live instant to the
  // Pacific chart session date. Uploading privately is not public release.
  const recordingDate = started ? new Date(started).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : null;
  const matchedBy = published?.slice(0, 10) === date ? 'published' : recordingDate === date ? 'live_recorded' : null;
  return {
    channel: channel.title, video_title: details.title, video_id: videoId,
    published_at: published, uploaded_at: uploaded, live_started_at: started,
    recording_date: recordingDate, matched_by: matchedBy,
    status: matchedBy ? 'verified' : 'not_matched',
    // An explicit recording/session date shown in the video or its description
    // can still be reviewed manually; absence here is not a negative finding.
    resource: matchedBy ? { title: channel.title, url: `https://www.youtube.com/watch?v=${videoId}` } : null,
  };
}

function candidateId(channelKey,link) {
  if(!channels[channelKey])throw Error('Channel must be neto or kay');
  const url = new URL(link);
  const id = url.searchParams.get('v');
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(url.hostname) || url.pathname !== '/watch' || !/^[\w-]{11}$/.test(id || '')) throw Error('Use an HTTPS YouTube watch URL');
  return id;
}

export async function checkVideoCandidates(date,candidates,{request=fetch,concurrency=4}={}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0,10)!==date) throw Error('Invalid date');
  if(!Array.isArray(candidates))throw Error('Candidates must be an array');
  // Deduplicate network reads only within this invocation; never cache missing
  // videos across days. Each channel/date identity is still verified separately.
  const inputs=candidates.map(c=>({...c,id:candidateId(c.channel,c.url)}));
  const unique=[...new Set(inputs.map(c=>c.id))];
  const pages=await mapConcurrent(unique,concurrency,async id=>{
    try {
      const response=await request(`https://www.youtube.com/watch?v=${id}`,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`YouTube HTTP ${response.status}`);
      return {html:await response.text()};
    }catch(error){return {error:error.message};}
  });
  const byId=new Map(unique.map((id,index)=>[id,pages[index]]));
  return {date,results:inputs.map(c=>{
    try {
      const page=byId.get(c.id);
      if(page.error)throw Error(page.error);
      return verifyVideoDate(page.html,date,c.channel,c.id);
    }catch(error){return {channel:channels[c.channel].title,video_id:c.id,status:'unavailable',reason:error.message,resource:null};}
  })};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [date, channelKey, link, output] = process.argv.slice(2);
  let result;
  if(channelKey==='--batch')result=await checkVideoCandidates(date,JSON.parse(await fs.readFile(link,'utf8')));
  else {
    const id=candidateId(channelKey,link);
    const response=await fetch(`https://www.youtube.com/watch?v=${id}`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`YouTube HTTP ${response.status}; check is unavailable, not no-match`);
    result=verifyVideoDate(await response.text(),date,channelKey,id);
  }
  if(output)await fs.writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
}
