import { canDecide, decisionProtection, mayHideCandidate } from './decision-rules.js';

const API = '/api/decisions';
const MOBILE_URL = 'https://job-calendar-private.rachel7802.chatgpt.site/#decisions';
const MOBILE_API = 'https://job-calendar-private.rachel7802.chatgpt.site/api/decisions';
const SIGNIN_URL = 'https://job-calendar-private.rachel7802.chatgpt.site/signin-with-chatgpt?return_to=%2F%23decisions';
let currentChoices = [];
let currentCanEdit = false;
let saveChoiceFn = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokyoToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day = s => String(s || '').slice(0,10);
const tokyoNowKey = () => {
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const v = Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
};
const fmt = s => {
  if (!s) return '日期待核';
  const d = day(s).split('-');
  return `${Number(d[1])}/${Number(d[2])}${String(s).length > 10 ? ` ${String(s).slice(11,16)}` : ''}`;
};

function dateSessions(op) {
  const entries = (op.registrationSessions || []).map(s => ({
    id: s.id || (s.eventStart ? `${op.id}::${s.eventStart}` : null),
    start: s.eventStart || null, end: s.eventEnd || null,
    deadline: s.deadline || null, label: s.bookingStage || s.registrationStatus || '', source:s
  }));
  if (!entries.length) for (const m of op.milestones || []) if (m.type === 'event') entries.push({
    id: m.date ? `${op.id}::${m.date}` : null, start: m.date || null, end: m.endDate || null, deadline: null, label: m.label || '', source:m
  });
  if (!entries.length) entries.push({id:null,start:null,end:null,deadline:null,label:'尚无公布场次'});
  const now=tokyoNowKey(), today=tokyoToday();
  const selectable = entries.filter(s=>{
    const source=s.source||{};
    const state=String(source.availabilityState||source.availabilityStatus||source.registrationStatus||source.bookingStage||'').toLowerCase();
    const closed=/closed|unavailable|ended|full|受付終了|満席|締切|開催終了|受付終了/.test(state);
    const waitlist=source.waitlistOpen===true||source.waitlist===true||/waitlist|キャンセル待ち|候补/.test(state);
    if(closed&&!waitlist)return false;
    const end=s.end||s.start;
    if(end && (String(end).length>10 ? end<=now : day(end)<today))return false;
    if(s.deadline && (String(s.deadline).length>10 ? s.deadline<=now : day(s.deadline)<today))return false;
    return true;
  }).map(s=>({...s,selectable:true}));
  return selectable.length ? selectable : entries.map(s=>({...s,selectable:false,label:`已关闭、已结束或截止；不可选${s.label?` · ${s.label}`:''}`}));
}
function opSortDate(op) {
  const dates=[...(op.registrationSessions||[]).flatMap(s=>[s.deadline,s.eventStart]),...(op.milestones||[]).filter(m=>['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline','event'].includes(m.type)&&!m.completed).map(m=>m.type==='event'?(m.endDate||m.date):m.date)].filter(Boolean).map(String).sort();
  return dates[0] || '9999-99-99';
}
function exactDeadline(op) {
  const ds = (op.registrationSessions || []).map(s => s.deadline).filter(Boolean);
  const ms = (op.milestones || []).filter(m => ['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline'].includes(m.type) && m.date && !m.completed).map(m => m.date);
  const all = [...ds,...ms].sort();
  return all.length ? fmt(all[0]) : '未公布／未核实';
}
function displayWhen(s) { return s ? `${fmt(s.start)}${s.end ? `–${fmt(s.end)}` : ''}` : '场次待公布'; }
function choiceLabel(choice) { return ({interested:'想参加',declined:'不参加',later:'再想想'}[choice]||'尚未选择'); }
function formatUpdatedAt(value) {
  if(!value)return '时间未记录';
  const d=new Date(value);
  return Number.isNaN(d.valueOf())?String(value):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)+' JST';
}
function nextStep(op) {
  const text = String(op.nextAction || '').replace(/https?:\/\/\S+/g,'').trim();
  return text || '确认是否参加；意向不会自动完成预约。';
}
function conflict(op) {
  if (op.decisionContext) return String(op.decisionContext);
  const text = `${op.nextAction || ''} ${op.notes || ''} ${op.statusDetail || ''}`;
  const sentence = text.split(/[。；]/).find(s => /冲突|重叠|无缓冲|通勤|上课|兼职/.test(s));
  return sentence || '当前记录未注明明确冲突';
}

