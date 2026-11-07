// Pure rules shared by the browser UI and the Sites Worker.
export function sessionChoiceMode(opportunity) {
  if (opportunity?.sessionModel?.mode) return opportunity.sessionModel.mode;
  if ((opportunity?.registrationSessions || []).length > 1) return 'choose_one';
  const events = (opportunity?.milestones || []).filter(m => m.type === 'event');
  // A project timeline is not a set of alternative appointments.
  return events.length > 1 ? 'project_schedule' : 'single';
}

const tokyoKey = date => {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};
const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(String(value || ''));
const timestamp = value => Date.parse(String(value).length === 10 ? `${value}T00:00:00+09:00` : /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`);
const excluded = opportunity => opportunity?.decisionEligible === false || /排除|明确不推荐|已放弃|已取消|不申请/.test(opportunity?.status || '');
const submittedStage = value => {
  const text = String(value || '');
  // Pre-entry and a separate briefing mentioned in statusDetail are not a submission.
  if (/预Entry|pre.?entry|プレエントリー|仮応募/i.test(text) && !/已正式提交|正式已提交|正式申请已受理|正式応募完了/.test(text)) return false;
  return text.split(/[／/；;，,。]/).some(part => !/未|尚未|待确认|候选/.test(part) &&
    /已提交|已正式提交|応募済|応募完了|申込済|已预约|预约完成|予約済|申込完了|确认参加|已受理|已入选|已录取|已参加|\bbooked\b|\baccepted\b|\bregistered\b/i.test(part));
};
const hasSubmitted = opportunity => opportunity?.bookingConfirmed === true || submittedStage(opportunity?.status) ||
  (opportunity?.registrationSessions || []).some(s => s.bookingConfirmed === true || submittedStage(s.bookingStage) || submittedStage(s.registrationStatus));

// Expiry is about an exhausted application window or an ended event, not rejection
// of an application. It never changes the stored application/booking facts.
export function decisionExpiry(opportunity, today, now) {
  if (!opportunity || excluded(opportunity) || !['selection','internship','activity'].includes(opportunity.category)) return {expired:false,label:''};
  const nowDate = now instanceof Date ? now : typeof now === 'number' ? new Date(now) : now ? new Date(timestamp(now)) : new Date();
  const current = Number.isFinite(nowDate.valueOf()) ? tokyoKey(nowDate) : tokyoKey(new Date());
  const localDay = validDate(today) && String(today).length === 10 ? today : current.slice(0,10);
  const clock = today && !now && localDay !== current.slice(0,10) ? `${localDay}T00:00:00` : current;
  const passed = value => validDate(value) && (String(value).length === 10 ? value < localDay : timestamp(value) <= timestamp(clock));
  const nodes = (opportunity.milestones || []).filter(m => !m.requiresVerification);
  const events = nodes.filter(m => m.type === 'event');
  // Some internship records carry a separate briefing's registration reminder.
  // Closing that briefing must not close the future internship itself.
  const sessions = (Array.isArray(opportunity.registrationSessions) ? opportunity.registrationSessions : []).filter(s =>
    opportunity.category === 'activity' || !events.length || !s.eventStart ||
    events.some(m => String(m.date).slice(0,10) <= String(s.eventStart).slice(0,10) &&
      String(m.endDate || m.date).slice(0,10) >= String(s.eventStart).slice(0,10)));
  const futureOpening = nodes.some(m => m.type === 'open' && !m.completed && validDate(m.date) && !passed(m.date) &&
    !/进入|面试|面接|结果|発表/.test(m.label || ''));
  const result = (label,reason,date) => ({expired:true,label,reason,...(date ? {date} : {})});
  // If no end time was published, a past start time alone does not prove it ended.
  const ended = (start,end) => end ? passed(end) : validDate(start) && String(start).slice(0,10) < localDay;
  const occurrences = sessions.length ? sessions.map(s => ({start:s.eventStart,end:s.eventEnd})) : events.map(m => ({start:m.date,end:m.endDate}));
  if (occurrences.length && occurrences.every(s => ended(s.start,s.end)) && !futureOpening) {
    const last = occurrences.map(s => s.end || s.start).filter(validDate).sort().at(-1);
    return result('活动已结束','所有已公布场次均已结束；不推定本人出席',last);
  }
  // A future booked/accepted/submitted arrangement survives its public deadline.
  if (hasSubmitted(opportunity)) return {expired:false,label:'',reason:'已有实际提交、受理或预约，继续保留后续安排'};
  if (futureOpening) return {expired:false,label:'',reason:'还有后续公布的开放窗口'};
  const waiting = s => s.waitlistOpen === true || s.waitlist === true || /waitlist|キャンセル待ち|候补/.test(String(s.availabilityState || s.availabilityStatus || ''));
  const sessionState = s => String(s.availabilityState || s.availabilityStatus || s.registrationStatus || '').toLowerCase();
  const activeSessionDeadline = s => s.deadline && !s.deadlineCompleted && !s.requiresVerification &&
    !nodes.some(m => m.completed && m.date === s.deadline && (!s.deadlineLabel || s.deadlineLabel === m.label));
  const sessionExpired = s => {
    if (ended(s.eventStart,s.eventEnd)) return true;
    // An open waitlist is a live route, even if regular seats are full/closed.
    if (waiting(s)) return !!s.waitlistDeadline && passed(s.waitlistDeadline);
    if (/closed|unavailable|ended|full|受付終了|満席|締切|開催終了/.test(sessionState(s))) return true;
    return activeSessionDeadline(s) && passed(s.deadline);
  };
  if (sessions.length && sessions.every(sessionExpired)) return result('所有场次已停止受理','已公布场次均已结束、截止或满员，且未核到开放候补');
  if (sessions.some(s => waiting(s) && !sessionExpired(s))) return {expired:false,label:'',reason:'仍有开放候补入口'};
  const deadlines = nodes.filter(m => !m.completed && validDate(m.date) && ['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline'].includes(m.type));
  // Published alternative channels/rounds are not all closed until their latest
  // known cutoff passes. An unknown later session is kept rather than guessed closed.
  if (sessions.some(activeSessionDeadline) && sessions.some(s => !sessionExpired(s))) return {expired:false,label:'',reason:'另有尚未截止或窗口待核的场次'};
  const applicationDeadlines = deadlines.filter(m => !['test_deadline','confirmation_deadline'].includes(m.type));
  const entryGates = applicationDeadlines.filter(m => m.type === 'es_deadline' ||
    /先完成报名|参加希望登记截止|预登记截止|注册截止|前置.*截止/.test(m.label || ''));
  const laterRound = nodes.some(m => m.type === 'open' && validDate(m.date) && entryGates.some(g => timestamp(m.date) > timestamp(g.date)) &&
    /报名|募集|选考.*轮|選考.*期|term|ターム/i.test(m.label || ''));
  const laterChannel = applicationDeadlines.some(m => !passed(m.date) && /官网|官方|RD|ReDesigner|平台|渠道|term|ターム|第.*轮|批/.test(m.label || '') &&
    !/作品|PF|材料|履歴/.test(m.label || ''));
  if (entryGates.length && entryGates.every(m => passed(m.date)) && !laterRound && !laterChannel) {
    return result('前置申请已截止','尚未正式提交，必需的前置申请窗口已结束',entryGates.map(m=>m.date).sort().at(-1));
  }
  if (applicationDeadlines.length && applicationDeadlines.every(m => passed(m.date))) {
    return result('报名已截止','已核到的申请渠道或批次截止均已过去',applicationDeadlines.map(m=>m.date).sort().at(-1));
  }
  if (/募集已结束|募集終了|申请已结束|报名已结束/.test(opportunity.status || '') && !applicationDeadlines.some(m=>!passed(m.date))) return result('报名已截止','当前募集已明确记录结束');
  if (/已结束|開催終了/.test(opportunity.status || '') && !occurrences.some(s=>!ended(s.start,s.end))) return result('活动已结束','项目已明确记录结束');
  if (/已截止|受付終了/.test(opportunity.status || '') && !applicationDeadlines.some(m=>!passed(m.date))) return result('报名已截止','当前批次已明确记录停止受理');
  return {expired:false,label:''};
}

export function decisionProtection(opportunity, today, now) {
  const sessions = Array.isArray(opportunity?.registrationSessions) ? opportunity.registrationSessions : [];
  const status = [opportunity?.status,opportunity?.statusDetail,...sessions.map(s=>`${s.bookingStage||''} ${s.registrationStatus||''}`)].join(' ');
  const platformAcceptedSessionPending = /DENSO/i.test(String(opportunity?.company || '')) &&
    /ReDesigner.*(?:受理|応募済)/i.test(status) && sessions.length > 0 &&
    sessions.every(s => /未确认|未预约|未提交|待确认/.test(String(s.bookingStage || '') + String(s.registrationStatus || '')));
  if (opportunity?.category === 'personal' || opportunity?.category === 'school' || opportunity?.category === 'work')
    return { protected: true, reason: '个人或固定占用' };
  if (excluded(opportunity)) return { protected:true,reason:'已排除或放弃' };
  const expiry = decisionExpiry(opportunity,today,now);
  if (expiry.expired) return { protected:true,reason:expiry.label };
  if (!platformAcceptedSessionPending && hasSubmitted(opportunity))
    return { protected: true, reason: '已提交或已确认状态' };
  return { protected: false, reason: '' };
}

export function canDecide(opportunity, today, now) {
  if (opportunity?.decisionEligible === false) return false;
  if (!opportunity || !['selection', 'internship', 'activity'].includes(opportunity.category)) return false;
  const protection = decisionProtection(opportunity, today,now);
  if (protection.protected) return false;
  const status = String(opportunity.status || '') + ' ' + String(opportunity.statusDetail || '');
  const hasSessions = (opportunity.registrationSessions || []).length > 0;
  return /候选|计划|未预约|未提交|有意|未Entry|预Entry|待选择|公开招聘／活动信息/.test(status) ||
    (/DENSO/i.test(opportunity.company || '') && hasSessions && /受理|応募済/.test(status));
}

// Hide only declined, unsubmitted candidates from plan views. Accepted and
// booked arrangements retain their factual status and remain visible.
export function mayHideCandidate(opportunity, choice, today) {
  if (choice !== 'declined' || !opportunity || decisionProtection(opportunity,today).protected) return false;
  const status = String(opportunity.status || '') + ' ' + String(opportunity.statusDetail || '');
  if (/DENSO/i.test(String(opportunity.company || '')) && /ReDesigner.*(?:受理|応募済)/i.test(status)) return false;
  return canDecide(opportunity,today);
}
