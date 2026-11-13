<?php
declare(strict_types=1);

/** Background metadata only. No command, payment, inventory, or status mutations. */
final class TransactionReferenceSync {
    public function __construct(private PDO $db,private TransactionReferenceGateway $firebase) {}
    public function initialize(): void {
        // Establish explicit high-water baselines, never backfill existing history.
        foreach(['payments'=>'transactions','dispensing'=>'dispensing_requests'] as $kind=>$table) {
            $max=(int)$this->db->query("SELECT COALESCE(MAX(id),0) FROM $table")->fetchColumn();
            $this->db->prepare('INSERT IGNORE INTO system_settings(setting_key,setting_value) VALUES(?,?)')->execute(['txn_ref_baseline_'.$kind,(string)$max]);
        }
    }
    public function run(): array {
        $this->initialize();$results=[];
        foreach(['payments','dispensing'] as $kind) {
            $q=$this->db->prepare('SELECT setting_value FROM system_settings WHERE setting_key=?');$q->execute(['txn_ref_baseline_'.$kind]);$baseline=(int)$q->fetchColumn();
            $from=$kind==='payments'?'transactions t':'dispensing_requests d JOIN transactions t ON t.id=d.transaction_id';
            $entity=$kind==='payments'?'t.id':'d.id';
            $request=$kind==='payments'?'NULL':'d.id';
            // Per-entity markers also catch transactions committed out of numeric-ID order.
            $q=$this->db->prepare("SELECT t.id transaction_id,t.transaction_code,$request request_id,$entity entity_id FROM $from WHERE $entity>? AND NOT EXISTS (SELECT 1 FROM system_settings s WHERE s.setting_key=CONCAT('txn_ref_done_$kind:', $entity)) ORDER BY $entity LIMIT 20");$q->execute([$baseline]);
            foreach($q->fetchAll() as $row) {
                try {
                    $this->firebase->syncTransactionReference($kind,(int)$row['transaction_id'],$row['transaction_code'],$row['request_id']===null?null:(int)$row['request_id']);
                    $this->db->prepare('INSERT IGNORE INTO system_settings(setting_key,setting_value) VALUES(?,?)')->execute(['txn_ref_done_'.$kind.':'.$row['entity_id'],$row['transaction_code']]);
                    $this->db->prepare('DELETE FROM system_settings WHERE setting_key=?')->execute(['txn_ref_error_'.$kind.':'.$row['entity_id']]);
                    $results[]=['kind'=>$kind,'id'=>(int)$row['entity_id'],'status'=>'synced'];
                } catch(Throwable $e) {
                    $code=in_array($e->getMessage(),['REFERENCE_IDENTITY_CONFLICT','REFERENCE_SYNC_CONCURRENT_UPDATE'],true)?$e->getMessage():'REFERENCE_SYNC_UNAVAILABLE';
                    $this->db->prepare('INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)')->execute(['txn_ref_error_'.$kind.':'.$row['entity_id'],$code]);
                    $results[]=['kind'=>$kind,'id'=>(int)$row['entity_id'],'status'=>$code];
                }
            }
        }
        return $results;
    }
}
