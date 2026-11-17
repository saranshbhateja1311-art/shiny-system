/* JEE OneShot OS — built on the JEE OS 4.5 application architecture.
   Independent curriculum, storage namespace and cloud table.
   Daily sequence: Physics → Chemistry → Mathematics, one chapter per day.
   Each chapter has exactly two completion controls: lecture and question practice.
*/
'use strict';

const APP_NAME = 'JEE OneShot OS';
const CURRICULUM_ID = 'jee-one-shot-116-2026';
const STORAGE_KEY = 'jee-one-shot-os-v2-state';
const DIRTY_KEY = 'jee-one-shot-os-v2-dirty-user';
const SUPABASE_URL = 'https://bztsnkejidzjjlaghtly.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Cef2U5pCDcDJp9DUpe36KA_8DrAetWc';
const CLOUD_TABLE = 'jee_one_shot_progress';
const SUBJECTS = [
  {id:'P',name:'Physics',color:'var(--p)',short:'P',desc:'Build intuition and solve with precision.'},
  {id:'C',name:'Chemistry',color:'var(--c)',short:'C',desc:'Connect concepts, reactions and applications.'},
  {id:'M',name:'Mathematics',color:'var(--m)',short:'M',desc:'Strengthen methods through problem practice.'}
];

let SEED = null;
let S = null;
let activeTab = 'today';
let activeSubject = 'all';
let calendarMonth = null;
let selectedCalendarDate = null;
let searchText = '';
let cloudUser = null, cloudReady = false, cloudBusy = false, cloudDirty = false;
let cloudTimer = null, cloudChannel = null, cloudUpdatedAt = 0, localChangeVersion = 0;
let pill = 'dev', cloudError = '';
let playerChapter = null;
let focusSeconds = 25 * 60, focusRunning = false, focusEndAt = 0, focusInterval = null;

