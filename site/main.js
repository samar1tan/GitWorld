import { validateRelease } from './release-validation.mjs';
import { english, chinese, releaseCopy } from './locales.mjs';
import { examples } from './examples.mjs';

let locale = new URL(location.href).searchParams.get('lang') === 'zh-CN' ? 'zh-CN' : 'en';
let release = null;
const messages = () => locale === 'en' ? english : chinese;
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderExample() {
  const example = examples[locale], copy = messages(), host = document.querySelector('#example-graph');
  const svg = svgElement('svg', {viewBox: `0 0 540 ${example.height}`, role: 'img', 'aria-labelledby': 'graph-title graph-description'});
  svg.append(svgElement('title', {id:'graph-title'}, copy.graphTitle), svgElement('desc', {id:'graph-description'}, copy.graphDescription));
  const defs = svgElement('defs'), marker = svgElement('marker', {id:'influence-arrow', viewBox:'0 0 8 8', refX:7, refY:4, markerWidth:7, markerHeight:7, orient:'auto'});
  marker.append(svgElement('path', {d:'M0 0L8 4L0 8Z', fill:'currentColor'})); defs.append(marker); svg.append(defs);
  for (const edge of example.edges) svg.append(svgElement('path', {d:edge.d, class:`graph-edge ${edge.kind}`, ...(edge.kind==='influence'?{'marker-end':'url(#influence-arrow)'}:{})}));
  for (const node of example.nodes) {
    if (node.year !== undefined || node.yearKey) svg.append(svgElement('text', {x:node.x, y:node.y-22, class:'graph-year'}, node.yearKey ? copy[node.yearKey] : String(node.year)));
    svg.append(svgElement('circle', {cx:node.x, cy:node.y, r:node.selected?7:6, class:`graph-node${node.selected?' selected':''}`}));
  }
  for (const label of example.labels) svg.append(svgElement('text', {x:label.x, y:label.y, 'text-anchor':label.anchor??'start', class:label.className??'graph-label'}, copy[label.key]));
  host.setAttribute('aria-label', copy.graphRegion); host.replaceChildren(svg); host.scrollLeft = 0;
  document.querySelector('.example-evidence').href = example.evidence;
  document.querySelector('[data-example-influence]').hidden = !example.edges.some(edge => edge.kind === 'influence');
  for (const node of document.querySelectorAll('[data-example-command]')) {
    const tokens = example.commands[node.dataset.exampleCommand].split(' ');
    node.replaceChildren(...tokens.flatMap((token, index) => [
      ...(index ? [document.createTextNode(' ')] : []), element('span', token),
    ]));
  }
}
function renderRelease() {
  document.querySelector('#download')?.remove();
  document.querySelector('#preview').hidden = Boolean(release);
  const section = document.querySelector('#installation'); section.replaceChildren(); section.hidden = !release;
  if (!release) return;
  const copy = releaseCopy[locale];
  document.querySelector('#release-status').textContent = copy.status(release);
  const link = element('a', copy.download, 'primary'); link.id = 'download'; link.href = release.url; document.querySelector('#actions').prepend(link);
  section.append(element('h2', copy.install));
  section.append(element('p', copy.instructions));
  if (release.signing === 'unsigned') section.append(element('p', copy.unsigned));
  section.append(element('p', `SHA-256 · ${release.sha256}`));
  const evidence = element('a', copy.acceptance); evidence.href = release.acceptanceReceipt.url; section.append(evidence);
}
function render() {
  const copy = messages();
  document.documentElement.lang = locale; document.title = copy.pageTitle;
  document.querySelector('meta[name="description"]').content = copy.description;
  document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = copy[node.dataset.copy]; });
  const language = document.querySelector('#language'); language.textContent = locale === 'en' ? '简体中文' : 'English'; language.lang = locale === 'en' ? 'zh-CN' : 'en';
  document.querySelector('.identity').href = locale === 'zh-CN' ? './?lang=zh-CN' : './';
  document.querySelector('.operations').setAttribute('aria-label', copy.operations);
  renderExample(); renderRelease();
}
document.querySelector('#language').addEventListener('click', () => {
  locale = locale === 'en' ? 'zh-CN' : 'en';
  const url = new URL(location.href); if (locale === 'zh-CN') url.searchParams.set('lang',locale); else url.searchParams.delete('lang');
  history.replaceState(null,'',url); render();
});
render();
fetch('./release.json').then(response => response.ok ? response.json() : null).then(value => { release = validateRelease(value); renderRelease(); }).catch(() => { release = null; });
