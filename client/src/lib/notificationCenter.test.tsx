import { beforeEach, expect, it, vi } from "vitest";
import type { Alert } from "@shared/medidispense";
const h=vi.hoisted(()=>({state:0,options:null as any,mutate:vi.fn(),invalidate:vi.fn(),setData:vi.fn(),navigate:vi.fn()}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useState:(initial:any)=>[h.state++===0?true:initial,vi.fn()],useEffect:vi.fn(),useRef:()=>({current:null})}));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({notifications:{invalidate:h.invalidate,list:{setData:h.setData}}}),notifications:{dismiss:{useMutation:(options:any)=>{h.options=options;return {mutate:h.mutate,isPending:false};}},dismissAll:{useMutation:()=>({mutate:vi.fn(),isPending:false})}}}}));
vi.mock("sonner",()=>({toast:{error:vi.fn(),success:vi.fn()}}));
import { NotificationCenter } from "@/components/NotificationCenter";
const alerts:Alert[]=[{id:1,kind:"low_stock",title:"Low Stock Alert",message:"Stock low",severity:"warning",createdAt:"2026-11-14 10:00:00",read:false},{id:2,kind:"dispensing_failure",title:"Dispensing Issue Alert",message:"Inspect",severity:"danger",createdAt:"2026-11-14 09:00:00",read:true}];
function all(node:any,predicate:(n:any)=>boolean):any[]{if(!node||typeof node!=="object")return[];if(Array.isArray(node))return node.flatMap(n=>all(n,predicate));return [...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)];}
beforeEach(()=>{h.state=0;vi.clearAllMocks();});
it("renders non-interactive notification cards with individual dismiss buttons",()=>{
 const tree=NotificationCenter({alerts,onNavigate:h.navigate});
 const cards=all(tree,n=>n.type==="article");expect(cards).toHaveLength(2);
 cards.forEach(card=>{expect(card.props.onClick).toBeUndefined();expect(card.props.tabIndex).toBeUndefined();});
 const buttons=all(tree,n=>n.type==="button"&&n.props["aria-label"]?.startsWith("Dismiss "));
 expect(buttons).toHaveLength(2);buttons[1].props.onClick();expect(h.mutate).toHaveBeenCalledWith({id:2});expect(h.navigate).not.toHaveBeenCalled();expect(h.setData).not.toHaveBeenCalled();
});
it("removes only the backend-confirmed dismissed item from cache and refreshes counts",()=>{
 NotificationCenter({alerts,onNavigate:h.navigate});h.options.onSuccess({dismissed:1},{id:1});
 const update=h.setData.mock.calls[0][1];expect(update(alerts)).toEqual([alerts[1]]);expect(h.invalidate).toHaveBeenCalledOnce();
});