const $ = (s, root=document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const subject = id => SUBJECTS.find(s=>s.id===id) || SUBJECTS[0];
const allChapters = () => SEED?.chapters || [];
const progressOf = id => S.progress[id] || (S.progress[id] = {lectureDone:false,practiceDone:false,updatedAt:null});
const localISO = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseLocalDate = value => { const [y,m,d]=String(value||'').split('-').map(Number); return new Date(y||2026,(m||1)-1,d||1,12,0,0,0); };
const addDays = (iso,n) => { const d=parseLocalDate(iso); d.setDate(d.getDate()+n); return localISO(d); };
const daysBetween = (a,b) => Math.round((parseLocalDate(b)-parseLocalDate(a))/86400000);
const fmtDate = iso => parseLocalDate(iso).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const shortDate = iso => parseLocalDate(iso).toLocaleDateString(undefined,{day:'numeric',month:'short'});
const chapterById = id => allChapters().find(c=>c.id===id);

function defaultState(){
  return {curriculumId:CURRICULUM_ID,startDate:localISO(),theme:'system',dailyTargetDate:null,dailyTargetId:null,progress:{},studyLog:{}};
}
function normalizeState(input){
  const out=defaultState();
  if(input && input.curriculumId===CURRICULUM_ID){
    out.startDate=/^\d{4}-\d{2}-\d{2}$/.test(input.startDate||'')?input.startDate:out.startDate;
    out.theme=['system','light','dark'].includes(input.theme)?input.theme:'system';
    out.dailyTargetDate=/^\d{4}-\d{2}-\d{2}$/.test(input.dailyTargetDate||'')?input.dailyTargetDate:null;
    out.dailyTargetId=typeof input.dailyTargetId==='string'?input.dailyTargetId:null;
    out.studyLog=input.studyLog&&typeof input.studyLog==='object'?input.studyLog:{};
    const raw=input.progress&&typeof input.progress==='object'?input.progress:{};
    for(const c of allChapters()){
      const p=raw[c.id]||{};
      // Migrate the earlier One Shot build without losing completed checkboxes.
      out.progress[c.id]={
        lectureDone:!!(p.lectureDone??p.lectureCompleted),
        practiceDone:!!(p.practiceDone??p.practiceCompleted),
        updatedAt:p.updatedAt||p.lectureCompletedAt||null
      };
    }
  } else {
    for(const c of allChapters()) out.progress[c.id]={lectureDone:false,practiceDone:false,updatedAt:null};
  }
  return out;
}
function setPill(next,error=''){
  pill=next;cloudError=error;
  const el=$('#pill');
  if(el){const labels={dev:'Local saved',saving:'Syncing…',ok:'Cloud synced',off:'Sync issue'};el.className='pill '+next;el.innerHTML='<i></i>'+labels[next];el.title=error||'Progress is saved locally.';}
  const detail=$('#cloudError');
  if(detail){detail.textContent=error;detail.style.display=error?'block':'none';}
}
function saveLocal(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(S));}catch(e){console.error('Local save failed',e);}}
function markDirty(){
  saveLocal();
  if(cloudUser&&cloudReady){
    cloudDirty=true;localChangeVersion++;
    try{localStorage.setItem(DIRTY_KEY,cloudUser.id);}catch(e){}
    setPill('saving');cloudSave();
  }
}
function scheduleSequence(){
  const by={P:allChapters().filter(c=>c.subject==='P').sort((a,b)=>a.order-b.order),C:allChapters().filter(c=>c.subject==='C').sort((a,b)=>a.order-b.order),M:allChapters().filter(c=>c.subject==='M').sort((a,b)=>a.order-b.order)};
  const seq=[];let i=0;
  while(seq.length<allChapters().length){
    for(const id of ['P','C','M']) if(by[id][i]) seq.push(by[id][i]);
    i++;
  }
  return seq;
}
function sequence(){return scheduleSequence();}
function chapterForDate(iso){
  const offset=daysBetween(S.startDate,iso);
  if(offset<0)return {before:true,days:-offset};
  const seq=sequence(),today=localISO();
  if(iso===today&&S.dailyTargetDate===today&&S.dailyTargetId){
    const pinned=seq.find(c=>c.id===S.dailyTargetId);
    if(pinned)return {chapter:pinned,index:seq.findIndex(c=>c.id===pinned.id),completed:progressOf(pinned.id).lectureDone&&progressOf(pinned.id).practiceDone};
  }
  const prior=seq.slice(0,Math.min(offset,seq.length));
  const pendingPrior=prior.find(c=>{const p=progressOf(c.id);return !p.lectureDone||!p.practiceDone;});
  let result;
  if(pendingPrior){
    const index=seq.findIndex(c=>c.id===pendingPrior.id);
    result={chapter:pendingPrior,index,overdue:true};
  }else if(offset>=seq.length){
    result={finished:true};
  }else{
    const c=seq[offset],p=progressOf(c.id);
    result={chapter:c,index:offset,completed:p.lectureDone&&p.practiceDone};
  }
  if(iso===today&&result.chapter){
    S.dailyTargetDate=today;S.dailyTargetId=result.chapter.id;saveLocal();
  }
  return result;
}
function scheduledChapterForDate(iso){
  const offset=daysBetween(S.startDate,iso),seq=sequence();
  return offset>=0&&offset<seq.length?seq[offset]:null;
}
function progressStats(){
  let both=0,lecture=0,practice=0;
  for(const c of allChapters()){
    const p=progressOf(c.id);
    if(p.lectureDone)lecture++;
    if(p.practiceDone)practice++;
    if(p.lectureDone&&p.practiceDone)both++;
  }
  const total=allChapters().length;
  return {both,lecture,practice,total,percent:total?Math.round(both/total*100):0};
}
function subjectPercent(id){
  const list=allChapters().filter(c=>c.subject===id);
  const done=list.filter(c=>progressOf(c.id).lectureDone&&progressOf(c.id).practiceDone).length;
  return list.length?Math.round(done/list.length*100):0;
}
function isDayComplete(iso){return S.studyLog[iso]===true||S.studyLog[iso]==='complete';}
function isDayPartial(iso){return S.studyLog[iso]==='partial';}
function currentStreak(){
  let cursor=localISO(),n=0;
  if(!isDayComplete(cursor))cursor=addDays(cursor,-1);
  while(isDayComplete(cursor)){n++;cursor=addDays(cursor,-1);}
  return n;
}
function logIfComplete(chapterId,assignedId){
  const today=localISO();
  if(assignedId!==chapterId)return;
  const p=progressOf(chapterId);
  if(p.lectureDone&&p.practiceDone)S.studyLog[today]='complete';
  else if(p.lectureDone||p.practiceDone)S.studyLog[today]='partial';
  else delete S.studyLog[today];
}
function setTheme(){
  document.documentElement.dataset.theme=S.theme==='system'?'':S.theme;
}
function toast(message){
  const el=$('#toast');if(!el)return;
  el.textContent=message;el.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('on'),2200);
}
function header(){
  const user=cloudUser?esc(cloudUser.email):'Cloud sync not connected';
  return `<div class="top">
    <div class="brand-lockup">
      <div class="brand-mark">OS</div>
      <div class="brand-copy"><h1>JEE OneShot OS</h1><div class="mu">One focused lecture. One question-practice session. Every day.</div></div>
    </div>
    <div class="top-actions">
      <span class="authuser mu">${user}</span>
      ${cloudUser?'<button class="btn g s" data-a="signout">Sign out</button>':'<button class="btn g s" data-a="auth">☁ Cloud sync</button>'}
      <span id="pill" class="pill ${pill}"><i></i>${({dev:'Local saved',saving:'Syncing…',ok:'Cloud synced',off:'Sync issue'})[pill]}</span>
    </div>
  </div><div id="cloudError" class="card err" style="display:${cloudError?'block':'none'};margin-bottom:12px">${esc(cloudError)}</div>`;
}
function nav(){
  const items=[['today','◷','Today'],['calendar','▦','Calendar'],['chapters','▤','Chapters'],['insights','↗','Insights'],['settings','⚙','Settings']];
  return items.map(([id,ico,label])=>`<button class="${activeTab===id?'on':''}" data-a="tab" data-tab="${id}"><span class="nav-ico">${ico}</span>${label}</button>`).join('');
}
function checkTile(id,field,title,sub){
  const p=progressOf(id),checked=field==='lectureDone'?p.lectureDone:p.practiceDone;
  return `<label class="check-tile"><input type="checkbox" data-a-check="${field}" data-id="${id}" ${checked?'checked':''}><span><b>${title}</b><small>${sub}</small></span></label>`;
}
function subjectProgressMarkup(){
  return `<div class="subject-progress">${SUBJECTS.map(s=>`<div class="subject-progress-row"><b><span class="subject-dot" style="background:${s.color}"></span>${s.name}</b><div class="bar"><span style="width:${subjectPercent(s.id)}%;background:${s.color}"></span></div><strong>${subjectPercent(s.id)}%</strong></div>`).join('')}</div>`;
}
function weekMarkup(){
  const today=localISO(),start=addDays(today,-6);
  return `<div class="week-strip">${Array.from({length:7},(_,i)=>{
    const date=addDays(start,i),d=parseLocalDate(date),status=isDayComplete(date)?'done':isDayPartial(date)?'partial':'';
    return `<div class="week-day ${status} ${date===today?'today':''}"><div class="dow">${d.toLocaleDateString(undefined,{weekday:'short'})}</div><div class="daynum">${d.getDate()}</div><div class="heat"></div></div>`;
  }).join('')}</div>`;
}
function focusPanel(){
  const mins=String(Math.floor(focusSeconds/60)).padStart(2,'0'),secs=String(focusSeconds%60).padStart(2,'0');
  return `<section class="panel">
    <div class="today-head"><div><div class="eyebrow">FOCUS SPRINT</div><h3 style="margin-top:4px">Protect your attention</h3></div><span class="tag">25 / 5</span></div>
    <div class="timer-display" id="timerDisplay">${mins}:${secs}</div>
    <div class="bar"><span id="timerBar" style="width:${Math.max(0,Math.min(100,(1500-focusSeconds)/1500*100))}%;background:var(--ac)"></span></div>
    <div class="timer-actions" style="margin-top:13px"><button class="btn s" data-a="timer-toggle">${focusRunning?'Pause':'Start focus'}</button><button class="btn g s" data-a="timer-reset">Reset</button><button class="btn g s" data-a="focus-mode">Focus mode</button></div>
    <div class="mu" style="margin-top:9px">A distraction-free 25-minute work block, followed by a 5-minute break.</div>
  </section>`;
}
function todayView(){
  const today=localISO(),item=chapterForDate(today),stats=progressStats(),streak=currentStreak();
  let mission='';
  if(item.before){
    mission=`<div class="eyebrow">YOUR PLAN STARTS IN ${item.days} DAY${item.days===1?'':'S'}</div><h2 class="today-title">Your daily rotation is ready.</h2><p class="today-desc">Your first study day is ${fmtDate(S.startDate)}. You can change the start date in Settings.</p><div class="today-actions"><button class="btn" data-a="tab" data-tab="settings">Review start date</button></div>`;
  } else if(item.finished){
    mission=`<div class="eyebrow">CURRICULUM COMPLETE</div><h2 class="today-title">All 116 chapters are in the books.</h2><p class="today-desc">You've reached the end of the one-video-per-day rotation. Keep your foundations sharp with revision and mixed practice.</p>`;
  } else {
    const c=item.chapter,s=subject(c.subject),p=progressOf(c.id),done=p.lectureDone&&p.practiceDone;
    const next=sequence()[item.index+1];
    mission=`<div class="today-head"><span class="subject-pill ${c.subject}">${s.name.toUpperCase()} · DAILY ROTATION</span><span class="tag">${shortDate(today)}</span></div>
      <h2 class="today-title">${esc(c.name)}</h2><p class="today-desc">Today's single one-shot lecture. Your sequence rotates Physics → Chemistry → Mathematics, skipping a subject only after its chapters are complete.</p>
      <div class="today-actions"><button class="btn" data-a="play" data-id="${c.id}">▶ Play lecture in app</button><button class="btn secondary" data-a="tab" data-tab="chapters">Open chapter library</button></div>
      <div class="daily-checks">
        ${checkTile(c.id,'lectureDone','Lecture completed','Tick after finishing the video')}
        ${checkTile(c.id,'practiceDone','Question practice completed','Tick after completing the questions')}
      </div>
      ${done?`<div class="mu" style="margin-top:12px;color:var(--c);font-weight:750">✓ Today's mission complete. ${next?'Next in rotation: '+esc(next.name):'You have completed the rotation.'}</div>`:item.overdue?'<div class="mu" style="margin-top:12px;color:#d49a39;font-weight:750">Carry-forward mission · Finish this chapter before moving on.</div>':''}`;
  }
  return `<div class="today-layout">
    <div class="panel today-hero">
      <div class="eyebrow">DAILY STUDY MISSION · ${fmtDate(today).toUpperCase()}</div>
      ${mission}
    </div>
    <div class="side-stack">
      <section class="panel">
        <div class="eyebrow">YOUR CONSISTENCY</div><div class="side-kpis">
          <div class="kpi"><strong>${streak}</strong><span>Day streak 🔥</span></div>
          <div class="kpi"><strong>${stats.percent}%</strong><span>Curriculum progress</span></div>
        </div>
        <div style="margin-top:16px"><div class="ring-row"><div class="ring" style="--v:${stats.percent}%" data-label="${stats.percent}%"></div><div><b>Steady progress wins.</b><div class="mu">Complete both checkboxes each day to build your streak.</div></div></div></div>
      </section>
      ${focusPanel()}
    </div>
  </div>
  <div class="grid" style="margin-top:16px">
    <section class="panel"><div class="today-head"><div><div class="eyebrow">WEEKLY CONSISTENCY</div><h3 style="margin-top:4px">Your last seven days</h3></div><span class="tag">Daily missions</span></div>${weekMarkup()}</section>
    <section class="panel"><div class="eyebrow">SUBJECT BALANCE</div><h3 style="margin:4px 0 15px">Progress by subject</h3>${subjectProgressMarkup()}</section>
  </div>`;
}
function chapterRow(c){
  const p=progressOf(c.id),s=subject(c.subject),done=p.lectureDone&&p.practiceDone;
  return `<article class="chapter-row">
    <div class="subject-mark" style="color:${s.color}">${s.short}</div>
    <div class="chapter-row-main"><div class="chapter-row-title">${esc(c.name)}</div><div class="chapter-row-meta">${s.name} · Chapter ${c.order}${done?' · <span style="color:var(--c)">Complete</span>':''}</div></div>
    <button class="icon-btn" data-a="play" data-id="${c.id}" title="Play lecture" aria-label="Play ${esc(c.name)}">▶</button>
    <div class="chapter-row-checks">
      <label class="mini-check"><input type="checkbox" data-a-check="lectureDone" data-id="${c.id}" ${p.lectureDone?'checked':''}> Lecture completed</label>
      <label class="mini-check"><input type="checkbox" data-a-check="practiceDone" data-id="${c.id}" ${p.practiceDone?'checked':''}> Question practice completed</label>
    </div>
  </article>`;
}
function chaptersView(){
  const filtered=allChapters().filter(c=>(activeSubject==='all'||c.subject===activeSubject)&&(!searchText||c.name.toLowerCase().includes(searchText.toLowerCase())));
  return `<section class="panel">
    <div class="today-head"><div><div class="eyebrow">YOUR CURRICULUM</div><h2 style="font-size:25px;letter-spacing:-.04em;margin-top:3px">Chapter library</h2><div class="mu">Play any lecture here and tick off the two learning steps.</div></div><span class="tag">116 chapters</span></div>
    <div class="filterbar"><input id="chapterSearch" type="search" placeholder="Search a chapter…" value="${esc(searchText)}">
      <button class="chip ${activeSubject==='all'?'on':''}" data-a="subject" data-subject="all">All subjects</button>
      ${SUBJECTS.map(s=>`<button class="chip ${activeSubject===s.id?'on':''}" data-a="subject" data-subject="${s.id}">${s.name}</button>`).join('')}
    </div>
    <div class="mu" style="margin-bottom:10px">${filtered.length} chapters in this view</div>
    <div class="chapter-list">${filtered.map(chapterRow).join('')||'<div class="empty-state">No chapters match your search.</div>'}</div>
  </section>`;
}

