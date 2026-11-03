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
const instant = value => Date.parse(value.length === 16 ? `${value}:00+09:00` : value);
const booked = item => item.o.bookingConfirmed === true || /已预约|确认参加|已参加/.test(item.o.status || '');

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
