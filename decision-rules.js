// Pure rules shared by the browser UI and the Sites Worker.
export function decisionProtection(opportunity, today = new Date().toISOString().slice(0, 10)) {
  const sessions = Array.isArray(opportunity?.registrationSessions) ? opportunity.registrationSessions : [];
  const status = [opportunity?.status,opportunity?.statusDetail,...sessions.map(s=>`${s.bookingStage||''} ${s.registrationStatus||''}`)].join(' ');
  const platformAcceptedSessionPending = /DENSO/i.test(String(opportunity?.company || '')) &&
    /ReDesigner.*(?:受理|応募済)/i.test(status) && sessions.length > 0 &&
    sessions.every(s => /未确认|未预约|未提交|待确认/.test(String(s.bookingStage || '') + String(s.registrationStatus || '')));
  if (opportunity?.category === 'personal' || opportunity?.category === 'school' || opportunity?.category === 'work')
    return { protected: true, reason: '个人或固定占用' };
  if (/排除|明确不推荐|已放弃|已取消|已结束|已截止|不申请/.test(status))
    return { protected: true, reason: '已过期或排除' };
  if (!platformAcceptedSessionPending && /已提交|応募済|応募完了|申込済|已预约|预约完成|予約済|申込完了|确认参加|已受理|已入选|已录取|已参加|\bbooked\b|\baccepted\b|\bregistered\b/i.test(status))
    return { protected: true, reason: '已提交或已确认状态' };
  const relevantDates = (opportunity?.milestones || []).filter(m => m?.date && ['deadline','es_deadline','portfolio_deadline','test_deadline','confirmation_deadline','event'].includes(m.type) && !m.requiresVerification && !m.completed)
    .map(m => String(m.type === 'event' ? (m.endDate || m.date) : m.date).slice(0, 10));
  const nowParts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const nowMap=Object.fromEntries(nowParts.map(x=>[x.type,x.value]));
  const now=`${nowMap.year}-${nowMap.month}-${nowMap.day}T${nowMap.hour}:${nowMap.minute}`;
  const sessionsAllClosed = sessions.length > 0 && sessions.every(s => {
    const state=String(s.availabilityState||s.availabilityStatus||s.bookingStage||s.registrationStatus||'').toLowerCase();
    const closed=/closed|unavailable|ended|full|受付終了|満席|締切|開催終了/.test(state) && !(s.waitlistOpen===true||s.waitlist===true||/waitlist|キャンセル待ち|候补/.test(state));
    const end=s.eventEnd||s.eventStart;
    const ended=end && (String(end).length>10 ? end<=now : end.slice(0,10)<today);
    const deadline=s.deadline && (String(s.deadline).length>10 ? s.deadline<=now : s.deadline.slice(0,10)<today);
    return closed||ended||deadline;
  });
  if (((relevantDates.length && relevantDates.every(d => d < today)) || sessionsAllClosed) && !platformAcceptedSessionPending)
    return { protected: true, reason: '日期已过' };
  return { protected: false, reason: '' };
}

export function canDecide(opportunity, today) {
  if (opportunity?.decisionEligible === false) return false;
  if (!opportunity || !['selection', 'internship', 'activity'].includes(opportunity.category)) return false;
  const protection = decisionProtection(opportunity, today);
  if (protection.protected) return false;
  const status = String(opportunity.status || '') + ' ' + String(opportunity.statusDetail || '');
  const hasSessions = (opportunity.registrationSessions || []).length > 0;
  return /候选|计划|未预约|未提交|有意|未Entry|待选择/.test(status) ||
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
