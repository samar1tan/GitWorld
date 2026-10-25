import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validPackage } from '../../../../packages/storage/src/test-fixtures.ts';
import { validateDataPackage } from '../../../../packages/domain/src/validation.ts';

const bundled = await build({ entryPoints: [new URL('./manager.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, logLevel: 'silent' });
const { createManager } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[key]);
const attributes = text => Object.fromEntries([...text.matchAll(/([\w.-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value ?? '')]));

// This bounded form host consumes the actual component's generated controls.
// It exercises handlers and transport, not browser layout or installed acceptance.
function fixture(t, initialLocale) {
  let locale = initialLocale, activeElement = null, published = 0, confirmations = 0;
  let draft = { id: 'draft', version: 3, baseRevision: null, updatedAt: '2026-10-25T00:00:00Z', package: validPackage() };
  const calls = [], head = 'a'.repeat(40), errors = [];
  class Element {
    constructor(tagName = 'div', attrs = {}, text = '') { this.tagName = tagName.toUpperCase(); this.attrs = attrs; this.dataset = {}; for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; this.name = attrs.name; this.type = attrs.type; this.value = attrs.value ?? text; this.textContent = text; this.checked = 'checked' in attrs; this.hidden = 'hidden' in attrs; this.disabled = 'disabled' in attrs; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    focus() { activeElement = this; }
    remove() { this.removed = true; }
    closest() { return this.form ?? null; }
  }
  class Form extends Element {
    constructor(attrs, html) {
      super('form', attrs); this.elements = []; this.notices = [];
      for (const match of html.matchAll(/<(input)\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/(?:textarea|select)>/g)) {
        const tag = match[1] ?? match[3], attrs = attributes(match[2] ?? match[4]); let value = decode(match[5] ?? '');
        if (tag === 'select') { const choices = [...(match[5] ?? '').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(match => attributes(match[1])); value = (choices.find(choice => 'selected' in choice) ?? choices[0])?.value ?? ''; }
        const control = new Element(tag, attrs, value); control.form = this; this.elements.push(control);
      }
      for (const match of html.matchAll(/<(small|span)\b([^>]*data-manager-group-error[^>]*)>([^<]*)<\/(?:small|span)>/g)) { const notice = new Element(match[1], attributes(match[2]), decode(match[3])); notice.form = this; this.notices.push(notice); }
    }
    querySelector(selector) { if (selector === '[data-manager-field-group]') return this.elements.find(control => 'managerFieldGroup' in control.dataset) ?? null; if (selector === '[data-manager-group-error]') return this.notices.find(notice => 'managerGroupError' in notice.dataset) ?? null; if (selector === '.manager-local-error') return this.notices.find(notice => notice.className?.includes('manager-local-error')) ?? null; const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1]; return this.elements.find(control => control.name === name) ?? null; }
    prepend(node) { this.notices.unshift(node); }
  }
  const app = {
    forms: [], html: '',
    set innerHTML(html) { this.html = html; this.forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(match => new Form(attributes(match[1]), match[2])); },
    get innerHTML() { return this.html; },
    querySelector(selector) { const purpose = selector.match(/data-manager-form="([^"]+)"/)?.[1]; return purpose ? this.forms.find(form => form.dataset.managerForm === purpose) ?? null : null; },
    querySelectorAll(selector) { return selector.startsWith('details') ? [] : this.forms.filter(form => selector.includes(`data-manager-form="${form.dataset.managerForm}"`)); },
  };
  class FormValues extends Map {
    constructor(form) { super(); for (const control of form.elements) if (control.name && !control.disabled && (!['checkbox', 'radio'].includes(control.type) || control.checked)) this.set(control.name, control.value); }
  }
  const document = { get activeElement() { return activeElement; }, querySelector: selector => selector === '#app' ? app : app.querySelector(selector), querySelectorAll: selector => app.querySelectorAll(selector), createElement: tag => new Element(tag) };
  const bridge = { onProgress: () => () => {}, async request(input) {
    calls.push(structuredClone(input)); const p = input.params; let result;
    switch (input.method) {
      case 'library.status': result = { schemaVersion: 3, datasets: [] }; break;
      case 'draft.list': result = [{ id: draft.id, datasetName: draft.package.dataset.name, revisionId: draft.package.revision.id, version: draft.version, updatedAt: draft.updatedAt }]; break;
      case 'source.list': result = []; break;
      case 'draft.get': result = structuredClone(draft); break;
      case 'draft.validate': result = []; break;
      case 'model.catalog': result = { revision: 'working', head, models: [] }; break;
      case 'draft.preview': result = { added: ['model'], changed: [], removed: [], issues: [] }; break;
      case 'draft.save': {
        const checked = validateDataPackage(p.package, 'shape');
        if (!checked.ok) return { protocolVersion: 1, requestId: input.requestId, ok: false, error: { code: 'INVALID_REQUEST' } };
        draft = { ...draft, package: checked.value, version: draft.version + 1 }; result = structuredClone(draft); break;
      }
      case 'draft.publish': published++; result = { datasetId: draft.package.dataset.id, revisionId: draft.package.revision.id, working: { head, path: 'models/technical.json', contentHash: 'b'.repeat(64) } }; break;
      default: throw new Error(`Unexpected model form operation ${input.method}`);
    }
    return { protocolVersion: 1, requestId: input.requestId, ok: true, result };
  } };
  const globals = { document, window: { gitworld: bridge, confirm: () => { confirmations++; return false; } }, FormData: FormValues, HTMLElement: Element, HTMLInputElement: Element, HTMLTextAreaElement: Element, HTMLSelectElement: Element };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const manager = createManager({ locale: () => locale, package: () => null, onClose() {}, onPublished: async () => {}, onError: error => errors.push(error) });
  const click = (action, extra = {}) => manager.click({ dataset: { manager: action, ...extra } });
  return { manager, app, calls, click, document, errors, locale: value => { locale = value; }, draft: () => draft, published: () => published, confirmations: () => confirmations, form: purpose => app.forms.find(form => form.dataset.managerForm === purpose) };
}

for (const locale of ['en', 'zh-CN']) {
  test(`${locale}: model publication reports working adoption and still requires the separate repository workflow`, async t => {
    const f = fixture(t, locale); await f.manager.open(); await f.click('open-draft', { id: 'draft' }); await f.click('preview');
    const form = f.form('publish'); form.querySelector('[name="reviewer"]').value = 'Technical reviewer'; form.querySelector('[name="note"]').value = 'Reviewed the synthetic model'; form.querySelector('[name="evidence"]').checked = true; form.querySelector('[name="rights"]').checked = true;
    await f.manager.submit(form);
    assert.equal(f.published(), 1); const publish = f.calls.find(call => call.method === 'draft.publish');
    assert.equal(publish.params.expectedVersion, 3); assert.equal(publish.params.expectedHead, 'a'.repeat(40)); assert.equal(publish.params.expectedModelHash, null);
    assert.equal(publish.params.review.evidenceReviewed, true); assert.equal(publish.params.review.rightsReviewed, true);
    assert.equal(f.calls.some(call => call.method.startsWith('repository.')), false);
    assert.match(f.app.html, locale === 'en' ? /Model added to working data[\s\S]*Changes/ : /模型已加入工作数据[\s\S]*待提交/);
    assert.doesNotMatch(f.app.html, /Release published|数据版本已发布/);
    const calls = f.calls.length; f.locale(locale === 'en' ? 'zh-CN' : 'en'); f.manager.render();
    assert.match(f.app.html, locale === 'en' ? /模型已加入工作数据/ : /Model added to working data/); assert.equal(f.calls.length, calls);
  });

  test(`${locale}: an invalid field group stays in its form until corrected without sending a domain write`, async t => {
    const f = fixture(t, locale); await f.manager.open(); await f.click('open-draft', { id: 'draft' }); await f.click('kind', { kind: 'field' });
    const form = f.form('object'), group = form.querySelector('[name="object.group"]'), name = form.querySelector('[name="object.name.en"]');
    name.value = 'A revised label';
    for (const invalid of ['Office tenure', 'constructor', 'office//tenure', 'a'.repeat(129)]) {
      group.value = invalid; await f.manager.change(group); await f.manager.submit(form);
      assert.equal(f.calls.filter(call => call.method === 'draft.save').length, 0);
      assert.equal(f.form('object'), form); assert.equal(form.querySelector('[name="object.group"]'), group);
      assert.equal(group.value, invalid); assert.equal(name.value, 'A revised label');
      assert.equal(group.getAttribute('aria-invalid'), 'true'); assert.equal(f.document.activeElement, group);
      const notice = form.querySelector('[data-manager-group-error]'); assert.equal(notice.hidden, false);
      assert.match(notice.textContent, locale === 'en' ? /group identifier.*office/ : /分组标识符.*office/);
      assert.ok(group.getAttribute('aria-describedby').includes(notice.attrs.id));
    }
    assert.match(f.app.html, /office/); assert.equal(await f.manager.close(), false); assert.equal(f.confirmations(), 1);
    group.value = 'office'; await f.manager.change(group); assert.equal(group.getAttribute('aria-invalid'), 'false'); assert.equal(form.querySelector('[data-manager-group-error]').hidden, true);
    await f.manager.submit(form);
    const writes = f.calls.filter(call => call.method === 'draft.save'); assert.equal(writes.length, 1); assert.equal(writes[0].params.expectedVersion, 3);
    assert.equal(f.draft().package.history.fields[0].group, 'office'); assert.equal(f.draft().package.history.fields[0].name.en, 'A revised label');
    assert.equal(f.errors.length, 0);
  });
}
