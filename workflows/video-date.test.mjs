import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyVideoDate, checkVideoCandidates } from './video-date.mjs';
const id = 'CFadW8y05fY';
const html = (meta = {}, details = {}) => `<script>var ytInitialPlayerResponse = ${JSON.stringify({videoDetails: {videoId: id, title: 'A title with } and "quotes"', ...details}, microformat: {playerMicroformatRenderer: {ownerProfileUrl: 'http://www.youtube.com/@KayCapitals', publishDate: '2026-08-05T12:13:35-07:00', uploadDate: '2026-08-04', ...meta}}})};</script>`;
test('accepts exact release date and preserves channel-labelled link', () => {
  const r = verifyVideoDate(html(), '2026-08-05', 'kay', id);
  assert.equal(r.matched_by, 'published');
  assert.equal(r.resource.title, 'Kay Capitals');
  assert.equal(r.resource.url, 'https://www.youtube.com/watch?v=' + id);
});
test('batch checks bound parallel reads, deduplicate canonical IDs and preserve input ordering',async()=>{
 const ids=['CFadW8y05fY','FBDTHrhFbcs','TOYg3dLCimo','Zx9Y5dJafWY','lb4LWwzAiBk'];
 let active=0,peak=0,reads=0;
 const request=async url=>{
  reads++;active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setImmediate(resolve));active--;
  const videoId=new URL(url).searchParams.get('v');
  return {ok:true,text:async()=>html({}, {videoId})};
 };
 const candidates=ids.map(id=>({channel:'kay',url:'https://www.youtube.com/watch?v='+id}));
 candidates.push({...candidates[0],url:candidates[0].url+'&extra=1'});
 const result=await checkVideoCandidates('2026-08-05',candidates,{request,concurrency:3});
 assert.equal(reads,5);assert.equal(peak,3);
 assert.deepEqual(result.results.map(r=>r.video_id),[...ids,ids[0]]);
 assert.ok(result.results.every(r=>r.status==='verified'));
});
test('one blocked candidate does not lose successful checks or become no-match',async()=>{
 const other='TOYg3dLCimo';
 const request=async url=>url.includes(other)?{ok:false,status:429}:{ok:true,text:async()=>html()};
 const result=await checkVideoCandidates('2026-08-05',[{channel:'kay',url:'https://www.youtube.com/watch?v='+id},{channel:'kay',url:'https://www.youtube.com/watch?v='+other}],{request});
 assert.equal(result.results[0].status,'verified');
 assert.equal(result.results[1].status,'unavailable');
 assert.equal(result.results[1].resource,null);
});
test('batch deduplication never bypasses channel identity',async()=>{
 let reads=0;
 const request=async()=>{reads++;return {ok:true,text:async()=>html()};};
 const result=await checkVideoCandidates('2026-08-05',['kay','neto'].map(channel=>({channel,url:'https://www.youtube.com/watch?v='+id})),{request});
 assert.equal(reads,1);assert.equal(result.results[0].status,'verified');
 assert.equal(result.results[1].status,'unavailable');assert.match(result.results[1].reason,/Channel mismatch/);
});
test('malformed candidate URLs are rejected before network requests',async()=>{
 let reads=0;
 await assert.rejects(checkVideoCandidates('2026-08-05',[{channel:'kay',url:'https://example.com/watch?v='+id}],{request:async()=>{reads++;}}),/YouTube watch URL/);
 assert.equal(reads,0);
});
test('private upload date alone does not establish public release', () => {
  const r = verifyVideoDate(html(), '2026-08-04', 'kay', id);
  assert.equal(r.status, 'not_matched');
  assert.equal(r.resource, null);
});
test('recording day can differ from release and uses Pacific session date', () => {
  const r = verifyVideoDate(html({publishDate: '2026-08-06', liveBroadcastDetails: {startTimestamp: '2026-08-06T01:00:00Z'}}), '2026-08-05', 'kay', id);
  assert.equal(r.matched_by, 'live_recorded');
});
test('rejects other channels and mismatched video IDs', () => {
  assert.throws(() => verifyVideoDate(html(), '2026-08-05', 'neto', id), /Channel mismatch/);
  assert.throws(() => verifyVideoDate(html({}, {videoId: 'another'}), '2026-08-05', 'kay', id), /ID mismatch/);
});
test('missing metadata is unavailable rather than a no-video finding', () => {
  assert.throws(() => verifyVideoDate('<html>Blocked</html>', '2026-08-05', 'kay', id), /unavailable/);
});
test('accepts Neto separately and does not infer dates from title shorthand', () => {
  const r = verifyVideoDate(html({ownerProfileUrl: 'https://www.youtube.com/@TradeWithNeto', publishDate: '2026-08-06'}, {title: '260805 session'}), '2026-08-05', 'neto', id);
  assert.equal(r.status, 'not_matched');
});
