(function(){
const $=s=>document.getElementById(s);
const video=$('vid'), canvas=$('wave'), ctx=canvas.getContext('2d');
const LEAD=3; // real seconds of lead-in
// a,b: the loop, or both null when there is no loop (then playback runs straight through).
// zw: timeline view width in seconds (0 = not set yet), v0: view start.
// beats, bpm: the beat grid, from analysis/<id>.json for YouTube or the in-browser detection for clips (empty = no grid).
// one: index in beats of a beat that is a "1". It belongs to the song (from the analysis file; 0 for clips), not to A.
const S={a:20,b:44,rate:100,lead:true,snap:true,repeat:true,click:false,big:false,zw:0,v0:0,dur:0,peaks:null,pdur:0,beats:[],bpm:0,one:0,key:null};
let objUrl=null, dirty=true, freeSeek=false, drag=null, wake=null, want=false;

const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const PREFS=['rate','lead','snap','repeat','click','big'];
const prefs=store.get('cl:prefs'); if(prefs){for(const k of PREFS) if(k in prefs) S[k]=prefs[k];}
function save(){const v={a:S.a,b:S.b,rate:S.rate,lead:S.lead,snap:S.snap,repeat:S.repeat,zw:S.zw};if(S.key)store.set(S.key,v);const p={};for(const k of PREFS)p[k]=S[k];store.set('cl:prefs',p);}

const fmt=t=>{if(!isFinite(t))t=0;t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(1)};
const hasLoop=()=>S.a!==null;
const pre=()=>hasLoop()?Math.max(0,S.a-(S.lead?LEAD*S.rate/100:0)):0; // where a round starts: the lead-in before A, or the song's start with no loop

/* ---------- players: clip file or YouTube ---------- */
let yt=null, ytState=-1, ytReady=false, apiPromise=null, ytRates=[];
// YouTube seek guard: getCurrentTime can lag behind a seekTo, so until the time lands near the target (or 2 s pass) we report the target.
// pend holds a seek asked for before the video has ever played; it runs on the first "playing" state (iOS ignores seeks before that).
let seekT=null, seekAt=0, pend=null, kickAt=0, bufAt=0;
const Clip={kind:'clip',
  time:()=>video.currentTime||0, seek:t=>{video.currentTime=t}, play:()=>{video.play().catch(()=>{})}, pause:()=>video.pause(), paused:()=>video.paused, settled:()=>!video.seeking,
  setRate(r){try{video.defaultPlaybackRate=r;video.playbackRate=r;video.preservesPitch=true;video.webkitPreservesPitch=true}catch(e){}}};
const Yt={kind:'yt',
  time(){if(!ytReady||!yt.getCurrentTime)return 0;if(pend!==null)return pend;const c=yt.getCurrentTime()||0;
    if(seekT!==null){const el=(performance.now()-seekAt)/1000;if(el>2||(c>=seekT-0.25&&c<=seekT+0.25+el*S.rate/100))seekT=null;else return seekT}
    return c},
  seek(t){if(!ytReady)return;if(ytState===-1||ytState===5){pend=t;return}seekT=t;seekAt=performance.now();yt.seekTo(t,true)},
  play:()=>{if(ytReady)yt.playVideo()}, pause:()=>{if(ytReady)yt.pauseVideo()},
  paused:()=>!(ytState===1||ytState===3), settled:()=>ytState===1&&seekT===null&&pend===null,
  setRate(r){if(!ytReady)return;try{yt.setPlaybackRate(r)}catch(e){}setTimeout(checkYtRate,400)}};
let P=Clip;
function checkYtRate(){if(P!==Yt||!ytReady)return;const want=S.rate,got=Math.round(yt.getPlaybackRate()*100);
  if(got===want){if(!steps)$('rateNote').textContent='';return}
  // the player quietly refused a 5% step: fall back to the speeds it lists
  if(!steps&&ytRates.length&&!ytRates.includes(want)){setSteps(ytRates);return}
  $('rateNote').textContent='YouTube is playing at '+got+'% instead of '+want+'%.'}
function applyRate(){P.setRate(S.rate/100)}
function onPlayState(playing){$('play').textContent=playing?'Pause':'Play';if(!playing){$('count').hidden=true;stopClicks();if(wake){wake.release().catch(()=>{});wake=null}}}
video.addEventListener('play',()=>{if(P===Clip){onPlayState(true);applyRate()}});
video.addEventListener('pause',()=>{if(P===Clip)onPlayState(false)});
video.addEventListener('seeked',()=>dirty=true);

/* ---------- speed steps ---------- */
let steps=null; // YouTube only: the speeds (percent, 50–150) the player allows when it can't do 5% steps
function setSteps(list){
  steps=list&&list.length?list:null;$('speed').step=steps?25:5;
  $('rateNote').textContent=steps?'YouTube only allows '+steps.join(', ')+'% here. Load a clip for 5% steps.':'';
  setRate(S.rate);
}
function setRate(r){r=Math.max(50,Math.min(150,r));S.rate=steps?steps.reduce((x,y)=>Math.abs(y-r)<Math.abs(x-r)?y:x):Math.round(r/5)*5;applyRate();render();save()}
function stepRate(d){if(!steps)return setRate(S.rate+5*d);const i=steps.indexOf(S.rate);setRate(steps[Math.max(0,Math.min(steps.length-1,i+d))])}
function probeYtRates(){
  // keep 5% steps; checkYtRate falls back to these listed speeds if the player refuses one
  ytRates=(yt.getAvailablePlaybackRates()||[]).map(x=>Math.round(x*100)).filter(x=>x>=50&&x<=150);
  setSteps(null);
}

/* ---------- beats ---------- */
function nearestIdx(b,t){let lo=0,hi=b.length-1;if(hi<0)return -1;while(hi-lo>1){const m=(lo+hi)>>1;if(b[m]<t)lo=m;else hi=m}return Math.abs(b[lo]-t)<=Math.abs(b[hi]-t)?lo:hi}
const nearestBeatIdx=t=>nearestIdx(S.beats,t);
const useSnap=()=>S.snap&&S.beats.length>0;
const oneIdx=()=>S.one;
const countOf=(i,one)=>(((i-one)%8)+8)%8; // 0 means "1"
function snap(t){if(useSnap())return S.beats[nearestBeatIdx(t)];return Math.round(t*10)/10}
function nudge(t,dir){if(useSnap()){let i=nearestBeatIdx(t);if(Math.abs(S.beats[i]-t)>0.02){i=dir>0?(S.beats[i]>t?i:i+1):(S.beats[i]<t?i:i-1)}else i+=dir;i=Math.max(0,Math.min(S.beats.length-1,i));return S.beats[i]}return Math.round((t+dir)*10)/10}
// Undo: a stack of earlier {a,b}. Callers grab mark() before a change and pass it to record() after, so one gesture is one entry.
let undos=[];
const mark=()=>({a:S.a,b:S.b});
function record(m){if(m.a===S.a&&m.b===S.b)return;undos.push(m);if(undos.length>50)undos.shift();$('undo').disabled=false}
function clearUndo(){undos=[];$('undo').disabled=true}
function undo(){const m=undos.pop();if(m){S.a=m.a;S.b=m.b;render();save()}$('undo').disabled=!undos.length}
// With no loop, setting A or B makes a new loop of about 8 beats (4 s without beats) on the far side of it.
const loopLen=()=>8*beatLen();
function setA(t){const m=mark();if(!hasLoop())S.b=Math.min(S.dur||t,snap(t+loopLen()));S.a=Math.max(0,Math.min(t,S.b-0.5));record(m);render();save()}
function setB(t){const m=mark();if(!hasLoop())S.a=Math.max(0,snap(t-loopLen()));S.b=Math.min(S.dur||t,Math.max(t,S.a+0.5));record(m);render();save()}
function clearLoop(){if(!hasLoop())return;const m=mark();S.a=S.b=null;record(m);render();save();
  $('status').textContent='Loop cleared. Play runs straight through. Set A or B to the playhead to make a new loop, or tap Undo to get this one back.'}
function snapAB(){if(!useSnap()||!hasLoop())return;const m=mark();S.a=snap(S.a);S.b=Math.max(snap(S.b),S.a+0.5);record(m)}
// New waveform and detected beats, from clip analysis or a fetched analysis file.
function gotAnalysis(peaks,pdur,beats,bpm,one,saved){
  S.peaks=peaks;S.pdur=pdur;S.beats=beats;S.bpm=beats.length?bpm:0;S.one=Math.max(0,one|0);
  if(!saved){snapAB();clearUndo()} // snapping the default loop on load is not a change to undo
  if(zwAuto)S.zw=defW(); // default zoom: about 10 eight-counts, now that the beat is known
  render();
}
function analyze(mono,sr){
  const N=Math.min(8000,Math.max(500,(mono.length/64)|0)), bs=mono.length/N, peaks=new Float32Array(N);let mx=1e-6;
  for(let i=0;i<N;i++){let m=0;const s=(i*bs)|0,e=Math.min(mono.length,((i+1)*bs)|0);for(let j=s;j<e;j+=2){const v=Math.abs(mono[j]);if(v>m)m=v}peaks[i]=m;if(m>mx)mx=m}
  for(let i=0;i<N;i++)peaks[i]/=mx;
  const hop=512,win=1024,n=Math.max(0,Math.floor((mono.length-win)/hop)),fr=sr/hop;
  if(n<fr*4) return {peaks,beats:[],bpm:0};
  const e=new Float32Array(n);for(let f=0;f<n;f++){let s=0;const o=f*hop;for(let i=0;i<win;i+=2){const v=mono[o+i];s+=v*v}e[f]=Math.log(1e-8+s)}
  const raw=new Float32Array(n);for(let f=1;f<n;f++){const d=e[f]-e[f-1];raw[f]=d>0?d:0}
  const ps=new Float64Array(n+1);for(let i=0;i<n;i++)ps[i+1]=ps[i]+raw[i];
  const w=Math.round(fr*0.4), on=new Float32Array(n);let sum=0,sq=0;
  for(let f=0;f<n;f++){const lo=Math.max(0,f-w),hi=Math.min(n,f+w+1);const v=Math.max(0,raw[f]-(ps[hi]-ps[lo])/(hi-lo));on[f]=v;sum+=v;sq+=v*v}
  const sd=Math.sqrt(Math.max(1e-12,sq/n-(sum/n)**2));for(let f=0;f<n;f++)on[f]/=sd;
  const Lmin=Math.floor(fr*60/200),Lmax=Math.ceil(fr*60/60),sc=new Float64Array(Lmax+2);
  for(let L=Lmin;L<=Lmax;L++){let s=0;for(let i=0;i+L<n;i++)s+=on[i]*on[i+L];const bpm=60*fr/L;sc[L]=s/(n-L)*Math.exp(-0.5*(Math.log2(bpm/120)/0.9)**2)}
  let bL=Lmin;for(let L=Lmin;L<=Lmax;L++)if(sc[L]>sc[bL])bL=L;
  let Pd=bL;if(bL>Lmin&&bL<Lmax){const y0=sc[bL-1],y1=sc[bL],y2=sc[bL+1],den=y0-2*y1+y2;if(den!==0)Pd=bL+0.5*(y0-y2)/den}
  const tight=100,score=new Float32Array(n),back=new Int32Array(n).fill(-1),far=Math.round(2*Pd),near=Math.max(1,Math.round(Pd/2));
  for(let t=0;t<n;t++){let best=-Infinity,bi=-1;for(let p=Math.max(0,t-far);p<=t-near;p++){const l=Math.log((t-p)/Pd),v=score[p]-tight*l*l;if(v>best){best=v;bi=p}}
    if(bi>=0&&best>0){score[t]=on[t]+best;back[t]=bi}else score[t]=on[t]}
  let t=n-1;for(let i=Math.max(0,n-far);i<n;i++)if(score[i]>score[t])t=i;
  const fr2=[];while(t>=0){fr2.push(t);t=back[t]}fr2.reverse();
  return {peaks,beats:fr2.map(f=>(f*hop+win/2)/sr),bpm:60*fr/Pd};
}

/* ---------- lead-in click ---------- */
let ac=null,clicks=[],clickArm=false;
function audioCtx(){if(!ac){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ac=new AC()}if(ac.state==='suspended')ac.resume().catch(()=>{});return ac}
function beep(when,accent){const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=accent?1760:1100;
  g.gain.setValueAtTime(0.0001,when);g.gain.exponentialRampToValueAtTime(accent?0.6:0.35,when+0.004);g.gain.exponentialRampToValueAtTime(0.0001,when+0.06);
  o.connect(g).connect(ac.destination);o.start(when);o.stop(when+0.07);clicks.push(o);o.onended=()=>{clicks=clicks.filter(x=>x!==o)}}
function stopClicks(){for(const o of clicks)try{o.stop()}catch(e){}clicks=[]}
// Called once per round when playback is running inside the lead-in: schedule clicks on the beats up to and including A (or once per real second without beats).
function scheduleClicks(t){
  if(!audioCtx())return;const r=S.rate/100,now=ac.currentTime+0.02;
  if(S.beats.length){const one=oneIdx();for(let i=Math.max(0,nearestBeatIdx(t)-1);i<S.beats.length&&S.beats[i]<=S.a+0.03;i++){const b=S.beats[i];if(b>t+0.01)beep(now+(b-t)/r,countOf(i,one)===0)}}
  else for(let k=LEAD;k>=0;k--){const b=S.a-k*r;if(b>t+0.01)beep(now+(b-t)/r,k===0)}
}

/* ---------- drawing ---------- */
// The timeline works like a PDF page: a fixed scale you pan. Only the zoom buttons change the scale.
const EIGHTS=[2,4,6,10,16,24,40]; // zoom levels, in eight-counts across
const TICKS=[1,2,5,10,15,30,60,120,300,600]; // time label spacing, seconds
const beatLen=()=>S.bpm?60/S.bpm:0.5; // without a beat grid, act as if 120 BPM, so 10 eights = 40 s
const defW=()=>80*beatLen();
// zwAuto: the width is the default and may be redone once beats arrive.
// Following, like a map app: the view scrolls so the playhead holds one screen spot, followAt (a fraction of the width; null = off).
// followAt is wherever the playhead is when following starts (a tap, or Play), or FOLLOW after Re-center.
// Panning and the Fit buttons turn it off. At the song's ends the view stops and the playhead moves instead.
const FOLLOW=0.25;
let zwAuto=true, followAt=FOLLOW;
function setFollow(at){followAt=at;$('recenter').hidden=at!==null;dirty=true}
const headFrac=()=>{const [v0,v1]=range();return (P.time()-v0)/(v1-v0)};
const onScreen=f=>f>=0&&f<=1;
// Play and Restart: keep following, or start from the playhead's screen spot (FOLLOW if it is off screen).
function followHere(){if(followAt===null){const f=headFrac();setFollow(onScreen(f)?f:FOLLOW)}}
function vw(){const D=S.dur||1;return Math.min(D,Math.max(1,S.zw||defW()))}
function range(){const W=vw();S.v0=Math.max(0,Math.min((S.dur||1)-W,S.v0||0));return[S.v0,S.v0+W]}
function setView(v0,w){S.zw=w;S.v0=v0;zwAuto=false;range();dirty=true;save()}
// Zoom to width w, keeping the time at screen fraction f in place. While following, zoom around the playhead instead, so it keeps its spot.
function zoomAt(w,f){const D=S.dur||1,[v0]=range(),W=vw();w=Math.min(D,Math.max(1,w));
  if(followAt!==null&&onScreen(headFrac()))f=headFrac();
  setView(v0+f*W-f*w,w)}
// The − and + buttons step to the next fixed level (the wheel zooms smoothly between them).
function zoom(d){ // d>0 zooms in
  const W=vw(),L=EIGHTS.map(n=>n*8*beatLen()).filter(w=>w<(S.dur||1));
  let w=d>0?L.slice().reverse().find(w=>w<W*0.98):L.find(w=>w>W*1.02);
  if(w===undefined)w=d>0?W:(S.dur||1);
  const f=headFrac();zoomAt(w,onScreen(f)?f:0.5); // keep the playhead (or the middle) where it is
}
// Fit loop and Fit song choose what is on screen, so they stop following like a pan does.
function fitLoop(){if(!hasLoop())return;const s=pre(),m=Math.max(0.5,(S.b-s)*0.08);setFollow(null);setView(s-m,S.b-s+2*m)}
function fitSong(){setFollow(null);setView(0,S.dur||1)}
// Called every frame: glide to a far target (a seek or a loop wrap), track exactly once close.
function followHead(t){if(followAt===null)return;const W=vw(),to=Math.max(0,Math.min((S.dur||1)-W,t-followAt*W)),d=to-S.v0;
  if(Math.abs(d)>1e-4){S.v0=Math.abs(d)<0.1*W?to:S.v0+d*0.25;dirty=true}}
const mss=k=>Math.floor(k/60)+':'+String(k%60).padStart(2,'0');
function tok(cs,n){return cs.getPropertyValue(n).trim()}
function resize(){const r=canvas.getBoundingClientRect(),d=window.devicePixelRatio||1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);dirty=true}
function draw(){
  dirty=false;const d=window.devicePixelRatio||1,W=canvas.width/d,H=canvas.height/d;if(!W)return;
  ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,W,H);
  const cs=getComputedStyle(document.documentElement);
  const [v0,v1]=range(),span=Math.max(0.001,v1-v0),X=t=>(t-v0)/span*W;
  const top=36,mid=(top+H)/2,amp=(H-top)/2-3;
  const loop=hasLoop(),xa=X(S.a),xb=X(S.b),xp=X(pre());
  if(loop){if(S.lead){ctx.fillStyle=tok(cs,'--tape-soft');ctx.globalAlpha=.45;ctx.fillRect(xp,top,xa-xp,H-top);ctx.globalAlpha=1}
    ctx.fillStyle=tok(cs,'--tape-soft');ctx.fillRect(xa,top,xb-xa,H-top)}
  const mu=tok(cs,'--muted'),pps=W/span;
  // time ruler: m:ss labels at the first spacing on the ladder that leaves room for them
  {const st=TICKS.find(s=>s*pps>=48)||600;ctx.font='600 11px '+tok(cs,'--body');ctx.textAlign='center';ctx.textBaseline='middle';
    for(let k=Math.ceil(v0/st)*st;k<=v1;k+=st){const x=X(k);ctx.fillStyle=tok(cs,'--line');ctx.fillRect(Math.round(x),top-4,1,4);
      if(x>12&&x<W-12){ctx.fillStyle=mu;ctx.fillText(mss(k),x,top-11)}}
    ctx.textBaseline='alphabetic'}
  // beat grid: a line on each "1" only
  const sp=8*beatLen()*pps; // pixels per eight-count
  if(S.beats.length&&sp>=6){const B=S.beats,one=oneIdx(),lab=sp>=24;
    ctx.font='700 10px '+tok(cs,'--body');ctx.textAlign='left';
    for(let i=Math.max(0,nearestIdx(B,v0)-1);i<B.length&&B[i]<=v1+1;i++){if(countOf(i,one)!==0)continue;const x=Math.round(X(B[i]));
      ctx.fillStyle=mu;ctx.globalAlpha=.4;ctx.fillRect(x,top,1,H-top);ctx.globalAlpha=1;
      if(lab){ctx.fillStyle=mu;ctx.fillText('1',x+3,H-4)}}}
  if(S.peaks&&S.peaks.length>1){const Pk=S.peaks,N=Pk.length,dur=S.pdur||S.dur||1,cw=tok(cs,'--wave'),ci=tok(cs,'--wave-in');
    for(let x=0;x<W;x+=2){const t0=v0+x/W*span,t1=v0+(x+2)/W*span;let i0=Math.floor(t0/dur*N),i1=Math.max(i0+1,Math.floor(t1/dur*N));let m=0;for(let i=Math.max(0,i0);i<Math.min(N,i1);i++)if(Pk[i]>m)m=Pk[i];
      const h=Math.max(1,m*amp),t=(t0+t1)/2;ctx.fillStyle=(loop&&t>=S.a&&t<=S.b)?ci:cw;ctx.fillRect(x,mid-h,1.5,2*h)}}
  else{ctx.fillStyle=tok(cs,'--line');ctx.fillRect(0,mid,W,1);
    if(P===Clip&&!S.peaks){ctx.fillStyle=tok(cs,'--muted');ctx.font='13px '+tok(cs,'--body');ctx.textAlign='center';ctx.fillText('Reading audio…',W/2,mid-8)}}
  if(loop){ctx.fillStyle=tok(cs,'--tape');ctx.fillRect(Math.round(xa)-1,0,2,H);ctx.fillRect(Math.round(xb)-1,0,2,H);
    ctx.fillStyle=tok(cs,'--tape-fill');ctx.fillRect(xa-1,0,20,18);ctx.fillRect(xb-19,0,20,18);
    ctx.fillStyle=tok(cs,'--tape-ink');ctx.font='700 12px '+tok(cs,'--body');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('A',xa+9,9.5);ctx.fillText('B',xb-9,9.5);ctx.textBaseline='alphabetic'}
  ctx.fillStyle=tok(cs,'--head');ctx.fillRect(Math.round(X(P.time()))-1,top-4,2,H-top+4);
}

