// Headless integration walkthrough. Reuses only the explicitly isolated polish ports.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChromium } from '../apps/server/src/render';

const phase = process.argv[2] ?? 'after';
const output = resolve(`test-results/polish/${phase}`);
await mkdir(output, { recursive: true });
const browser = await launchChromium();
const errors: string[] = [];
const checks: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) requests.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  const shot = async (name: string) => { console.log(name); await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); };
  await page.goto('http://127.0.0.1:5211', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Search files').waitFor();
  await shot('home-light');
  const file = await page.evaluate(async () => {
    const result = await fetch('/api/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Integration review' }) });
    return result.json();
  });
  await page.goto(`http://127.0.0.1:5211/file/${file.id}`, { waitUntil: 'networkidle' });
  await page.locator('.of-canvas').waitFor();
  const ids = await page.evaluate(async (modelUrl) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name);
    const { createComponent, createInstance } = await import(modelUrl);
    const file = ws.getActiveFile()!;
    const root = file.store.doc.pages[file.activePageId].rootId;
    const ids = file.store.transact('Integration fixtures', (tx) => {
      const inserted = tx.insertTrees(root, [
        { type: 'Frame', name: 'Field notes', styles: { position: 'absolute', left: 0, top: 0, width: 400, height: 380, padding: 32, display: 'flex', flexDirection: 'column', gap: 20, backgroundColor: '#f2f0e9', borderRadius: 12 }, children: [
          { type: 'Text', name: 'Heading', text: 'A field companion', styles: { fontFamily: 'Geist', fontSize: 32, fontWeight: 600, color: '#272d27' } },
          { type: 'Text', name: 'Description', text: 'Collect ideas. Shape the details.', styles: { fontSize: 16, color: '#596258' } },
          { type: 'SVG', name: 'Shapes', styles: { width: 220, height: 80 }, attrs: { viewBox: '0 0 220 80' }, children: [{ type: 'SVGElement', tag: 'g', name: 'Group', children: [
            { type: 'SVGElement', tag: 'rect', name: 'Rect', attrs: { x: '4', y: '4', width: '60', height: '60', rx: '8', fill: '#d97757' } },
            { type: 'SVGElement', tag: 'circle', name: 'Circle', attrs: { cx: '110', cy: '34', r: '30', fill: '#475a47' } },
            { type: 'SVGElement', tag: 'path', name: 'Path', attrs: { d: 'M158 64L188 4L218 64Z', fill: '#b4a78d' } },
          ] }] },
        ] },
        { type: 'Frame', name: 'Button', styles: { position: 'absolute', left: 460, top: 0, width: 180, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#475a47', borderRadius: 8 }, children: [{ type: 'Text', text: 'Save notes', styles: { fontSize: 16, color: '#ffffff' } }] },
        { type: 'Image', name: 'Sample image', src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" fill="#d97757"/></svg>'), styles: { position: 'absolute', left: 460, top: 120, width: 180, height: 100 } },
        { type: 'Shader', name: 'Gradient', shader: { name: 'MeshGradient', params: { speed: 0 } }, styles: { position: 'absolute', left: 460, top: 260, width: 180, height: 120 } },
      ]);
      return inserted;
    });
    // insertTrees returns root ids; look up the fixture nodes by name afterwards.
    const doc = file.store.doc;
    const byName = Object.fromEntries(Object.values(doc.nodes).map((n) => [n.name, n.id]));
    file.store.transact('Create component', (tx) => createComponent(tx, byName.Button, { props: [] }));
    const instance = file.store.transact('Create instance', (tx) => createInstance(tx, byName.Button, root, { styles: { position: 'absolute', left: 460, top: 410 } }));
    return { ...byName, Instance: instance };
  }, '/@fs' + resolve('packages/model/src/index.ts'));
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(1000);
  const select = async (name: string) => page.evaluate(async ({ fileId, id }) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name); ws.setLeftTab('layers'); ws.setRightTab('design'); ws.setSelection(fileId, [id]);
  }, { fileId: file.id, id: ids[name] });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (theme) => { const p = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/prefs.ts')).at(-1)!.name); p.setPrefs({ theme }); }, theme);
    if (theme === 'dark') {
      await page.evaluate(async () => { const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name); ws.goHome(); });
      await shot('home-dark');
      await page.goto(`http://127.0.0.1:5211/file/${file.id}`, { waitUntil: 'networkidle' });
    }
    for (const name of ['Field notes', 'Heading', 'Shapes', 'Rect', 'Sample image', 'Gradient', 'Instance', 'Button']) {
      await select(name);
      await page.waitForTimeout(150);
      await shot(`${theme}-${name.replaceAll(' ', '-').toLowerCase()}`);
      const inspector = page.locator('.of-inspector').last();
      await inspector.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await shot(`${theme}-${name.replaceAll(' ', '-').toLowerCase()}-lower`);
      await inspector.evaluate((el) => { el.scrollTop = 0; });
    }
    await select('Button');
    await page.evaluate(async ({ fileId, id }) => { const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name); ws.markAgentWork(fileId, [id], 'claude-code', 'Refining layout'); }, { fileId: file.id, id: ids.Button });
    await page.waitForTimeout(100);
    await shot(`${theme}-working`);
    const badgeCheck = await page.evaluate(() => {
      const size = document.querySelector<HTMLElement>('[data-of-size-badge]')!;
      const agent = document.querySelector<HTMLElement>('[data-of-agent-badge]')!;
      const a = size.getBoundingClientRect(), b = agent.getBoundingClientRect();
      const cs = getComputedStyle(size);
      return { color: cs.color, background: cs.backgroundColor, overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top };
    });
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const fg = luminance(badgeCheck.color), bg = luminance(badgeCheck.background);
    const contrast = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    if (badgeCheck.overlap || contrast < 4.5) throw new Error(`Badge check failed: ${JSON.stringify(badgeCheck)}`);
    checks.push({ theme, contrast, ...badgeCheck });
    await page.evaluate(async (fileId) => { const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name); ws.clearAgentWork(fileId); }, file.id);
    for (const tab of ['Theme', 'Assets', 'Layers']) {
      await page.getByRole('radio', { name: tab, exact: true }).click();
      await shot(`${theme}-${tab.toLowerCase()}`);
    }
    for (const tab of ['Code', 'Agent', 'Design']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await shot(`${theme}-${tab.toLowerCase()}`);
      if (tab === 'Agent') {
        await page.getByRole('button', { name: 'Activity', exact: true }).click();
        await shot(`${theme}-activity`);
      }
    }
    for (const settings of ['general', 'agents', 'guide', 'ai', 'shortcuts']) {
      await page.evaluate((p) => window.dispatchEvent(new CustomEvent('opencrease:settings', { detail: { page: p } })), settings);
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(200);
      await shot(`${theme}-settings-${settings}`);
      await page.keyboard.press('Escape');
    }
    for (const surface of ['command-palette', 'connect-agent', 'history', 'plugins']) {
      await page.evaluate((surface) => window.dispatchEvent(new Event(`opencrease:${surface}`)), surface);
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(150);
      if (surface === 'history') {
        await page.getByRole('textbox', { name: 'Version name' }).fill('Integration checkpoint');
        await page.getByRole('button', { name: 'Save version', exact: true }).click();
        await page.getByRole('button', { name: /Integration checkpoint/ }).last().click();
      }
      if (surface === 'connect-agent') await page.getByRole('button', { name: 'Set up', exact: true }).first().click();
      await shot(`${theme}-${surface}`);
      await page.keyboard.press('Escape');
    }
    for (const mode of ['image', 'svg', 'edit']) {
      await page.evaluate((mode) => window.dispatchEvent(new CustomEvent('opencrease:ai-generate', { detail: { mode } })), mode);
      await page.getByRole('dialog').waitFor();
      await shot(`${theme}-generate-${mode}`);
      await page.keyboard.press('Escape');
    }
    await select('Field notes');
    const inspector = page.locator('.of-inspector').last();
    await inspector.getByRole('button', { name: 'Add export', exact: true }).click();
    await page.getByRole('button', { name: /^Export Field notes/ }).count();
    await inspector.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(400);
    await shot(`${theme}-export`);
    const exportButton = inspector.getByRole('button', { name: /^Export/, exact: false }).filter({ hasText: /Export/ }).last();
    const download = page.waitForEvent('download', { timeout: 20000 });
    await exportButton.click();
    await (await download).saveAs(`${output}/${theme}-export.png`);

  }
  await writeFile(`${output}/errors.json`, JSON.stringify({ errors, requests }, null, 2));
  await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2));
  await writeFile(`${output}/fixture.json`, JSON.stringify({ fileId: file.id, ids }, null, 2));
  console.log(JSON.stringify({ output, errors }));
} finally { await browser.close(); }