export function shouldHideCandidateFromPlans(opportunity) {
  // Archived public references are retained in the source, not as personal tasks.
  if (opportunity?.decisionEligible === false) return true;
  const saved = currentChoices.find(c=>c.id===opportunity?.id);
  return mayHideCandidate(opportunity,saved?.choice,tokyoToday());
}
function announceChoicesChanged() { window.dispatchEvent(new CustomEvent('decisionschange')); }

export async function mountDecisions(data) {
  const root = document.querySelector('#decision-list');
  const status = document.querySelector('#decision-status');
  const access = document.querySelector('#decision-access');
  const toggle = document.querySelector('#decisions-toggle');
  const content = document.querySelector('#decisions-content');
  if (!root || !data?.opportunities) return;
  let choices = [];
  let canEdit = false;
  let signedIn = false;
  let apiReady = false;
  let loadAttempted = false;
  let retrying = false;
  let writing = false;
  let undoStack = [];
  let deckIndex = 0;
  let reviewId = null;
  let isOpen = location.hash === '#decisions';
  let lastLoadedAt = 0;
  const today = tokyoToday();
  const candidates = data.opportunities.filter(op => canDecide(op,today)).sort((a,b)=>{
    const ad=opSortDate(a),bd=opSortDate(b);
    if(ad!==bd)return ad.localeCompare(bd);
    const priority=o=>/Brother|MCD3/i.test(o.company||'')&&/有意|希望|预登记|先听/i.test(o.decisionContext||'')?0:1;
    return priority(a)-priority(b)||String(a.company||'').localeCompare(String(b.company||''));
  });
  content.hidden = !isOpen;
  toggle?.setAttribute('aria-expanded',String(isOpen));
  if (toggle) toggle.textContent = isOpen ? '收起待决定' : '展开待决定';

  function accessMarkup() {
    if (!apiReady && !loadAttempted) return '<p class="decision-access-note">正在连接账号，读取已保存的选择…</p>';
    if (!apiReady) return `<p class="decision-access-note">暂时无法连接选择同步。可重试，或前往<a href="${MOBILE_URL}">手机站管理选择</a>。当前选择未保存在此设备。</p>`;
    if (canEdit) return '<p class="decision-access-note">选择将保存到账号，可在其他设备继续查看。</p>';
    if (!signedIn) return `<p class="decision-access-note">登录后可管理选择。<a href="${SIGNIN_URL}">使用 ChatGPT 登录</a> · <a href="${MOBILE_URL}">手机站</a></p>`;
    return `<p class="decision-access-note">当前账号可查看选择，但没有编辑权限。<a href="${MOBILE_URL}">前往手机站</a></p>`;
  }
  function choiceFor(id) { return choices.find(c => c.id === id) || null; }
  function cardHtml(op,saved) {
    const sessions=dateSessions(op), selected=sessions.some(s=>s.id===saved?.sessionId)?(saved?.sessionId||''):(sessions.length===1?(sessions[0].id||''):'');
    const selectable=sessions.some(s=>s.selectable);
    const sessionPicker=sessions.length>1?`<label class="decision-session-label"><span>选择场次</span><select data-session-for="${esc(op.id)}"><option value="">先选择场次</option>${sessions.map(s=>`<option value="${esc(s.id||'')}" ${selected===(s.id||'')?'selected':''} ${!s.selectable?'disabled':''}>${esc(displayWhen(s))}${s.label?` · ${esc(s.label)}`:''}</option>`).join('')}</select></label>`:`<div class="decision-session"><b>可选场次</b><span>${esc(displayWhen(sessions[0]))}${sessions[0].label ? ` · ${esc(sessions[0].label)}` : ''}</span></div>`;
    const savedLabel=saved?({interested:'想参加 · 已记录为意向',declined:'不参加 · 已记录',later:'再想想 · 已记录'}[saved.choice]||''):'尚未选择';
    const platformOnly=/DENSO/i.test(op.company||'')&&/受理|応募済/.test(String(op.status||''));
    return `<article class="decision-card" tabindex="0" data-decision-card="${esc(op.id)}" aria-label="${esc(op.company)} ${esc(op.title)}，左右方向键或左右滑动可快速选择">
      <div class="decision-card-head"><div><span class="decision-company">${esc(op.company)}</span><h3>${esc(op.title)}</h3></div><span class="decision-current">${esc(savedLabel)}</span></div>
      <div class="decision-facts">${sessionPicker}<div class="decision-fact"><b>报名截止</b><span>${esc(exactDeadline(op))}</span></div><div class="decision-fact"><b>当前状态</b><span>${esc(op.status||'状态待核')}</span></div><div class="decision-fact"><b>冲突／说明</b><span>${esc(conflict(op))}</span></div><div class="decision-fact"><b>下一步</b><span>${esc(platformOnly&&saved?.choice==='declined'?'DENSO平台申请已受理；选择不参加只记录意向，后续手续仍需确认。':nextStep(op))}</span></div></div>
      ${!selectable?'<p class="decision-protection">没有仍开放的可选场次；保留记录供查看，不可选择想参加。</p>':''}
      <div class="decision-actions"><button type="button" data-choice="declined" data-id="${esc(op.id)}" ${!canEdit||writing?'disabled':''}>不参加</button><button type="button" data-choice="later" data-id="${esc(op.id)}" ${!canEdit||writing?'disabled':''}>再想想</button><button type="button" data-choice="interested" data-id="${esc(op.id)}" ${!canEdit||writing||!selectable?'disabled':''}>想参加</button></div>
      ${saved&&canEdit?`<button class="decision-undo" data-undo="${esc(op.id)}" type="button">撤销此选择</button>`:''}</article>`;
  }
  function render() {
    access.innerHTML = accessMarkup();
    const decided = new Map(choices.map(c => [c.id,c]));
    const pending=candidates.filter(op=>!decided.has(op.id));
    const selected=reviewId?candidates.find(o=>o.id===reviewId):pending[Math.min(deckIndex,Math.max(0,pending.length-1))];
    const pos=selected&&!reviewId?pending.findIndex(o=>o.id===selected.id)+1:0;
    let html='';
    if(selected){
      html+=reviewId?`<div class="decision-deck-nav"><button type="button" data-review-close>返回待决定</button><span>查看已保存选择</span></div>`:`<div class="decision-deck-nav"><button type="button" data-deck-nav="prev" ${pos<=1?'disabled':''}>上一项</button><span>第 ${pos} / ${pending.length} 项</span><button type="button" data-deck-nav="next" ${pos>=pending.length?'disabled':''}>下一项</button></div>`;
      html+=cardHtml(selected,decided.get(selected.id));
    } else html+='<p class="decision-empty">待决定项目已处理完。</p>';
    const history=choices.filter(c=>candidates.some(o=>o.id===c.id));
    if(history.length)html+=`<details class="decision-history"><summary>已选择／历史恢复（${history.length}）</summary>${history.map(c=>{const op=candidates.find(o=>o.id===c.id);return `<div class="decision-history-row"><button class="decision-history-project" type="button" data-id="${esc(c.id)}">${esc(op?`${op.company} · ${op.title}`:c.id)} · ${esc(choiceLabel(c.choice))} · ${esc(formatUpdatedAt(c.updatedAt))}</button>${canEdit?`<button type="button" data-review="${esc(c.id)}">查看／修改</button><button type="button" data-restore="${esc(c.id)}">恢复到待决定</button>`:''}</div>`;}).join('')}</details>`;
    root.innerHTML=html;
  }
  async function load() {
    if (writing) return;
    retrying = true; status.textContent = '正在读取账号选择…';
    try {
      const sameOrigin = location.origin === new URL(MOBILE_URL).origin;
      let r = await fetch(sameOrigin ? API : MOBILE_API,{headers:{Accept:'application/json'},credentials:sameOrigin?'same-origin':'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if (!sameOrigin && !r.ok) throw new Error(`手机站读取 HTTP ${r.status}`);
      if (sameOrigin && !r.ok && r.status !== 401 && r.status !== 403 && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      if (sameOrigin && r.status === 404) r = await fetch(MOBILE_API,{headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      choices = Array.isArray(payload.choices) ? payload.choices : [];
      currentChoices = choices;
      canEdit = sameOrigin && payload.canEdit === true; signedIn = sameOrigin && payload.signedIn === true; apiReady = true;
      currentCanEdit = canEdit;
      lastLoadedAt = Date.now();
      announceChoicesChanged();
      status.textContent = canEdit ? `已同步 ${choices.length} 项选择` : '选择只读';
    } catch (error) {
      apiReady = false; canEdit = false;
      status.textContent = `无法同步选择（${error.message}）。可重试；不会在本地伪保存。`;
    } finally { loadAttempted = true; retrying = false; render(); }
  }
  async function save(id, choice) {
    if (!canEdit || writing || retrying) return false;
    const op = candidates.find(o => o.id === id); if (!op) return;
    const sessionSelect = root.querySelector(`[data-session-for="${CSS.escape(id)}"]`);
    const sessions = dateSessions(op);
    const sessionId = sessionSelect ? sessionSelect.value || null : (sessions.length === 1 && sessions[0].selectable ? sessions[0].id : null);
    if (choice === 'interested' && sessions.length > 1 && !sessionId) { status.textContent = '想参加前，请先选择一个具体场次。'; sessionSelect?.focus(); return false; }
    const previous = choiceFor(id);
    writing = true;
    status.textContent = '正在保存…';
    root.querySelectorAll('[data-choice],[data-undo],[data-restore]').forEach(b=>b.disabled=true);
    try {
      const r = await fetch(API,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id,choice,sessionId})});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      if (!Array.isArray(payload.choices)) throw new Error('服务器未返回完整选择列表');
      undoStack.push({id,previous}); choices = payload.choices; currentChoices = choices;
      canEdit = payload.canEdit === true; signedIn = payload.signedIn === true; apiReady = true;
      currentCanEdit = canEdit;
      status.textContent = '已保存到账号；未更改预约状态。';
      if(reviewId===id)reviewId=null;
      writing = false; render();
      announceChoicesChanged();
      return true;
    } catch (error) {
      status.textContent = `保存失败（${error.message}）。选择没有更新，请重试。`;
      writing = false; render();
      return false;
    }
  }
  async function undo(id) {
    if (!canEdit||writing||retrying) return;
    const op = candidates.find(o=>o.id===id); const prev=undoStack.slice().reverse().find(x=>x.id===id)?.previous || null;
    if (!op) return;
    writing=true; root.querySelectorAll('[data-choice],[data-undo],[data-restore]').forEach(b=>b.disabled=true);
    const sessionId = prev?.sessionId || null;
    try {
      const r=await fetch(API,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id,choice:prev?.choice||null,sessionId})});
      if(!r.ok)throw new Error(`HTTP ${r.status}`); const payload=await r.json(); if(!Array.isArray(payload.choices))throw new Error('服务器未返回完整选择列表');
      choices=payload.choices; currentChoices=choices; undoStack=undoStack.filter(x=>x.id!==id); if(!prev)reviewId=null; status.textContent='已撤销并同步。'; writing=false; render(); announceChoicesChanged();
    }catch(error){status.textContent=`撤销失败（${error.message}）。选择没有更新，请重试。`;writing=false;render();}
  }
  async function restore(id) {
    if (!canEdit||writing||retrying) return;
    writing=true; root.querySelectorAll('[data-choice],[data-undo],[data-restore]').forEach(b=>b.disabled=true);
    try {
      const r=await fetch(API,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id,choice:null,sessionId:null})});
      if(!r.ok)throw new Error(`HTTP ${r.status}`); const payload=await r.json(); if(!Array.isArray(payload.choices))throw new Error('服务器未返回完整选择列表');
      choices=payload.choices; currentChoices=choices; reviewId=null; status.textContent='已恢复到待决定，并同步到账号。'; writing=false; render(); announceChoicesChanged();
    }catch(error){status.textContent=`恢复失败（${error.message}）。选择没有更新，请重试。`;writing=false;render();}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-choice]'); if(b){e.stopPropagation();save(b.dataset.id,b.dataset.choice);return;}
    const u=e.target.closest('[data-undo]'); if(u){e.stopPropagation();undo(u.dataset.undo);return;}
    const r=e.target.closest('[data-restore]'); if(r){e.stopPropagation();restore(r.dataset.restore);}
    const rv=e.target.closest('[data-review]'); if(rv){e.stopPropagation();reviewId=rv.dataset.review;render();return;}
    if(e.target.closest('[data-review-close]')){e.stopPropagation();reviewId=null;render();return;}
    const nav=e.target.closest('[data-deck-nav]'); if(nav){e.stopPropagation();const decided=new Set(choices.map(c=>c.id)),pending=candidates.filter(o=>!decided.has(o.id));deckIndex=Math.max(0,Math.min(pending.length-1,deckIndex+(nav.dataset.deckNav==='next'?1:-1)));render();}
  });
  root.addEventListener('keydown',e=>{
    const card=e.target.closest('[data-decision-card]');
    if (!card || e.target.closest('button,select')) return;
    if (e.key==='ArrowLeft'){e.preventDefault();save(card.dataset.decisionCard,'declined');}
    if (e.key==='ArrowRight'){e.preventDefault();save(card.dataset.decisionCard,'interested');}
  });
  let pointer=null;
  root.addEventListener('pointerdown',e=>{const card=e.target.closest('[data-decision-card]');if(!card||e.target.closest('button,select'))return;pointer={card,x:e.clientX,y:e.clientY,dx:0,locked:false,canceled:false,pointerId:e.pointerId};try{card.setPointerCapture(e.pointerId);}catch{}});
  root.addEventListener('pointermove',e=>{if(!pointer||e.pointerId!==pointer.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.max(Math.abs(dx),Math.abs(dy))>12&&!pointer.locked){if(Math.abs(dx)>Math.abs(dy))pointer.locked=true;else pointer.canceled=true;}if(pointer.locked&&!pointer.canceled){e.preventDefault();pointer.dx=dx;pointer.card.style.setProperty('--swipe-x',`${dx}px`);}});
  const endSwipe=e=>{if(!pointer||e.pointerId!==pointer.pointerId)return;const p=pointer;pointer=null;p.card.style.removeProperty('--swipe-x');if(!p.canceled&&p.locked&&Math.abs(p.dx)>=80)save(p.card.dataset.decisionCard,p.dx>0?'interested':'declined');};
  root.addEventListener('pointerup',endSwipe);root.addEventListener('pointercancel',e=>{if(pointer&&e.pointerId===pointer.pointerId){pointer.card.style.removeProperty('--swipe-x');pointer=null;}});
  saveChoiceFn = save;
  document.querySelector('#decision-retry')?.addEventListener('click',()=>{if(!retrying)load();});
  const refreshIfStale=()=>{if(!retrying&&Date.now()-lastLoadedAt>3000)load();};
  window.addEventListener('focus',refreshIfStale);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshIfStale();});
  toggle?.addEventListener('click',()=>{isOpen=!isOpen;content.hidden=!isOpen;toggle.setAttribute('aria-expanded',String(isOpen));toggle.textContent=isOpen?'收起待决定':'展开待决定';});
  document.querySelectorAll('a[href="#decisions"]').forEach(link=>link.addEventListener('click',()=>{isOpen=true;content.hidden=false;toggle?.setAttribute('aria-expanded','true');if(toggle)toggle.textContent='收起待决定';}));
  window.addEventListener('hashchange',()=>{if(location.hash==='#decisions'){isOpen=true;content.hidden=false;toggle?.setAttribute('aria-expanded','true');if(toggle)toggle.textContent='收起待决定';}});
  render();
  await load();
}

