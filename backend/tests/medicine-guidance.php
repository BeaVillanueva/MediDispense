<?php
declare(strict_types=1);
require __DIR__.'/../src/MedicineGuidance.php';
require __DIR__.'/../src/Database.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
$medicine=['id'=>1,'name'=>'Example 500mg','genericName'=>'Example','description'=>'Tablet','dosage'=>'500 mg tablet','instructions'=>'Label','imageUrl'=>'/example.jpg'];
$row=['medicine_id'=>1,'identity_snapshot'=>json_encode(MedicineGuidance::identity($medicine)),'approval_status'=>'approved','product_identity_verified'=>1,'pharmacist_name'=>'TEST REVIEWER','pharmacist_registration'=>'TEST ONLY','approved_at'=>'2026-01-01 00:00:00','review_due_at'=>'2099-01-01 00:00:00','medicine_name'=>'Example','strength'=>'500 mg','formulation'=>'tablet','purpose'=>'TEST PURPOSE','age_group'=>'TEST AGE','recommended_dose'=>'TEST DOSE','frequency'=>'TEST FREQUENCY','precautions'=>'TEST PRECAUTIONS','source_label'=>'TEST SOURCE','source_url'=>'https://example.org/label'];
$count=0;
$check=static function(bool $ok,string $message)use(&$count):void {if(!$ok)throw new RuntimeException($message);$count++;};
$check(MedicineGuidance::approved($medicine,$row)!==null,'Approved fixture rejected');
$revoked=$row;$revoked['approval_status']='revoked';
$check(MedicineGuidance::approved($medicine,$revoked)===null,'Revoked guidance accepted');
foreach (['approval_status'=>'draft','product_identity_verified'=>0,'pharmacist_name'=>'','pharmacist_registration'=>'','review_due_at'=>'2020-01-01','recommended_dose'=>'','source_url'=>'javascript:alert(1)','identity_snapshot'=>'{}','approved_at'=>'2098-01-01'] as $key=>$value) {
    $changed=$row;$changed[$key]=$value;
    $check(MedicineGuidance::approved($medicine,$changed)===null,'Unsafe fixture accepted: '.$key);
}
$changed=$medicine;$changed['dosage']='250 mg tablet';
$check(MedicineGuidance::approved($changed,$row)===null,'Different strength accepted');
// Temporary tables shadow any real table; no writes to production data.
$db->exec('CREATE TEMPORARY TABLE medicine_usage_guidance (id INT,medicine_id INT,identity_snapshot TEXT,approval_status TEXT,product_identity_verified INT,pharmacist_name TEXT,pharmacist_registration TEXT,approved_at TEXT,review_due_at TEXT,medicine_name TEXT,strength TEXT,formulation TEXT,purpose TEXT,age_group TEXT,recommended_dose TEXT,frequency TEXT,precautions TEXT,source_label TEXT,source_url TEXT)');
$columns=array_keys($row);$stmt=$db->prepare('INSERT INTO medicine_usage_guidance (id,'.implode(',',$columns).') VALUES ('.implode(',',array_fill(0,count($columns)+1,'?')).')');
$stmt->execute(array_merge([1],array_values($row)));
$check(MedicineGuidance::attach($db,[$medicine])[0]['usageGuidance']!==null,'Read approved fixture failed');
$row['approval_status']='draft';$stmt->execute(array_merge([2],array_values($row)));
$check(MedicineGuidance::attach($db,[$medicine])[0]['usageGuidance']===null,'Latest draft must hide older approval');
$db->exec('DROP TEMPORARY TABLE medicine_usage_guidance');
// Verify absent-schema behavior using a dedicated temporary PDO subclass, without dropping real tables.
$missing=new class extends PDO { public function __construct(){} public function query(string $query,?int $fetchMode=null,mixed ...$args):PDOStatement|false {throw new class extends PDOException { public function __construct(){parent::__construct('test missing table');$this->code='42S02';} };} };
$check(MedicineGuidance::attach($missing,[$medicine])[0]['usageGuidance']===null,'Missing-schema fallback failed');
echo "Passed $count medicine guidance checks; production data untouched.\n";