/* ---------- UI ---------- */
function render(){
  const loop=hasLoop();
  $('aTime').textContent=loop?fmt(S.a):'–';$('bTime').textContent=loop?fmt(S.b):'–';
  $('aCount').textContent=loop&&S.beats.length?' · count '+(countOf(nearestBeatIdx(S.a),oneIdx())+1):'';
  if(loop){const len=S.b-S.a;let beats='';if(S.beats.length){const n=S.beats.filter(b=>b>=S.a-0.03&&b<S.b-0.03).length;beats=' · '+n+' beats'}
    $('loopSum').textContent='Loop length '+len.toFixed(1)+' s'+beats+(S.lead?' · lead-in starts at '+fmt(pre()):'')}
  else $('loopSum').textContent='No loop. Set A or B to the playhead to make one.';
  for(const id of ['aMinus','aPlus','bMinus','bPlus','tLead','tRepeat','fitLoop'])$(id).disabled=!loop;
  if(document.activeElement!==$('speedVal'))$('speedVal').value=S.rate+'%';$('speed').value=S.rate;
  for(const [id,k] of [['tLead','lead'],['tSnap','snap'],['tRepeat','repeat'],['tClick','click'],['tBig','big']])$(id).setAttribute('aria-pressed',S[k]);
  $('counter').classList.toggle('big',S.big);
  $('bpm').textContent=S.bpm?('≈ '+Math.round(S.bpm)+' BPM'):'';
  const step=useSnap()?'beat':'second';for(const id of ['aMinus','aPlus','bMinus','bPlus'])$(id).title='Move one '+step;
  dirty=true;
}

