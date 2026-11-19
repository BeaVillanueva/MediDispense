import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({cells:[] as any[],effects:[] as any[],pending:[] as (()=>void)[],cursor:0,eligible:true,id:'TXN-ONE'}));
vi.mock('react',()=>({
  useState:(initial:any)=>{const i=h.cursor++;if(!(i in h.cells))h.cells[i]=typeof initial==='function'?initial():initial;return [h.cells[i],(next:any)=>{h.cells[i]=typeof next==='function'?next(h.cells[i]):next;}];},
  useRef:(initial:any)=>{const i=h.cursor++;return h.cells[i]??(h.cells[i]={current:initial});},
  useEffect:(run:()=>unknown,deps:unknown[])=>{const i=h.cursor++,old=h.effects[i];if(!old||deps.some((d,n)=>!Object.is(d,old.deps[n])))h.pending.push(()=>{old?.cleanup?.();h.effects[i]={deps:[...deps],cleanup:run()};});},
}));
import {useKioskReceipt} from '@/hooks/useKioskReceipt';
function render(){h.cursor=0;const state=useKioskReceipt(h.eligible,h.id);const effects=h.pending.splice(0);effects.forEach(fn=>fn());if(effects.length){h.cursor=0;return useKioskReceipt(h.eligible,h.id);}return state;}
beforeEach(()=>{h.cells=[];h.effects=[];h.pending=[];h.cursor=0;h.eligible=true;h.id='TXN-ONE';vi.useFakeTimers();vi.stubGlobal('window',new EventTarget());});
afterEach(()=>{h.effects.forEach(e=>e?.cleanup?.());vi.useRealTimers();vi.unstubAllGlobals();});
describe('Okay before customer receipt',()=>{
  it('does not open a receipt or start its clock before the customer chooses Okay',()=>{expect(render().open).toBe(false);vi.advanceTimersByTime(30000);expect(render().expired).toBe(false);expect(vi.getTimerCount()).toBe(0);});
  it('starts five seconds from Okay, not from transaction success',()=>{render();vi.advanceTimersByTime(30000);render().show();expect(render().open).toBe(true);vi.advanceTimersByTime(4900);expect(render().open).toBe(true);vi.advanceTimersByTime(100);expect(render().open).toBe(false);expect(render().expired).toBe(true);});
  it('holds an opened receipt after interaction',()=>{render().show();render();window.dispatchEvent(new Event('pointerdown'));vi.advanceTimersByTime(30000);expect(render().held).toBe(true);expect(render().open).toBe(true);expect(render().expired).toBe(false);});
  it('ignores Okay when backend receipt evidence is unavailable',()=>{h.eligible=false;render().show();expect(render().requested).toBe(false);expect(render().open).toBe(false);expect(vi.getTimerCount()).toBe(0);});
  it('requires a new Okay for each purchase and does not inherit an expired clock',()=>{render().show();render();vi.advanceTimersByTime(5000);expect(render().expired).toBe(true);h.id='TXN-TWO';expect(render().open).toBe(false);expect(render().expired).toBe(false);expect(render().requested).toBe(false);render().show();expect(render().open).toBe(true);expect(render().seconds).toBe(5);});
  it('stops the timer on closing and allows deliberate reopening without a new auto-close',()=>{render().show();render();render().close();vi.advanceTimersByTime(10000);expect(render().expired).toBe(false);expect(render().finished).toBe(true);render().show();expect(render().finished).toBe(false);expect(render().open).toBe(true);expect(render().held).toBe(true);vi.advanceTimersByTime(10000);expect(render().open).toBe(true);});
  it('remembers Done while backend safety is blocked without marking a new purchase finished',()=>{render().show();render();render().close();expect(render().finished).toBe(true);vi.advanceTimersByTime(30000);expect(render().finished).toBe(true);h.id='TXN-NEXT';expect(render().finished).toBe(false);expect(render().requested).toBe(false);});
});
