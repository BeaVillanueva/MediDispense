import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const h=vi.hoisted(()=>({role:'staff'}));
vi.mock('@/contexts/FirebaseAuthContext',()=>({useFirebaseAuth:()=>({profile:{role_code:h.role}})}));
vi.mock('@/components/ControllerReplacement',()=>({default:()=> <div>AUTHORIZED REPLACEMENT</div>}));
import ControllerMaintenance from '@/pages/ControllerMaintenance';
describe('direct controller maintenance entry',()=>{
  it.each(['staff','admin'])('denies %s maintenance access',role=>{h.role=role;const html=renderToStaticMarkup(<ControllerMaintenance/>);expect(html).toContain('Super Admin access required');expect(html).not.toContain('AUTHORIZED REPLACEMENT');});
  it('exposes existing workflow only to Super Admin without cancelling a purchase on render',()=>{h.role='super_admin';const html=renderToStaticMarkup(<ControllerMaintenance/>);expect(html).toContain('AUTHORIZED REPLACEMENT');expect(html).toContain('Wait for backend-confirmed cancellation');});
});