async function lockScreen(){try{if('wakeLock'in navigator&&!wake){wake=await navigator.wakeLock.request('screen');wake.addEventListener('release',()=>wake=null)}}catch(e){}}
function startLoop(){freeSeek=false;followHere();want=true;clickArm=true;P.seek(pre());applyRate();P.play()}
function togglePlay(){
  if(S.click)audioCtx(); // unlock Web Audio inside the tap
  if(!P.paused()){want=false;P.pause();return}
  const t=P.time();want=true;clickArm=true;followHere();
  if(hasLoop()&&!freeSeek&&(t<pre()-0.25||t>=S.b-0.05))startLoop();else{applyRate();P.play()}
  lockScreen();
  if(P===Yt)setTimeout(()=>{if(P===Yt&&want&&P.paused())$('status').textContent="If the video doesn't start, tap the video itself once. After that, Play works from here."},2500);
}

/* ---------- eight-count strip ---------- */
const counter=$('counter'),slots=[];
for(let k=0;k<8;k++){const c=document.createElement('span');c.className='cell'+(k===0?' first':'');c.textContent=k+1;const a=document.createElement('span');a.className='and';a.textContent='&';counter.append(c,a);slots.push(c,a)}
// A count lights when the playhead reaches its beat (or the midpoint, for "&"), AHEAD seconds early: the class change
// reaches the screen one to two frames after this frame starts, so lighting a frame or so early makes it show on the beat.
const AHEAD=0.03;
let lastSlot=-2;
function updateCounter(t){
  const B=S.beats;counter.hidden=!B.length;if(!B.length)return;
  const u=t+AHEAD;let i=nearestBeatIdx(u);if(B[i]>u)i--; // i: the last beat at or before u
  let slot=-1;
  if(i>=0&&i<B.length-1){const c=countOf(i,oneIdx());slot=c*2+(u>=(B[i]+B[i+1])/2?1:0)}
  if(slot===lastSlot)return;
  if(lastSlot>=0&&slots[lastSlot])slots[lastSlot].classList.remove('on');
  if(slot>=0)slots[slot].classList.add('on');
  lastSlot=slot;
}

