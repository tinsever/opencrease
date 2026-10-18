import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchChromium } from '../apps/server/src/render';
import { resolve } from 'node:path';
const fixture = JSON.parse(await readFile('test-results/polish/after/fixture.json', 'utf8'));
const output = resolve('test-results/polish/details'); await mkdir(output, { recursive: true });
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5211/file/${fixture.fileId}`, { waitUntil: 'networkidle' });
  await page.locator('.of-canvas').waitFor();
  await page.evaluate(async ({ fileId, ids }) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name);
    ws.setSelection(fileId, [ids['Field notes']]);
  }, fixture);
  fixture.ids.Pinned = await page.evaluate(async ({ fixture, modelUrl }) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name);
    const model = await import(modelUrl);
    const file = ws.getActiveFile();
    return file.store.transact('Review optional inspector controls', (tx) => {
      if (!tx.doc.modeCollections?.length) tx.createModeCollection('Appearance', ['light', 'dark']);
      if (!tx.doc.tokens.some((t) => t.name === '--color-review')) tx.createToken({ type: 'color', name: '--color-review', value: '#d97757', modes: { dark: '#e6a18a' } });
      if (!tx.doc.textStyles?.length) tx.createTextStyle({ name: 'Heading', styles: { fontSize: 32, fontWeight: 600 } });
      const button = tx.doc.nodes[fixture.ids.Button];
      model.setComponentDef(tx, button.id, { props: [{ name: 'label', type: 'text', target: button.children[0], default: 'Save notes' }] });
      tx.setStyles(fixture.ids['Field notes'], { display: 'flex', gridTemplateColumns: null });
      return tx.insertTrees(fixture.ids['Field notes'], [{ type: 'Rectangle', name: 'Pinned', styles: { position: 'absolute', left: 32, top: 280, width: 48, height: 48, backgroundColor: '#d97757' }, constraints: { horizontal: 'left', vertical: 'bottom' } }])[0];
    });
  }, { fixture, modelUrl: '/@fs' + resolve('packages/model/src/index.ts') });
  const select = async (name: string) => page.evaluate(async ({ fileId, id }) => {
    const ws = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/workspace.ts')).at(-1)!.name);
    ws.setLeftTab('layers'); ws.setRightTab('design'); ws.setSelection(fileId, [id]);
  }, { fileId: fixture.fileId, id: fixture.ids[name] });
  const shot = async (name: string) => { console.log(name); return page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); };
  const sections: Record<string, unknown> = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (theme) => {
      const p = await import(performance.getEntriesByType('resource').filter((r) => r.name.includes('/src/state/prefs.ts')).at(-1)!.name); p.setPrefs({ theme });
    }, theme);
    await select('Field notes');
    // Exercise both layout systems, then restore the authored fixture.
    const gridAdd = page.getByRole('button', { name: 'Add grid layout', exact: true });
    if (await gridAdd.count()) await gridAdd.click();
    await shot(`${theme}-grid`);
    await page.keyboard.press('Meta+z');
    for (const label of ['Add border', 'Add outline', 'Add shadow', 'Add filter', 'Add backdrop filter', 'Add clip path or mask', 'Add style']) {
      const add = page.getByRole('button', { name: label, exact: true });
      if (await add.count()) await add.first().click();
      if (label === "Add filter" || label === "Add backdrop filter") {
        const item = page.getByRole("menuitem", { name: "Blur", exact: true });
        if (await item.isEnabled()) await item.click(); else await page.keyboard.press("Escape");
      }
      if (label === "Add clip path or mask") {
        const item = page.getByRole("menuitem", { name: "Clip path", exact: true });
        if (await item.isEnabled()) await item.click(); else await page.keyboard.press("Escape");
      }
      await shot(`${theme}-${label.toLowerCase().replaceAll(' ', '-')}`);
    }
    const padding = page.getByRole('button', { name: 'Padding per side', exact: true });
    if (await padding.count()) await padding.click();
    await page.getByRole('button', { name: 'Radius per corner', exact: true }).click();
    for (const name of ['Field notes', 'Heading', 'Shapes', 'Rect', 'Sample image', 'Gradient', 'Instance', 'Pinned']) {
      await select(name);
      if (name === 'Heading') {
        const details = page.locator('.of-section.collapsed').filter({ has: page.getByText('Text details', { exact: true }) });
        if (await details.count()) await details.click();
      }
      const all = page.locator('.of-inspector .of-section');
      sections[`${theme}-${name}`] = await all.evaluateAll((els) => els.map((el) => ({ title: el.querySelector('.of-section-title')?.textContent, buttons: [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent) })));
      for (let index = 0; index < await all.count(); index++) {
        await all.nth(index).screenshot({ path: `${output}/${theme}-${name.replaceAll(' ', '-')}-section-${index}.png`, animations: 'disabled' });
      }
    }
    await page.getByRole('radio', { name: 'Theme', exact: true }).click();
    await page.locator('[data-token="--color-review"]').click();
    await shot(`${theme}-token-detail`);
    await page.getByRole('radio', { name: 'Assets', exact: true }).click();
    await shot(`${theme}-component-assets`);
    await select('Field notes');
    await page.getByRole('button', { name: 'Edit colour', exact: true }).first().click();
    await shot(`${theme}-colour-picker`);
    await page.keyboard.press('Escape');
    // The shape menu is an independent toolbar surface.
    await page.getByRole('button', { name: /shapes menu/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Ellipse/ }).waitFor();
    await shot(`${theme}-shape-menu`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More tools', exact: true }).click();
    await shot(`${theme}-toolbar-overflow`);
    await page.keyboard.press('Escape');
  }
  // Modal keys must not mutate the underlying text or steal a focused button's Space key.
  await select('Heading');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('opencrease:settings', { detail: { page: 'general' } })));
  await page.getByRole('button', { name: 'Agents', exact: true }).focus();
  await page.keyboard.press('p');
  await page.keyboard.press('Meta+b');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Reset token', exact: true }).waitFor();
  const old = await page.evaluate(async () => (await (await fetch('/api/session')).json()).token);
  await page.getByRole('button', { name: 'Reset token', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Token reset.' }).waitFor();
  const next = await page.evaluate(async () => (await (await fetch('/api/session')).json()).token);
  if (old === next) throw new Error('Reset token did not rotate');
  const oldStatus = await fetch('http://127.0.0.1:29911/api/files', { headers: { 'x-opencrease-token': old } });
  if (oldStatus.status !== 401) throw new Error('Old token was not rejected');
  await shot('token-reset');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('opencrease:plugins')));
  await page.getByRole('button', { name: 'Rename selection: Item 1, Item 2, ...', exact: true }).click();
  const allow = page.getByRole('button', { name: 'Allow', exact: true });
  await allow.waitFor({ timeout: 1000 }).then(() => allow.click()).catch(() => {});
  await page.getByRole('status').filter({ hasText: /Renamed/ }).waitFor();
  await shot('plugin-result');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('opencrease:history')));
  await page.getByRole('button', { name: /Integration checkpoint/ }).first().click();
  const restore = page.getByRole('button', { name: /^Restore version/ });
  await restore.click();
  await page.getByRole('button', { name: /Restored version/ }).waitFor();
  await shot('history-restored');
  await writeFile(`${output}/sections.json`, JSON.stringify(sections, null, 2));
  await writeFile(`${output}/errors.json`, JSON.stringify(errors, null, 2));
  console.log(JSON.stringify({ errors, output }));

} finally { await browser.close(); }
