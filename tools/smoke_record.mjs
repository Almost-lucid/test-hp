#!/usr/bin/env node
// Smoke-test and record static demos.
// Usage: node tools/smoke_record.mjs <slug> [slug...]   (no args = every demos/*/ with an index.html)
// Env: BASE_URL  serve root that contains /demos/ (e.g. http://localhost:8000). If unset, an in-process static server is started.
//      DEMOS_DIR directory holding the slugs (default: demos)   OUT_DIR (default: out)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DEMOS_DIR = process.env.DEMOS_DIR || 'demos';
const OUT_DIR = process.env.OUT_DIR || 'out';
const TARGET_MS = 20000;
const MOBILE = { width: 375, height: 812 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let slugs = process.argv.slice(2).filter(Boolean);
if (!slugs.length) {
  slugs = fs.readdirSync(DEMOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DEMOS_DIR, d.name, 'index.html')))
    .map((d) => d.name);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function readSteps(slug) {
  const f = path.join(DEMOS_DIR, slug, 'demo.json');
  if (!fs.existsSync(f)) return { meta: {}, steps: [] };
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { meta, steps: (meta.steps || []).slice(0, 5) };
}

async function smoke(browser, url, outDir) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  // AGENTS.md: no external network requests.
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    errors.push(`external request blocked: ${u.href}`); return r.abort();
  });
  const resp = await page.goto(url, { waitUntil: 'load' });
  if (!resp || !resp.ok()) errors.push(`HTTP ${resp ? resp.status() : 'no response'} for ${url}`);
  await sleep(800);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (sw > MOBILE.width) errors.push(`horizontal scroll at 375px: scrollWidth=${sw}`);
  await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: true });
  await ctx.close();
  return errors;
}

async function record(browser, url, steps, outDir, viewport, name, mobile) {
  const tmp = fs.mkdtempSync(path.join(outDir, '.rec-'));
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: tmp, size: viewport } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2000);
  if (!steps.length) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let i = 1; i <= 6; i++) { await page.evaluate((y) => scrollTo({ top: y, behavior: 'smooth' }), (h * i) / 6); await sleep(1500); }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  }
  const gap = Math.max(1500, Math.floor((TARGET_MS - 6000) / Math.max(1, steps.length)));
  for (const s of steps) {
    if (s.action === 'click') { await page.locator(s.selector).first().click({ timeout: 5000 }); }
    else if (s.action === 'fill') {
      const loc = page.locator(s.selector).first();
      await loc.click({ timeout: 5000 }); await loc.fill('');
      await loc.pressSequentially(String(s.value ?? ''), { delay: 180 });
    } else if (s.action === 'wait') { await sleep(s.ms ?? 1000); continue; }
    else throw new Error(`unknown step action: ${s.action}`);
    await sleep(gap);
  }
  const left = TARGET_MS - (Date.now() - t0);
  if (left > 0) await sleep(left);
  const video = page.video();
  await ctx.close();
  const webm = path.join(outDir, `${name}.webm`);
  fs.renameSync(await video.path(), webm);
  fs.rmSync(tmp, { recursive: true, force: true });
  const mp4 = path.join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', '-an', mp4]);
  return mp4;
}

const server = process.env.BASE_URL ? null : await startServer();
const base = (process.env.BASE_URL || `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
const browser = await chromium.launch();
const results = [];
let failed = false;
for (const slug of slugs) {
  const outDir = path.join(OUT_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });
  const url = `${base}/${DEMOS_DIR.replace(/^\.\//, '').replace(/\/$/, '')}/${slug}/`;
  const r = { slug, url, errors: [] };
  try {
    const { steps } = readSteps(slug);
    r.errors = await smoke(browser, url, outDir);
    if (!r.errors.length) {
      await record(browser, url, steps, outDir, { width: 1280, height: 720 }, 'video', false);
      await record(browser, url, steps, outDir, MOBILE, 'video-portrait', true);
    }
  } catch (e) { r.errors.push(String(e.message || e)); }
  r.ok = r.errors.length === 0;
  if (!r.ok) failed = true;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${slug}${r.errors.map((e) => `\n  - ${e}`).join('')}`);
  results.push(r);
}
await browser.close();
server?.close();
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
