#!/usr/bin/env node
// Generates <dir>/index.html listing every <dir>/<slug>/demo.json. Usage: node tools/build_index.mjs [dir=demos]
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] || 'demos';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const items = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
  .map((d) => { const f = path.join(dir, d.name, 'demo.json'); return fs.existsSync(f) ? { slug: d.name, ...JSON.parse(fs.readFileSync(f, 'utf8')) } : null; })
  .filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demos</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:640px;padding:24px 16px;color:#1d2433}
li{margin:0 0 14px}a{font-weight:600}p{margin:2px 0 0;color:#6b7385}</style></head><body><h1>Demos</h1><ul>
${items.map((i) => `<li><a href="./${esc(i.slug)}/">${esc(i.title)}</a><p>${esc(i.pitch)}</p></li>`).join('\n')}
</ul></body></html>\n`;
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`index: ${items.length} demo(s)`);
