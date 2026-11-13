#pragma once
// Copy to PaymentDemo.local.h only for supervised capstone demonstrations.
// Backend must independently allow automatic_session_binding. Production default is 0.
// Assumption: no coins are inserted between sessions or after the payment deadline.
#define MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND 0
