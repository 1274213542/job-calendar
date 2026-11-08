import { canDecide, mayHideCandidate, sessionChoiceMode, decisionExpiry } from './decision-rules.js?v=20261107-minimal';
import { decisionSessionContext } from './schedule.js?v=20261107-minimal';
import { loadDecisionCompanyData, renderDecisionCompany, renderCompanyCompareLink } from './decision-company.js?v=20261107-minimal';

const API = '/api/decisions';
const MOBILE_URL = 'https://job-calendar-private.rachel7802.chatgpt.site/#decisions';
const MOBILE_API = 'https://job-calendar-private.rachel7802.chatgpt.site/api/decisions';
const CLOUD_URL = new URL('/?sync=account#decisions', MOBILE_URL).href;
const CLOUD_RETURN = encodeURIComponent('/?sync=account#decisions');
const DEVICE_KEY = 'job-calendar-device-decisions-v1';
let currentChoices = [];
let openChoiceCard = null;
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
  return `${d[0]!==tokyoToday().slice(0,4)?`${d[0]}/`:''}${Number(d[1])}/${Number(d[2])}${String(s).length > 10 ? ` ${String(s).slice(11,16)}` : ''}`;
};

export function dateSessions(op) {
  const mode = sessionChoiceMode(op);
  const events = (op.milestones || []).filter(m => m.type === 'event');
  if (mode === 'project_schedule') return [{id:null,start:null,end:null,selectable:true,
    projectEvents:events,label:'项目日程'}];
  const entries = (op.registrationSessions || []).map(source => ({
    id:source.id || (source.eventStart ? `${op.id}::${source.eventStart}` : null),
    start:source.eventStart || null,end:source.eventEnd || null,deadline:source.deadline || null,
    label:source.bookingStage || source.registrationStatus || '',source
  }));
  if (!entries.length) for (const m of events) entries.push({id:m.date ? `${op.id}::${m.date}` : null,
    start:m.date || null,end:m.endDate || null,deadline:null,label:m.label || '',source:m});
  if (!entries.length) entries.push({id:null,start:null,end:null,deadline:null,label:'项目意向'});
  const now=tokyoNowKey(),today=tokyoToday();
  return entries.map(session => {
    const source=session.source || {};
    const state=String(source.availabilityState || source.availabilityStatus || source.registrationStatus || '').toLowerCase();
    const closed=/closed|unavailable|ended|full|受付終了|満席|締切|開催終了/.test(state);
    const waitlist=source.waitlistOpen===true || source.waitlist===true || /waitlist|キャンセル待ち|候补/.test(state);
    const end=session.end;
    const ended=end ? (String(end).length>10 ? end.slice(0,16)<=now : day(end)<today) : session.start && day(session.start)<today;
    const cutoff=waitlist ? source.waitlistDeadline : session.deadline;
    const passed=cutoff && (String(cutoff).length>10 ? cutoff.slice(0,16)<=now : day(cutoff)<today);
    const future=source.opensAt && (source.opensAt.length>10 ? source.opensAt.slice(0,16)>now : day(source.opensAt)>today);
    const booked=source.availabilityState==='booked' || /^已预约|^已确认参加/.test(source.bookingStage || '');
    const availability=ended ? '已结束' : booked ? '已预约此场' : passed || (closed&&!waitlist) ? '报名已关闭' : future ? '未开放'
      : waitlist ? '仅候补登记' : /form_available/.test(state) ? '余位待核' : /open|available/.test(state) ? '报名中' : '受理情况待核';
    return {...session,selectable:!(ended || passed || (closed&&!waitlist)),booked,availability};
  });
}

function sessionContext(op, selected, data) {
  if (!selected?.projectEvents) return decisionSessionContext(op,selected,data);
  const contexts=selected.projectEvents.map(m => decisionSessionContext(op,{start:m.date,end:m.endDate,source:m},data));
  const formats=[...new Set(contexts.map(c=>c.format))];
  const unique=new Map(contexts.flatMap(c=>c.conflicts).map(c=>[`${c.otherId}|${c.start}|${c.end}|${c.group}|${c.selfStart}`,c]));
  return {format:formats.length===1?formats[0]:'各阶段形式见日程',conflicts:[...unique.values()],
    notices:[...new Set(contexts.flatMap(c=>c.notices))]};
}

