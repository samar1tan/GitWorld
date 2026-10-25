/** Replace surrounding content without disconnecting a live child or its editor. */
export function replaceChildrenAround(target: HTMLElement, replacement: HTMLElement, retained: HTMLElement, placeholder: HTMLElement | null = null): boolean {
  if (retained.parentElement !== target || placeholder && placeholder.parentElement !== replacement) return false;
  for (const child of [...target.childNodes]) if (child !== retained) child.remove();
  let after = false;
  for (const child of [...replacement.childNodes]) {
    if (child === placeholder) { after = true; continue; }
    if (after) target.append(child); else target.insertBefore(child, retained);
  }
  return true;
}

/** Live input values are synchronized separately from their default-value attribute. */
export function syncElementAttributes(target: HTMLElement, replacement: HTMLElement, ignored: readonly string[] = []): void {
  for (const attribute of [...target.attributes]) if (!ignored.includes(attribute.name) && !replacement.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  for (const attribute of [...replacement.attributes]) if (!ignored.includes(attribute.name) && target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
}
