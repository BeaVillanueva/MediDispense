/** Presentation only. Never determines whether recovery or kiosk return is safe. */
const blockers:Record<string,string>={
  REVIEW_NOT_SAVED:'Save this check first.',
  INSPECTION_INCOMPLETE:'Finish checking what happened to the missing tablets.',
  CONTROLLER_VERIFICATION_REQUIRED:'Confirm that moving parts have stopped and the control board is disconnected.',
  INVENTORY_INCOMPLETE:'Count the tablets left in the slot, then save this check.',
  REVIEW_INCOMPLETE:'The saved check still needs attention.',
  COMMAND_RETIREMENT_UNCONFIRMED:'The previous medicine delivery has not been safely closed yet.',
  ACTIVE_FIREBASE_COMMAND:'Another medicine delivery is still open. Keep the control board disconnected.',
  FIREBASE_VERIFICATION_REQUIRED:'The system could not confirm that the previous delivery has ended. Check the connection.',
  OTHER_REVIEW_PENDING:'Another medicine delivery still needs a staff check.',
  PAYMENT_RECONCILIATION_REQUIRED:'The recorded payment needs checking before the kiosk can reopen.',
  ACTIVE_DISPENSING_REQUEST:'Another medicine delivery is still waiting or in progress.',
  OTHER_PURCHASE_PENDING:'Another customer purchase is still open.',
  CONTROLLER_UNVERIFIED:'The machine connection could not be verified. Ask a supervisor to check it.',
  CONTROLLER_DIAGNOSTICS_STALE:'A recent machine update is needed. Check the connection and try again.',
  UNRESOLVED_COIN_EVENTS:'Some inserted coins still need checking. Do not start another purchase.',
  INCOMPLETE_COIN_PULSES:'The machine has not finished checking an inserted coin.',
  COIN_STORAGE_UNHEALTHY:'The machine cannot confirm its saved coin records. Ask for assistance.',
  CONTROLLER_RECONCILIATION_REQUIRED:'The machine has an unfinished safety check. Ask for assistance.',
  PAYMENT_SESSION_UNVERIFIED:'The machine has not confirmed the current purchase yet.',
  UNKNOWN_PAYMENT_OWNER:'The machine cannot identify which purchase an inserted payment belongs to.',
  ACTIVE_PAYMENT_SESSION:'The machine is still linked to another open purchase.',
  ACTIVE_MOTOR:'A medicine dispenser may still be moving. Confirm that it has stopped.',
};
export function recoveryBlockerText(code:string){return blockers[code]??'Another safety check is needed. Ask a supervisor to review the saved details.';}
export function recoveryErrorText(message:string){
  if(/(?:Firebase|command).*(?:active|pending)/i.test(message))return blockers.ACTIVE_FIREBASE_COMMAND;
  if(/(?:network|connection|fetch|timeout)/i.test(message))return 'The connection was interrupted. Check the connection, then try again.';
  return 'The check could not be confirmed. Try checking again or ask a supervisor to review the saved details.';
}
export function recoveryOutcomeText(outcome:string){return ({dispensed_sensor_missed:'All tablets came out',not_dispensed:'No tablets came out',partial:'Only some tablets came out'} as Record<string,string>)[outcome]??'Not yet selected';}
export function recoveryWarningText(code:string){
  if(code==='CUSTOMER_OBLIGATION_PENDING')return 'This customer still needs a refund or replacement. Reopening the kiosk does not settle it.';
  if(code==='HISTORICAL_FAILED_PURCHASES')return 'Older purchases still need customer follow-up. They do not prevent reopening this machine.';
  return 'Some customer follow-up is still needed. Check the saved notes.';
}
