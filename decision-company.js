const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
const key = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const organizers = new Set(['ViViViT', 'ReDesigner', '武藏野美术大学', 'クリ博', 'デジタルスケープ'].map(key));
const isEmployer = name => !organizers.has(key(name));
const otherEntityNames = new Set(['WDB', 'WDBグループ', 'Visional', 'Mercari Group'].map(key));
const noRate = '该设计岗位录取倍率未核到公开数据';

async function getJson(path) {
  try {
    const response = await fetch(path, {cache:'no-store', signal:AbortSignal.timeout(8000)});
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function buildDecisionCompanyData(compensation, evidence) {
  const aliases = new Map();
  const companies = Array.isArray(compensation?.companies) ? compensation.companies : [];
  const projects = Array.isArray(evidence?.projects) ? evidence.projects : [];
  for (const company of companies) {
    if (!company?.name) continue;
    for (const name of [company.name, ...(Array.isArray(company.aliases) ? company.aliases : [])]) {
      const normalized = key(name);
      if (!normalized || otherEntityNames.has(normalized) || !isEmployer(name)) continue;
      if (!aliases.has(normalized)) aliases.set(normalized, company);
      else if (aliases.get(normalized) !== company) aliases.set(normalized, null);
    }
  }
  return {
    aliases, compensationDate:compensation?.asOf, hasCompensation:Array.isArray(compensation?.companies),
    projects:new Map(projects.filter(project => project?.id).map(project => [project.id,project])),
  };
}

export async function loadDecisionCompanyData() {
  const [compensation, evidence] = await Promise.all([
    getJson('./data/compensation.json'), getJson('./data/decision-context.json'),
  ]);
  return buildDecisionCompanyData(compensation,evidence);
}

export function matchDecisionEmployers(op, data, project) {
  const normalized = key(op.company);
  const names = Array.isArray(project?.companies) && project.companies.length
    ? project.companies
    : data.aliases.has(normalized) ? [op.company] : String(op.company || '').split(/[/／]/).map(name => name.trim());
  return [...new Set(names.filter(isEmployer).map(name => data.aliases.get(key(name))).filter(Boolean))];
}

export function renderCompanyCompareLink(name, data, label = '查看公司待遇') {
  const company = data?.aliases.get(key(name));
  return company ? `<a href="#compensation" data-compare-company="${esc(company.name)}">${esc(label)}</a>` : '';
}

function links(sources) {
  return (Array.isArray(sources) ? sources : []).map(source => {
    try {
      const url = new URL(source.url);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return '';
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.label || url.hostname)}</a>`;
    } catch {
      return '';
    }
  }).filter(Boolean);
}

function metric(label, value, scope) {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value || '待核')}${scope ? `<small>${esc(scope)}</small>` : ''}</dd></div>`;
}

function term(label, text) {
  return text ? `<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>` : '';
}

function payrollRoles(company, op) {
  const roles = Array.isArray(company.roles) ? company.roles : [];
  if (roles.length <= 1 || company.name !== 'Panasonic') return roles;
  if (/CREATIVE OJT.*照明／住宅设备/.test(op.title)) return roles.filter(role => /Electric Works／Housing Solutions/.test(role.role));
  if (/CREATIVE OJT UI\/UX/.test(op.title)) return roles.filter(role => /パナソニック株式会社/.test(role.role));
  return roles;
}

function employerHtml(company, op, project, data, showIntern) {
  const roles = payrollRoles(company,op);
  const role = roles.length === 1 ? roles[0] : null;
  const sameJob = role && !/另一职种/.test(role.scope || '');
  const review = company.employeeReviews || {};
  const overtime = review.overtime || {};
  const official = company.officialWorkload;
  const officialSources = links(official?.sources);
  const hasOfficial = Number.isFinite(official?.hoursPerMonth) && official.scope && official.period && officialSources.length;
  const scopeName = ({
    'NEZOT／WDB':'NEZOT 法人员工投稿',
    'Visional／ビズリーチ':'ビズリーチ法人员工投稿',
    'Sony':'Sony Group 样本',
  })[company.name] || '跨岗位员工投稿';
  const roleContext = !role && roles.length > 1
    ? '按招聘法人分别列出，见明细。'
    : [role?.role, role?.scope].filter(Boolean).join(' · ');
  const hasEmployeeHours = Number.isFinite(overtime.hoursPerMonth);
  const workload = hasOfficial
    ? metric('官方设计部月均加班',`${official.hoursPerMonth} 小时`,`${official.scope} · ${official.period}`)
    : metric('员工自报月均加班',hasEmployeeHours ? `${overtime.hoursPerMonth} 小时` : null,hasEmployeeHours ? scopeName : '');
  const measures = metric('新卒月薪',sameJob ? role.monthly : null)
    + metric('新卒年收',sameJob ? role.annual : null)
    + workload;
  const intern = showIntern ? metric('本项目实习报酬',project?.internPay || '未核到公开数据',project?.internPayScope) : '';
  const details = roles.map(job => {
    const sources = links(job.sources);
    return `<div class="decision-company-role">
      <h5>${esc(job.role || '入职待遇')}</h5>
      <dl>${term('适用范围',job.scope)}${term('月薪',job.monthly)}${term('年收',job.annual)}
        ${term('奖金',job.bonus)}${term('加班费',job.overtime)}${term('福利',job.benefits)}
        ${term('同公司实习资料 · 适用项目见说明',job.intern)}
        ${term('资料口径',job.evidenceNote)}${term('核查日期',job.checkedAt || data.compensationDate)}</dl>
      ${sources.length ? `<div class="decision-company-sources">${sources.join('')}</div>` : ''}
    </div>`;
  }).join('');
  const reviewSources = links(review.sources);
  const sample = hasEmployeeHours
    ? [`${overtime.hoursPerMonth} 小时/月`, scopeName,
      Number.isFinite(overtime.sampleSize) ? `样本 ${overtime.sampleSize} 人` : '样本数未披露',
      overtime.period || '统计期间未披露',overtime.note].filter(Boolean).join(' · ')
    : overtime.note;
  const reviewDetail = term('员工加班统计',sample) + term('员工评价口径',review.limitations)
    + term('评价核查日期',review.checkedAt);
  const officialDetail = hasOfficial ? term('官方实际加班',`${official.hoursPerMonth} 小时/月 · ${official.scope} · ${official.period}`)
    + term('官方资料核查日期',official.checkedAt) : '';
  return `${roleContext ? `<p class="decision-company-scope">${esc(roleContext)}</p>` : ''}
    <dl class="decision-company-metrics">${measures}${intern}</dl>
    <p class="decision-company-review"><b>员工评价</b> ${esc(review.summary || '暂无已核实的公开评价摘要。')}</p>
    <details class="decision-company-details">
      <summary>奖金、加班费与资料来源</summary>
      ${details}
      ${officialDetail || reviewDetail ? `<dl>${officialDetail}${reviewDetail}</dl>` : ''}
      ${hasOfficial ? `<div class="decision-company-sources">${officialSources.join('')}</div>` : ''}
      ${reviewSources.length ? `<div class="decision-company-sources">${reviewSources.join('')}</div>` : ''}
      ${renderCompanyCompareLink(company.name,data,'查看完整公司对照')}
    </details>`;
}

function projectHtml(project) {
  const sources = links(project?.sources);
  const rate = sources.length && project?.selectionRateNote && typeof project?.selectionRate === 'string' ? project.selectionRate : '';
  const details = term('选考流程',project?.selectionProcess) + term('材料与门槛',project?.requirementsNote)
    + term('方向与课题',project?.fitNote) + term('倍率口径',project?.selectionRateNote)
    + term('核查日期',project?.checkedAt);
  return `<p class="decision-company-rate"><b>录取倍率</b> ${esc(rate || noRate)}</p>
    ${details || sources.length ? `<details class="decision-company-details">
      <summary>本项目选考要求与来源</summary>
      ${details ? `<dl>${details}</dl>` : ''}
      ${sources.length ? `<div class="decision-company-sources">${sources.join('')}</div>` : ''}
    </details>` : ''}`;
}

export function renderDecisionCompany(op, data) {
  const project = data.projects.get(op.id);
  const companies = matchDecisionEmployers(op,data,project);
  const showIntern = op.category === 'internship' || !!project?.internPay;
  const heading = '<h4>待遇与选考</h4>';
  const joint = Array.isArray(project?.companies) && new Set(project.companies.filter(isEmployer).map(key)).size > 1;
  if (companies.length === 1 && !joint) {
    const company = companies[0];
    return `${heading}<p class="decision-company-name">${esc(company.name)}</p>
      ${employerHtml(company,op,project,data,showIntern)}${projectHtml(project)}`;
  }
  const intern = showIntern ? `<dl class="decision-company-metrics">${metric('本项目实习报酬',project?.internPay || '未核到公开数据',project?.internPayScope)}</dl>` : '';
  if (companies.length) {
    return `${heading}${intern}<p class="decision-company-scope">联合活动 · 按公司查看已核资料</p>
      ${companies.map(company => `<details class="decision-company-details">
        <summary>${esc(company.name)}</summary>${employerHtml(company,op,project,data,false)}
      </details>`).join('')}${projectHtml(project)}`;
  }
  const missing = data.hasCompensation ? '暂无可确认适用于该项目的公司待遇资料。' : '公司待遇资料暂时无法读取。';
  return `${heading}${intern}<p class="decision-company-scope">${missing}</p>${projectHtml(project)}`;
}
