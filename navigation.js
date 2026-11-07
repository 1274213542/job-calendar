// View navigation only. Existing calendar data, filters and saved choices stay in place.
const panels = [...document.querySelectorAll('[data-app-panel]')];
const navigation = document.querySelector('.app-navigation');
const links = [...navigation.querySelectorAll('[data-app-view]')];
const names = { schedule: '日程', decisions: '决定', projects: '项目', companies: '公司' };
const hashes = { schedule: '#schedule', decisions: '#decisions', projects: '#projects', companies: '#compensation' };
const stateKey = '__jobCalendarNavigation';
const scrollKey = 'job-calendar-view-scroll-v1';
let positions = {};
try { positions = JSON.parse(sessionStorage.getItem(scrollKey) || '{}'); } catch { /* Navigation also works without storage. */ }
let currentView = null;
let currentUrl = null;
let navigationFrame = 0;
let scrollFrame = 0;
let restoring = false;
let historyWriteTimer = 0;
let lastHistoryWrite = -Infinity;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function cleanPosition(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function routeFor(hash) {
  let id;
  try { id = decodeURIComponent((hash || '').replace(/^#/, '')); } catch { return null; }
  if (!id || id === 'top') return { view: 'schedule', target: id || null };
  const target = document.getElementById(id);
  const panel = target?.closest('[data-app-panel]');
  return panel ? { view: panel.dataset.appPanel, target: id } : null;
}

function writePosition(force = false) {
  if (!currentView || restoring) return;
  const y = cleanPosition(window.scrollY);
  positions[currentView] = y;
  // Do not overwrite the entry the browser has just navigated back to.
  if (location.href === currentUrl) {
    const elapsed = performance.now() - lastHistoryWrite;
    if (force || elapsed >= 500) {
      clearTimeout(historyWriteTimer);
      historyWriteTimer = 0;
      history.replaceState({ ...history.state, [stateKey]: { view: currentView, y } }, '', location.href);
      lastHistoryWrite = performance.now();
    } else if (!historyWriteTimer) {
      // A trailing write also covers browsers without the scrollend event.
      historyWriteTimer = setTimeout(() => { historyWriteTimer = 0; writePosition(true); }, 500 - elapsed);
    }
  }
}

function persistPositions() {
  try { sessionStorage.setItem(scrollKey, JSON.stringify(positions)); } catch { /* Optional convenience, never required. */ }
}

function markNavigation() {
  for (const link of links) {
    const active = link.dataset.appView === currentView;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function openDecisions() {
  if (currentView !== 'decisions') return;
  const button = document.getElementById('decisions-toggle');
  const content = document.getElementById('decisions-content');
  if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
  // The navigation module can start before the calendar's asynchronous mount.
  if (content) content.hidden = false;
  button?.setAttribute('aria-expanded', 'true');
}

function updateFilterNotice() {
  const notice = document.getElementById('schedule-filter-notice');
  const labels = [];
  const category = document.querySelector('#category-filter .chip.active');
  if (category?.dataset.category !== 'all') labels.push(category?.textContent.trim());
  const company = document.getElementById('company-filter').value.trim();
  if (company) labels.push(company);
  for (const id of ['status-filter', 'progress-filter']) {
    const select = document.getElementById(id);
    if (select.value !== 'all') labels.push(select.selectedOptions[0]?.textContent);
  }
  notice.hidden = !labels.filter(Boolean).length;
  document.getElementById('schedule-filter-label').textContent = `当前日程筛选：${labels.filter(Boolean).join(' · ')}`;
}

function showView(view, { hash = hashes[view], historyMode = 'push', restore = true, y, focus = false } = {}) {
  const panel = panels.find(item => item.dataset.appPanel === view);
  if (!panel) return false;
  const previousView = currentView;
  if (historyMode !== 'none') writePosition(true);
  else if (currentView && !restoring) positions[currentView] = cleanPosition(window.scrollY);
  clearTimeout(historyWriteTimer);
  historyWriteTimer = 0;
  persistPositions();
  cancelAnimationFrame(navigationFrame);
  restoring = true;

  if (historyMode === 'push' && location.hash !== hash) {
    history.pushState({ ...history.state, [stateKey]: { view, y: cleanPosition(y ?? positions[view]) } }, '', hash);
  }
  currentView = view;
  currentUrl = location.href;
  document.body.dataset.activeView = view;
  for (const item of panels) {
    const active = item === panel;
    item.hidden = !active;
    item.inert = !active;
  }
  markNavigation();
  openDecisions();
  updateFilterNotice();
  const heading = document.getElementById(panel.getAttribute('aria-labelledby'));
  document.querySelector('.skip-link').href = `#${heading.id}`;
  document.title = `${names[view]} · 求职日历 2028`;
  if (previousView && previousView !== view) document.getElementById('view-announcement').textContent = `已切换到${names[view]}`;

  navigationFrame = requestAnimationFrame(() => {
    const target = routeFor(hash)?.target;
    if (restore) window.scrollTo({ top: cleanPosition(y ?? positions[view]), behavior: 'instant' });
    else if (!target || target === 'top' || target === panel.id) window.scrollTo({ top: 0, behavior: 'instant' });
    else document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (focus || (previousView !== view && document.activeElement?.closest('[data-app-panel][hidden]'))) heading.focus({ preventScroll: true });
    restoring = false;
    writePosition(true);
  });
  window.dispatchEvent(new CustomEvent('calendarviewchange', { detail: { view, previousView } }));
  return true;
}

// Reveal the destination before legacy detail links run their own scroll/focus code.
document.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const payButton = event.target.closest('.pay-dialog-link');
  if (payButton) {
    showView('companies', { restore: false });
    return;
  }
  const link = event.target.closest('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
  const route = routeFor(url.hash);
  if (!route) return;
  event.preventDefault();
  const isNavigation = link.hasAttribute('data-app-view');
  showView(route.view, {
    hash: url.hash,
    restore: isNavigation && route.view !== currentView,
    focus: event.detail === 0
  });
}, true);

// app.js also decorates its original section links. Keep the page-level semantic last.
document.addEventListener('click', event => {
  if (event.target.closest('.app-navigation')) markNavigation();
  if (event.target.closest('#category-filter, #reset-filters')) queueMicrotask(updateFilterNotice);
  if (event.target.closest('[data-clear-project-filters]')) {
    document.getElementById('reset-filters').click();
    updateFilterNotice();
  }
});
for (const type of ['input', 'change']) document.getElementById('project-filters').addEventListener(type, updateFilterNotice);

navigation.addEventListener('keydown', event => {
  const index = links.indexOf(event.target.closest('[data-app-view]'));
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length;
  links[next].focus();
  // Arrow keys move through navigation; Enter/Space is not repurposed from links.
});

function followHistory() {
  if (location.href === currentUrl) return;
  const route = routeFor(location.hash);
  if (!route) return;
  const saved = history.state?.[stateKey];
  showView(route.view, { hash: location.hash, historyMode: 'none', restore: saved?.view === route.view, y: saved?.y });
}
window.addEventListener('popstate', followHistory);
window.addEventListener('hashchange', followHistory);
window.addEventListener('scroll', () => {
  if (restoring || scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; writePosition(); });
}, { passive: true });
window.addEventListener('scrollend', () => writePosition(true), { passive: true });
window.addEventListener('pagehide', () => { writePosition(true); persistPositions(); });
window.addEventListener('decisionschange', openDecisions);

// Optional integration point for other UI modules; no data or network side effects.
window.jobCalendarNavigation = Object.freeze({
  navigate: (view, options = {}) => showView(view, options),
  get currentView() { return currentView; }
});
const initial = routeFor(location.hash) || { view: 'schedule' };
const initialState = history.state?.[stateKey];
showView(initial.view, {
  hash: location.hash,
  historyMode: 'none',
  restore: initialState?.view === initial.view,
  y: initialState?.y
});
