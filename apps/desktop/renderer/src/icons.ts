/* Small geometric controls share a stroke weight and remain native vectors. */
const paths = {
  branch: '<circle cx="10" cy="10" r="8"/><path d="M10 2c6 5 6 11 0 16" opacity=".45"/><path d="M7 14V7m0 5c0-2 6-1 6-4"/><circle cx="7" cy="6.5" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/><circle cx="7" cy="14.5" r="1.4" fill="currentColor"/>',
  library: '<ellipse cx="10" cy="4" rx="6.5" ry="2.5"/><path d="M3.5 4v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V4M3.5 9.5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
  globe: '<circle cx="10" cy="10" r="7.5"/><ellipse cx="10" cy="10" rx="3.2" ry="7.5"/><path d="M2.5 10h15"/>',
  chevron: '<path d="m6 8 4 4 4-4"/>',
  back: '<path d="m11.5 5-5 5 5 5M7 10h9"/>',
  check: '<path d="m4.5 10 3.5 3.5 7.5-7.5"/>',
} as const;
export function icon(name:keyof typeof paths) {
  return `<svg class="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