// YouTube on iOS can drop to paused right after a seek, or sit buffering. Nudge it while the user wants playback.
function ytWatch(now){
  if(P!==Yt||!ytReady||!want||now-kickAt<1500)return;
  if(ytState===2&&now-seekAt<3000){kickAt=now;yt.playVideo()}
  else if(ytState===3&&now-bufAt>6000){kickAt=now;bufAt=now;Yt.seek(yt.getCurrentTime());yt.playVideo()}
}

function tick(){
  requestAnimationFrame(tick);
  if(!S.dur)return;
  const t=P.time(),playing=!P.paused();
  if(playing&&hasLoop()&&t>=S.b&&(!freeSeek||t<S.b+0.3)){freeSeek=false;clickArm=true;if(S.repeat)P.seek(pre());else{want=false;P.pause();P.seek(pre())}}
  else if(clickArm&&playing&&P.settled()){if(S.click&&S.lead&&hasLoop()&&t<S.a&&t>=pre()-0.3)scheduleClicks(t);clickArm=false}
  ytWatch(performance.now());
  updateCounter(t);
  followHead(t);
  const c=$('count');
  if(playing&&S.lead&&hasLoop()&&!S.beats.length&&t<S.a-0.02&&t>=pre()-0.3){const n=Math.ceil((S.a-t)/(S.rate/100));const s=String(Math.max(1,Math.min(LEAD,n)));if(c.textContent!==s)c.textContent=s;c.hidden=false}else if(!c.hidden)c.hidden=true;
  $('now').textContent=fmt(t);
  if(playing||dirty)draw();
}

