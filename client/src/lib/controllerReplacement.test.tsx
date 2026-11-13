import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ControllerReplacement,{replacementFormBlocker} from '@/components/ControllerReplacement';
vi.mock('@/lib/trpc',()=>({trpc:{machine:{controllers:{useQuery:()=>({data:[{device_id:'20799D470968',bound_transaction_id:165,fresh:false,ageSeconds:400,retired:false,registrationStatus:'unretired',pending_events:0}],isPending:false})},retireController:{useMutation:()=>({isPending:false,mutateAsync:vi.fn()})}}}}));
describe('Controller replacement admin workflow',()=>{
  it('explains missing IDs, duplicate IDs, confirmations and a pending request',()=>{
    expect(replacementFormBlocker('','2C8C6AF3AF48',true)).toBe('Select the old controller ID first.');
    expect(replacementFormBlocker('20799D470968','',true)).toBe('Select the installed controller ID.');
    expect(replacementFormBlocker('20799D470968','20799D470968',true)).toContain('different');
    expect(replacementFormBlocker('20799D470968','2C8C6AF3AF48',false)).toContain('physical checks');
    expect(replacementFormBlocker('20799D470968','2C8C6AF3AF48',true,true)).toContain('in progress');
    expect(replacementFormBlocker('20799D470968','2C8C6AF3AF48',true)).toBe('');
  });
  it('shows stale registrations rather than treating them as disconnected',()=>{
    const html=renderToStaticMarkup(<ControllerReplacement/>);expect(html).toContain('20799D470968');expect(html).toContain('stale');expect(html).toContain('unretired');
  });
  it('requires explicit physical confirmations and IDs before retirement',()=>{
    const html=renderToStaticMarkup(<ControllerReplacement/>);expect(html.match(/type="checkbox"/g)).toHaveLength(3);expect(html).toMatch(/<button[^>]*disabled/);expect(html).toContain('does not cancel purchases');
  });
});
