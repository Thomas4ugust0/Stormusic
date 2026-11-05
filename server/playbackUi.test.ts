import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

test('slider persists, filters an existing offline mix, and exhaustion stops instead of looping', async t => {
  const dir = await mkdtemp(resolve('.tmp-ui-'))
  const compile = async (folder: string) => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = folder + '/' + item.name
      if (item.isDirectory()) { await compile(path); continue }
      if (!/\.tsx?$/.test(path) || /\.test\.|\/sw\.ts$|\/main\.tsx$/.test(path)) continue
      let source = await readFile(path, 'utf8')
      source = source.replace(/from '(\.[^']+)'/g, (_, p) => `from '${p.replace(/\.ts$/, '')}.mjs'`).replaceAll('import.meta.env.BASE_URL', "'/'").replaceAll('import.meta.env.PROD', 'true')
      const out = resolve(dir, path.replace(/^src\//, '').replace(/\.tsx?$/, '.mjs'))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)
    }
  }
  await compile('src')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:8787', pretendToBeVisual: true })
  const w = dom.window
  Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, Event: w.Event, HTMLElement: w.HTMLElement, addEventListener: w.addEventListener.bind(w), removeEventListener: w.removeEventListener.bind(w), IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: w.navigator.userAgent, onLine: false, storage: { estimate: async () => ({usage:0,quota:1e9}), persisted:async()=>true } } })
  const now=Date.now()
  const track=(id: string,title: string)=>({id:'yt:'+id,ytId:id,title,artist:title,sub:'Music',genre:'rock',moods:[],energy:0.5,dur:180})
  const heard=track('heard000000','Heard before'), fresh=track('fresh000000','Fresh song')
  localStorage.setItem('ytm.profile',JSON.stringify({genres:['rock'],subs:[],artists:[]}))
  localStorage.setItem('ytm.supermix',JSON.stringify({at:now,tracks:[heard,fresh],kinds:{},online:true}))
  localStorage.setItem('ytm.dailyPlan',JSON.stringify({at:now,tracks:[heard,fresh]}))
  localStorage.setItem('ytm.taste',JSON.stringify({ev:[{y:heard.ytId,k:'listen',at:now-2*86400000}],meta:{[heard.ytId]:heard}}))
  const audios: FakeAudio[]=[]
  class FakeAudio {
    src='';dataset: Record<string,string>={};paused=true;ended=false;duration=180;currentTime=0;readyState=4;plays=0
    onplaying?:()=>void;onpause?:()=>void;ontimeupdate?:()=>void;onended?:()=>void
    constructor(){audios.push(this)}
    async play(){this.paused=false;this.plays++;this.onplaying?.()}
    pause(){if(!this.paused){this.paused=true;queueMicrotask(()=>this.onpause?.())}}
    load(){}
    removeAttribute(){this.src=''}
  }
  Object.assign(globalThis,{Audio:FakeAudio})
  globalThis.fetch=async(input,init)=>{
    const url=String(input)
    if(url.endsWith('/api/v1/library'))return Response.json({tracks:[heard,fresh].map(t=>({id:t.ytId,title:t.title,artist:t.artist,duration:180,status:'done',bytes:10})),removedIds:[],summary:{done:2,total:2,minutes:6,bytes:20,running:false}})
    if(url.includes('/api/resolve/'))return Response.json({url:'/api/audio?id='+url.split('/').at(-1),source:'Disco do celular',duration:180})
    if(url.includes('/health'))return Response.json({status:'ok',state:'idle',js_runtime:'node',ytdlp_version:'test'})
    if(url.includes('/api/v1/plan'))return Response.json({accepted:JSON.parse(String(init?.body)).tracks.length,missing:0})
    throw Error('Unexpected request '+url)
  }
  const {act,createElement}=await import('react')
  const {createRoot}=await import('react-dom/client')
  const {default:App}=await import(pathToFileURL(resolve(dir,'App.mjs')).href)
  const root=createRoot(document.getElementById('root')!)
  const settle=()=>new Promise(r=>setImmediate(r))
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();await rm(dir,{recursive:true,force:true})})
  await act(async()=>{root.render(createElement(App));await settle()})
  const click=async(button: Element)=>act(async()=>{button.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle()})
  const library=[...document.querySelectorAll('button')].find(b=>b.textContent==='Biblioteca')!
  assert.ok(library);await click(library)
  const slider=document.querySelector('#repeat-days') as HTMLInputElement
  assert.equal(slider.min,'1');assert.equal(slider.max,'10');assert.equal(slider.value,'1')
  await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(slider,'10');slider.dispatchEvent(new w.Event('input',{bubbles:true}));slider.dispatchEvent(new w.Event('change',{bubbles:true}));await settle()})
  assert.equal(localStorage.getItem('ytm.repeatDays'),'10')
  assert.match(document.querySelector('output')!.textContent!,/10 dias/)
  await click(document.querySelector('[aria-label="Tocar Heard before"]')!)
  assert.equal(audios.reduce((n,a)=>n+a.plays,0),0)
  await click(document.querySelector('[aria-label="Tocar Fresh song"]')!)
  assert.equal(audios.reduce((n,a)=>n+a.plays,0),1)
  const audio=audios.find(a=>!a.paused)!
  await act(async()=>{audio.currentTime=1.1;audio.ontimeupdate?.();await settle()})
  assert.ok(JSON.parse(localStorage.getItem('ytm.taste')!).playedAt[fresh.ytId])
  await act(async()=>{audio.currentTime=180;audio.ended=true;audio.onended?.();await settle()})
  assert.ok(audios.every(a=>a.paused))
  assert.equal(audios.reduce((n,a)=>n+a.plays,0),1)
  assert.match(document.body.textContent!,/Não há mais faixas disponíveis sem repetir/)
  await act(async()=>{root.render(createElement(App,{key:'reload'}));await settle()})
  await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Biblioteca')!)
  assert.equal((document.querySelector('#repeat-days') as HTMLInputElement).value,'10')
  await click(document.querySelector('[aria-label="Tocar Fresh song"]')!)
  assert.equal(audios.reduce((n,a)=>n+a.plays,0),1)
  await t.test('download removal is enabled during a batch and actually completes through confirmation', async () => {
    const {default:Downloads}=await import(pathToFileURL(resolve(dir,'components/Downloads.mjs')).href)
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
    w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
    let deleted=0, refreshed=0
    const fixture={tracks:[{id:'deleteui000',title:'Delete me',artist:'Artist',duration:180,status:'downloading',bytes:5,total:10,percent:50}],summary:{done:0,total:1,minutes:0,bytes:5,running:true}}
    globalThis.fetch=async(input,init)=>{assert.equal(String(input),'/api/v1/library/deleteui000');assert.equal(init?.method,'DELETE');deleted++;return new Response(null,{status:204})}
    await act(async()=>{root.render(createElement(Downloads,{data:fixture,error:'',refresh:()=>{refreshed++},play:()=>{}}));await settle()})
    assert.ok(!document.body.textContent!.includes('Baixar agora'))
    const button=document.querySelector('[aria-label="Excluir Delete me"]') as HTMLButtonElement
    assert.equal(button.disabled,false);await click(button)
    await click([...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Confirmar')!)
    assert.equal(deleted,1);assert.equal(refreshed,1)
    assert.equal(document.querySelector('[aria-label="Excluir Delete me"]'),null)
    assert.match(document.body.textContent!,/Faixa excluída/)
  })

  await t.test('manual download starts the queue and displays overall and per-track progress', async () => {
    const {default:Downloads}=await import(pathToFileURL(resolve(dir,'components/Downloads.mjs')).href)
    const fixture={tracks:[{id:'manualui001',title:'Queued song',artist:'Artist',duration:180,status:'queued',bytes:0,total:10,percent:0}],summary:{done:0,total:1,minutes:0,bytes:0,running:false}}
    let started=0,refreshed=0
    globalThis.fetch=async(input,init)=>{assert.equal(String(input),'/api/v1/library/run');assert.equal(init?.method,'POST');started++;return new Response(null,{status:202})}
    await act(async()=>{root.render(createElement(Downloads,{data:fixture,error:'',refresh:()=>{refreshed++},play:()=>{}}));await settle()})
    await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Baixar agora')!)
    assert.equal(started,1);assert.equal(refreshed,1)
    fixture.summary.running=true;fixture.tracks[0].status='downloading';fixture.tracks[0].percent=50
    await act(async()=>{root.render(createElement(Downloads,{data:fixture,error:'',refresh:()=>{},play:()=>{}}));await settle()})
    assert.equal((document.querySelector('[aria-label="Progresso da fila"]') as HTMLProgressElement).value,50)
    assert.equal((document.querySelector('[aria-label="Download de Queued song"]') as HTMLProgressElement).value,50)
    assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Baixando…')?.disabled)
  })

  await t.test('bulk deletion removes both downloaded and queued songs during a batch', async () => {
    const {default:Downloads}=await import(pathToFileURL(resolve(dir,'components/Downloads.mjs')).href)
    const ids=['bulkdelete1','bulkdelete2'],deleted:string[]=[]
    const fixture={tracks:ids.map((id,i)=>({id,title:id,artist:'Artist',duration:180,status:i?'queued':'done',bytes:i?0:10,total:10,percent:100})),summary:{done:1,total:2,minutes:3,bytes:10,running:true}}
    globalThis.fetch=async(input,init)=>{assert.equal(init?.method,'DELETE');deleted.push(String(input).split('/').at(-1)!);return new Response(null,{status:204})}
    await act(async()=>{root.render(createElement(Downloads,{data:fixture,error:'',refresh:()=>{},play:()=>{}}));await settle()})
    await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Excluir todas as baixadas')!)
    await click([...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Confirmar')!)
    assert.deepEqual(deleted,ids)
    assert.equal(document.querySelectorAll('[aria-label^="Excluir bulk"]').length,0)
    assert.ok(!document.body.textContent!.includes('Baixar agora'))
    assert.match(document.body.textContent!,/Downloads excluídos/)
  })

})