/* ---------- timeline pointer ---------- */
function tAt(ev){const r=canvas.getBoundingClientRect(),[v0,v1]=range();return v0+Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*(v1-v0)}
// The A or B tab under the pointer, or null.
function markerAt(ev){if(!hasLoop())return null;const r=canvas.getBoundingClientRect(),[v0,v1]=range(),X=t=>(t-v0)/(v1-v0)*r.width,x=ev.clientX-r.left;
  const da=Math.abs(x-X(S.a)-8),db=Math.abs(x-X(S.b)+8);return Math.min(da,db)<26?(da<=db?'a':'b'):null}
// Loop selection: the loop spans the press time t0 and t, in either direction, snapped, at least 0.5 s long.
function selectTo(t0,t){const D=S.dur;let a=snap(Math.min(t0,t)),b=snap(Math.max(t0,t));
  if(b-a<0.5){if(t<t0)a=b-0.5;else b=a+0.5}
  if(a<0){a=0;b=Math.max(b,0.5)}if(b>D){b=D;a=Math.max(0,Math.min(a,D-0.5))}
  S.a=a;S.b=b;render()}
// A tap seeks there without moving the view; following carries on with the playhead held at the tapped spot.
// Two taps within 300 ms and 30 px of each other clear the loop.
let lastTap=null; // {at, x} of the previous tap
function tapAt(ev){const r=canvas.getBoundingClientRect(),now=performance.now(),dbl=lastTap&&now-lastTap.at<300&&Math.abs(ev.clientX-lastTap.x)<30;
  lastTap=dbl?null:{at:now,x:ev.clientX};
  freeSeek=true;setFollow(Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)));P.seek(tAt(ev));
  if(dbl)clearLoop()}