function calendarChapterForDate(iso){
  const today=localISO();
  if(iso===today)return chapterForDate(iso).chapter||null;
  const offset=daysBetween(S.startDate,iso),seq=sequence();
  if(offset<0||offset>=seq.length)return null;
  return seq[offset];
}
function calendarStatus(iso,chapter){
  if(!chapter)return 'empty';
  const p=progressOf(chapter.id);
  if(p.lectureDone&&p.practiceDone)return 'done';
  if(p.lectureDone||p.practiceDone)return 'partial';
  if(iso===localISO())return 'today';
  if(iso<localISO())return 'missed';
  return 'upcoming';
}
function calendarCell(iso){
  const chapter=calendarChapterForDate(iso),status=calendarStatus(iso,chapter);
  const selected=iso===selectedCalendarDate;
  const date=parseLocalDate(iso);
  const title=chapter?`${fmtDate(iso)} — ${chapter.name}`:fmtDate(iso);
  return `<button class="os-cal-day ${status} ${selected?'selected':''} ${iso===localISO()?'is-today':''}" data-a="calendar-day" data-date="${iso}" title="${esc(title)}">
    <span class="os-cal-number">${date.getDate()}</span>
    ${chapter?`<span class="os-cal-dot"></span><span class="os-cal-subject">${chapter.subject}</span>`:'<span class="os-cal-dot invisible"></span>'}
  </button>`;
}
function calendarMonthSummary(year,month){
  const dim=new Date(year,month,0).getDate();
  let complete=0,partial=0,planned=0;
  for(let day=1;day<=dim;day++){
    const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const chapter=calendarChapterForDate(iso),status=calendarStatus(iso,chapter);
    if(status==='done')complete++;
    else if(status==='partial')partial++;
    else if(status==='upcoming'||status==='today')planned++;
  }
  return {complete,partial,planned};
}
function calendarDetail(){
  const iso=selectedCalendarDate,chapter=calendarChapterForDate(iso);
  const status=calendarStatus(iso,chapter),p=chapter?progressOf(chapter.id):null;
  const statusLabel={done:'Completed',partial:'In progress',today:'Today',missed:'Not completed',upcoming:'Upcoming',empty:'No chapter scheduled'}[status];
  if(!chapter){
    const before=daysBetween(S.startDate,iso)<0;
    return `<section class="panel os-cal-detail">
      <div class="eyebrow">DAY DETAILS</div><h3>${fmtDate(iso)}</h3>
      <span class="os-cal-status empty">${statusLabel}</span>
      <p class="mu">${before?'Your daily plan has not started yet. The first scheduled chapter begins on '+fmtDate(S.startDate)+'.':'All 116 chapters have been scheduled by this date.'}</p>
      ${before?`<button class="btn g s" data-a="calendar-day" data-date="${S.startDate}">Go to plan start</button>`:''}
    </section>`;
  }
  const s=subject(chapter.subject);
  const dayIndex=daysBetween(S.startDate,iso)+1;
  return `<section class="panel os-cal-detail">
    <div class="today-head"><div><div class="eyebrow">DAY ${Math.max(1,dayIndex)} · DAILY MISSION</div><h3>${fmtDate(iso)}</h3></div><span class="os-cal-status ${status}">${statusLabel}</span></div>
    <div class="os-cal-chapter">
      <span class="subject-pill ${chapter.subject}">${s.name.toUpperCase()}</span>
      <h3>${esc(chapter.name)}</h3>
      <div class="mu">One lecture · one question-practice session</div>
    </div>
    <button class="btn block" data-a="play" data-id="${chapter.id}">▶ Play lecture in app</button>
    <div class="daily-checks os-cal-checks">
      ${checkTile(chapter.id,'lectureDone','Lecture completed','Tick when the video is finished')}
      ${checkTile(chapter.id,'practiceDone','Question practice completed','Tick when practice is finished')}
    </div>
    ${status==='missed'?'<p class="mu os-cal-note">This scheduled day has passed. Unfinished work is carried forward to your current daily mission.</p>':''}
  </section>`;
}
function calendarView(){
  const [year,month]=calendarMonth.split('-').map(Number);
  const first=new Date(year,month-1,1),days=new Date(year,month,0).getDate();
  const lead=(first.getDay()+6)%7;
  const summary=calendarMonthSummary(year,month);
  const monthLabel=first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const prev=new Date(year,month-2,1),next=new Date(year,month,1);
  const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const cells=Array.from({length:lead},()=>'<div class="os-cal-blank"></div>');
  for(let day=1;day<=days;day++){
    const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    cells.push(calendarCell(iso));
  }
  while(cells.length%7!==0)cells.push('<div class="os-cal-blank"></div>');
  return `<div class="os-calendar-head">
    <div><div class="eyebrow">YOUR STUDY TIMELINE</div><h2>Calendar</h2><p class="mu">See your daily P → C → M missions, completed work and pending chapters.</p></div>
    <button class="btn g s" data-a="calendar-today">Today</button>
  </div>
  <div class="os-calendar-layout">
    <section class="panel os-calendar-panel">
      <div class="os-calendar-monthbar">
        <button class="icon-btn" data-a="calendar-month" data-month="${key(prev)}" aria-label="Previous month">‹</button>
        <div><h3>${monthLabel}</h3><span class="mu">${summary.complete} completed · ${summary.partial} partial · ${summary.planned} upcoming</span></div>
        <button class="icon-btn" data-a="calendar-month" data-month="${key(next)}" aria-label="Next month">›</button>
      </div>
      <div class="os-cal-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="os-cal-grid">${cells.join('')}</div>
      <div class="os-cal-legend">
        <span><i class="done"></i> Complete</span><span><i class="partial"></i> Partial</span><span><i class="today"></i> Today</span><span><i class="upcoming"></i> Upcoming</span><span><i class="missed"></i> Pending</span>
      </div>
    </section>
    <aside class="os-cal-detail-column" id="calendarDetail">${calendarDetail()}</aside>
  </div>`;
}

