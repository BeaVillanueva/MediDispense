import { afterEach, expect, it, vi } from 'vitest';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const input={request_key:'b'.repeat(32),device_id:'2C8C6AF3AF48',attestation_nonce:'c'.repeat(32),event_id:'coin-exact-retained-event',original_payment_event_id:'coin-original-recorded-event',verified_total:5,notes:'Physically verified only the original payment; no additional physical coin.',machine_isolated:true as const,motors_stopped:true as const,coin_path_checked:true as const,no_additional_payment_confirmed:true as const};
it.each(['staff','admin'])('denies %s exact-event inspection and authorization',async employeeRole=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const caller=appRouter.createCaller({req:{headers:{}},employeeRole} as TrpcContext);
  await expect(caller.coinReviews.status()).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(caller.coinReviews.authorize(input)).rejects.toMatchObject({code:'FORBIDDEN'});expect(fetch).not.toHaveBeenCalled();
});
it('forwards explicit Super Admin decisions without posting payment or simulated acknowledgment',async()=>{
  vi.stubEnv('MEDIDISPENSE_PHP_API_URL','http://php.test');const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{id:input.request_key,authorized:true}})});vi.stubGlobal('fetch',fetch);
  const caller=appRouter.createCaller({req:{headers:{}},employeeRole:'super_admin'} as TrpcContext);await caller.coinReviews.authorize(input);
  expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][0]).toContain('/api/payments/coin-reviews/authorize');expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
});
