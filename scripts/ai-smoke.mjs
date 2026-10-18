// Run against an isolated local server/Vite and ai/testing/fake-provider.ts. No real provider keys.
// Defaults are Track 7 ports; outputs go to the ignored test-results directory.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const editorUrl = process.env.AI_EDITOR_URL || 'http://localhost:5207';
const serverUrl = process.env.AI_SERVER_URL || 'http://127.0.0.1:29907';
const mockUrl = process.env.AI_MOCK_URL || 'http://127.0.0.1:29917';
const output = 'test-results/track7';
await mkdir(output, { recursive: true });
const json = async (path, method = 'GET', body) => {
  const r = await fetch(`${serverUrl}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert(r.ok, `${path}: ${r.status} ${await (!r.ok ? r.text() : Promise.resolve(''))}`);
  return r.json();
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });
let fileId;
const doc = () => page.evaluate(async () => (await import('/src/state/workspace.ts')).getActiveFile().store.doc);
const select = (ids) => page.evaluate(async ({fileId, ids}) => (await import('/src/state/workspace.ts')).setSelection(fileId, ids), {fileId, ids});
const tool = async (name, args) => {
  const result = await json('/api/tools/call', 'POST', { tool: name, args: {fileId, ...args}, client: {name:'track7-smoke'} });
  assert(!result.isError, JSON.stringify(result));
  return result;
};
const settings = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('opencrease:settings', {detail:{page:'ai'}})));
const closeDialog = () => page.getByRole('dialog').getByRole('button', {name:'Close', exact:true}).click();
const generate = async (prompt, key = 'i') => {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press(`Meta+Shift+${key}`);
  const dialog = page.getByRole('dialog', {name:key === 'i' ? 'Generate image' : 'Generate SVG', exact:true});
  await dialog.locator('textarea').fill(prompt);
  await dialog.getByRole('button', {name:/^Generate/}).click();
};
const waitImage = async (prompt) => {
  await page.evaluate(async () => { window.__aiWorkspace = await import('/src/state/workspace.ts'); });
  await page.waitForFunction((prompt) => Object.values(window.__aiWorkspace.getActiveFile().store.doc.nodes).some((n) => n.gen?.prompt === prompt), prompt, {timeout:20000});
  return Object.values((await doc()).nodes).find((n) => n.gen?.prompt === prompt);
};
try {
  // A clean OPENCREASE_HOME is required: the test exercises the unconfigured state.
  assert.equal((await json('/api/ai')).providers.length, 0);
  fileId = (await json('/api/files', 'POST', {name:'Track 7 provider check'})).id;
  await page.goto(`${editorUrl}/file/${fileId}`);
  await page.getByRole('tab', {name:'Agent', exact:true}).click();
  await page.getByRole('button', {name:'Set up a provider'}).waitFor();
  assert(await page.getByRole('textbox', {name:'Message agent'}).isDisabled());
  await shot('unconfigured-agent');
  await page.getByRole('button', {name:'Set up a provider'}).click();

  // Configure both protocols through the actual settings form.
  await page.getByRole('button', {name:'Anthropic', exact:true}).click();
  await page.getByRole('textbox', {name:'Base URL', exact:true}).fill(mockUrl);
  await page.getByLabel('API key', {exact:true}).fill('mock-key-ABCD');
  assert.equal(await page.getByLabel('Chat model', {exact:true}).inputValue(), 'claude-opus-5-5');
  await page.getByRole('button', {name:'Save', exact:true}).click();
  await page.getByText('key …ABCD', {exact:false}).waitFor();
  await page.getByRole('button', {name:'OpenAI-compatible', exact:true}).click();
  await page.locator('.of-prov.open .n1').filter({hasText:'OpenAI-compatible'}).waitFor();
  await page.getByRole('textbox', {name:'Name', exact:true}).fill('Local mock');
  await page.getByRole('textbox', {name:'Base URL', exact:true}).fill(`${mockUrl}/v1`);
  await page.getByLabel('Chat model', {exact:true}).fill('fake-chat');
  await page.getByLabel('Image model', {exact:true}).fill('fake-image');
  await page.getByRole('button', {name:'Test connection', exact:true}).click();
  await page.getByText('Connected. 3 models available.', {exact:false}).waitFor();
  const defaultsSaved = page.waitForResponse((r) => r.url().endsWith('/api/ai/defaults') && r.request().method() === 'PUT');
  await page.getByRole('combobox', {name:'Chat provider', exact:true}).selectOption({label:'Local mock'});
  await defaultsSaved;
  await shot('ai-settings');
  const aiSettings = await json('/api/ai');
  assert(!JSON.stringify(aiSettings).includes('mock-key'));
  assert.equal(aiSettings.defaults.chat, aiSettings.providers.find((p) => p.label === 'Local mock').id);
  await closeDialog();
  await page.getByRole('combobox', {name:'Agent provider'}).selectOption({label:'Local mock'});
  await page.getByRole('textbox', {name:'Message agent'}).fill('Make a card');
  await page.getByRole('button', {name:'Send', exact:false}).click();
  await page.getByRole('button', {name:'Stop', exact:true}).waitFor();
  await page.getByText('Done. I added', {exact:false}).waitFor({timeout:20000});
  await page.getByRole('button', {name:'Send', exact:false}).waitFor();
  let history = await json(`/api/ai/agent/${fileId}`);
  assert.equal(history.turns[1].providerKind, 'openai-compatible');
  assert(history.turns[1].parts.some((p) => p.type === 'steps' && p.steps.some((s) => s.image)));
  await shot('openai-agent');
  await page.getByRole('button', {name:'Activity', exact:true}).click();
  await page.getByText('Review checklist', {exact:true}).waitFor();
  await shot('activity-log');
  await page.getByRole('button', {name:'Chat', exact:true}).click();
  await page.getByRole('combobox', {name:'Agent provider'}).selectOption({label:'Anthropic'});
  await page.getByRole('textbox', {name:'Message agent'}).fill('Make another card');
  await page.getByRole('button', {name:'Send', exact:false}).click();
  await page.getByRole('button', {name:'Stop', exact:true}).waitFor();
  await page.getByRole('button', {name:'Stop', exact:true}).waitFor({state:'hidden',timeout:20000});
  history = await json(`/api/ai/agent/${fileId}`);
  assert.equal(history.turns.at(-1).providerKind, 'anthropic');
  assert.equal(history.turns.at(-1).error, undefined);
  assert.equal(history.turns.at(-1).parts.flatMap((p) => p.type === 'steps' ? p.steps : []).length, 5);
  await shot('claude-agent');
  await page.getByRole('textbox', {name:'Message agent'}).fill(`say ${'Long streaming reply '.repeat(80)}`);
  await page.getByRole('button', {name:'Send', exact:false}).click();
  await page.getByRole('button', {name:'Stop', exact:true}).click();
  await page.getByText('Stopped', {exact:true}).waitFor({timeout:10000});
  await shot('stopped-agent');

  // No selection: image generation inserts a new node, then edits and regenerates it.
  await page.getByRole('tab', {name:'Design', exact:true}).click();
  await select([]);
  await generate('Blue ceramic vase');
  await page.locator('[data-of-gen-status="processing"]').waitFor();
  await shot('image-processing');
  const image = await waitImage('Blue ceramic vase');
  assert.equal(image.gen.model, 'fake-image');
  assert(image.src.startsWith('asset://'));
  await select([image.id]);
  await page.getByRole('button', {name:'Regenerate', exact:true}).click();
  await page.locator('[data-of-gen-status="processing"]').waitFor();
  await page.locator('[data-of-gen-status="processing"]').waitFor({state:'hidden',timeout:20000});
  await page.getByRole('button', {name:'Edit image', exact:true}).click();
  await page.getByRole('dialog').locator('textarea').fill('Make it dusk');
  await page.getByRole('dialog').getByRole('button', {name:/^Edit/}).click();
  const edited = await waitImage('Make it dusk');
  assert.equal(edited.gen.edit, true);
  assert.equal(edited.styles.width, image.styles.width);
  assert.equal(edited.styles.height, image.styles.height);
  assert.notEqual(edited.src, image.src);
  await shot('edited-image');

  // Fill, pending URL aliases, honest provider errors, and context-aware SVG.
  const board = Object.values((await doc()).nodes).find((n) => n.type === 'Frame' && n.name === 'Agent card');
  await select([board.id]);
  await generate('Pine forest fill');
  const filled = await waitImage('Pine forest fill');
  assert.equal(filled.gen.target, 'fill');
  assert(filled.styles.backgroundImage.includes('/assets/'));
  await tool('write_html', {targetNodeId:board.id, mode:'insert-children', html:'<img layer-name="URL image" src="paper-gen://image?prompt=URL%20vase&w=200&h=100" style="width:200px;height:100px"/><div layer-name="URL fill" style="width:200px;height:100px;background-image:url(gen://image?prompt=URL%20forest)"></div>'});
  await waitImage('URL vase');
  await waitImage('URL forest');
  await select([image.id]);
  await generate('please fail');
  await page.locator('[data-of-gen-status="error"]').waitFor({timeout:10000});
  await shot('image-error');
  await page.getByRole('button', {name:'Retry', exact:true}).click();
  await page.locator('[data-of-gen-status="processing"]').waitFor();
  await page.locator('[data-of-gen-status="error"]').waitFor({timeout:10000});
  await select([board.id]);
  await generate('A check mark', 'j');
  await page.waitForFunction(() => Object.values(window.__aiWorkspace.getActiveFile().store.doc.nodes).some((n) => n.type === 'SVG' && n.name === 'A check mark'), null, {timeout:10000});
  const svgSize = await page.locator('svg[data-of-id]').last().boundingBox();
  assert.equal(Math.round(svgSize.width), 120);
  assert.equal(Math.round(svgSize.height), 120);
  await shot('generated-svg');
  await page.getByRole('tab', {name:'Agent', exact:true}).click();
  await page.reload();
  await page.getByRole('tab', {name:'Agent', exact:true}).click();
  await page.getByText('Stopped', {exact:true}).waitFor();
  const other = await json('/api/files', 'POST', {name:'Separate conversation'});
  await page.goto(`${editorUrl}/file/${other.id}`);
  await page.getByRole('tab', {name:'Agent', exact:true}).click();
  await page.getByText('Design with an agent', {exact:true}).waitFor();
  assert.equal((await json(`/api/ai/agent/${other.id}`)).turns.length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ok:true, fileId, turns:history.turns.length, screenshots:output, checks:['provider setup and key masking','OpenAI and Anthropic tool loops','screenshot feedback','activity log','Stop','new image and regenerate','reference edit retaining size','fill','gen and paper-gen URLs','image errors and retry','SVG with frame context','per-file history and reload','no browser errors']}, null, 2));
} catch (e) {
  await shot('failure');
  console.error(await page.locator('body').innerText());
  throw e;
} finally { await browser.close(); }
