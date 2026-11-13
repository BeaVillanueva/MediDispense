<?php
// Copy to payment-demo.local.php for a supervised capstone demonstration only.
// Ignored in APP_ENV=production. No physical coin inhibition is claimed.
return [
    'controlled_expiration' => false,
    'no_late_coins_assumption_acknowledged' => false,
    'automatic_session_binding' => false, // Also requires explicit firmware demo opt-in.
    'protected_transaction_ids' => [], // Never auto-bind or auto-expire these purchases.
];
