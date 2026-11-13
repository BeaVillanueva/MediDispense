# Portable coin safety-core fault tests

The C source includes the same CoinPaymentCore.h used by the Arduino adapter.
It uses in-memory persistence and injected failure/pulse points, not physical hardware/NVS.

On a development machine permitted to execute native test binaries:

    cc -std=c99 -Wall -Wextra -o coin-core-tests esp32/tests/coin-payment-core.c
    ./coin-core-tests

Windows portable C compilation succeeded during this review, but Application Control blocked
execution even with elevated tool approval. These assertions have not been counted as passed.
Do not disable or bypass application-control policy. PHP/TypeScript tests are separate and do
not substitute for these fault tests or hardware bench validation.

No test flashes the controller or connects to the live payment backend.
