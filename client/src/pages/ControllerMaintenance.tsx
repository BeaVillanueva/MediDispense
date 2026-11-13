import {useFirebaseAuth} from '@/contexts/FirebaseAuthContext';
import ControllerReplacement from '@/components/ControllerReplacement';

/** Direct maintenance entry; deliberately absent from Machine Monitoring. */
export default function ControllerMaintenance(){
  const auth=useFirebaseAuth();
  if(auth.profile?.role_code!=='super_admin')return <main className="page-content"><section className="panel" style={{padding:28}}><h1>Super Admin access required</h1><p>Sign in with an authorized Super Admin account to replace a controller.</p><a href="/">Back to dashboard</a></section></main>;
  return <main className="page-stack machine-monitoring" style={{maxWidth:900,margin:'32px auto',padding:20}}><a href="/">Back to dashboard</a><h1>Controller Maintenance</h1><p>Keep the old controller disconnected. Do not insert coins during this check.</p><ControllerReplacement/><section className="panel" style={{padding:24}}><h2>After successful retirement</h2><p>Return to the original kiosk browser and keep it connected. The existing payment expiration workflow will recheck the unpaid purchase. Wait for backend-confirmed cancellation before starting another purchase.</p><p>If assistance is still required, keep the purchase open and report the displayed blocker. Do not clear browser storage or insert coins.</p></section></main>;
}
