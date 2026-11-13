# Simplified Machine Monitoring

The regular Admin/staff page shows the machine name, prominent connection status, Check Connection, four aligned component cards and recorded medicine stock. Technical identifiers, timestamps, diagnostic sources and controller replacement controls are absent from this view.

Online means a recent authenticated connection, not verified motor/sensor/coin functionality. Unknown connection evidence remains unverified rather than being presented as proven offline or online. Component reports such as Ready, Idle, Monitoring or Running do not prove a successful physical test, so these display **Not Yet Verified**. Disconnection and fault reports use **Disconnected** and **Needs Attention**. There is currently no verified functional-test field that would justify **Working**.

Only a Super Admin can open the separate **Super Admin Maintenance** view. It contains connection details and the existing controller replacement workflow. Raw diagnostic reads and controller retirement are restricted to Super Admin at tRPC, PHP route and retirement service layers. All existing physical confirmation, journal, ledger, command, freshness and audit guards remain intact. Neither registration is automatically retired.

UI files modified:

- `client/src/components/MachineMonitoring.tsx`
- `client/src/components/machine-monitoring.css`
- `client/src/lib/machineMonitoring.ts`

Authorization files modified: `server/routers.ts`, `backend/public/index.php`, `backend/src/CoinPaymentDiagnostics.php`.

Tests: `client/src/lib/machineMonitoring.test.ts`, new `client/src/lib/machineMonitoringView.test.tsx`, `server/machineMonitoring.test.ts`, `backend/tests/controller-replacement.php`. Coverage includes hidden staff diagnostics, separate maintenance entry, server denial for Admin/staff, Super Admin recovery workflow, unchanged connection freshness and no inferred hardware readiness.

No firmware, NVS, payment, inventory, sensor, dispensing, registration or transaction data changes. No schema migration or firmware re-upload required. Restart the production Node app and refresh the page after deploying the build.
