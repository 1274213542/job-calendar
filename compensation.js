const PAGE_SIZE = 80;
const collator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });
const groups = { contact: 0, plan: 1, reference: 2, history: 3 };
const organizers = new Set(['ViViViT', 'ReDesigner', '武藏野美术大学', 'クリ博', 'デジタルスケープ'].map(key));
const fields = {
  monthly: '月薪', annual: '年收', bonus: '奖金', overtime: '加班费',
  benefits: '津贴与福利', intern: '实习报酬'
};

function key(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function calendarGroup(status) {
  if (/已取消|未入选|未通过|已结束|已截止|放弃|不申请/.test(status)) return 'history';
  if (/未报名|尚未申请|未申请|尚未提交|未提交|合格后|若合格/.test(status)) return 'plan';
  if (/已预约|预约成功|已确认参加|已参加|已提交|已受理|已匹配|已入选|书类通过|预\s*Entry|応募済/i.test(status)) return 'contact';
  if (/公开招聘|公开活动/.test(status)) return 'reference';
  return 'plan';
}

function collectEmployers(companies, opportunities) {
  const byAlias = new Map();
  const employers = [];
  function addCompany(company) {
    const names = [company.name, ...(company.aliases || [])];
    const item = { ...company, group: null, searchNames: names.map(key) };
    for (const name of names) byAlias.set(key(name), item);
    employers.push(item);
    return item;
  }
  companies.forEach(addCompany);
  for (const opportunity of opportunities) {
    if (opportunity.category === 'school') continue;
    const company = opportunity.company || '';
    const fullMatch = byAlias.get(key(company));
    const parts = company.split(/[/／]/).map(s => s.trim()).filter(Boolean);
    const hosts = parts.filter(s => organizers.has(key(s)));
    const targets = new Set();
    if (fullMatch && !organizers.has(key(company))) targets.add(fullMatch);
    if (!fullMatch) {
      for (const name of parts) {
        const match = byAlias.get(key(name));
        if (match) targets.add(match);
      }
    }
    const group = calendarGroup(opportunity.status || '');
    for (const item of targets) {
      if (!item.group || groups[group] < groups[item.group]) item.group = group;
    }
    if (hosts.length) {
      // A company named in an event has an event link only. A joint booking is not a job application.
      const eventTitle = key(opportunity.title);
      for (const item of employers) {
        if ((!item.group || item.group === 'history') && item.searchNames.some(name => name.length > 1 && eventTitle.includes(name))) {
          item.group = 'reference';
        }
      }
    }
  }
  return employers.map(item => ({ ...item, group: item.group || 'reference' }))
    .sort((a, b) => groups[a.group] - groups[b.group] || collator.compare(a.name, b.name));
}

function displayValue(value) {
  return el('span', value ? 'pay-value' : 'pay-value pay-missing', value || '待核');
}

// Use reviewed numeric metadata, never numbers guessed from salary prose.
function comparisonValue(item, metric) {
  if (metric === 'rating') return item.company.employeeReviews?.rating;
  if (metric === 'overtime') return item.company.employeeReviews?.overtime?.hoursPerMonth;
  const values = (item.job ? [item.job] : item.company.roles || [])
    .map(job => job.sortValues?.[metric + 'JPY']).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

export function sortCompensationItems(items, sort) {
  const [metric, direction] = sort.split('-');
  if (metric === 'default') return [...items];
  return [...items].sort((a, b) => {
    if (metric === 'name') return collator.compare(a.company.name, b.company.name) * (direction === 'asc' ? 1 : -1);
    const av = comparisonValue(a, metric), bv = comparisonValue(b, metric);
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return (av - bv) * (direction === 'asc' ? 1 : -1) || collator.compare(a.company.name, b.company.name);
  });
}

function companyList(items, mode, sort, expanded) {
  const list = el('div', 'pay-company-list');
  const metric = sort.split('-')[0];
  for (const item of items) {
    const { company, job } = item;
    const card = el('details', 'pay-company-item');
    const identityKey = mode + ':' + company.name + ':' + (job?.role || '');
    card.open = expanded.has(identityKey);
    const summary = el('summary', 'pay-company-summary');
    const identity = el('span', 'pay-company-name');
    identity.append(el('strong', '', company.name));
    if (job?.role) identity.append(el('small', '', job.role));
    const value = el('span', 'pay-company-number');
    const displayMetric = ['monthly', 'annual', 'rating', 'overtime'].includes(metric) ? metric : mode === 'reviews' ? 'rating' : 'monthly';
    if (mode !== 'intern') {
      const amount = comparisonValue(item, displayMetric);
      let label = displayMetric === 'rating' ? '员工评分 · 5分制' : displayMetric === 'overtime' ? '员工自报加班 / 月' : job?.sortValues?.[displayMetric + 'Label'] || fields[displayMetric];
      if (job?.sortValues?.reference && ['monthly', 'annual'].includes(displayMetric)) label += ' · 参考';
      const number = Number.isFinite(amount) ? displayMetric === 'rating' ? amount.toFixed(2) : displayMetric === 'overtime' ? amount + ' 小时' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(amount / 10000) + '万日元' : '待公布 / 待核';
      value.append(el('b', '', number), el('small', '', label));
    } else value.append(el('small', '', '查看报酬'));
    summary.append(identity, value, el('span', 'pay-company-chevron', '›'));
    const body = el('div', 'pay-company-body');
    let rendered = false;
    function showDetails() {
      if (!card.open || rendered) return;
      rendered = true;
      if (mode === 'reviews') body.append(reviewCards([item]));
      else {
        const row = details(job, mode, '', 1);
        body.append(row.querySelector('.pay-terms'));
      }
    }
    card.addEventListener('toggle', () => {
      if (card.open) expanded.add(identityKey); else expanded.delete(identityKey);
      showDetails();
    });
    card.append(summary, body);
    showDetails();
    list.append(card);
  }
  return list;
}

function sourceLinks(sources, emptyLabel = '招聘要项待核') {
  const box = el('div', 'pay-sources');
  for (const source of sources || []) {
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const link = el('a', '', source.label || url.hostname);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    box.append(link);
  }
  if (!box.childElementCount) box.append(el('span', 'pay-missing', emptyLabel));
  return box;
}

function details(job, mode, id, columns) {
  const row = el('tr', 'pay-expanded');
  row.id = id;
  row.hidden = true;
  const cell = document.createElement('td');
  cell.colSpan = columns;
  const list = el('dl', 'pay-terms');
  function term(label, content) {
    const group = el('div');
    group.append(el('dt', '', label));
    const value = el('dd');
    value.append(content);
    group.append(value);
    list.append(group);
  }
  if (mode === 'employment' && job.scope) term('适用范围', job.scope);
  if (job.availabilityLabel) term('信息状态', job.availabilityLabel);
  if (job.evidenceNote) term('核查说明', job.evidenceNote);
  if (job.checkedAt) term('核查日期', job.checkedAt);
  const fieldKeys = mode === 'intern' ? ['intern'] : ['monthly', 'annual', 'bonus', 'overtime', 'benefits'];
  for (const field of fieldKeys) term(fields[field], displayValue(job[field]));
  term('招聘要项', sourceLinks(job.sources));
  cell.append(list);
  row.append(cell);
  return row;
}

function makeTable(items, mode) {
  const cols = mode === 'intern' ? ['intern'] : ['monthly', 'annual', 'bonus', 'overtime'];
  const table = el('table', 'pay-table pay-table-' + mode);
  table.setAttribute('aria-label', mode === 'intern' ? '公司与实习报酬' : '公司与入职待遇');
  const head = table.createTHead().insertRow();
  for (const label of [mode === 'intern' ? '公司' : '公司 / 岗位', ...cols.map(c => fields[c]), '明细']) {
    const cell = el('th', '', label);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  items.forEach(({ company, job }, index) => {
    const id = 'pay-terms-' + index;
    const row = el('tr', 'pay-summary');
    const identity = el('th', 'pay-identity');
    identity.scope = 'row';
    identity.append(el('strong', '', company.name));
    if (mode === 'employment') {
      identity.append(el('span', 'pay-role', job.role || '岗位待遇待核'));
      if (job.scope) identity.append(el('span', 'pay-scope', job.scope));
      if (job.availabilityLabel) identity.append(el('span', 'pay-availability', job.availabilityLabel));
    }
    row.append(identity);
    for (const col of cols) {
      const cell = el('td', 'pay-col-' + col);
      const label = el('small', 'pay-field', fields[col]);
      label.setAttribute('aria-hidden', 'true');
      cell.append(label, displayValue(job[col] || (job.availabilityLabel ? '未公布，见核查说明' : null)));
      row.append(cell);
    }
    const action = el('td', 'pay-action');
    const button = el('button', 'pay-expand', '展开');
    button.type = 'button';
    button.setAttribute('aria-controls', id);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', '展开' + company.name + ' ' + (job.role || '') + '的待遇明细');
    action.append(button);
    row.append(action);
    const panel = details(job, mode, id, cols.length + 2);
    button.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.textContent = open ? '收起' : '展开';
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', button.textContent + company.name + ' ' + (job.role || '') + '的待遇明细');
      row.classList.toggle('is-expanded', open);
    });
    body.append(row, panel);
  });
  return table;
}

function reviewCards(items) {
  const list = el('div', 'pay-review-list');
  const statusLabels = { public_summary: '可读公开概要', limited: '有限公开资料', not_found: '暂无可靠公开资料' };
  for (const { company } of items) {
    const review = company.employeeReviews || {};
    const card = el('article', 'pay-review-card');
    const header = el('div', 'pay-review-heading');
    const identity = el('div');
    identity.append(el('h3', '', company.name), el('span', 'pay-review-status', statusLabels[review.status] || '评价资料待核'));
    header.append(identity);
    if (review.checkedAt) header.append(el('span', 'pay-date', '核查 ' + review.checkedAt.slice(0, 10)));
    card.append(header);
    const metrics = el('div', 'pay-review-metrics');
    function metric(label, value) {
      const box = el('div');
      box.append(el('small', '', label), el('b', '', value));
      metrics.append(box);
    }
    const overtime = review.overtime || {};
    if (Number.isFinite(overtime.hoursPerMonth)) metric('员工自报月均加班', overtime.hoursPerMonth + ' 小时');
    if (Number.isFinite(review.paidLeaveRate)) metric('员工自报有休消化率', review.paidLeaveRate + '%');
    if (Number.isFinite(review.rating)) metric('评价平台评分（5分制）', String(review.rating));
    if (metrics.childElementCount) card.append(metrics);
    card.append(el('p', 'pay-review-summary', review.summary || '暂未核到可直接阅读、且能确认对应法人的员工评价。'));
    const details = el('details', 'pay-review-details');
    details.append(el('summary', '', '评价要点、口径与来源'));
    const columns = el('div', 'pay-review-points');
    function points(label, values, style) {
      if (!Array.isArray(values) || !values.length) return;
      const box = el('div', style);
      box.append(el('h4', '', label));
      const ul = el('ul');
      values.forEach(value => ul.append(el('li', '', value)));
      box.append(ul);
      columns.append(box);
    }
    points('评价中提到的优点', review.positives, 'review-positives');
    points('留意事项与面谈确认', review.concerns, 'review-concerns');
    if (columns.childElementCount) details.append(columns);
    const context = [];
    if (Number.isFinite(overtime.hoursPerMonth)) {
      context.push(Number.isFinite(overtime.sampleSize) ? '加班统计样本：' + overtime.sampleSize + ' 人' : '该加班统计的样本数未明确');
      context.push(overtime.period ? '统计期间：' + overtime.period : '统计期间未明确');
    }
    if (overtime.note) context.push(overtime.note);
    if (review.limitations) context.push(review.limitations);
    if (context.length) details.append(el('p', 'pay-review-limits', context.join('；')));
    details.append(sourceLinks(review.sources, '暂未核到可引用的员工评价原页'));
    card.append(details);
    list.append(card);
  }
  return list;
}

export async function mountCompensation(opportunities) {
  const response = await fetch('./data/compensation.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Compensation data unavailable');
  const data = await response.json();
  const employers = collectEmployers(data.companies, opportunities);
  const search = document.getElementById('pay-search');
  const filter = document.getElementById('pay-filter');
  const sort = document.getElementById('pay-sort');
  const modes = document.getElementById('pay-mode');
  const results = document.getElementById('pay-results');
  const count = document.getElementById('pay-count');
  const more = document.getElementById('pay-more');
  let mode = 'employment';
  let limit = PAGE_SIZE;
  const expanded = new Set();
  const sortChoices = {
    employment: [['default', '已联系优先'], ['monthly-desc', '月薪：高 → 低'], ['monthly-asc', '月薪：低 → 高'], ['annual-desc', '年收：高 → 低'], ['annual-asc', '年收：低 → 高'], ['rating-desc', '评分：高 → 低'], ['rating-asc', '评分：低 → 高'], ['name-asc', '公司名称']],
    intern: [['default', '已联系优先'], ['name-asc', '公司名称']],
    reviews: [['rating-desc', '评分：高 → 低'], ['rating-asc', '评分：低 → 高'], ['overtime-asc', '加班：少 → 多'], ['overtime-desc', '加班：多 → 少'], ['default', '已联系优先'], ['name-asc', '公司名称']]
  };
  const savedSorts = {};
  function refreshSortOptions() {
    sort.replaceChildren(...sortChoices[mode].map(([value, title]) => {
      const option = el('option', '', title); option.value = value; return option;
    }));
    sort.value = savedSorts[mode] || sortChoices[mode][0][0];
  }
  refreshSortOptions();
  const modeNote = document.getElementById('pay-mode-note');
  if (data.asOf) document.getElementById('pay-date').textContent = '资料核对 ' + data.asOf;
  document.querySelector('.pay-controls').hidden = false;

  function render(reset = true) {
    if (reset) limit = PAGE_SIZE;
    const query = key(search.value.trim());
    const items = [];
    let companies = 0;
    for (const company of employers) {
      if (filter.value !== 'all' && company.group !== filter.value) continue;
      const roles = company.roles?.length ? company.roles : [{}];
      if (mode === 'reviews') {
        if (query && !company.searchNames.some(name => name.includes(query)) && !roles.some(job => key(job.role).includes(query))) continue;
        companies++;
        items.push({ company });
        continue;
      }
      let matchingRoles = roles;
      if (mode === 'intern') {
        matchingRoles = roles.filter(job => job.intern);
      }
      if (query && !company.searchNames.some(name => name.includes(query))) {
        matchingRoles = matchingRoles.filter(job => key(job.role).includes(query) ||
          (mode === 'intern' && key(job.intern).includes(query)));
      }
      if (matchingRoles.length) companies++;
      for (const job of matchingRoles) items.push({ company, job });
    }
    count.textContent = companies + ' 家公司' + (mode === 'reviews' ? ' · 员工评价与工作强度' : ' · ' + items.length + ' 条待遇记录');
    modeNote.textContent = mode === 'reviews' ? '员工评分为5分制，统计可能涵盖多个岗位和年份。' : mode === 'intern' ? '查看各项目的实习报酬与交通、住宿补助。' : '税前日元 · 区间按下限排序 · 参考年份及奖金口径见详情';
    const visible = sortCompensationItems(items, sort.value).slice(0, limit);
    results.replaceChildren(items.length ? companyList(visible, mode, sort.value, expanded) : el('p', 'pay-empty', '没有符合当前条件的公司或岗位。'));
    more.hidden = visible.length === items.length;
    more.textContent = '再显示 ' + Math.min(PAGE_SIZE, items.length - visible.length) + ' 条';
    if (!more.hidden) count.textContent += ' · 已显示 ' + visible.length + ' 条';
  }
  search.addEventListener('input', () => render());
  filter.addEventListener('change', () => render());
  sort.addEventListener('change', () => { savedSorts[mode] = sort.value; render(); });
  function setMode(nextMode) {
    mode = nextMode;
    refreshSortOptions();
    modes.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode)));
    render();
  }
  modes.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.dataset.mode === mode) return;
    setMode(button.dataset.mode);
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-compare-company]');
    if (!link) return;
    const employer = employers.find(item => item.name === link.dataset.compareCompany);
    if (!employer) return;
    filter.value = 'all';
    search.value = employer.name;
    setMode('employment');
  });
  more.addEventListener('click', () => {
    limit += PAGE_SIZE;
    render(false);
  });
  render();
  return function addPayShortcut(opportunity, container) {
    const employer = employers.find(item => item.searchNames.includes(key(opportunity.company)));
    if (!employer) return;
    const link = el('button', 'pay-dialog-link', '查看公司待遇');
    link.type = 'button';
    link.addEventListener('click', () => {
      container.closest('dialog').close();
      filter.value = 'all';
      search.value = employer.name;
      const hasInternPay = employer.roles.some(job => job.intern);
      setMode(opportunity.category === 'internship' && hasInternPay ? 'intern' : 'employment');
      document.getElementById('compensation').scrollIntoView();
      search.focus({ preventScroll: true });
    });
    container.querySelector('.detail-company')?.after(link);
    if (!link.isConnected) container.querySelector('h2')?.after(link);
  };
}
