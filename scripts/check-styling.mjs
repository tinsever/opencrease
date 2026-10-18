import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
// Run against a separate Vite editor and temporary server workspace, never the user's dev session.
const serverUrl = `http://127.0.0.1:${process.env.OPENCREASE_PORT ?? 29905}`;
const editorUrl = process.env.OPENCREASE_EDITOR_URL ?? 'http://localhost:5205';
const output = process.env.OPENCREASE_CHECK_DIR ?? '/tmp/of-track5/screenshots';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true, args:['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',err=>errors.push(String(err)));
page.on('console',msg=>{if(msg.type()==='error') console.log('console:',msg.text().slice(0,300));});
page.setDefaultTimeout(10000);
try {
 const f=await (await fetch(`${serverUrl}/api/files`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Styling verification'})})).json();
 await page.goto(`${editorUrl}/file/${f.id}`);
 await page.waitForSelector('[data-of-canvas]');
 const ids=await page.evaluate(async(fileId)=>{
  const w=await import('/src/state/workspace.ts');
  const file=w.getOpenFile(fileId), root=file.store.doc.pages[file.activePageId].rootId;
  let ids;
  file.store.transact('Fixture',tx=>{
   ids=tx.insertTrees(root,[
    {type:'Frame',name:'Paint study',styles:{width:420,height:300,left:0,top:0,backgroundColor:'#f5f3ec',borderRadius:24},children:[
      {type:'Text',name:'Heading',text:'Colour in motion',styles:{position:'absolute',left:28,top:28,fontSize:28,fontWeight:600,color:'#253d32'}},
      {type:'Rectangle',name:'Gradient card',styles:{position:'absolute',left:28,top:95,width:240,height:160,borderRadius:16,backgroundImage:'linear-gradient(90deg, #a8c2a5 0%, #487866 100%)'}},
      {type:'SVG',name:'Colour icon',attrs:{viewBox:'0 0 32 32'},styles:{position:'absolute',left:310,top:150,width:60,height:60},children:[{type:'SVGElement',tag:'circle',attrs:{cx:'16',cy:'16',r:'14',fill:'#487866',stroke:'#253d32','stroke-width':'2'}}]},
    ]},
    {type:'Frame',name:'Shader card',styles:{width:280,height:300,left:470,top:0,backgroundColor:'white',borderRadius:24,overflow:'hidden'},paint:{shader:{name:'MeshGradient',params:{colors:['#b9d6bb','#e3be9b','#7da79c','#425b50'],speed:0}}},children:[{type:'Text',text:'Shader fill',styles:{position:'absolute',left:24,top:24,color:'#172a21',fontSize:24,fontWeight:600}}]},
    {type:'Shader',name:'Shader node',shader:{name:'GrainGradient',params:{speed:0}},styles:{width:280,height:200,left:470,top:350}},
   ]);
  });
  const gradient=file.store.doc.nodes[ids[0]].children[1];
  w.setSelection(fileId,[gradient]);
  window.track5={fileId,ids,gradient};
  return {artboard:ids[0],shaderFill:ids[1],shader:ids[2],gradient};
 },f.id);
 await page.evaluate(async()=>{const v=await import('/src/canvas/view.ts');v.zoomToFit();});
 await page.getByRole('button',{name:'Edit gradient',exact:true}).click();
 await page.waitForSelector('[data-of-gradient-handles]');
 await page.screenshot({path:`${output}/gradient.png`});
 const section = (title) => page.locator('aside[aria-label="Inspector"] .of-section').filter({has:page.locator('.of-section-title').filter({hasText:new RegExp(`^${title}$`)})});
 const getNode = async (id) => page.evaluate(async(id)=>{const w=await import('/src/state/workspace.ts');return w.getOpenFile(window.track5.fileId).store.doc.nodes[id];},id);
 const select = async (id) => {await page.evaluate(async(id)=>{const w=await import('/src/state/workspace.ts');w.setSelection(window.track5.fileId,[id]);},id);};
 const commit = async (field,value) => {const input=await field.elementHandle();assert(input);await input.fill(String(value));await input.press('Enter');};
 const close = async () => {await page.keyboard.press('Escape');};
 const shot = async(name) => {await page.screenshot({path:`${output}/${name}.png`});};
 const drag = async(locator,dx,dy) => {const r=await locator.boundingBox();assert(r);await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await page.mouse.up();};
 // On-canvas stops and endpoints, then radial and conic geometry.
 await drag(page.locator('[data-stop="0"] rect').first(),45,0);
 assert.match((await getNode(ids.gradient)).styles.backgroundImage,/18\.8%/);
 await drag(page.locator('[data-handle="end"]'),-30,-35);
 assert.notEqual((await getNode(ids.gradient)).styles.backgroundImage.includes('90deg'),true);
 await page.getByRole('radio',{name:'Radial',exact:true}).click();
 await page.getByLabel('Radial size',{exact:true}).selectOption('closest-side');
 assert.match((await getNode(ids.gradient)).styles.backgroundImage,/radial-gradient\(circle closest-side/);
 assert.equal((await getNode(ids.gradient)).styles.backgroundSize,undefined);
 await commit(page.getByRole('textbox',{name:'Centre X',exact:true}),30);
 await page.getByRole('radio',{name:'Conic',exact:true}).click();
 await commit(page.getByRole('textbox',{name:'Angle',exact:true}),120);
 assert.match((await getNode(ids.gradient)).styles.backgroundImage,/conic-gradient\(from 120deg at 30% 50%/);
 await shot('conic');
 await close();
 await section('Fill').getByRole('button',{name:'Hide fill',exact:true}).click();
 assert.equal((await getNode(ids.gradient)).styles.backgroundImage,undefined);
 assert.equal((await getNode(ids.gradient)).paint.hiddenFills.length,1);
 await section('Fill').getByRole('button',{name:'Show fill',exact:true}).click();
 // Stacking and drag reorder.
 await section('Fill').getByRole('button',{name:'Add fill',exact:true}).click();
 await page.getByRole('menuitem',{name:'Solid colour',exact:true}).click();
 let fills=section('Fill').locator('.of-reorder-row');
 assert.equal(await fills.count(),2);
 const second=await fills.nth(1).boundingBox();
 const grip=fills.nth(0).getByRole('button',{name:'Drag to reorder fills'});
 const gr=await grip.boundingBox();
 await page.mouse.move(gr.x+gr.width/2,gr.y+gr.height/2);await page.mouse.down();await page.mouse.move(gr.x+gr.width/2,second.y+second.height+6,{steps:8});await page.mouse.up();
 assert.match((await getNode(ids.gradient)).styles.backgroundImage,/^conic-gradient/);
 await section('Fill').getByLabel('Background blend mode',{exact:true}).selectOption('multiply');
 assert.equal((await getNode(ids.gradient)).styles.backgroundBlendMode,'multiply');
 // Border, outline, radius and node blend mode.
 await section('Border').getByRole('button',{name:'Add border',exact:true}).click();
 await section('Border').getByRole('button',{name:'Width per side',exact:true}).click();
 for (const [side,width] of [['Top',1],['Right',2],['Bottom',3],['Left',4]]) await commit(section('Border').getByRole('textbox',{name:`${side} border width`,exact:true}),width);
 await section('Border').getByLabel('Border style',{exact:true}).selectOption('dashed');
 assert.equal((await getNode(ids.gradient)).styles.borderLeftWidth,4);
 await section('Outline').getByRole('button',{name:'Add outline',exact:true}).click();
 await commit(section('Outline').getByRole('textbox',{name:'Outline offset',exact:true}),3);
 await section('Outline').getByLabel('Outline style',{exact:true}).selectOption('dotted');
 assert.equal((await getNode(ids.gradient)).styles.outlineOffset,3);
 await commit(section('Appearance').getByRole('textbox',{name:'Corner radius',exact:true}),20);
 await section('Appearance').getByRole('button',{name:'Blend mode',exact:true}).click();
 await section('Appearance').locator('select').selectOption('screen');
 assert.equal((await getNode(ids.gradient)).styles.mixBlendMode,'screen');
 await section('Appearance').getByRole('button',{name:'Radius per corner',exact:true}).click();
 await commit(section('Appearance').getByRole('textbox',{name:'Bottom right radius',exact:true}),8);
 assert.equal((await getNode(ids.gradient)).styles.borderBottomRightRadius,8);
 // Shadows with inset and drag reorder.
 for(let i=0;i<2;i++) await section('Shadow').getByRole('button',{name:'Add shadow',exact:true}).click();
 await section('Shadow').getByLabel('Shadow type',{exact:true}).first().selectOption('inner');
 let shadows=section('Shadow').locator('.of-reorder-row');
 await shadows.nth(1).scrollIntoViewIfNeeded();
 const sr=await shadows.nth(1).boundingBox(),sg=await shadows.nth(0).getByRole('button',{name:'Drag to reorder shadows'}).boundingBox();
 await page.mouse.move(sg.x+sg.width/2,sg.y+sg.height/2);await page.mouse.down();await page.mouse.move(sg.x+sg.width/2,sr.y+sr.height+8,{steps:8});await page.mouse.up();
 assert.match((await getNode(ids.gradient)).styles.boxShadow,/, inset/);
 await shot('effects');
 // Every filter and backdrop filter.
 for(const title of ['Filters','Backdrop filters']) {
  for (const label of ['Blur','Brightness','Contrast','Saturate','Grayscale','Sepia','Invert','Hue rotate']) {
   await section(title).getByRole('button',{name:title==='Filters'?'Add filter':'Add backdrop filter',exact:true}).click();
   await page.getByRole('menuitem',{name:label,exact:true}).click();
  }
  assert.equal(await section(title).locator('input').count(),8);
 }
 assert.match((await getNode(ids.gradient)).styles.backdropFilter,/sepia\(100%\).*invert\(100%\).*hue-rotate\(90deg\)/);
 await section('Backdrop filters').scrollIntoViewIfNeeded();await shot('filters');
 // Clip and mask render; raw allowlisted CSS is editable and removable.
 await section('Clip and mask').getByRole('button',{name:'Add clip path or mask',exact:true}).click();
 await page.getByRole('menuitem',{name:'Clip path',exact:true}).click();
 await section('Clip and mask').getByLabel('Clip path shape',{exact:true}).selectOption('circle(50%)');
 await section('Clip and mask').getByRole('button',{name:'Add clip path or mask',exact:true}).click();
 await page.getByRole('menuitem',{name:'Gradient mask',exact:true}).click();
 assert.equal((await getNode(ids.gradient)).styles.clipPath,'circle(50%)');
 await section('Other styles').getByRole('button',{name:'Add style',exact:true}).click();
 await section('Other styles').getByRole('combobox',{name:'Property',exact:true}).fill('z-index');
 await section('Other styles').getByRole('textbox',{name:'Value',exact:true}).fill('3');
 await section('Other styles').getByRole('button',{name:'Add style',exact:true}).last().click();
 assert.equal((await getNode(ids.gradient)).styles.zIndex,3);
 await commit(section('Other styles').getByRole('textbox',{name:'zIndex value',exact:true}),4);
 await section('Other styles').getByRole('button',{name:'Remove zIndex',exact:true}).click();
 assert.equal((await getNode(ids.gradient)).styles.zIndex,undefined);
 await section('Clip and mask').scrollIntoViewIfNeeded();await shot('clip-mask');
 // Image upload, fit/fill/tile, numeric crop and modified canvas resize.
 const imageId=await page.evaluate(async()=>{
  const w=await import('/src/state/workspace.ts'),{api}=await import('/src/state/api.ts');
  const c=document.createElement('canvas');c.width=200;c.height=100;
  const ctx=c.getContext('2d');ctx.fillStyle='#ec6b42';ctx.fillRect(0,0,100,100);ctx.fillStyle='#3b8b77';ctx.fillRect(100,0,100,100);
  const blob=await new Promise(r=>c.toBlob(r));const f=w.getOpenFile(window.track5.fileId);
  const asset=await api.uploadAsset(f.id,blob,'test-image.png');let id;
  f.store.transact('Image fixture',tx=>{tx.addAsset({...asset,width:200,height:100});[id]=tx.insertTrees(f.store.doc.pages[f.activePageId].rootId,[{type:'Frame',name:'Image fill',styles:{width:420,height:200,left:0,top:350,backgroundImage:`url("${api.assetUrl(f.id,asset.hash)}")`,backgroundSize:'cover',backgroundPosition:'center',backgroundRepeat:'no-repeat'}}]);});
  window.track5.image=id;return id;
 });
 await select(imageId);
 await page.getByRole('button',{name:'Edit image fill',exact:true}).click();
 for(const [fit,value] of [['Fit','contain'],['Fill','cover'],['Tile',undefined],['Crop','120%']]) {
  await page.getByRole('radiogroup',{name:'Image fit',exact:true}).getByRole('radio',{name:fit,exact:true}).click();
  assert.equal((await getNode(imageId)).styles.backgroundSize,value);
 }
 await commit(page.getByRole('textbox',{name:'Image X',exact:true}),'25%');
 await shot('image-crop');await close();
 const imageEl=page.locator(`[data-of-id="${imageId}"]`),ir=await imageEl.boundingBox();
 await page.keyboard.down('Meta');
 await page.mouse.move(ir.x+ir.width,ir.y+ir.height/2);await page.mouse.down();await page.mouse.move(ir.x+ir.width-30,ir.y+ir.height/2,{steps:6});await page.mouse.up();
 await page.keyboard.up('Meta');
 assert.equal((await getNode(imageId)).styles.width,390);
 assert.match((await getNode(imageId)).styles.backgroundSize,/px .*px/);
 // Eyedropper fallback samples rendered pixels, then Shift creates a gradient stop.
 await select(ids.artboard);
 await page.evaluate(()=>{Object.defineProperty(window,'EyeDropper',{value:undefined,configurable:true});});
 await section('Fill').getByRole('button',{name:'Edit colour',exact:true}).click();
 await page.getByRole('button',{name:'Pick a colour from the canvas',exact:true}).click();
 const imageRect=await imageEl.boundingBox();
 await page.mouse.click(imageRect.x+30,imageRect.y+30);
 await page.waitForSelector('.of-eyedropper-layer',{state:'detached'});
 const sampled=(await getNode(ids.artboard)).styles.backgroundColor;
 assert.match(sampled,/oklch/);
 await close();
 await section('Fill').getByRole('button',{name:'Edit colour',exact:true}).click();
 await page.getByRole('button',{name:'Pick a colour from the canvas',exact:true}).click({modifiers:['Shift']});
 await page.mouse.click(imageRect.x+imageRect.width-30,imageRect.y+30);
 await page.waitForSelector('.of-eyedropper-layer',{state:'detached'});
 assert.match((await getNode(ids.artboard)).styles.backgroundImage,/linear-gradient/);
 await close();
 // Restore a solid fill for colour notation checks.
 await page.evaluate(async()=>{const w=await import('/src/state/workspace.ts'),f=w.getOpenFile(window.track5.fileId);f.store.transact('Solid',tx=>tx.setStyles(window.track5.ids[0],{backgroundImage:null,backgroundColor:'#f5f3ec'}));});
 // Colour picker modes, free CSS input, P3 and tokens.
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'color-gamut',value:'p3'}]});
 await select(ids.artboard);
 await section('Fill').getByRole('button',{name:'Edit colour',exact:true}).click();
 assert.equal(await page.getByLabel('Colour format',{exact:true}).inputValue(),'oklch');
 for(const mode of ['oklab','hex','rgb','hsl','p3','oklch']) await page.getByLabel('Colour format',{exact:true}).selectOption(mode);
 await page.getByRole('radiogroup',{name:'Gamut of this colour'}).getByRole('radio').nth(1).click();
 const plane=page.locator('.of-popover canvas');
 assert.equal(await plane.evaluate(c=>c.getContext('2d').getContextAttributes().colorSpace),'display-p3');
 await shot('colour-picker');
 await close();
 const color=section('Fill').getByRole('textbox',{name:'Colour value',exact:true});
 for(const css of ['lab(54% 30 10)','lch(60% 40 80)','hwb(120 10% 20%)','rebeccapurple','color-mix(in oklch, red 30%, blue)']) {
  await commit(color,css);assert.equal((await getNode(ids.artboard)).styles.backgroundColor,css);
 }
 await section('Fill').getByRole('button',{name:'Edit colour',exact:true}).click();
 await page.getByRole('button',{name:'Save as token',exact:true}).click();
 await page.getByPlaceholder('--color-name',{exact:true}).fill('paint-accent');
 await page.getByPlaceholder('--color-name',{exact:true}).press('Enter');
 assert.equal((await getNode(ids.artboard)).styles.backgroundColor,'var(--paint-accent)');
 await close();
 // Bulk colours include SVG attributes and nested descendants.
 await select(ids.artboard);
 const bulk=section('Selection colours');assert(await bulk.locator('input[aria-label="Colour value"]').count()>2);
 const svgColor=bulk.locator('.of-fill-row').filter({has:page.locator('input[value="#487866"]')}).getByRole('textbox',{name:'Colour value',exact:true});
 await commit(svgColor,'#36786c');
 const svgUpdated=await page.evaluate(async()=>{const w=await import('/src/state/workspace.ts');return Object.values(w.getOpenFile(window.track5.fileId).store.doc.nodes).some(n=>n.attrs?.fill==='#36786c');});
 assert(svgUpdated);
 await bulk.scrollIntoViewIfNeeded();await shot('selection-colours');
 // Shader picker covers all components; schema controls and drawing buffers are real.
 await select(ids.shader);
 const shaderOptions=await page.getByLabel('All shaders',{exact:true}).locator('option').count();assert(shaderOptions>=30);
 await page.getByLabel('All shaders',{exact:true}).selectOption('HalftoneDots');
 assert(await page.getByRole('button',{name:'Choose image',exact:true}).count());
 const imageBuffer=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#487866';ctx.fillRect(0,0,64,64);ctx.fillStyle='white';ctx.fillRect(16,16,32,32);return c.toDataURL().split(',')[1];}),'base64');
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Choose image',exact:true}).click();
 await (await chooser).setFiles({name:'shader-input.png',mimeType:'image/png',buffer:imageBuffer});
 await page.waitForFunction((id)=>document.querySelector(`[data-of-id="${id}"] canvas`),ids.shader);
 await page.waitForFunction(async(id)=>{const w=await import('/src/state/workspace.ts');return w.getOpenFile(window.track5.fileId).store.doc.nodes[id].shader.params.image?.startsWith('asset://');},ids.shader);
 await shot('shader-image');
 await page.getByLabel('All shaders',{exact:true}).selectOption('MeshGradient');
 await page.waitForFunction((id)=>!!document.querySelector(`[data-of-id="${id}"] canvas`),ids.shader);
 const buffers=await page.evaluate((ids)=>[ids.shaderFill,ids.shader].map(id=>{const canvas=document.querySelector(`[data-of-id="${id}"] canvas`);const gl=canvas?.getContext('webgl2');return {preserve:gl?.getContextAttributes()?.preserveDrawingBuffer,pixels:canvas?.toDataURL().length};}),ids);
 assert(buffers.every(b=>b.preserve&&b.pixels>100));
 await page.getByRole('tab',{name:'Code',exact:true}).click();
 assert.match(await page.locator('aside[aria-label="Inspector"]').innerText(),/import \{ MeshGradient \} from "@paper-design\/shaders-react"/);
 await shot('shader-code');
 await page.getByRole('tab',{name:'Design',exact:true}).click();
 await select(ids.shaderFill);
 await section('Fill').getByRole('button',{name:'Edit shader fill',exact:true}).click();
 await shot('shader-fill');
 await close();
 // Bridge screenshot/export also reads the retained WebGL buffer.
 const result=await (await fetch(`${serverUrl}/api/tools/call`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool:'get_screenshot',args:{fileId:f.id,nodeId:ids.shaderFill,scale:1},client:{name:'track5-test'}})})).json();
 assert(!result.isError,JSON.stringify(result));assert(result.content.some(c=>c.type==='image'));
 const screenshot=result.content.find(c=>c.type==='image');
 await writeFile(`${output}/bridge-shader.png`,Buffer.from(screenshot.data,'base64'));
 console.log(JSON.stringify({file:f.id,ids,shaderOptions,buffers,screenshots:output,errors},null,2));
 // WebGL-disabled environments get an explicit reason instead of a blank canvas.
 const fallback=await browser.newPage({viewport:{width:1440,height:1000}});
 await fallback.addInitScript(()=>{const native=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl/.test(type)?null:native.call(this,type,...args);};});
 await fallback.goto(`${editorUrl}/file/${f.id}`);
 await fallback.getByLabel('MeshGradient: WebGL is unavailable',{exact:true}).first().waitFor();
 await fallback.screenshot({path:`${output}/webgl-fallback.png`});
 await fallback.close();
 assert.equal(errors.length,0,errors.join('\n'));
} catch(err) { await page.screenshot({path:`${output}/failure.png`}); throw err; }
finally {await browser.close();}