export function appendDecisionDetail(op, container) {
  if (op.decisionEligible === false) return;
  const protection = decisionProtection(op,tokyoToday());
  const saved = currentChoices.find(c=>c.id===op.id);
  const box = document.createElement('section');
  box.className = 'detail-section decision-detail';
  box.innerHTML = `<h3>参与意向</h3>${protection.protected
    ? `<p class="decision-protection">此项目受保护：${esc(protection.reason)}。状态不会被参与意向覆盖。</p>`
    : `<p class="decision-detail-current">${esc(saved ? ({interested:'想参加（已记录为意向）',declined:'不参加（已记录）',later:'再想想（已记录）'}[saved.choice] || '尚未选择') : '尚未选择')}</p>
       <p class="decision-detail-tip">选择只记录意向，不改变报名状态。未提交候选选择“不参加”后会从计划视图隐藏；已提交、已受理或已预约安排会保留。</p>
       <p><a href="#decisions" data-go-decisions>前往待你决定卡片选择场次</a></p>
       <div class="decision-actions"><button type="button" data-detail-choice="declined" ${!currentCanEdit?'disabled':''}>不参加</button><button type="button" data-detail-choice="later" ${!currentCanEdit?'disabled':''}>再想想</button><button type="button" data-detail-choice="interested" ${!currentCanEdit?'disabled':''}>想参加</button></div>`}`;
  box.addEventListener('click',e=>{const link=e.target.closest('[data-go-decisions]');if(link){e.preventDefault();container.closest('dialog')?.close();const content=document.querySelector('#decisions-content'),toggle=document.querySelector('#decisions-toggle');if(content)content.hidden=false;if(toggle){toggle.setAttribute('aria-expanded','true');toggle.textContent='收起待决定';}location.hash='#decisions';requestAnimationFrame(()=>document.querySelector('#decisions')?.scrollIntoView({behavior:'smooth'}));return;}const b=e.target.closest('[data-detail-choice]');if(b&&saveChoiceFn){e.stopPropagation();saveChoiceFn(op.id,b.dataset.detailChoice).then(ok=>{if(ok){const line=box.querySelector('.decision-detail-current');if(line){const choice=currentChoices.find(c=>c.id===op.id);line.textContent=choice?({interested:'想参加（已记录为意向）',declined:'不参加（已记录）',later:'再想想（已记录）'}[choice.choice]||'尚未选择'):'尚未选择';}}});}});
  container.append(box);
}
