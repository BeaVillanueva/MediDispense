<?php
declare(strict_types=1);

/** Read-only connection projection, never a payment/registration safety decision. */
final class MachineMonitoring {
    public static function project(array $machine,array $reports):array {
        if(!$reports)return $machine+['monitoring_source'=>'legacy_heartbeat','controller_device_id'=>null,'controller_ambiguous'=>false];
        $live=array_values(array_filter($reports,fn($d)=>!($d['retired']??false)&&($d['fresh']??false)));
        $candidates=array_values(array_filter($reports,fn($d)=>!($d['retired']??false)));
        usort($candidates,fn($a,$b)=>($b['reportedAtMs']??0)<=>($a['reportedAtMs']??0));
        $selected=count($live)===1?$live[0]:($candidates[0]??null);
        $ambiguous=count($live)>1;
        $machine['monitoring_source']='authenticated_controller_diagnostics';
        $machine['controller_device_id']=$ambiguous?null:($selected['device_id']??null);
        $machine['controller_ambiguous']=$ambiguous;
        $machine['heartbeat_age_seconds']=$selected['ageSeconds']??null;
        $machine['heartbeat_at_ms']=$selected['reportedAtMs']??null;
        $machine['last_communication_at']=isset($selected['reportedAtMs'])?date('c',(int)($selected['reportedAtMs']/1000)):null;
        $online=count($live)===1&&($selected['backend_session_verified']??false)===true;
        $machine['connection_status']=$online?'online':'offline';
        // Old test heartbeat component values are not current component evidence.
        $machine['esp32_status']=$online?'Connected':'Unknown';
        foreach(['motor_status','sensor_status','coin_acceptor_status'] as $key)$machine[$key]='Unknown';
        $machine['last_payload']=json_encode($online?['esp32_status'=>'Connected']:[]);
        return $machine;
    }
}