// A press on the A or B tab drags that marker (one undo entry per drag). Any other press is a tap, unless it moves:
// - Mouse or pen: dragging 4 px selects a new loop, like selecting text. Desktop pans with the wheel or trackpad instead.
// - Touch: moving 6 px pans (and stops following), since touch has no wheel. Holding still for 400 ms switches to loop selection.
canvas.addEventListener('pointerdown',ev=>{
  if(!S.dur)return;const m=markerAt(ev),base={x:ev.clientX,t0:tAt(ev),mark:mark(),moved:false};
  if(m)drag={...base,what:m};
  else if(ev.pointerType==='touch'){drag={...base,what:'pan',v0:S.v0};const d=drag;
    d.timer=setTimeout(()=>{if(drag===d&&!d.moved){d.what='sel';d.moved=true;selectTo(d.t0,d.t0);if(navigator.vibrate)navigator.vibrate(10)}},400)}
  else drag={...base,what:'sel'};
  canvas.setPointerCapture(ev.pointerId);ev.preventDefault();dirty=true;
});
canvas.addEventListener('pointermove',ev=>{
  if(!drag){if(ev.pointerType!=='touch')canvas.style.cursor=markerAt(ev)?'ew-resize':'';return}
  const dx=ev.clientX-drag.x;
  if(drag.what==='pan'){if(!drag.moved&&Math.abs(dx)<6)return;
    if(!drag.moved){drag.moved=true;clearTimeout(drag.timer);setFollow(null)}S.v0=drag.v0-dx/canvas.getBoundingClientRect().width*vw();range();dirty=true;return}
  if(drag.what==='sel'){if(!drag.moved&&Math.abs(dx)<4)return;drag.moved=true;selectTo(drag.t0,tAt(ev));return}
  const t=tAt(ev);
  if(drag.what==='a'){S.a=Math.max(0,Math.min(snap(t),S.b-0.5))}else{S.b=Math.min(S.dur,Math.max(snap(t),S.a+0.5))}
  render()});
const endDrag=ev=>{
  if(!drag)return;clearTimeout(drag.timer);
  if(drag.what==='a'||drag.what==='b'||(drag.what==='sel'&&drag.moved)){record(drag.mark);save()}
  else if(!drag.moved&&ev.type==='pointerup')tapAt(ev);
  drag=null;dirty=true};
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
// Wheel and trackpad, like a map: sideways scroll pans (as a drag does); up/down scroll and pinch (ctrlKey) zoom around the cursor.
canvas.addEventListener('wheel',ev=>{
  if(!S.dur)return;ev.preventDefault();
  const r=canvas.getBoundingClientRect(),u=ev.deltaMode===1?16:ev.deltaMode===2?r.width:1,dx=ev.deltaX*u,dy=ev.deltaY*u;
  if(!ev.ctrlKey&&Math.abs(dx)>Math.abs(dy)){setFollow(null);S.v0+=dx/r.width*vw();range();dirty=true;return}
  zoomAt(vw()*Math.exp(dy*(ev.ctrlKey?0.01:0.002)),(ev.clientX-r.left)/r.width);
},{passive:false});

