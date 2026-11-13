<?php
declare(strict_types=1);

/** Read-only clinical information. Never infer approval from legacy dosage text. */
final class MedicineGuidance {
    public static function identity(array $medicine): array {
        $identity=[];
        foreach (['id','name','genericName','description','dosage','instructions','imageUrl'] as $key) {
            $identity[$key]=$medicine[$key]??null;
        }
        return $identity;
    }

    public static function approved(array $medicine, array $row, ?int $now=null): ?array {
        $now??=time();
        if (($row['approval_status']??'')!=='approved' || (int)($row['product_identity_verified']??0)!==1) return null;
        foreach (['pharmacist_name','pharmacist_registration','approved_at','review_due_at'] as $key) if (empty($row[$key])) return null;
        $approved=strtotime($row['approved_at']); $due=strtotime($row['review_due_at']);
        if (!$approved || !$due || $approved>$now || $due<=$now || $due<=$approved) return null;
        $snapshot=json_decode($row['identity_snapshot']??'',true);
        if (!is_array($snapshot) || $snapshot!==self::identity($medicine)) return null;
        $fields=['medicineName'=>'medicine_name','strength'=>'strength','formulation'=>'formulation','purpose'=>'purpose','ageGroup'=>'age_group','dose'=>'recommended_dose','frequency'=>'frequency','precautions'=>'precautions','sourceLabel'=>'source_label','sourceUrl'=>'source_url'];
        $result=['approvalStatus'=>'approved'];
        foreach ($fields as $key=>$column) {
            if (!is_string($row[$column]??null) || trim($row[$column])==='') return null;
            $result[$key]=trim($row[$column]);
        }
        $url=parse_url($result['sourceUrl']);
        if (!$url || ($url['scheme']??'')!=='https' || empty($url['host']) || isset($url['user']) || isset($url['pass'])) return null;
        $result['minimumInterval']=$row['minimum_interval']??null;
        $result['maximumDailyDose']=$row['maximum_daily_dose']??null;
        $result['approvedAt']=$row['approved_at'];
        $result['reviewDueAt']=$row['review_due_at'];
        return $result;
    }

    public static function attach(PDO $db, array $medicines): array {
        try {
            // The latest revision wins, including drafts/revocations. Never fall back to old approval.
            $rows=$db->query('SELECT g.* FROM medicine_usage_guidance g JOIN (SELECT medicine_id,MAX(id) id FROM medicine_usage_guidance GROUP BY medicine_id) latest ON latest.id=g.id')->fetchAll();
        } catch (PDOException $error) {
            if ($error->getCode()!=='42S02') throw $error;
            $rows=[]; // Optional proposed schema is absent: withhold clinical guidance.
        }
        $byMedicine=[];
        foreach ($rows as $row) $byMedicine[(int)$row['medicine_id']]=$row;
        foreach ($medicines as &$medicine) $medicine['usageGuidance']=isset($byMedicine[$medicine['id']])?self::approved($medicine,$byMedicine[$medicine['id']]):null;
        unset($medicine);
        return $medicines;
    }
}