function insightsView(){
  const stats=progressStats(),streak=currentStreak(),completed=allChapters().filter(c=>progressOf(c.id).lectureDone&&progressOf(c.id).practiceDone);
  return `<section class="panel">
    <div class="eyebrow">PERFORMANCE OVERVIEW</div><h2 style="font-size:26px;letter-spacing:-.04em;margin:4px 0 16px">Consistency over intensity.</h2>
    <div class="insight-grid">
      <div class="insight-card"><strong>${stats.percent}%</strong><span>Curriculum completion</span></div>
      <div class="insight-card"><strong>${streak} 🔥</strong><span>Current streak</span></div>
      <div class="insight-card"><strong>${completed.length}</strong><span>Chapters fully completed</span></div>
    </div>
    <div class="grid" style="margin-top:16px">
      <div class="panel"><div class="eyebrow">SUBJECT PROGRESS</div><h3 style="margin:4px 0 16px">Keep the rotation balanced</h3>${subjectProgressMarkup()}</div>
      <div class="panel"><div class="eyebrow">RECENT ACTIVITY</div><h3 style="margin:4px 0 8px">Seven-day consistency</h3>${weekMarkup()}<p class="mu" style="margin-top:12px">A filled green dot means both the lecture and question practice were completed for that day's assigned chapter.</p></div>
    </div>
  </section>
  <section class="panel" style="margin-top:14px"><div class="eyebrow">COMPLETED CHAPTERS</div><h3 style="margin:4px 0 12px">Your finished work</h3>
    ${completed.length?`<div class="chapter-list">${completed.slice().reverse().slice(0,12).map(c=>`<div class="chapter-row"><div class="subject-mark">${c.subject}</div><div class="chapter-row-main"><div class="chapter-row-title">${esc(c.name)}</div><div class="chapter-row-meta">${subject(c.subject).name}</div></div><span class="tag" style="color:var(--c)">✓ Done</span></div>`).join('')}</div>`:'<div class="empty-state">Your completed chapters will appear here. Start with today’s mission.</div>'}
  </section>`;
}
function settingsView(){
  return `<section class="panel"><div class="eyebrow">WORKSPACE PREFERENCES</div><h2 style="font-size:25px;margin:4px 0 16px">Settings</h2>
    <div class="settings-grid">
      <div class="setting"><label for="startDate">Daily rotation start date</label><p>The first day is Physics chapter 1. The rotation then follows Physics → Chemistry → Mathematics, one chapter per day.</p><input id="startDate" type="date" value="${esc(S.startDate)}"></div>
      <div class="setting"><label for="themeSelect">Appearance</label><p>Choose the interface appearance for this device.</p><select id="themeSelect"><option value="system" ${S.theme==='system'?'selected':''}>Use device setting</option><option value="light" ${S.theme==='light'?'selected':''}>Light</option><option value="dark" ${S.theme==='dark'?'selected':''}>Dark</option></select></div>
      <div class="setting"><label>Cloud synchronization</label><p>${cloudUser?'Signed in as '+esc(cloudUser.email):'Sign in to sync your progress between devices. Local saving works without an account.'}</p><button class="btn s" data-a="${cloudUser?'signout':'auth'}">${cloudUser?'Sign out':'Connect cloud sync'}</button></div>
      <div class="setting"><label>Independent workspace</label><p>This app has its own progress store and cloud table. It does not overwrite your JEE OS data.</p><span class="tag">JEE OneShot OS · 116 chapters</span></div>
    </div>
  </section>`;
}
function render(){
  setTheme();
  $('#top').innerHTML=header();
  $('#nav').innerHTML=nav();
  const views={today:todayView,calendar:calendarView,chapters:chaptersView,insights:insightsView,settings:settingsView};
  $('#app').innerHTML=(views[activeTab]||todayView)();
  updateTimerUI();
}
function setTab(tab){activeTab=tab;render();window.scrollTo({top:0,behavior:'smooth'});}
function openPlayer(id){
  const c=chapterById(id);if(!c)return;
  playerChapter=c;
  const match=c.url.match(/[?&]v=([^&]+)/)||c.url.match(/youtu\.be\/([^?&]+)/);
  const videoId=match?.[1];
  $('#playerTitle').textContent=c.name+' · '+subject(c.subject).name;
  $('#playerFoot').innerHTML=`<span>JEE OneShot OS · YouTube player</span><div style="display:flex;gap:8px;align-items:center"><a class="btn g s" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a><button class="btn g s" data-a="close-player">Close player</button></div>`;
  $('#playerFrame').innerHTML=videoId?`<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1" title="${esc(c.name)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`:'<div class="empty-state" style="color:white">This video link could not be embedded. Use the chapter link in the curriculum data.</div>';
  $('#player').classList.add('on');document.body.style.overflow='hidden';
}
function closePlayer(){$('#player').classList.remove('on');$('#playerFrame').innerHTML='';playerChapter=null;document.body.style.overflow='';}
function setCheckbox(id,field,value){
  if(!['lectureDone','practiceDone'].includes(field))return;
  const assignedId=chapterForDate(localISO()).chapter?.id;
  const p=progressOf(id);p[field]=!!value;p.updatedAt=new Date().toISOString();
  logIfComplete(id,assignedId);markDirty();render();
  if(p.lectureDone&&p.practiceDone)toast('Both steps complete. Great work!');
}
function updateTimerUI(){
  const display=$('#timerDisplay'),bar=$('#timerBar'),btn=document.querySelector('[data-a="timer-toggle"]');
  if(!display)return;
  const m=String(Math.floor(focusSeconds/60)).padStart(2,'0'),s=String(focusSeconds%60).padStart(2,'0');
  display.textContent=m+':'+s;
  if(bar)bar.style.width=Math.max(0,Math.min(100,(1500-focusSeconds)/1500*100))+'%';
  if(btn)btn.textContent=focusRunning?'Pause':'Start focus';
}
function timerTick(){
  if(!focusRunning)return;
  focusSeconds=Math.max(0,Math.ceil((focusEndAt-Date.now())/1000));
  if(focusSeconds<=0){focusRunning=false;clearInterval(focusInterval);focusInterval=null;toast('Focus sprint complete. Take a 5-minute break.');}
  updateTimerUI();
}
function toggleTimer(){
  if(focusRunning){focusRunning=false;clearInterval(focusInterval);focusInterval=null;focusSeconds=Math.max(0,Math.ceil((focusEndAt-Date.now())/1000));}
  else {if(focusSeconds<=0)focusSeconds=25*60;focusRunning=true;focusEndAt=Date.now()+focusSeconds*1000;focusInterval=setInterval(timerTick,250);}
  updateTimerUI();
}
function resetTimer(){focusRunning=false;clearInterval(focusInterval);focusInterval=null;focusSeconds=25*60;updateTimerUI();}
function authMsg(msg,bad=false){const el=$('#authmsg');if(el){el.textContent=msg;el.className='authmsg '+(bad?'bad':'ok');}}
function authOpen(){$('#authbox').classList.add('on');authMsg(cloudUser?'Signed in as '+cloudUser.email:'');}
function authClose(){$('#authbox').classList.remove('on');}