/* ---------- controls ---------- */
$('play').onclick=togglePlay;$('restart').onclick=()=>{if(S.click)audioCtx();startLoop();lockScreen()};
$('slower').onclick=()=>stepRate(-1);$('faster').onclick=()=>stepRate(1);
$('speed').oninput=e=>setRate(+e.target.value);
$('aMinus').onclick=()=>setA(nudge(S.a,-1));$('aPlus').onclick=()=>setA(nudge(S.a,1));
$('bMinus').onclick=()=>setB(nudge(S.b,-1));$('bPlus').onclick=()=>setB(nudge(S.b,1));
$('aHere').onclick=()=>setA(snap(P.time()));$('bHere').onclick=()=>setB(snap(P.time()));
$('tLead').onclick=()=>{S.lead=!S.lead;render();save()};
$('tRepeat').onclick=()=>{S.repeat=!S.repeat;render();save()};
$('tClick').onclick=()=>{S.click=!S.click;if(S.click)audioCtx();render();save()};
$('tBig').onclick=()=>{S.big=!S.big;render();save()};
$('tSnap').onclick=()=>{S.snap=!S.snap;snapAB();render();save()};
$('undo').onclick=undo;
// Typed speed: the percentage is an input. Commit on Enter or blur (setRate clamps and rounds); Escape or junk reverts.
{const sv=$('speedVal');let cancel=false;
  sv.addEventListener('focus',()=>{cancel=false;sv.value=S.rate;sv.select()});
  sv.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sv.blur()}else if(e.key==='Escape'){cancel=true;sv.blur()}});
  sv.addEventListener('blur',()=>{const n=parseFloat(sv.value);if(!cancel&&isFinite(n))setRate(n);else render()})}
$('zOut').onclick=()=>zoom(-1);$('zIn').onclick=()=>zoom(1);$('fitLoop').onclick=fitLoop;$('fitSong').onclick=fitSong;
$('recenter').onclick=()=>setFollow(FOLLOW);
document.addEventListener('keydown',e=>{if(e.code==='Space'&&S.dur&&!/INPUT|BUTTON|TEXTAREA/.test(e.target.tagName)){e.preventDefault();togglePlay()}});
new ResizeObserver(resize).observe($('cwrap'));
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>dirty=true)}catch(e){}
new MutationObserver(()=>dirty=true).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

/* ---------- shared setup after a source loads ---------- */
function showApp(){$('empty').hidden=true;$('app').hidden=false;$('transport').hidden=false}
function restore(key){
  S.key=key;const saved=store.get(key);S.zw=0;clearUndo();
  if(saved){for(const k of ['a','b','rate','lead','snap','repeat','zw'])if(k in saved)S[k]=saved[k]}
  else{if(S.dur>=46){S.a=20;S.b=44}else{S.a=0;S.b=Math.min(S.dur||8,8)}}
  if(S.a===null||S.b===null)S.a=S.b=null; // no loop
  else{S.b=Math.min(S.b,S.dur||S.b);S.a=Math.max(0,Math.min(S.a,S.b-0.5))}
  zwAuto=!(S.zw>0);setFollow(FOLLOW);
  return !!saved;
}

/* ---------- clip files ---------- */
const once=(el,ev)=>new Promise(r=>el.addEventListener(ev,r,{once:true}));
$('file').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)loadClip(f);e.target.value=''});
async function loadClip(f){
  if(P===Yt&&ytReady)yt.pauseVideo();
  P=Clip;want=false;video.pause();if(objUrl)URL.revokeObjectURL(objUrl);
  $('ytWrap').hidden=true;$('srcNote').textContent='';markSong(null);steps=null;$('speed').step=5;$('rateNote').textContent='';
  S.peaks=null;S.pdur=0;S.beats=[];S.bpm=0;S.one=0;S.dur=0;showApp();
  const st=$('status');st.textContent='Loading clip…';
  objUrl=URL.createObjectURL(f);const meta=once(video,'loadedmetadata');video.src=objUrl;video.load();
  await meta;
  const hasVideo=video.videoWidth>0;video.hidden=!hasVideo;$('audioOnly').hidden=hasVideo;
  S.dur=isFinite(video.duration)?video.duration:0;
  const saved=restore('cl:'+f.name+':'+f.size);
  applyRate();resize();render();P.seek(pre());
  if(f.size>450e6){st.textContent='This clip is too large to draw a waveform on a phone. Looping still works, but there are no counts.';S.peaks=new Float32Array(1);render();return}
  st.textContent='Reading audio for the waveform and beats…';
  await new Promise(r=>setTimeout(r,30));
  try{
    const buf=await f.arrayBuffer();const AC=window.AudioContext||window.webkitAudioContext;const ac=new AC();
    const audio=await new Promise((res,rej)=>{const p=ac.decodeAudioData(buf,res,rej);if(p&&p.then)p.then(res,rej)});
    try{ac.close()}catch(e){}
    if(!S.dur)S.dur=audio.duration;
    const ch=audio.numberOfChannels,L=audio.length,mono=new Float32Array(L);
    for(let c=0;c<ch;c++){const d=audio.getChannelData(c);for(let i=0;i<L;i++)mono[i]+=d[i]/ch}
    st.textContent='Finding the beat…';await new Promise(r=>setTimeout(r,30));
    const res=analyze(mono,audio.sampleRate);
    if(P!==Clip)return;
    gotAnalysis(res.peaks,audio.duration,res.beats,res.bpm,0,saved);
    st.textContent=S.beats.length?'Tap to jump there. Drag A or B; they snap to the beat grid.':'Tap to jump there. Drag A or B to move the loop.';
    P.seek(pre());
  }catch(err){S.peaks=new Float32Array(1);st.textContent="Couldn't read this clip's audio, so there's no waveform. Looping and speed still work.";render()}
}

