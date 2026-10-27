import { validateRelease } from './release-validation.mjs';
import { english, chinese, releaseCopy } from './locales.mjs';
import { cases, defaultCaseId, getExample, initialSelection, commandsForExample } from './examples.mjs';
import { createInvestigation } from './investigation.mjs';
import model from '../data/seed/early-medieval.json' with { type: 'json' };

const parameters = new URL(location.href).searchParams;
let locale = parameters.get('lang') === 'zh-CN' ? 'zh-CN' : 'en';
let selection = initialSelection(parameters.get('case'));
let release = null;
const investigation = createInvestigation(model.history);
const messages = () => locale === 'en' ? english : chinese;
const text = value => value?.[locale] ?? value?.en ?? messages().unknownValue;
const example = () => getExample(selection.caseId);
const byId = id => document.getElementById(id);
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}
function svgElement(tag, attributes = {}, content) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}
function nodeLabel(node) { return messages()[node.labelKey].replaceAll('\n', ' '); }
function nodeYear(node) { return node.yearKey ? messages()[node.yearKey] : String(node.year); }
function recordLabel(id) {
  const node = example().nodes.find(item => item.id === id);
  return nodeYear(node) + ' · ' + nodeLabel(node);
}
function fieldValue(value) { return value?.status === 'known' ? text(value.label) : messages().unknownValue; }
function sourceLink(source) {
  if (!source || !source.url.startsWith('https://')) return null;
  const link = element('a', source.title);
  link.href = source.url; link.target = '_blank'; link.rel = 'noreferrer';
  return link;
}
function syncURL() {
  const url = new URL(location.href);
  if (locale === 'zh-CN') url.searchParams.set('lang', locale); else url.searchParams.delete('lang');
  if (selection.caseId !== defaultCaseId) url.searchParams.set('case', selection.caseId); else url.searchParams.delete('case');
  history.replaceState(null, '', url);
}
function renderGraphHint() { const host = byId('example-graph'); byId('graph-scroll-hint').hidden = host.scrollWidth <= host.clientWidth; }
function renderGraph() {
  const active = example(), copy = messages(), host = byId('example-graph');
  const previousScroll = host.scrollLeft, sameCase = host.dataset.caseId === active.id;
  const svg = svgElement('svg', { viewBox: '0 0 660 ' + active.height, role: 'group', 'aria-labelledby': 'graph-title graph-description' });
  svg.append(svgElement('title', { id: 'graph-title' }, copy[active.titleKey]), svgElement('desc', { id: 'graph-description' }, copy[active.descriptionKey]));
  const defs = svgElement('defs'), marker = svgElement('marker', { id: 'influence-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
  marker.append(svgElement('path', { d: 'M0 0L8 4L0 8Z', fill: 'currentColor' })); defs.append(marker); svg.append(defs);
  for (const edge of active.edges) {
    svg.append(svgElement('path', { d: edge.d, class: 'graph-edge ' + edge.kind + (edge.condensed ? ' condensed' : ''), ...(edge.kind === 'influence' ? { 'marker-end': 'url(#influence-arrow)' } : {}) }));
  }
  for (const label of active.labels) svg.append(svgElement('text', { x: label.x, y: label.y, 'text-anchor': label.anchor ?? 'start', class: label.className ?? 'graph-label' }, copy[label.key]));
  for (const node of active.nodes) {
    const group = svgElement('g', { role: 'button', tabindex: '0', 'data-record': node.id, 'aria-label': recordLabel(node.id), 'aria-pressed': 'false', class: 'graph-record' });
    group.append(svgElement('rect', { x: node.x - 22, y: node.y - 22, width: 44, height: 44, class: 'graph-hit' }));
    group.append(svgElement('text', { x: node.x, y: node.y - 25, class: 'graph-year' }, nodeYear(node)));
    group.append(svgElement('circle', { cx: node.x, cy: node.y, r: 7, class: 'graph-node' }));
    const label = svgElement('text', { x: node.labelX ?? node.x, y: node.labelY ?? node.y + 33, 'text-anchor': node.anchor ?? 'middle', class: 'graph-label' });
    copy[node.labelKey].split('\n').forEach((line, index) => label.append(svgElement('tspan', { x: node.labelX ?? node.x, dy: index ? 18 : 0 }, line)));
    group.append(label, svgElement('text', { x: node.x + 13, y: node.y - 8, class: 'graph-endpoints', 'aria-hidden': 'true' }));
    const select = () => { selection.selected = node.id; renderSelection(); };
    group.addEventListener('click', select);
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    svg.append(group);
  }
  host.setAttribute('aria-label', copy.graphRegion); host.replaceChildren(svg);
  const selected = active.nodes.find(node => node.id === selection.selected);
  host.scrollLeft = sameCase ? previousScroll : Math.max(0, selected.x / 660 * svg.getBoundingClientRect().width - host.clientWidth / 2);
  host.dataset.caseId = active.id; renderGraphHint();
  document.querySelector('[data-example-influence]').hidden = !active.edges.some(edge => edge.kind === 'influence');
  document.querySelector('[data-example-condensed]').hidden = !active.edges.some(edge => edge.condensed);
}
function renderRecord() {
  const active = example(), copy = messages(), { commit, snapshot } = investigation.record(active, selection.selected);
  byId('record-title').textContent = text(commit.title);
  byId('record-date').textContent = recordLabel(commit.id);
  byId('record-branch').textContent = snapshot.branchId;
  byId('record-summary').textContent = text(commit.summary);
  const values = byId('record-fields'); values.replaceChildren();
  const sources = byId('record-sources'); sources.replaceChildren();
  let evidenceCount = 0;
  for (const id of active.fieldIds) {
    const value = snapshot.fields[id], item = element('div'), description = element('dd');
    const fieldName = text(investigation.field(id).name);
    item.append(element('dt', fieldName));
    description.append(element('strong', fieldValue(value)));
    if (value?.status === 'known') {
      const changedAt = model.history.commits.find(record => record.id === value.changedAt);
      description.append(element('small', value.inherited ? copy.inherited + ' · ' + changedAt.year : copy.recordedHere));
    }
    item.append(description); values.append(item);
    const references = value?.evidence?.length ? value.evidence : (value?.sourceIds ?? []).map(sourceId => ({ sourceId }));
    const claim = element('li'), referencesList = element('ul');
    for (const reference of references) {
      const link = sourceLink(investigation.source(reference.sourceId));
      if (!link) continue;
      const entry = element('li'); entry.append(link);
      if (reference.locator) entry.append(element('p', reference.locator, 'evidence-locator'));
      if (reference.note) entry.append(element('p', text(reference.note), 'evidence-locator'));
      referencesList.append(entry); evidenceCount++;
    }
    if (referencesList.childElementCount) { claim.append(element('strong', fieldName), referencesList); sources.append(claim); }
  }
  byId('record-evidence').hidden = evidenceCount === 0;
}
function renderComparison() {
  const active = example(), copy = messages(), diff = investigation.compare(active, selection.a, selection.b);
  const body = byId('comparison-body'); body.replaceChildren();
  for (const row of diff.rows) {
    const line = element('tr'), label = element('th'); label.scope = 'row';
    label.append(element('span', text(investigation.field(row.fieldId).name)), element('small', copy[row.kind] ?? copy.unknown, 'difference ' + row.kind));
    line.append(label, element('td', fieldValue(row.before)), element('td', fieldValue(row.after))); body.append(line);
  }
  byId('common-base').textContent = diff.commonBaseIds.length
    ? copy.commonPast + ' · ' + diff.commonBaseIds.map(id => { const node = active.nodes.find(item => item.id === id); if (node) return recordLabel(id); const commit = model.history.commits.find(item => item.id === id); return commit.date?.precision === 'approximate' ? copy.approxYear.replace('{year}', String(commit.year)) : String(commit.year); }).join(', ')
    : copy.independentPaths;
}
function renderCommands() {
  const commands = commandsForExample(example(), selection);
  for (const node of document.querySelectorAll('[data-example-command]')) node.textContent = commands[node.dataset.exampleCommand];
}
function renderSelection() {
  for (const group of document.querySelectorAll('[data-record]')) {
    const id = group.dataset.record;
    group.setAttribute('aria-pressed', String(id === selection.selected));
    group.querySelector('.graph-endpoints').textContent = [selection.a === id ? 'A' : '', selection.b === id ? 'B' : ''].filter(Boolean).join(' · ');
  }
  renderRecord(); renderComparison(); renderCommands();
}
function renderCase() {
  const active = example(), copy = messages();
  byId('case-panel').setAttribute('aria-labelledby', 'case-' + active.id);
  for (const button of document.querySelectorAll('[data-case]')) {
    const item = getExample(button.dataset.case), selected = item.id === active.id;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    button.querySelector('strong').textContent = copy[item.labelKey]; button.querySelector('span').textContent = copy[item.themeKey];
  }
  byId('case-question').textContent = copy[active.titleKey];
  byId('case-years').textContent = copy[active.yearsKey];
  byId('case-insight').textContent = copy[active.insightKey];
  byId('diagram-note').textContent = copy[active.noteKey];
  document.querySelector('.example-evidence').href = active.evidence;
  for (const [index, article] of [...document.querySelectorAll('.operations article')].entries()) {
    article.querySelector('h3').textContent = copy[active.operationKeys[index]];
    article.querySelector('p').textContent = copy[active.bodyKeys[index]];
  }
  for (const endpoint of ['a', 'b']) {
    const select = byId('comparison-' + endpoint); select.replaceChildren();
    for (const node of active.nodes) { const option = element('option', recordLabel(node.id)); option.value = node.id; select.append(option); }
    select.value = selection[endpoint];
  }
  renderGraph(); renderSelection();
}
function renderRelease() {
  document.querySelector('#download')?.remove();
  byId('preview').hidden = Boolean(release);
  const section = byId('installation'); section.replaceChildren(); section.hidden = !release;
  if (!release) return;
  const copy = releaseCopy[locale];
  byId('release-status').textContent = copy.status(release);
  const link = element('a', copy.download, 'primary'); link.id = 'download'; link.href = release.url; byId('actions').prepend(link);
  section.append(element('h2', copy.install), element('p', copy.instructions));
  if (release.signing === 'unsigned') section.append(element('p', copy.unsigned));
  section.append(element('p', 'SHA-256 · ' + release.sha256));
  const evidence = element('a', copy.acceptance); evidence.href = release.acceptanceReceipt.url; section.append(evidence);
}
function render() {
  const copy = messages();
  document.documentElement.lang = locale; document.title = copy.pageTitle;
  document.querySelector('meta[name="description"]').content = copy.description;
  for (const node of document.querySelectorAll('[data-copy]')) node.textContent = copy[node.dataset.copy];
  const language = byId('language'); language.textContent = locale === 'en' ? '简体中文' : 'English'; language.lang = locale === 'en' ? 'zh-CN' : 'en';
  byId('case-tabs').setAttribute('aria-label', copy.caseTabs);
  document.querySelector('.operations').setAttribute('aria-label', copy.operations);
  try { renderCase(); byId('example-error').hidden = true; } catch { byId('example-error').textContent = copy.exampleError; byId('example-error').hidden = false; }
  renderRelease();
}
function selectCase(id) { selection = initialSelection(id); byId('record-evidence').open = false; syncURL(); render(); }
for (const item of cases) {
  const button = element('button', undefined, 'case-tab'); button.type = 'button'; button.id = 'case-' + item.id;
  button.dataset.case = item.id; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'case-panel');
  button.append(element('strong'), element('span'));
  button.addEventListener('click', () => selectCase(item.id));
  button.addEventListener('keydown', event => {
    const index = cases.indexOf(item), next = event.key === 'ArrowRight' ? (index + 1) % cases.length : event.key === 'ArrowLeft' ? (index + cases.length - 1) % cases.length : event.key === 'Home' ? 0 : event.key === 'End' ? cases.length - 1 : null;
    if (next !== null) { event.preventDefault(); selectCase(cases[next].id); byId('case-' + cases[next].id).focus(); }
  });
  byId('case-tabs').append(button);
}
for (const endpoint of ['a', 'b']) byId('comparison-' + endpoint).addEventListener('change', event => {
  if (example().nodes.some(node => node.id === event.target.value)) { selection[endpoint] = event.target.value; renderSelection(); }
});
byId('language').addEventListener('click', () => { locale = locale === 'en' ? 'zh-CN' : 'en'; syncURL(); render(); });
if (parameters.has('case') && !cases.some(item => item.id === parameters.get('case'))) syncURL();
render();
window.addEventListener('resize', renderGraphHint);
fetch('./release.json').then(response => response.ok ? response.json() : null).then(value => { release = validateRelease(value); renderRelease(); }).catch(() => { release = null; });