/* Local-first Supabase snapshot sync. Uses the dedicated One Shot table and per-user RLS. */
const sb=(window.supabase&&window.supabase.createClient)?window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
async function cloudLoadOrSeed(){
  if(!sb||!cloudUser)return false;
  cloudBusy=true;setPill('saving');
  try{
    const {data,error}=await sb.from(CLOUD_TABLE).select('state,updated_at').eq('user_id',cloudUser.id).maybeSingle();
    if(error)throw error;
    let dirtyFor='';try{dirtyFor=localStorage.getItem(DIRTY_KEY)||'';}catch(e){}
    if(dirtyFor===cloudUser.id){
      cloudReady=true;cloudDirty=true;cloudUpdatedAt=Date.parse(data?.updated_at||'')||0;cloudBusy=false;await cloudPush();return true;
    }
    if(data?.state?.curriculumId===CURRICULUM_ID){S=normalizeState(data.state);cloudUpdatedAt=Date.parse(data.updated_at||'')||0;saveLocal();}
    cloudReady=true;cloudBusy=false;
    if(!data||data.state?.curriculumId!==CURRICULUM_ID){cloudDirty=true;localChangeVersion++;await cloudPush();}
    else setPill('ok');
    render();return true;
  }catch(e){cloudReady=false;setPill('off',e.message||String(e));authMsg('Cloud sync failed: '+(e.message||e),true);return false;}
  finally{cloudBusy=false;}
}
async function cloudPush(){
  cloudTimer=null;if(!sb||!cloudUser||!cloudReady)return;
  if(cloudBusy){if(cloudDirty){cloudTimer=setTimeout(cloudPush,500);}return;}
  const version=localChangeVersion;let succeeded=false;cloudBusy=true;setPill('saving');
  try{
    const now=new Date().toISOString();
    const {data,error}=await sb.from(CLOUD_TABLE).upsert({user_id:cloudUser.id,state:S,updated_at:now},{onConflict:'user_id'}).select('updated_at').single();
    if(error)throw error;succeeded=true;cloudUpdatedAt=Date.parse(data?.updated_at||now)||Date.now();
    if(version===localChangeVersion){cloudDirty=false;try{if(localStorage.getItem(DIRTY_KEY)===cloudUser.id)localStorage.removeItem(DIRTY_KEY);}catch(e){}setPill('ok');}
    else{cloudDirty=true;setPill('saving');}
  }catch(e){setPill('off',e.message||String(e));console.error('One Shot cloud sync failed:',e);}
  finally{cloudBusy=false;if(succeeded&&cloudDirty){clearTimeout(cloudTimer);cloudTimer=setTimeout(cloudPush,900);}}
}
function cloudSave(){if(!cloudUser||!cloudReady)return;clearTimeout(cloudTimer);cloudTimer=setTimeout(cloudPush,650);}
function cloudSubscribe(){
  if(!sb||!cloudUser)return;if(cloudChannel)sb.removeChannel(cloudChannel);
  const uid=cloudUser.id;
  cloudChannel=sb.channel('jee-one-shot-progress-'+uid).on('postgres_changes',{event:'*',schema:'public',table:CLOUD_TABLE,filter:'user_id=eq.'+uid},payload=>{
    const row=payload.new;if(!row?.state||cloudDirty||cloudBusy||cloudTimer)return;
    const at=Date.parse(row.updated_at||'')||0;
    if(at>cloudUpdatedAt&&row.state.curriculumId===CURRICULUM_ID){S=normalizeState(row.state);cloudUpdatedAt=at;saveLocal();setPill('ok');render();}
  }).subscribe();
}
async function authSignIn(){
  if(!sb)return authMsg('Supabase client did not load. Check your internet connection.',true);
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
  if(!email||!password)return authMsg('Enter your email and password.',true);
  authMsg('Signing in…');const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error)return authMsg(error.message,true);
  cloudUser=data.user;authClose();await cloudLoadOrSeed();cloudSubscribe();render();
}
async function authSignUp(){
  if(!sb)return authMsg('Supabase client did not load. Check your internet connection.',true);
  const email=$('#authEmail').value.trim(),password=$('#authPassword').value;
  if(!email||password.length<6)return authMsg('Enter an email and a password of at least 6 characters.',true);
  authMsg('Creating account…');const {data,error}=await sb.auth.signUp({email,password});
  if(error)return authMsg(error.message,true);
  if(data.session){cloudUser=data.user;authClose();await cloudLoadOrSeed();cloudSubscribe();render();}
  else authMsg('Account created. Check your email for confirmation, then sign in.');
}
async function authSignOut(){
  if(!sb)return;await sb.auth.signOut();cloudUser=null;cloudReady=false;cloudDirty=false;
  if(cloudChannel){sb.removeChannel(cloudChannel);cloudChannel=null;}
  setPill('dev');render();
}
async function cloudPullLatest(){
  if(!sb||!cloudUser||!cloudReady||cloudDirty||cloudBusy||cloudTimer)return;
  try{
    const {data,error}=await sb.from(CLOUD_TABLE).select('state,updated_at').eq('user_id',cloudUser.id).maybeSingle();
    if(error)throw error;const at=Date.parse(data?.updated_at||'')||0;
    if(data?.state?.curriculumId===CURRICULUM_ID&&at>cloudUpdatedAt){S=normalizeState(data.state);cloudUpdatedAt=at;saveLocal();setPill('ok');render();}
  }catch(e){setPill('off',e.message||String(e));}
}
async function initCloud(){
  if(!sb){setPill('off','Supabase client did not load. Local saving is still available.');return;}
  try{
    const {data,error}=await sb.auth.getSession();if(error)throw error;
    cloudUser=data.session?.user||null;
    if(cloudUser){await cloudLoadOrSeed();cloudSubscribe();}else setPill('dev');
    sb.auth.onAuthStateChange((_event,session)=>{
      const next=session?.user||null;if(next?.id===cloudUser?.id)return;cloudUser=next;
      if(cloudUser)setTimeout(()=>cloudLoadOrSeed().then(cloudSubscribe).then(render),0);
      else{cloudReady=false;cloudDirty=false;if(cloudChannel){sb.removeChannel(cloudChannel);cloudChannel=null;}setPill('dev');render();}
    });
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudUser){if(cloudDirty)cloudSave();else cloudPullLatest();}});
    window.addEventListener('online',()=>{if(cloudUser){if(cloudDirty)cloudSave();else cloudPullLatest();}});
  }catch(e){setPill('off',e.message||String(e));console.error('Cloud init failed',e);}
}

