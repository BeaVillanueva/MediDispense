import {describe,it,expect} from 'vitest';
import {recoveryBlockerText,recoveryErrorText,recoveryOutcomeText,recoveryWarningText} from './recoveryPresentation';
describe('plain-language delivery checks',()=>{
  it('explains payment and machine blockers without technical jargon',()=>{
    for(const code of ['ACTIVE_FIREBASE_COMMAND','FIREBASE_VERIFICATION_REQUIRED','COIN_STORAGE_UNHEALTHY','UNRESOLVED_COIN_EVENTS','PAYMENT_RECONCILIATION_REQUIRED','CONTROLLER_DIAGNOSTICS_STALE']){
      expect(recoveryBlockerText(code)).not.toMatch(/Firebase|journal|pulse|reconcil|diagnostic|backend/i);
      expect(recoveryBlockerText(code)).not.toMatch(/ready to reopen/i);
    }
  });
  it('keeps unknown blockers blocked and asks for a supervisor',()=>{expect(recoveryBlockerText('NEW_GUARD')).toContain('supervisor');});
  it('explains a command or connection failure without claiming recovery succeeded',()=>{expect(recoveryErrorText('Another Firebase command is active.')).toContain('delivery is still open');expect(recoveryErrorText('Network interrupted')).toContain('connection');});
  it('labels physical results without inventing a default outcome',()=>{expect(recoveryOutcomeText('dispensed_sensor_missed')).toBe('All tablets came out');expect(recoveryOutcomeText('unknown')).toBe('Not yet selected');});
  it('keeps outstanding customer assistance visible and never promises a refund',()=>{expect(recoveryWarningText('CUSTOMER_OBLIGATION_PENDING')).toContain('does not settle it');expect(recoveryWarningText('HISTORICAL_FAILED_PURCHASES')).toContain('do not prevent reopening');});
});
