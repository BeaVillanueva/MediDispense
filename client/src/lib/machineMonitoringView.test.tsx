import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const h=vi.hoisted(()=>({role:'admin'}));
vi.mock('@/contexts/FirebaseAuthContext',()=>({useFirebaseAuth:()=>({profile:{role_code:h.role}})}));
vi.mock('@/lib/trpc',()=>({trpc:{machine:{status:{useQuery:()=>({data:{machineName:'MediDispense-01',online:true,heartbeatAgeSeconds:2,heartbeatAtMs:1000,controllerDeviceId:'PRIVATE-DEVICE',monitoringSource:'PRIVATE-API',esp32Status:'Connected',motorStatus:'Ready',sensorStatus:'Monitoring',coinAcceptorStatus:'Unknown',componentReports:{controller:true,dispenser:true,detection:true,payment:false},slots:[]},dataUpdatedAt:Date.now(),isError:false,isPending:false,refetch:vi.fn()})}}}}));
vi.mock('@/components/ControllerReplacement',()=>({default:()=> <div>PRIVATE REPLACEMENT</div>}));
import MachineMonitoring from '@/components/MachineMonitoring';
describe('staff Machine Monitoring view',()=>{
  it.each(['admin','staff'])('hides technical details and replacement from %s',role=>{
    h.role=role;const html=renderToStaticMarkup(<MachineMonitoring/>);
    expect(html).toContain('MediDispense-01');expect(html).toContain('Online');expect(html).toContain('Check Connection');
    for(const text of ['PRIVATE-DEVICE','PRIVATE-API','PRIVATE REPLACEMENT','Technical Details','heartbeat','Super Admin Maintenance'])expect(html).not.toContain(text);
  });
  it('hides the maintenance button from Super Admin too',()=>{
    h.role='super_admin';const html=renderToStaticMarkup(<MachineMonitoring/>);expect(html).not.toContain('Super Admin Maintenance');expect(html).not.toContain('PRIVATE REPLACEMENT');
  });
  it('never presents ready or monitoring reports as verified working hardware',()=>{
    h.role='admin';const html=renderToStaticMarkup(<MachineMonitoring/>);expect(html).toContain('Not Yet Verified');expect(html).not.toContain('>Working<');expect(html).not.toContain('Reported Ready');
  });
});