/* ---------- YouTube ---------- */
function loadApi(){
  if(window.YT&&window.YT.Player)return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((res,rej)=>{
    const prev=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{if(prev)try{prev()}catch(e){};res()};
    const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.onerror=()=>rej(new Error('blocked'));document.head.appendChild(s);
    setTimeout(()=>rej(new Error('timeout')),8000);
  });
  apiPromise.catch(()=>{apiPromise=null});
  return apiPromise;
}
// Precomputed waveform and beats, committed as analysis/<id>.json by tools/analyze.py. Missing or broken means null.
function fetchAnalysis(id){
  return fetch('analysis/'+id+'.json').then(r=>r.ok?r.json():null).then(j=>j&&Array.isArray(j.peaks)&&Array.isArray(j.beats)?j:null).catch(()=>null);
}
const YT_ERR={2:"That link has a bad video ID.",5:"YouTube's player hit an error on this device.",100:'This video is private, removed, or not available.',101:"This video's owner doesn't allow it to play on other sites.",150:"This video's owner doesn't allow it to play on other sites."};
async function loadYt(id){
  const note=$('srcNote');store.set('cl:lastSong',id);markSong(id);
  note.textContent='Loading YouTube…';
  const ana=fetchAnalysis(id);
  try{await loadApi()}catch(err){note.textContent="YouTube can't load on this page. Open this looper from its own web address, or use Load clip with a screen recording.";return}
  video.pause();P=Yt;ytReady=false;ytState=-1;want=false;seekT=null;pend=null;
  video.hidden=true;$('audioOnly').hidden=true;$('ytWrap').hidden=false;
  S.peaks=null;S.pdur=0;S.dur=0;S.beats=[];S.bpm=0;S.one=0;showApp();
  if(yt){try{yt.destroy()}catch(e){}const h=document.createElement('div');h.id='ytHost';$('ytWrap').replaceChildren(h)}
  const me=yt=new YT.Player('ytHost',{videoId:id,playerVars:{playsinline:1,rel:0,modestbranding:1,controls:1},
    events:{
      onReady:()=>{ytReady=true;S.dur=yt.getDuration()||0;const saved=restore('cl:yt:'+id);probeYtRates();resize();render();P.seek(pre());
        note.textContent='';$('status').textContent='Press Play.';
        ana.then(j=>{if(yt!==me||!j)return;
          if(!S.dur&&j.duration>0)S.dur=j.duration;
          gotAnalysis(Float32Array.from(j.peaks),+j.duration||S.dur,j.beats.filter(Number.isFinite),+j.bpm||0,+j.one||0,saved);
          if(P.paused())P.seek(pre());
          $('status').textContent='Drag A or B; they snap to the beat grid.'});
      },
      onStateChange:ev=>{const s=ev.data,now=performance.now();ytState=s;
        if(s===3)bufAt=now;
        if(s===1){if(!S.dur){S.dur=yt.getDuration()||0;render()}applyRate();if(pend!==null){const t=pend;pend=null;Yt.seek(t)}}
        if(s===2&&now-seekAt>3000)want=false; // paused from the YouTube player's own controls
        if(s===0&&want){if(S.repeat&&hasLoop())startLoop();else{want=false;Yt.seek(pre())}}
        onPlayState(s===1||s===3);dirty=true},
      onPlaybackRateChange:()=>checkYtRate(),
      onError:ev=>{const m=(YT_ERR[ev.data]||'YouTube could not play this video (error '+ev.data+').')+' Use Load clip with a screen recording of it instead.';
        note.textContent=m;$('status').textContent=m;want=false}
    }});
}

/* ---------- song list: analysis/index.json, written by tools/analyze.py ---------- */
let songs=[];
const fmtDur=t=>{t=Math.round(t)||0;return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
// Highlight the song that is loaded (null for a clip) and fold the list away; its summary row opens it again.
function markSong(id){
  for(const b of $('songs').children)b.classList.toggle('on',b.dataset.id===id);
  const s=songs.find(x=>x.id===id);$('songNow').textContent=s?s.title:'';$('songBox').open=false;
}
fetch('analysis/index.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(list=>{
  songs=(Array.isArray(list)?list:[]).filter(x=>x&&/^[\w-]{11}$/.test(x.id));
  if(!songs.length)throw new Error('empty');
  const last=store.get('cl:lastSong'),i=songs.findIndex(x=>x.id===last);
  if(i>0)songs.unshift(...songs.splice(i,1)); // the last song first
  $('songs').replaceChildren(...songs.map(x=>{const b=document.createElement('button');b.className='song';b.dataset.id=x.id;
    b.innerHTML='<span></span><span class="dur"></span>';b.firstChild.textContent=x.title||x.id;b.lastChild.textContent=fmtDur(x.duration);
    b.onclick=()=>loadYt(x.id);return b}));
  loadYt(songs[0].id); // open the last song (or the first) right away; Play still needs a tap
}).catch(()=>{$('songBox').hidden=true;$('srcNote').textContent="The song list didn't load. Tap Load clip to open a video or audio file."});
requestAnimationFrame(tick);
})();