/* Delegated interaction keeps the UI lightweight, as in the JEE OS SPA. */
document.addEventListener('click',async ev=>{
  const el=ev.target.closest('[data-a]');if(!el)return;
  const a=el.dataset.a;
  if(a==='tab')setTab(el.dataset.tab);
  else if(a==='calendar-month'){calendarMonth=el.dataset.month;selectedCalendarDate=calendarMonth+'-01';render();}
  else if(a==='calendar-today'){calendarMonth=localISO().slice(0,7);selectedCalendarDate=localISO();render();}
  else if(a==='calendar-day'){selectedCalendarDate=el.dataset.date;calendarMonth=selectedCalendarDate.slice(0,7);render();}
  else if(a==='subject'){activeSubject=el.dataset.subject;activeTab='chapters';render();}
  else if(a==='play')openPlayer(el.dataset.id);
  else if(a==='close-player')closePlayer();
  else if(a==='auth')authOpen();
  else if(a==='authclose')authClose();
  else if(a==='signin')await authSignIn();
  else if(a==='signup')await authSignUp();
  else if(a==='signout')await authSignOut();
  else if(a==='timer-toggle')toggleTimer();
  else if(a==='timer-reset')resetTimer();
  else if(a==='focus-mode'){document.body.classList.toggle('focus-mode');el.textContent=document.body.classList.contains('focus-mode')?'Exit focus mode':'Focus mode';}
});
document.addEventListener('change',ev=>{
  const el=ev.target;
  if(el.matches('[data-a-check]'))setCheckbox(el.dataset.id,el.dataset.aCheck,el.checked);
  else if(el.id==='startDate'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(el.value)){S.startDate=el.value;S.dailyTargetDate=null;S.dailyTargetId=null;markDirty();render();toast('Daily rotation start date updated.');}
  }else if(el.id==='themeSelect'){
    S.theme=el.value;markDirty();setTheme();render();
  }
});
document.addEventListener('input',ev=>{
  if(ev.target.id==='chapterSearch'){
    searchText=ev.target.value;const pos=ev.target.selectionStart;
    const list=$('.chapter-list');if(list){const filtered=allChapters().filter(c=>(activeSubject==='all'||c.subject===activeSubject)&&(!searchText||c.name.toLowerCase().includes(searchText.toLowerCase())));list.innerHTML=filtered.map(chapterRow).join('')||'<div class="empty-state">No chapters match your search.</div>';}
    const again=$('#chapterSearch');if(again){again.focus();again.setSelectionRange(pos,pos);}
  }
});
$('#player')?.addEventListener('click',ev=>{if(ev.target.id==='player')closePlayer();});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&$('#player')?.classList.contains('on'))closePlayer();});
async function boot(){
  try{
    const r=await fetch('/tracker.json',{cache:'no-store'});if(!r.ok)throw new Error('tracker.json not found');
    SEED=await r.json();
    if(SEED.curriculumId!==CURRICULUM_ID||!Array.isArray(SEED.chapters)||SEED.chapters.length!==116)throw new Error('Curriculum validation failed');
  }catch(e){$('#app').innerHTML=`<div class="card err"><h2>Could not load curriculum</h2><p>${esc(e.message)}. Start the app using start.bat.</p></div>`;setPill('off',e.message);return;}
  try{
    const raw=localStorage.getItem(STORAGE_KEY);S=raw?normalizeState(JSON.parse(raw)):defaultState();saveLocal();
  }catch(e){S=defaultState();saveLocal();}
  const todayItem=chapterForDate(localISO()).chapter;
  if(todayItem){
    const tp=progressOf(todayItem.id);
    if(tp.lectureDone&&tp.practiceDone)S.studyLog[localISO()]='complete';
    else if(tp.lectureDone||tp.practiceDone)S.studyLog[localISO()]='partial';
  }
  calendarMonth=localISO().slice(0,7);selectedCalendarDate=localISO();
  setTheme();render();await initCloud();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
