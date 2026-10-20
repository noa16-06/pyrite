// 16×16 icons in the spirit of the IntelliJ "New UI" icon set.
const svg = (body, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const icons = {
  folder: svg(`<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#43454A" stroke="#868A91"/>`),
  folderTest: svg(`<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#253627" stroke="#5FB865"/>`),
  folderExcluded: svg(`<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#45322B" stroke="#E08855"/>`),
  python: svg(
    `<path d="M7.9 1.5c-3 0-2.8 1.3-2.8 1.3v1.4H8v.4H3.9S2 4.4 2 7.5s1.7 3 1.7 3h1V9s-.1-1.7 1.7-1.7h2.9s1.6 0 1.6-1.6V3.1s.3-1.6-3-1.6zM6.3 2.4a.5.5 0 1 1 0 1 .5.5 0 0 1 0-1z" fill="#548AF7"/>` +
      `<path d="M8.1 14.5c3 0 2.8-1.3 2.8-1.3v-1.4H8v-.4h4.1s1.9.2 1.9-2.9-1.7-3-1.7-3h-1V7s.1 1.7-1.7 1.7H6.7s-1.6 0-1.6 1.6v2.6s-.3 1.6 3 1.6zm1.6-.9a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1z" fill="#F2C55C"/>`
  ),
  text: svg(`<path d="M3.5 1.5h6l3 3v10h-9z" stroke="#9DA0A8"/><path d="M5.5 7.5h5M5.5 9.5h5M5.5 11.5h3" stroke="#9DA0A8"/>`),
  markdown: svg(`<rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="#548AF7"/><path d="M4 10.5v-5l2 2.2 2-2.2v5M11 5.5v5m0 0-1.6-1.6M11 10.5l1.6-1.6" stroke="#548AF7"/>`),
  json: svg(`<path d="M5.5 2.5c-1.5 0-1.5 1-1.5 2v1.5c0 1-.8 2-1.5 2 .7 0 1.5 1 1.5 2v1.5c0 1 0 2 1.5 2M10.5 2.5c1.5 0 1.5 1 1.5 2v1.5c0 1 .8 2 1.5 2-.7 0-1.5 1-1.5 2v1.5c0 1 0 2-1.5 2" stroke="#F2C55C"/>`),
  config: svg(`<circle cx="8" cy="8" r="2" stroke="#9DA0A8"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="#9DA0A8"/>`),
  chevronRight: svg(`<path d="M6 4l4 4-4 4" stroke="#868A91" stroke-width="1.2"/>`),
  chevronDown: svg(`<path d="M4 6l4 4 4-4" stroke="#868A91" stroke-width="1.2"/>`),
  run: svg(`<path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.2-5.2a.5.5 0 0 0 0-.86l-8.2-5.2a.5.5 0 0 0-.76.43z" fill="#5FB865"/>`),
  testPassed: svg(`<circle cx="8" cy="8" r="6" fill="#5FB865"/><path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="#1E1F22" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  testFailed: svg(`<circle cx="8" cy="8" r="6" fill="#F75464"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="#1E1F22" stroke-width="1.5" stroke-linecap="round"/>`),
  testError: svg(`<circle cx="8" cy="8" r="6" fill="#F75464"/><path d="M8 4.8v4" stroke="#1E1F22" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="#1E1F22"/>`),
  testSkipped: svg(`<circle cx="8" cy="8" r="5.5" stroke="#868A91" stroke-width="1.2"/><path d="M4.3 11.7l7.4-7.4" stroke="#868A91" stroke-width="1.2"/>`),
  testRunning: svg(`<circle cx="8" cy="8" r="5.5" stroke="#3574F0" stroke-width="1.5" stroke-dasharray="20 15"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/></circle>`),
  testPending: svg(`<circle cx="8" cy="8" r="5.5" stroke="#6F737A" stroke-width="1.2" stroke-dasharray="2 2"/>`),
  rerunFailed: svg(`<path d="M13 8a5 5 0 1 1-1.6-3.7" stroke="#5FB865" stroke-width="1.3"/><path d="M12.5 1.8v3.3H9.2" stroke="#5FB865" stroke-width="1.3"/><circle cx="12" cy="12" r="3" fill="#F75464"/>`),
  showPassed: svg(`<circle cx="8" cy="8" r="6" stroke="#5FB865" stroke-width="1.3"/><path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="#5FB865" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  rerun: svg(`<path d="M13 8a5 5 0 1 1-1.6-3.7" stroke="#5FB865" stroke-width="1.3"/><path d="M12.5 1.8v3.3H9.2" stroke="#5FB865" stroke-width="1.3"/>`),
  stop: svg(`<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="#DB5C5C"/>`),
  clear: svg(`<circle cx="8" cy="8" r="5.5" stroke="#9DA0A8"/><path d="M4.2 11.8l7.6-7.6" stroke="#9DA0A8"/>`),
  search: svg(`<circle cx="7" cy="7" r="4.5" stroke="#CED0D6" stroke-width="1.2"/><path d="M10.5 10.5l3.5 3.5" stroke="#CED0D6" stroke-width="1.2"/>`),
  project: svg(`<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" stroke="#CED0D6"/>`),
  terminal: svg(`<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="#CED0D6"/><path d="M4 6l2.5 2L4 10M8 10.5h4" stroke="#CED0D6"/>`),
  runTool: svg(`<path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.2-5.2a.5.5 0 0 0 0-.86l-8.2-5.2a.5.5 0 0 0-.76.43z" stroke="#CED0D6"/>`),
  newFile: svg(`<path d="M9.5 1.5h-6v13h9v-10z" stroke="#CED0D6"/><path d="M8 7v5M5.5 9.5h5" stroke="#CED0D6"/>`),
  newDir: svg(`<path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" stroke="#CED0D6"/><path d="M8 6.5v5M5.5 9h5" stroke="#CED0D6"/>`),
  refresh: svg(`<path d="M13 8a5 5 0 1 1-1.6-3.7" stroke="#CED0D6" stroke-width="1.2"/><path d="M12.5 1.8v3.3H9.2" stroke="#CED0D6" stroke-width="1.2"/>`),
  collapse: svg(`<path d="M4 7l4-3.5L12 7M4 12.5L8 9l4 3.5" stroke="#CED0D6" stroke-width="1.2"/>`),
  minimize: svg(`<path d="M3.5 8h9" stroke="#CED0D6" stroke-width="1.2"/>`),
  close: svg(`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="#868A91" stroke-width="1.2"/>`),
  plus: svg(`<path d="M8 3v10M3 8h10" stroke="#CED0D6" stroke-width="1.2"/>`),
};

// Pyrite crystals grow as cubes — the logo is an isometric gold cube.
export const logo = (size = 64) => `
<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pyTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE9A3"/><stop offset="1" stop-color="#E9B949"/></linearGradient>
    <linearGradient id="pyLeft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9A33A"/><stop offset="1" stop-color="#9C6B1C"/></linearGradient>
    <linearGradient id="pyRight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B7832A"/><stop offset="1" stop-color="#6E4612"/></linearGradient>
  </defs>
  <path d="M32 6 L56 19 L32 32 L8 19 Z" fill="url(#pyTop)"/>
  <path d="M8 19 L32 32 L32 58 L8 45 Z" fill="url(#pyLeft)"/>
  <path d="M56 19 L32 32 L32 58 L56 45 Z" fill="url(#pyRight)"/>
  <path d="M32 6 L56 19 L32 32 L8 19 Z M32 32 V58" fill="none" stroke="#FFF4CF" stroke-opacity=".35" stroke-width="1"/>
</svg>`;

export function fileIcon(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyw") || lower.endsWith(".pyi")) return icons.python;
  if (lower.endsWith(".md") || lower.endsWith(".rst")) return icons.markdown;
  if (lower.endsWith(".json")) return icons.json;
  if (/\.(toml|cfg|ini|ya?ml|env)$/.test(lower) || lower.startsWith(".")) return icons.config;
  return icons.text;
}

export function folderIcon(name) {
  if (/^(\.?venv|env|node_modules|build|dist|\.tox|target)$/.test(name)) return icons.folderExcluded;
  if (/^tests?$/.test(name)) return icons.folderTest;
  return icons.folder;
}
