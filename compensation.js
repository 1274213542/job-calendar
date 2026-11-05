const PAGE_SIZE = 10;
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

function sourceLinks(sources) {
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
  if (!box.childElementCount) box.append(el('span', 'pay-missing', '招聘要项待核'));
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
    }
    row.append(identity);
    for (const col of cols) {
      const cell = el('td', 'pay-col-' + col);
      const label = el('small', 'pay-field', fields[col]);
      label.setAttribute('aria-hidden', 'true');
      cell.append(label, displayValue(job[col]));
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

export async function mountCompensation(opportunities) {
  const response = await fetch('./data/compensation.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Compensation data unavailable');
  const data = await response.json();
  const employers = collectEmployers(data.companies, opportunities);
  const search = document.getElementById('pay-search');
  const filter = document.getElementById('pay-filter');
  const modes = document.getElementById('pay-mode');
  const results = document.getElementById('pay-results');
  const count = document.getElementById('pay-count');
  const more = document.getElementById('pay-more');
  let mode = 'employment';
  let limit = PAGE_SIZE;
  if (data.asOf) document.getElementById('pay-date').textContent = '资料核对 ' + data.asOf;
  document.querySelector('.pay-controls').hidden = false;

  function render(reset = true) {
    if (reset) limit = PAGE_SIZE;
    const query = key(search.value.trim());
    const items = [];
    let companies = 0;
    for (const company of employers) {
      if (filter.value !== 'all' && company.group !== filter.value) continue;
      const roles = company.roles.length ? company.roles : [{}];
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
    count.textContent = companies + ' 家公司 · ' + items.length + ' 条待遇记录';
    if (filter.value === 'all' && !query && companies) count.textContent += ' · 已报名或已联系优先';
    const visible = items.slice(0, limit);
    results.replaceChildren(items.length ? makeTable(visible, mode) : el('p', 'pay-empty', '没有符合当前条件的公司或岗位。'));
    more.hidden = visible.length === items.length;
    more.textContent = '再显示 ' + Math.min(PAGE_SIZE, items.length - visible.length) + ' 条';
    if (!more.hidden) count.textContent += ' · 已显示 ' + visible.length + ' 条';
  }
  search.addEventListener('input', () => render());
  filter.addEventListener('change', () => render());
  function setMode(nextMode) {
    mode = nextMode;
    modes.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode)));
    render();
  }
  modes.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.dataset.mode === mode) return;
    setMode(button.dataset.mode);
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
