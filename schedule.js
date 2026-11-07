// Weekly commitments are expanded only for the requested dates, in Tokyo time.
const dayOf = value => String(value || '').slice(0, 10);
const dateAtNoon = value => new Date(`${dayOf(value)}T12:00:00Z`);
const nextDay = value => {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export function expandWeeklySchedule(rules, start, end) {
  const result = [];
  for (let date = dayOf(start); date <= dayOf(end); date = nextDay(date)) {
    for (const rule of rules || []) {
      const recurrence = rule.recurrence;
      if (!recurrence || date < recurrence.effectiveFrom ||
          (recurrence.effectiveUntil && date > recurrence.effectiveUntil) ||
          !recurrence.weekdays.includes(dateAtNoon(date).getUTCDay()) ||
          (recurrence.exceptions || []).includes(date)) continue;
      result.push({o: rule, m: {
        type: 'event', date: recurrence.allDay ? date : `${date}T${recurrence.start}`,
        endDate: recurrence.allDay ? date : `${date}T${recurrence.end}`,
        allDay: !!recurrence.allDay, label: recurrence.label || rule.title,
        recurring: true
      }});
    }
  }
  return result;
}

const hasTime = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value || '');
const instant = value => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+09:00`);
const confirmedText = value => /已预约|预约完成|已确认参加|确认参加|已参加|予約済|参加確定|^booked$|^confirmed$/.test(value || '') &&
  !/未预约|未确认|尚未|未参加|待确认|候选|待结果|未录取/.test(value || '');
const eventSession = ({o, m}) => (o.registrationSessions || []).find(s => s.eventStart &&
  String(s.eventStart).slice(0,16) === String(m?.date || '').slice(0,16));
// A project-level booking cannot confirm every alternative date in that project.
const booked = item => {
  const {o, m} = item;
  const session = eventSession(item);
  if (session) {
    const state = `${session.bookingStage || ''} ${session.registrationStatus || ''}`.trim();
    if (state) return confirmedText(state);
    return session.bookingConfirmed === true || confirmedText(session.availabilityState);
  }
  const nodeState = `${m?.status || ''} ${m?.label || ''}`.trim();
  if (m?.bookingConfirmed !== undefined) return m.bookingConfirmed === true;
  if (confirmedText(nodeState)) return true;
  if (/未预约|未确认|尚未|候选|待结果|未录取/.test(nodeState)) return false;
  if ((o.registrationSessions || []).length > 1 || (o.milestones || []).filter(n => n.type === 'event').length > 1) return false;
  return o.bookingConfirmed === true || confirmedText(o.status);
};

export function compareEvents(a, b) {
  if (a.o.id === b.o.id) return null;
  const ae = a.m.endDate || a.m.date, be = b.m.endDate || b.m.date;
  if (dayOf(a.m.date) > dayOf(be) || dayOf(b.m.date) > dayOf(ae)) return null;
  const timed = [a.m.date, a.m.endDate, b.m.date, b.m.endDate].every(hasTime);
  if (timed) {
    const overlap = Math.min(instant(ae), instant(be)) - Math.max(instant(a.m.date), instant(b.m.date));
    if (overlap <= 0) {
      const gap = Math.max(instant(a.m.date), instant(b.m.date)) - Math.min(instant(ae), instant(be));
      if (gap <= 15 * 60000 && dayOf(a.m.date) === dayOf(b.m.date)) {
        return {a, b, kind: 'buffer', label: gap === 0 ? '前后紧接 · 无缓冲' : '前后缓冲不足', minutes: gap / 60000, priority: booked(a) && booked(b) ? 3 : 8};
      }
      return null;
    }
  }
  const uncertain = !timed || a.m.endApproximate || b.m.endApproximate;
  return {a, b, kind: 'overlap', label: uncertain ? '日期／预计时段可能重叠' : booked(a) && booked(b) ? '已预约时间重叠' : '候选／待结果时间重叠', priority: booked(a) && booked(b) ? 0 : 6};
}

export function findScheduleConflicts(events, rules) {
  const conflicts = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    for (let j = i + 1; j < events.length; j++) {
      const match = compareEvents(event, events[j]);
      if (match) conflicts.push(match);
    }
    const routines = expandWeeklySchedule(rules, event.m.date, event.m.endDate || event.m.date);
    for (const routine of routines) {
      const match = compareEvents(event, routine);
      if (!match || match.kind === 'buffer') continue;
      if (routine.o.scheduleKind === 'work') {
        if (event.o.workCompatibility === 'online_briefing') continue;
        const canAdjust = event.o.workAdjustment?.status === 'can_adjust';
        conflicts.push({...match, kind: 'work', label: canAdjust ? '兼职可调 · 调班完成待核' : event.o.conditionalAttendance ? '若录取需确认调班' : '需确认是否调整兼职', priority: booked(event) || /待指引/.test(event.o.status || '') ? 2 : event.o.conditionalAttendance ? 4 : 7});
      } else {
        conflicts.push({...match, kind: 'school', label: event.o.availabilityDecision === 'keep' ? '与上课／通勤重叠 · 本人保留' : event.o.conditionalAttendance ? '若录取需协调学校安排' : '与上课／通勤重叠', priority: booked(event) ? 1 : event.o.conditionalAttendance ? 4 : 6});
      }
    }
  }
  return conflicts.sort((a, b) => a.priority - b.priority || a.a.m.date.localeCompare(b.a.m.date));
}

function attendanceFormat(text) {
  const online = /线上(?!报名|申请|登记|选考入口)|在线(?!报名|申请|登记)|オンライン(?!申込|応募|登録)|\bonline\b|\bzoom\b|\bteams\b|google meet|\bwebinar\b|^\s*web\s*$/i.test(text);
  const onsite = /线下|对面|対面|来場|教室|\bon[- ]?site\b|\bin.person\b|(?:^|[；，。／、\s])现场(?=$|[；，。／、\s])|现场(?:举办|举行|参加|反馈|实习|展会|面谈|说明会)/i.test(text);
  if ((online && onsite) || /混合|ハイブリッド|\bhybrid\b/i.test(text)) return '线上或线下';
  if (online) return '线上';
  if (onsite) return '线下';
  return '';
}

function sessionFormat(op, session, milestone) {
  const source = session?.source;
  const explicitFormat = entry => attendanceFormat([entry?.attendanceMode, entry?.format, entry?.mode].join(' '));
  return explicitFormat(source) || explicitFormat(milestone) ||
    attendanceFormat([source?.label, milestone?.label].join(' ')) || explicitFormat(op) ||
    attendanceFormat(`${op.title || ''} ${op.description || ''}`);
}

const timedRange = m => hasTime(m.date) && hasTime(m.endDate) && instant(m.date) < instant(m.endDate);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(dayOf(value)) && Number.isFinite(dateAtNoon(value).valueOf());
const rangeText = ({date, endDate, endApproximate, allDay}) => {
  const short = value => `${Number(value.slice(5,7))}/${Number(value.slice(8,10))}${hasTime(value) ? ` ${value.slice(11,16)}` : ''}`;
  if (allDay) return `${short(date)}${endDate && dayOf(endDate) !== dayOf(date) ? `–${short(endDate)}` : ''} 全天`;
  if (!endDate || (!hasTime(date) && endDate === date)) {
    return `${short(date)}${hasTime(date) ? ' 起，结束待核' : '，时段待核'}`;
  }
  const end = dayOf(date) === dayOf(endDate) && hasTime(endDate) ? endDate.slice(11,16) : short(endDate);
  return `${short(date)}–${endApproximate ? '约' : ''}${end}`;
};

function conflictEventDetails({o, m}) {
  const session = eventSession({o,m});
  const confirmed = o.schoolMandatory || booked({o,m});
  const projectBooked = o.bookingConfirmed === true || confirmedText(o.status);
  return {
    otherId: o.id,
    start: m.date || null,
    end: m.endDate || null,
    time: rangeText(m),
    company: m.recurring ? '' : o.company,
    title: m.recurring ? m.label : o.title,
    stage: m.recurring ? '固定安排' : session?.bookingStage || session?.registrationStatus ||
      (projectBooked && !confirmed ? '本项目有已预约记录；该场未确认' : o.status || '状态待核'),
    confirmed: !!confirmed,
  };
}

function overlapDescription(a, b, kind, minutes) {
  const shortDay = value => `${Number(dayOf(value).slice(5,7))}/${Number(dayOf(value).slice(8,10))}`;
  if (kind === 'buffer') {
    const otherBefore = instant(b.endDate) <= instant(a.date);
    return `${otherBefore ? '对方结束后到本场开始' : '本场结束后到对方开始'}仅隔 ${minutes} 分钟；没有时间重叠`;
  }
  const startDay = [dayOf(a.date),dayOf(b.date)].sort().at(-1);
  const endDay = [dayOf(a.endDate || a.date),dayOf(b.endDate || b.date)].sort()[0];
  if (timedRange(a) && timedRange(b) && !a.endApproximate && !b.endApproximate) {
    const startMs = Math.max(instant(a.date),instant(b.date));
    const endMs = Math.min(instant(a.endDate),instant(b.endDate));
    if (endMs <= startMs) return '未发现实际重叠';
    const tokyo = ms => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0,16);
    const start = tokyo(startMs), end = tokyo(endMs);
    const endLabel = dayOf(start) === dayOf(end) ? end.slice(11,16) : `${shortDay(end)} ${end.slice(11,16)}`;
    return `重叠 ${shortDay(start)} ${start.slice(11,16)}–${endLabel}`;
  }
  const days = `${shortDay(startDay)}${endDay !== startDay ? `–${shortDay(endDay)}` : ''}`;
  return `日期交集 ${days}；${a.endApproximate || b.endApproximate ? '含预计时间，准确重叠时段待核' : '起止时刻未齐，具体重叠待核'}`;
}

function attendanceTrigger(event, other, detail) {
  const selfConfirmed = event.o.schoolMandatory || booked(event);
  const selfSelection = !selfConfirmed && (event.o.category === 'internship' || event.o.conditionalAttendance);
  const otherSelection = !detail.confirmed && (other.o.category === 'internship' || other.o.conditionalAttendance);
  if (selfSelection && otherSelection) return '两个项目均录取且决定参加后才成立';
  if (selfSelection) return detail.confirmed || other.m.recurring
    ? '本项目录取且决定参加后才成立'
    : '本项目录取且参加，并选择另一场后才成立';
  if (otherSelection) return selfConfirmed
    ? '另一项目录取且决定参加后才成立'
    : '选择本场，且另一项目录取并参加后才成立';
  if (selfConfirmed && (detail.confirmed || other.m.recurring)) return '两项均为已确认或固定安排';
  if (detail.confirmed || other.m.recurring) return '选择本场后，会影响已确认或固定安排';
  return selfConfirmed ? '选择另一候选场后才成立' : '两场都决定参加后才成立';
}

export function decisionSessionContext(op, session, data) {
  const milestone = (op.milestones || []).find(m => m.type === 'event' && m.date === session?.start);
  const knownFormat = sessionFormat(op, session, milestone);
  const format = knownFormat || (session?.start ? '形式待核' : '场次待公布');
  if (!validDay(session?.start)) {
    return {format, conflicts:[], notices:['场次时间待公布，暂无法核对重叠。']};
  }

  const m = {type:'event', date:session.start, endDate:session.end || milestone?.endDate,
    endApproximate:session.source?.endApproximate || milestone?.endApproximate,
    allDay:session.source?.allDay || milestone?.allDay};
  const briefing = format === '线上' && (op.workCompatibility === 'online_briefing' ||
    (op.workCompatibility !== 'requires_confirmation' && op.category === 'activity' &&
      /说明会|説明会|讲座|セミナー|webinar/i.test(`${op.title} ${op.description}`) &&
      !/面试|笔试|工作坊|咨询|反馈|1对1|必须开|屏幕共享/.test(`${op.title} ${op.description}`)));
  const event = {o:{...op, workCompatibility:briefing ? 'online_briefing' : 'requires_confirmation'}, m};
  const selfConfirmed = !!(op.schoolMandatory || booked(event));
  const selfStage = session?.source?.bookingStage || session?.source?.registrationStatus || op.status || '状态待核';
  const selfSelection = !selfConfirmed && (op.category === 'internship' || op.conditionalAttendance);
  const reserved = other => booked({o:other}) || other.schoolMandatory || other.conditionalAttendance || /待指引/.test(other.status || '');
  const occupied = (data?.opportunities || []).filter(other => other.id !== op.id &&
    !/未入选|未通过|取消|放弃|不申请|已结束|已截止|受付終了/.test(other.status || '') &&
    (reserved(other) || (other.decisionEligible !== false && ['activity','internship','selection'].includes(other.category))))
    .flatMap(o => (o.milestones || []).filter(node => node.type === 'event' && validDay(node.date) &&
      !node.requiresVerification && !node.completed && dayOf(node.date) <= dayOf(m.endDate || m.date) &&
      dayOf(node.endDate || node.date) >= dayOf(m.date)).map(node => ({o,m:node})));
  const clashes = findScheduleConflicts([event, ...occupied], data?.weeklySchedule || []).filter(pair => pair.a === event &&
    (pair.kind !== 'buffer' || pair.minutes === 0 || reserved(pair.b.o)));
  const conflicts = new Map();
  for (const {b,kind,minutes,label} of clashes) {
    const detail = conflictEventDetails(b);
    const exact = timedRange(m) && timedRange(b.m) && !m.endApproximate && !b.m.endApproximate;
    let tone = 'warning';
    let group = 'conditional';
    let risk;
    let note;
    if (kind === 'buffer') {
      group = 'buffer';
      risk = minutes ? `仅隔 ${minutes} 分钟` : '无缓冲';
    } else if (kind === 'school') {
      group = 'coordination';
      risk = exact ? '与学校安排重叠' : '可能与学校安排重叠';
      tone = exact && !selfSelection ? 'danger' : 'warning';
      if (event.o.availabilityDecision === 'keep') note = '本人已选择保留。';
      else if (selfSelection) note = '若录取需协调学校安排。';
    } else if (kind === 'work') {
      group = 'coordination';
      risk = exact ? '与兼职重叠' : '可能与兼职重叠';
      note = label;
    } else if (selfSelection) {
      risk = detail.confirmed
        ? (exact ? '录取后将影响已确认安排' : '录取后可能影响已确认安排')
        : (exact ? '选择或录取后时间重叠' : '选择或录取后可能重叠');
    } else if (detail.confirmed) {
      group = exact ? 'confirmed' : 'unknown';
      risk = `${selfConfirmed ? '' : '若选本场，'}${exact ? '与已确认安排重叠' : '可能影响已确认安排'}`;
      tone = exact ? 'danger' : 'warning';
    } else if (b.o.conditionalAttendance || b.o.category === 'internship') {
      risk = exact ? '入选后时间重叠' : '入选后可能重叠';
    } else {
      risk = exact ? '另选这场才会重叠' : '另一场仍未确认，可能重叠';
    }
    conflicts.set(b, {...detail,tone,risk,note,group,selfStage,selfConfirmed,selfTime:rangeText(m),selfStart:m.date,
      overlapText:overlapDescription(m,b.m,kind,minutes),
      exactOverlap:kind !== 'buffer' && exact,
      trigger:attendanceTrigger(event,b,detail)});
  }
  for (const other of occupied) {
    if (!other.o.scheduleNotice || dayOf(other.m.date) !== dayOf(m.date) || m.date < other.m.date) continue;
    const conflict = conflicts.get(other);
    if (conflict) {
      conflict.note = '还有后续安排，结束时间待核。';
      conflict.group = 'unknown';
      conflict.tone = 'warning';
      conflict.exactOverlap = false;
      conflict.overlapText = '后续安排的结束时间未核实，具体重叠待核';
    } else {
      const detail = conflictEventDetails(other);
      conflicts.set(other, {...detail,tone:'warning',risk:'后续时间待核',group:'unknown',
        selfStage,selfConfirmed,exactOverlap:false,
        overlapText:'后续安排的结束时间未核实，具体重叠待核',
        trigger:attendanceTrigger(event,other,detail),note:'该场结束后还有安排。'});
    }
  }
  const notices = [];
  if (!timedRange(m) || m.endApproximate) notices.push('本场起止时间待核，冲突可能变化。');
  if (!knownFormat || format === '线上或线下') notices.push('参加方式待核，暂无法确认转场。');
  if (!data?.weeklySchedule) notices.push('上课及兼职安排需另核。');
  const rows = [...conflicts.values()].sort((a,b) => Number(b.tone === 'danger') - Number(a.tone === 'danger'));
  return {format,conflicts:rows,notices,selfStage,selfConfirmed};
}
