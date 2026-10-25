import { validateRelease } from './release-validation.mjs';
import { chinese, releaseCopy } from './locales.mjs';
const english = Object.fromEntries([...document.querySelectorAll('[data-copy]')].map(node => [node.dataset.copy, node.textContent]));

let locale = 'en';
let release = null;
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function renderRelease() {
  document.querySelector('#download')?.remove();
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
  document.documentElement.lang = locale;
  const messages = locale === 'en' ? english : chinese;
  document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = messages[node.dataset.copy] ?? english[node.dataset.copy]; });
  const language = document.querySelector('#language'); language.textContent = locale === 'en' ? '简体中文' : 'English'; language.lang = locale === 'en' ? 'zh-CN' : 'en';
  document.querySelector('#graph-title').textContent = releaseCopy[locale].graphTitle;
  document.querySelector('.operations').setAttribute('aria-label', releaseCopy[locale].operations);
  renderRelease();
}
document.querySelector('#language').addEventListener('click', () => { locale = locale === 'en' ? 'zh-CN' : 'en'; render(); });
fetch('./release.json').then(response => response.ok ? response.json() : null).then(value => { release = validateRelease(value); renderRelease(); }).catch(() => { release = null; });