function reapplicationPanel(op) {
  if (op.category!=='selection') return '';
  const rule=op.reapplication;
  return `<section class="decision-reapply"><b>再次申请</b><p>${esc(rule?.summary || '待确认')}</p>
    ${rule?.sources?.length ? `<details><summary>查看依据</summary><p>${esc(rule.scope || '')}</p>${rule.sources.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)}</a>`).join(' · ')}</details>` : ''}</section>`;
}


function opSortDate(op) {
  const dates=[...(op.registrationSessions||[]).flatMap(s=>[s.deadline,s.eventStart]),...(op.milestones||[]).filter(m=>['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline','event'].includes(m.type)&&!m.completed).map(m=>m.type==='event'?(m.endDate||m.date):m.date)].filter(Boolean).map(String).sort();
  return dates[0] || '9999-99-99';
}
export function decisionDeadline(op, saved) {
  const allSessions = dateSessions(op);
  const sessions = allSessions.filter(session => session.selectable &&
    (!saved?.sessionId || session.id === saved.sessionId));
  const nodes = op.milestones || [];
  const sessionDates = sessions.filter(session => !session.source?.deadlineCompleted && !session.source?.requiresVerification &&
    !nodes.some(node => node.completed && node.date === session.deadline &&
      (!session.source?.deadlineLabel || node.label === session.source.deadlineLabel))).map(session =>
        session.source?.waitlistOpen || session.source?.waitlist ? session.source.waitlistDeadline : session.deadline);
  const milestoneDates = nodes.filter(node =>
    ['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline'].includes(node.type) &&
    !node.completed && !node.requiresVerification &&
    (!allSessions.some(session => session.deadline === node.date) || sessions.some(session => session.deadline === node.date)))
    .map(node => node.date);
  return [...sessionDates,...milestoneDates].filter(date =>
    /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(date || '')) && !pastDate(date)).sort()[0] || null;
}

export function compareDecisionDeadlines(a, b, direction = 'soonest', choices = []) {
  const left = decisionDeadline(a, choices.find(choice => choice.id === a.id));
  const right = decisionDeadline(b, choices.find(choice => choice.id === b.id));
  if (!left || !right) {
    if (left) return -1;
    if (right) return 1;
  } else {
    const order = left.localeCompare(right);
    if (order) return direction === 'latest' ? -order : order;
  }
  return String(a.company || '').localeCompare(String(b.company || ''), 'zh-CN') ||
    String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
}
function displayWhen(s) {
  if (!s?.start) return '场次待公布';
  if (!s.end) return fmt(s.start) + (String(s.start).length > 10 ? '（结束时间待核）' : '');
  const end = day(s.start) === day(s.end) && String(s.end).length > 10 ? String(s.end).slice(11,16) : fmt(s.end);
  return `${fmt(s.start)}–${end}`;
}
export function opportunityType(op) {
  const title = op.title || '';
  const subtype = op.subtype || '';
  const description = `${subtype} ${title}`;
  const workshop = /工作坊|ワークショップ|workshop/i;
  if (op.category === 'selection') {
    if (/预登记|プレエントリー/.test(description)) return {label:'预登记',tone:'registration'};
    if (/适(?:性|应性)测试|適性検査/.test(description)) return {label:'适性测试',tone:'selection'};
    if (/实习选考面试|インターン.*面接/.test(description)) return {label:'实习面试',tone:'internship'};
    if (/早期选考|早期選考/.test(description)) return {label:'早期选考',tone:'selection'};
    if (/作品集联合选考/.test(description)) return {label:'作品集选考',tone:'selection'};
    if (/本选考|本選考|通常選考/.test(description)) return {label:'本选考',tone:'selection'};
    return {label:'选考',tone:'selection'};
  }
  if (op.category === 'internship') {
    if (workshop.test(title) || (workshop.test(subtype) && !/实习|インターン/.test(subtype))) return {label:'工作坊',tone:'workshop'};
    if (/体验|体験/.test(title)) return {label:'职场体验',tone:'workshop'};
    return {label:'实习',tone:'internship'};
  }
  if (op.category === 'activity') {
    if (/说明会|説明会/.test(title)) return {label:'说明会',tone:'briefing'};
    if (/面谈|面談/.test(title)) return {label:'面谈',tone:'conversation'};
    if (/咨询|相談/.test(title) && /作品集|ポートフォリオ/.test(title)) return {label:'作品集咨询',tone:'portfolio'};
    if (/作品集.*(?:反馈|建议|advice)|作品建议|ポートフォリオ.*(?:講評|添削)/i.test(title)) return {label:'作品集反馈',tone:'portfolio'};
    if (workshop.test(title)) return {label:'工作坊',tone:'workshop'};
    if (/座谈|座談/.test(title)) return {label:'座谈',tone:'conversation'};
    if (/讲座|講座|セミナー|seminar/i.test(title)) return {label:'讲座',tone:'briefing'};
    if (/^(?:公司设计说明会|设计职说明会)$/.test(subtype)) return {label:'说明会',tone:'briefing'};
    return {label:'招聘活动',tone:'neutral'};
  }
  return {label:'其他事项',tone:'neutral'};
}

function typeTag({label,tone}) {
  return `<span class="decision-type decision-type-${tone}">${esc(label)}</span>`;
}

function choiceLabel(choice, op) {
  if (choice === 'interested') return op?.category === 'selection' ? '申请意向' : '参加意向';
  return ({declined:op?.category==='selection'?'不申请':'不参加',later:'再想想'}[choice] || '尚未选择');
}

function internshipOpeningNote(op) {
  if (op.category !== 'internship') return '';
  const now = tokyoNowKey();
  const upcoming = (op.milestones || []).find(m => m.type === 'open' && !m.completed && m.date &&
    (m.date.length > 10 ? m.date > now : m.date > day(now)));
  if (upcoming) return `${fmt(upcoming.date)}`;
  if (/即将开放|尚未开放|报名未开放|仅预告/.test([op.subtype,op.status,op.statusDetail].join(' '))) {
    return '待公布';
  }
  return '';
}

function formatUpdatedAt(value) {
  if(!value)return '时间未记录';
  const d=new Date(value);
  return Number.isNaN(d.valueOf())?String(value):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)+' JST';
}
function pastDate(value) {
  return value && (String(value).length>10 ? String(value).slice(0,16)<=tokyoNowKey() : day(value)<tokyoToday());
}
function shortStage(op) {
  if (decisionExpiry(op,tokyoToday()).expired) return '已过期';
  const status=String(op.status || '');
  if (/已预约|预约完成|已确认参加/.test(status)) return '已预约';
  if (/已录取/.test(status)) return '已录取';
  if (/已入选/.test(status)) return '已入选';
  if (/已提交/.test(status)) return '已提交';
  if (/已受理/.test(status)) return '已受理';
  if (/待结果/.test(status)) return '待结果';
  if (internshipOpeningNote(op)) return '待开放';
  if (/预Entry|预登记|已Entry|MyPage已登记/i.test(`${status} ${op.statusDetail || ''}`)) return '预登记';
  return '未申请';
}
function nextStep(op) {
  const text = String(op.nextAction || '').replace(/https?:\/\/\S+/g,'').trim();
  return text || '确认项目内容和报名方式。';
}

export function conflictPanel({conflicts, notices}, companyData, ownTime) {
  const groups=[['confirmed','已约冲突'],['buffer','衔接紧凑'],['coordination','学校／兼职'],['conditional','候选冲突'],['unknown','待核实']];
  const rowHtml=c=>`<li class="decision-conflict-row decision-conflict-${esc(c.tone)}">
    <div class="decision-conflict-name">${esc([c.company,c.title].filter(Boolean).join(' · '))}</div>
    <dl class="decision-time-pair"><div><dt>本项目</dt><dd>${esc(c.selfTime || ownTime || '待核')}</dd></div><div><dt>对方</dt><dd>${esc(c.time)}</dd></div></dl>
    <p class="decision-conflict-result"><b>${esc((c.overlapText || c.risk || '').replace('；没有时间重叠',''))}</b></p>
    ${c.stage ? `<p class="decision-conflict-stage">对方状态：${esc(c.stage)}</p>` : ''}
    ${c.trigger ? `<p class="decision-conflict-note">${esc(c.trigger)}</p>` : ''}
    ${c.note ? `<p class="decision-conflict-note">${esc(c.note)}</p>` : ''}
    ${c.company ? `<span class="decision-conflict-company" data-conflict-company="${esc(c.company)}">${renderCompanyCompareLink(c.company,companyData)}</span>` : ''}</li>`;
  const content=groups.map(([key,label])=>{
    const raw=conflicts.filter(c=>(c.group || 'unknown')===key);
    const merged=new Map();
    for (const row of raw) {
      const id=`${row.otherId || row.company || row.title}|${row.stage}`;
      if (!merged.has(id)) merged.set(id,{...row});
      else {
        const existing=merged.get(id);
        if (!existing.time.includes(row.time)) existing.time+='；'+row.time;
        if (!existing.overlapText.includes(row.overlapText)) existing.overlapText+='；'+row.overlapText;
      }
    }
    const rows=[...merged.values()];
    if (!rows.length) return '';
    return `<details class="decision-conflict-group" ${key==='confirmed'?'open':''}><summary>${esc(label)} <span>${rows.length}</span></summary><ul class="decision-conflict-list">${rows.map(rowHtml).join('')}</ul></details>`;
  }).join('');
  return `<section class="decision-conflict"><h4>时间安排</h4>${content || (!notices.length ? '<p class="decision-conflict-lead">未发现冲突</p>' : '')}
    ${notices.length ? `<details class="decision-conflict-group"><summary>待核实</summary>${notices.map(n=>`<p class="decision-conflict-hint">${esc(n)}</p>`).join('')}</details>` : ''}</section>`;
}

function readDeviceChoices() {
  try {
    const records = JSON.parse(localStorage.getItem(DEVICE_KEY) || '[]');
    return Array.isArray(records) ? records.filter(record => typeof record?.id === 'string' && [null,'interested','declined','later'].includes(record.choice)) : [];
  } catch (error) {
    return error instanceof SyntaxError ? [] : null;
  }
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
  const gestureHelp = document.querySelector('.decision-gesture-help');
  if (!root || !data?.opportunities) return;

  const sameOrigin = location.origin === new URL(MOBILE_URL).origin;
  let accountChoices = [];
  let deviceChoices = readDeviceChoices();
  let choices = [];
  let cloudCanEdit = false;
  let signedIn = false;
  let storageMode = new URLSearchParams(location.search).get('sync') === 'account' ? 'account' : 'auto';
  let retrying = false;
  let firstLoadComplete = false;
  let cloudReadFailed = false;
  let writing = false;
  let writeRevision = 0;
  let reviewId = null;
  let listMode = 'pending';
  let sortOrder = 'soonest';
  let archiveOpen = false;
  let confirmingId = null;
  let isOpen = location.hash === '#decisions';
  let lastLoadedAt = 0;
  let feedback = null;
  let pointer = null;
  let wheelGesture = null;
  let companyData = null;
  const undoStack = new Map();
  const draftSessions = new Map();
  const today = tokyoToday();
  const candidates = data.opportunities.filter(op => canDecide(op, today));

  const savesToAccount = () => storageMode === 'account';
  const canSave = () => savesToAccount() ? cloudCanEdit : deviceChoices !== null;
  const saveScope = () => savesToAccount() ? '账号' : '此浏览器';

  function updateChoices() {
    const merged = new Map(accountChoices.map(choice => [choice.id, choice]));
    for (const record of savesToAccount() ? [] : deviceChoices || []) {
      if (record.choice === null) merged.delete(record.id);
      else merged.set(record.id, record);
    }
    choices = [...merged.values()].sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    currentChoices = choices;
    announceChoicesChanged();
  }

  function setOpen(open) {
    isOpen = open;
    content.hidden = !open;
    toggle?.setAttribute('aria-expanded', String(open));
    if (toggle) toggle.textContent = open ? '收起待决定' : '展开待决定';
  }

  function choiceFor(id) { return choices.find(choice => choice.id === id) || null; }

  function selectedSession(op, sessions, saved) {
    if (sessions.length === 1) return sessions[0];
    const id = draftSessions.get(op.id) ?? saved?.sessionId;
    return sessions.find(session => session.id === id);
  }

  function cardHtml(op, saved) {
    const allSessions = dateSessions(op);
    const expired = decisionExpiry(op,today).expired;
    const archivedSessions = allSessions.filter(session=>!session.selectable&&!session.booked);
    const sessions = expired ? allSessions : allSessions.filter(session=>session.selectable || session.booked);
    const selected = selectedSession(op,sessions,saved);
    const selectable = sessions.some(session=>session.selectable);
    const context = sessionContext(op,selected,{...data,opportunities:data.opportunities.filter(item=>!shouldHideCandidateFromPlans(item))});
    const confirmation = confirmingId===op.id;
    const disabled = !canSave() || writing ? 'disabled' : '';
    const openingNote=internshipOpeningNote(op);
    const sessionPicker = selected?.projectEvents
      ? `<div class="decision-project-schedule"><b>项目日程</b><ul>${selected.projectEvents.map(m=>`<li><strong>${esc(displayWhen({start:m.date,end:m.endDate}))}</strong><span>${esc(m.label)}</span></li>`).join('')}</ul></div>`
      : sessions.length>1
      ? `<fieldset class="decision-slot-options"><legend>场次${/同内容|内容相同/.test(op.sessionModel?.note || op.title || '')?' · 同内容':''}</legend>${sessions.map(session=>{
        const c=sessionContext(op,session,{...data,opportunities:data.opportunities.filter(item=>!shouldHideCandidateFromPlans(item))});
        const count=key=>c.conflicts.filter(x=>x.group===key).length;
        const short=[count('confirmed')?`已约冲突 ${count('confirmed')}`:'',count('conditional')?`候选冲突 ${count('conditional')}`:'',count('buffer')?`衔接紧凑 ${count('buffer')}`:'',count('coordination')?'需调班／调整课时':''].filter(Boolean).join(' · ');
        return `<label class="decision-slot ${selected===session?'is-selected':''}"><input type="radio" name="slot-${esc(op.id)}" data-session-for="${esc(op.id)}" value="${esc(session.id || '')}" ${selected===session?'checked':''} ${session.selectable?'':'disabled'}><span><strong>${esc(displayWhen(session))}</strong><span>${esc(c.format)} · ${esc(session.availability)}</span>${short?`<small>${esc(short)}</small>`:''}</span></label>`;
      }).join('')}</fieldset>`
      : selected?.start ? `<div class="decision-session"><b>${op.category==='internship'?'实习期间':'时间'}</b><strong>${esc(displayWhen(selected))}</strong><span>${esc(context.format)}</span></div>`
      : op.category==='selection' ? '' : '<div class="decision-session"><b>时间</b><span>待公布</span></div>';
    const deadlines=(op.milestones || []).filter(m=>['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline'].includes(m.type)&&!m.completed&&m.date);
    const liveDeadlines=deadlines.filter(m=>!pastDate(m.date));
    const pastDeadlines=deadlines.filter(m=>pastDate(m.date));
    const deadlineText=selected?.deadline&&!pastDate(selected.deadline) ? fmt(selected.deadline) : liveDeadlines.length ? liveDeadlines.map(m=>`${fmt(m.date)}${liveDeadlines.length>1?` · ${m.label || '截止'}`:''}`).join('；') : '未公布';
    const type=opportunityType(op);
    const savedLabel=saved?choiceLabel(saved.choice,op):'';
    return `<article class="decision-card" tabindex="0" data-decision-card="${esc(op.id)}" aria-label="${esc(type.label)} ${esc(op.company)} ${esc(op.title)}">
      <div class="decision-card-head"><div><div class="decision-card-meta">${typeTag(type)}<span class="decision-company">${esc(op.company)}</span><span class="decision-stage">${esc(shortStage(op))}</span></div><h3>${esc(op.title)}</h3></div>${savedLabel?`<span class="decision-current">${esc(savedLabel)}</span>`:''}</div>
      ${op.intro?`<p class="decision-intro">${esc(op.intro)}</p>`:''}
      ${sessionPicker}
      <div class="decision-facts">${openingNote&&!expired?`<div class="decision-fact"><b>开放</b><span>${esc(openingNote)}</span></div>`:''}${canDecide(op,today)?`<div class="decision-fact"><b>截止</b><span>${esc(deadlineText)}</span></div>`:''}</div>
      ${reapplicationPanel(op)}
      ${!expired&&selected&&(selected.start||selected.projectEvents)?conflictPanel(context,companyData,displayWhen(selected)):''}
      <details class="decision-reference"><summary>待遇、评价与选考材料</summary><section class="decision-company-context" aria-label="待遇与选考" data-company-context="${esc(op.id)}">${companyData?renderDecisionCompany(op,companyData):'<p>读取中…</p>'}</section></details>
      <details class="decision-next"><summary>报名详情</summary><p>${esc(op.statusDetail || op.status || '')}</p><p>${esc(nextStep(op))}</p>${pastDeadlines.length?`<div class="decision-past-dates"><b>已过截止</b>${pastDeadlines.map(m=>`<p>${esc(fmt(m.date))} · ${esc(m.label)}</p>`).join('')}</div>`:''}</details>
      ${!expired&&archivedSessions.length?`<details class="decision-past-sessions"><summary>已过期场次 ${archivedSessions.length}</summary>${archivedSessions.map(session=>`<p>${esc(displayWhen(session))} · ${esc(session.availability)}</p>`).join('')}</details>`:''}
      <p class="decision-card-feedback" role="status" aria-live="polite">${feedback?.id===op.id?esc(feedback.text):''}</p><span class="decision-swipe-preview" aria-hidden="true"></span>
      ${!canDecide(op,today)?'':confirmation?`<div class="decision-confirmation"><p>保存${choiceLabel('interested',op)}？</p><div class="decision-actions"><button type="button" data-cancel-interest>返回</button><button type="button" data-confirm-interest="${esc(op.id)}" data-confirm-session="${esc(selected?.id || '')}" ${disabled || (!selected?.selectable?'disabled':'')}>保存</button></div></div>`:`<div class="decision-actions"><button type="button" data-choice="declined" data-id="${esc(op.id)}" ${disabled}>${op.category==='selection'?'不申请':'不参加'}</button><button type="button" data-choice="later" data-id="${esc(op.id)}" ${disabled}>稍后</button><button type="button" data-choice="interested" data-id="${esc(op.id)}" ${disabled || (!selectable?'disabled':'')}>${op.category==='selection'?'想申请':openingNote?'关注开放':'想参加'}</button></div>`}
      ${saved&&canSave()&&!expired?`<button class="decision-undo" data-undo="${esc(op.id)}" type="button" ${disabled}>撤销选择</button>`:''}
    </article>`;
  }

  function listItemHtml(op, archived = false) {
    const saved = choiceFor(op.id);
    const expiry = archived ? decisionExpiry(op,today) : null;
    const deadline = archived ? expiry.date : decisionDeadline(op,saved);
    const deadlineLabel = archived ? expiry.label || '已过期' : deadline ? `${fmt(deadline)} 截止` : '截止待公布';
    const expanded = reviewId === op.id;
    return `<div class="decision-list-item ${expanded?'is-expanded':''}">
      <button type="button" class="decision-list-summary" data-expand-decision="${esc(op.id)}" aria-expanded="${expanded}" aria-controls="decision-body-${esc(op.id)}">
        <span class="decision-list-name"><strong>${esc(op.company)}</strong><span>${esc(op.title)}</span></span>
        <span class="decision-list-meta">${typeTag(opportunityType(op))}<span class="decision-list-deadline ${deadline?'':'is-unknown'}">${esc(deadlineLabel)}</span></span>
        <svg class="decision-list-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <div id="decision-body-${esc(op.id)}" class="decision-list-body" ${expanded?'':'hidden'}>${expanded?cardHtml(op,saved):''}</div>
    </div>`;
  }

  function render() {
    const cloudLink = !sameOrigin ? `<a href="${CLOUD_URL}" target="_top">打开云端版</a>`
      : cloudCanEdit ? '<button type="button" data-storage-mode="account">切换到云端</button>'
      : signedIn ? `<a href="/signout-with-chatgpt?return_to=${CLOUD_RETURN}" target="_top">切换为日历所有者账号</a>`
      : `<a href="/signin-with-chatgpt?return_to=${CLOUD_RETURN}" target="_top">连接云端</a>`;
    const note = savesToAccount()
      ? cloudCanEdit ? '保存位置：云端账号'
        : signedIn ? '当前账号缺少这份日历的编辑权限。' : '连接日历所有者账号后，可跨设备同步选择。'
      : deviceChoices !== null ? '保存位置：此设备'
        : '当前浏览器的本地存储不可用。';
    const deviceLink = savesToAccount() && deviceChoices !== null
      ? `<button type="button" data-storage-mode="device">${deviceChoices.length ? '查看本浏览器记录' : '使用本浏览器保存'}</button>` : '';
    access.innerHTML = `<p class="decision-access-note">${esc(note)}</p><div class="decision-access-actions">${savesToAccount() && cloudCanEdit ? '' : cloudLink}${deviceLink}</div>`;
    if (gestureHelp) gestureHelp.hidden = !canSave();
    const pending = candidates.filter(op => !choiceFor(op.id));
    const activeChoices = choices.filter(choice=>data.opportunities.some(item=>item.id===choice.id&&!decisionExpiry(item,today).expired));
    const history = activeChoices.filter(choice=>listMode==='interested'?choice.choice==='interested':choice.choice!=='interested');
    const counts={pending:pending.length,interested:activeChoices.filter(c=>c.choice==='interested').length,other:activeChoices.filter(c=>c.choice!=='interested').length};
    const tabs=`<div class="decision-list-tabs" role="group" aria-label="决定列表">${[['pending','待决定'],['interested','我的意向'],['other','暂缓／不参加']].map(([key,label])=>`<button type="button" data-list-mode="${key}" aria-pressed="${listMode===key}">${label} <span>${counts[key]}</span></button>`).join('')}</div>`;
    const sort=`<label class="decision-sort"><span>排序</span><select data-decision-sort aria-label="按截止时间排序"><option value="soonest" ${sortOrder==='soonest'?'selected':''}>截止最近</option><option value="latest" ${sortOrder==='latest'?'selected':''}>截止最远</option></select></label>`;
    const items=(listMode==='pending' ? pending : history.map(choice=>data.opportunities.find(item=>item.id===choice.id)))
      .sort((a,b)=>compareDecisionDeadlines(a,b,sortOrder,choices));
    let html=items.length ? `<div class="decision-overview">${items.map(item=>listItemHtml(item)).join('')}</div>`
      : `<p class="decision-empty">${!firstLoadComplete?'正在读取…':cloudReadFailed?'云端意向暂未读到，请点「重试」。':listMode==='pending'?'待决定项目已处理完。':'这个列表暂时没有记录。'}</p>`;
    const archived=data.opportunities.filter(item=>['activity','internship','selection'].includes(item.category)&&item.decisionEligible!==false&&decisionExpiry(item,today).expired).sort((a,b)=>opSortDate(b).localeCompare(opSortDate(a)));
    if (archived.length) html+=`<details class="decision-archive" ${archiveOpen?'open':''}><summary>已过期 <span>${archived.length}</span></summary><div class="decision-overview">${archived.map(item=>listItemHtml(item,true)).join('')}</div></details>`;
    root.innerHTML = `<div class="decision-list-toolbar">${tabs}${sort}</div>` + html;
  }

  function showFeedback(id, text) {
    feedback = {id, text};
    status.textContent = text;
    const line = root.querySelector(`[data-decision-card="${CSS.escape(id)}"] .decision-card-feedback`);
    if (line) line.textContent = text;
  }

  async function load() {
    if (retrying || writing) return;
    retrying = true;
    const revision = writeRevision;
    try {
      const response = await fetch(sameOrigin ? API : MOBILE_API, {
        headers: {Accept:'application/json'},
        credentials: sameOrigin ? 'same-origin' : 'omit',
        cache:'no-store',
        signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.choices)) throw new Error('选择记录格式有误');
      if (revision !== writeRevision) return;
      accountChoices = payload.choices;
      cloudReadFailed = false;
      cloudCanEdit = sameOrigin && payload.canEdit === true;
      signedIn = sameOrigin && payload.signedIn === true;
      if (cloudCanEdit && storageMode === 'auto') {
        storageMode = 'account';
        confirmingId = null;
        undoStack.clear();
      }
      lastLoadedAt = Date.now();
      if (!feedback && !writing) status.textContent = canSave() ? (savesToAccount()?'云端已同步':'仅此设备') : '待连接云端';
    } catch {
      if (revision !== writeRevision) return;
      cloudReadFailed = true;
      cloudCanEdit = false;
      if (!feedback && !writing) status.textContent = savesToAccount() ? '同步失败' : '仅此设备';
    } finally {
      firstLoadComplete = true;
      document.querySelector('#decision-retry').hidden = !cloudReadFailed;
      retrying = false;
      updateChoices();
      if (!pointer && !writing && !confirmingId) render();
    }
  }

  async function writeChoice(id, choice, sessionId, remember = true) {
    if (writing) return;
    if (!canSave()) {
      showFeedback(id, savesToAccount() ? '请先连接云端，再保存选择。' : '此浏览器无法保存选择。');
      return;
    }
    const op = candidates.find(candidate => candidate.id === id);
    const previous = choiceFor(id);
    const destination = saveScope();
    writing = true;
    writeRevision++;
    root.querySelectorAll('[data-choice],[data-confirm-interest],[data-undo],[data-restore]').forEach(button => { button.disabled = true; });
    status.textContent = '正在保存…';
    try {
      if (savesToAccount()) {
        const response = await fetch(API, {
          method:'PUT', credentials:'same-origin',
          headers:{'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({id,choice,sessionId}), signal:AbortSignal.timeout(12000)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            cloudCanEdit = false;
            signedIn = response.status === 403;
          }
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (!Array.isArray(payload.choices)) throw new Error('服务器未返回完整记录');
        accountChoices = payload.choices;
      } else {
        const records = (readDeviceChoices() || deviceChoices).filter(record => record.id !== id);
        if (choice !== null || accountChoices.some(record => record.id === id)) {
          records.push({id,choice,sessionId,updatedAt:new Date().toISOString()});
        }
        localStorage.setItem(DEVICE_KEY, JSON.stringify(records));
        deviceChoices = records;
      }
      if (remember) undoStack.set(id, previous);
      else undoStack.delete(id);
      draftSessions.delete(id);
      confirmingId = null;
      reviewId = null;
      feedback = null;
      status.textContent = savesToAccount()?'云端已保存':'已保存到此设备';
      updateChoices();
    } catch (error) {
      showFeedback(id, `保存失败（${error.message}）。请重试。`);
    } finally {
      writing = false;
      render();
    }
  }

  function choose(id, choice, confirmedSession = null) {
    const op = candidates.find(candidate => candidate.id === id);
    if (!op || writing) return;
    if (!canSave()) {
      showFeedback(id, savesToAccount() ? '请先连接云端，再保存选择。' : '此浏览器无法保存选择。');
      return;
    }
    const sessions = dateSessions(op);
    const selected = selectedSession(op, sessions, choiceFor(id));
    if (choice === 'interested') {
      if (!sessions.some(session => session.selectable)) {
        showFeedback(id, '当前场次已截止或结束，请查看最新安排。');
        return;
      }
      if (!selected?.selectable) {
        showFeedback(id, '请选择场次。');
        root.querySelector(`[data-session-for="${CSS.escape(id)}"]`)?.focus();
        return;
      }
      if (confirmedSession !== null && confirmedSession !== (selected.id || '')) {
        confirmingId = null;
        showFeedback(id, '场次已变化，请重新核对。');
        render();
        return;
      }
      if (confirmedSession === null) {
        confirmingId = id;
        feedback = null;
        render();
        const button = root.querySelector('[data-confirm-interest]');
        button?.focus({preventScroll:true});
        button?.scrollIntoView({block:'nearest'});
        return;
      }
    }
    void writeChoice(id, choice, selected?.selectable ? selected.id : null);
  }

  function showProject(id) {
    const op = data.opportunities.find(item => item.id === id);
    if (!op) return;
    const saved = choiceFor(id);
    if (decisionExpiry(op,today).expired) archiveOpen = true;
    else listMode = saved ? saved.choice === 'interested' ? 'interested' : 'other' : 'pending';
    reviewId = id;
    confirmingId = null;
    feedback = null;
    setOpen(true);
    render();
  }

  root.addEventListener('toggle', event => {
    if (event.target.matches('.decision-archive')) archiveOpen = event.target.open;
  }, true);
  root.addEventListener('change', event => {
    if (event.target.matches('[data-decision-sort]')) {
      sortOrder = event.target.value === 'latest' ? 'latest' : 'soonest';
      render();
      root.querySelector('[data-decision-sort]')?.focus({preventScroll:true});
      return;
    }
    const select = event.target.closest('[data-session-for]');
    if (!select) return;
    draftSessions.set(select.dataset.sessionFor, select.value);
    confirmingId = null;
    feedback = null;
    render();
    root.querySelector(`[data-session-for="${CSS.escape(select.dataset.sessionFor)}"][value="${CSS.escape(select.value)}"]`)?.focus({preventScroll:true});
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    event.stopPropagation();
    const {choice,id,undo,restore,review,confirmInterest} = button.dataset;
    if (button.dataset.expandDecision) {
      reviewId = reviewId === button.dataset.expandDecision ? null : button.dataset.expandDecision;
      confirmingId = null;
      feedback = null;
      render();
      root.querySelector(`[data-expand-decision="${CSS.escape(button.dataset.expandDecision)}"]`)?.focus({preventScroll:true});
    }
    else if (button.dataset.listMode) {listMode=button.dataset.listMode;reviewId=null;confirmingId=null;feedback=null;render();}
    else if (button.matches('.decision-history-project')) showProject(id);
    else if (choice) choose(id, choice);
    else if (confirmInterest) choose(confirmInterest, 'interested', button.dataset.confirmSession);
    else if (button.hasAttribute('data-cancel-interest')) {
      confirmingId = null;
      feedback = null;
      render();
    } else if (undo) {
      const previous = undoStack.get(undo);
      void writeChoice(undo, previous?.choice || null, previous?.sessionId || null, false);
    } else if (restore) void writeChoice(restore, null, null, false);
    else if (review) showProject(review);

  });

  const interactive = 'a,button,select,input,label,summary,details[open]';
  const swipeChoice = dx => dx < 0 ? 'declined' : 'interested';
  root.addEventListener('keydown', event => {
    const card = event.target.closest('[data-decision-card]');
    if (!card || event.target.closest(interactive) || confirmingId || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    choose(card.dataset.decisionCard, event.key === 'ArrowLeft' ? 'declined' : 'interested');
  });

  root.addEventListener('pointerdown', event => {
    const card = event.target.closest('[data-decision-card]');
    if (!card || event.target.closest(interactive) || !event.isPrimary || event.button !== 0 || writing || confirmingId) return;
    pointer = {card, id:event.pointerId, x:event.clientX, y:event.clientY, horizontal:false};
  });
  function clearPointer() {
    const active = pointer;
    pointer = null;
    active?.card.classList.remove('is-dragging');
    active?.card.style.removeProperty('--swipe-x');
    if (active?.card.hasPointerCapture(active.id)) active.card.releasePointerCapture(active.id);
    return active;
  }
  root.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        clearPointer();
        return;
      }
      pointer.horizontal = true;
      try { pointer.card.setPointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
    }
    event.preventDefault();
    pointer.card.classList.add('is-dragging');
    pointer.card.style.setProperty('--swipe-x', `${Math.max(-100, Math.min(100, dx))}px`);
    pointer.card.querySelector('.decision-swipe-preview').textContent = dx < 0 ? '← 不参加' : '→ 核对场次';
  });
  root.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const active = clearPointer();
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.abs(dx) >= 65 && Math.abs(dx) > Math.abs(dy)) choose(active.card.dataset.decisionCard, swipeChoice(dx));
  });
  for (const type of ['pointercancel','lostpointercapture']) root.addEventListener(type, event => {
    if (pointer?.id === event.pointerId) clearPointer();
  });

  // Keep trackpad momentum from selecting the next card after one swipe.
  root.addEventListener('wheel', event => {
    const card = event.target.closest('[data-decision-card]');
    if (!card || event.target.closest(interactive) || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = Date.now();
    if (!wheelGesture || now - wheelGesture.at > 260) wheelGesture = {at:now, dx:0, used:false};
    wheelGesture.at = now;
    if (wheelGesture.used || writing || confirmingId) return;
    wheelGesture.dx -= event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? card.clientWidth : 1);
    if (Math.abs(wheelGesture.dx) < 85) return;
    wheelGesture.used = true;
    choose(card.dataset.decisionCard, swipeChoice(wheelGesture.dx));
  }, {passive:false});

  openChoiceCard = showProject;
  access.addEventListener('click', event => {
    const button = event.target.closest('[data-storage-mode]');
    if (!button || writing) return;
    storageMode = button.dataset.storageMode;
    confirmingId = null;
    feedback = null;
    undoStack.clear();
    status.textContent = savesToAccount()?'云端已同步':'仅此设备';
    updateChoices();
    render();
  });
  document.querySelector('#decision-retry')?.addEventListener('click', load);
  const refresh = () => {
    if (!pointer && !confirmingId && Date.now() - lastLoadedAt > 30000) void load();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('storage', event => {
    if (event.key !== DEVICE_KEY && event.key !== null) return;
    deviceChoices = readDeviceChoices();
    updateChoices();
    if (!pointer && !writing) render();
  });
  toggle?.addEventListener('click', () => setOpen(!isOpen));
  document.querySelectorAll('a[href="#decisions"]').forEach(link => link.addEventListener('click', () => setOpen(true)));
  window.addEventListener('hashchange', () => { if (location.hash === '#decisions') setOpen(true); });
  setOpen(isOpen);
  status.textContent = '读取中…';
  updateChoices();
  render();
  void loadDecisionCompanyData().then(details => {
    companyData = details;
    // Only hydrate the new read-only panel and links. Keep current inputs,
    // confirmation, and any active swipe on the existing card untouched.
    const panel = root.querySelector('[data-company-context]');
    const op = data.opportunities.find(candidate => candidate.id === panel?.dataset.companyContext);
    if (op) panel.innerHTML = renderDecisionCompany(op,companyData);
    root.querySelectorAll('[data-conflict-company]').forEach(link => {
      link.innerHTML = renderCompanyCompareLink(link.dataset.conflictCompany,companyData);
    });
  });
  await load();
}

export function appendDecisionDetail(op, container) {
  if (!canDecide(op, tokyoToday())) return;
  const saved = currentChoices.find(choice => choice.id === op.id);
  const box = document.createElement('section');
  box.className = 'detail-section decision-detail';
  box.innerHTML = `<h3>我的选择</h3><p>${typeTag(opportunityType(op))} ${esc(choiceLabel(saved?.choice, op))}${saved ? ' · 已保存' : ''}</p><p><a href="#decisions">查看场次、时间冲突并选择</a></p>`;
  box.querySelector('a').addEventListener('click', event => {
    event.preventDefault();
    container.closest('dialog')?.close();
    openChoiceCard?.(op.id);
    location.hash = '#decisions';
    document.querySelector('#decisions')?.scrollIntoView({block:'start'});
  });
  container.append(box);
}
