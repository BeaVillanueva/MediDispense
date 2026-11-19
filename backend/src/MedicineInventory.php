<?php
declare(strict_types=1);

/** Catalog changes never write inventory quantities or historical purchase items. */
final class MedicineInventory {
    public function __construct(private PDO $db, private string $machineCode) {}

    public function save(int $id, array $body, bool $archive=false): array {
        if($archive)throw new KioskError('MAINTENANCE_REQUIRED','Use the physically inspected Remove Medicine workflow.');
        if(($body['same_product_confirmed']??false)!==true)throw new KioskError('PRODUCT_CONFIRMATION','Confirm this is the same medicine, strength and formulation. Use Replace Medicine for a different product.',422);
        if(array_key_exists('is_enabled',$body))throw new KioskError('MAINTENANCE_REQUIRED','Use the physical slot workflow to activate or remove medicines.');
        $fields=[]; $values=[];
        foreach (['stock_quantity','quantity','reserved_quantity'] as $field) {
            if (array_key_exists($field,$body)) throw new KioskError('INVALID_MEDICINE','Use Add Stock to change stock.',422);
        }
        foreach (['name','generic_name','description','dosage_information','usage_instructions','image_url','unit_price','expiry_date','minimum_stock_level','is_enabled'] as $field) {
            if (!array_key_exists($field,$body)) continue;
            $value=$body[$field];
            if (in_array($field,['name','generic_name','description','dosage_information','usage_instructions'],true)) {
                if (!is_string($value) || strlen(trim($value))<2 || (in_array($field,['name','generic_name'],true) && mb_strlen(trim($value))>180)) throw new KioskError('INVALID_MEDICINE','Enter valid medicine information.',422);
                $value=trim($value);
            }
            if ($field==='unit_price' && (!is_numeric($value) || !is_finite((float)$value) || (float)$value<=0 || (float)$value>99999999.99 || abs((float)$value*100-round((float)$value*100))>0.00001)) throw new KioskError('INVALID_PRICE','Enter a positive price with at most two decimal places.',422);
            if ($field==='expiry_date') {
                $date=is_string($value)?DateTimeImmutable::createFromFormat('!Y-m-d',$value):false;
                if (!$date || $date->format('Y-m-d')!==$value || $value<'1000-01-01') throw new KioskError('INVALID_EXPIRY','Enter a valid expiry date.',422);
            }
            if ($field==='minimum_stock_level' && (!is_int($value) || $value<0 || $value>4294967295)) throw new KioskError('INVALID_MEDICINE','Invalid minimum stock.',422);
            if ($field==='is_enabled') { if (!is_bool($value) && !in_array($value,[0,1],true)) throw new KioskError('INVALID_MEDICINE','Invalid enabled value.',422); $value=(int)$value; }
            if ($field==='image_url' && (!is_string($value) || strlen($value)>500 || ($value!=='' && !filter_var($value,FILTER_VALIDATE_URL) && !str_starts_with($value,'/')))) throw new KioskError('INVALID_MEDICINE','Invalid image URL.',422);
            $fields[]="$field=?"; $values[]=$value;
        }
        if (array_key_exists('slot_number',$body) && $body['slot_number']!==null && (!is_int($body['slot_number']) || $body['slot_number']<1 || $body['slot_number']>65535)) throw new KioskError('INVALID_SLOT','Choose an existing slot.',422);
        $this->db->beginTransaction();
        try {
            $query=$this->db->prepare('SELECT id FROM machines WHERE machine_code=? FOR UPDATE');$query->execute([$this->machineCode]);
            $query=$this->db->prepare('SELECT setting_value FROM system_settings WHERE setting_key=?');$query->execute(['inventory_maintenance:'.$this->machineCode]);$op=json_decode($query->fetchColumn()?:'null',true);
            if(($op['status']??'')==='active')throw new KioskError('MAINTENANCE_ACTIVE','Finish the open physical slot change before editing medicine details.');
            $query=$this->db->prepare('SELECT m.*,i.quantity,i.reserved_quantity FROM medicines m JOIN inventory i ON i.medicine_id=m.id WHERE m.id=? FOR UPDATE');
            $query->execute([$id]); $medicine=$query->fetch();
            if (!$medicine) throw new KioskError('NOT_FOUND','Medicine record not found.',404);
            if(array_key_exists('slot_number',$body)){
                $query=$this->db->prepare('SELECT slot_number FROM machine_slots WHERE medicine_id=?');$query->execute([$id]);$current=$query->fetchColumn();
                if(($current===false?null:(int)$current)!==$body['slot_number'])throw new KioskError('MAINTENANCE_REQUIRED','Editing cannot change physical slots. Use Remove or Replace Medicine.');
                unset($body['slot_number']);
            }
            if(isset($body['expiry_date'])&&$body['expiry_date']!==$medicine['expiry_date']&&(int)$medicine['quantity']>0)throw new KioskError('BATCH_EXPIRY','Expiry cannot change while tablets remain. Remove the old stock before loading a different expiry batch.');
            if(isset($body['name'])){$query=$this->db->prepare('SELECT id FROM medicines WHERE LOWER(TRIM(name))=LOWER(?) AND is_enabled=1 AND id<>?');$query->execute([trim($body['name']),$id]);if($query->fetchColumn())throw new KioskError('DUPLICATE_MEDICINE','An active medicine already uses that name.');}
            // Checkout locks these same rows before reserving stock, so catalog changes cannot race a purchase.
            if ((int)$medicine['reserved_quantity']>0) throw new KioskError('MEDICINE_BUSY','Finish or cancel the active purchase before changing this medicine.');
            if (array_key_exists('category_name',$body)) {
                if (!is_string($body['category_name'])) throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);
                $query=$this->db->prepare('SELECT id FROM medicine_categories WHERE name=? AND is_active=1'); $query->execute([trim($body['category_name'])]); $category=$query->fetchColumn();
                if (!$category) throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);
                $fields[]='category_id=?'; $values[]=$category;
            }
            $query=$this->db->prepare('SELECT COUNT(*) FROM transaction_items WHERE medicine_id=?'); $query->execute([$id]); $history=(int)$query->fetchColumn();
            if ($fields) { $values[]=$id; $this->db->prepare('UPDATE medicines SET '.implode(',',$fields).' WHERE id=?')->execute($values); }
            else throw new KioskError('INVALID_MEDICINE','No editable fields supplied.',422);
            $after=$this->db->prepare('SELECT name,generic_name,category_id,description,dosage_information,usage_instructions,unit_price,expiry_date FROM medicines WHERE id=?');$after->execute([$id]);$newValues=$after->fetch();
            $this->db->commit();
            return ['medicine_id'=>$id,'medicine_name'=>$medicine['name'],'transaction_records_preserved'=>$history,'updated_fields'=>array_keys($body),'previous'=>array_intersect_key($medicine,$newValues),'new'=>$newValues];
        } catch (Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
}
