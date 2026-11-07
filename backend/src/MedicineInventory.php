<?php
declare(strict_types=1);

/** Catalog changes never write inventory quantities or historical purchase items. */
final class MedicineInventory {
    public function __construct(private PDO $db, private string $machineCode) {}

    public function save(int $id, array $body, bool $archive=false): array {
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
            if ($field==='unit_price' && (!is_numeric($value) || !is_finite((float)$value) || (float)$value<0 || (float)$value>99999999.99 || abs((float)$value*100-round((float)$value*100))>0.00001)) throw new KioskError('INVALID_PRICE','Enter a non-negative price with at most two decimal places.',422);
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
            $query=$this->db->prepare('SELECT m.name,i.reserved_quantity FROM medicines m JOIN inventory i ON i.medicine_id=m.id WHERE m.id=? FOR UPDATE');
            $query->execute([$id]); $medicine=$query->fetch();
            if (!$medicine) throw new KioskError('NOT_FOUND','Medicine record not found.',404);
            // Checkout locks these same rows before reserving stock, so catalog changes cannot race a purchase.
            if ((int)$medicine['reserved_quantity']>0) throw new KioskError('MEDICINE_BUSY','Finish or cancel the active purchase before changing this medicine.');
            if (array_key_exists('category_name',$body)) {
                if (!is_string($body['category_name'])) throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);
                $query=$this->db->prepare('SELECT id FROM medicine_categories WHERE name=? AND is_active=1'); $query->execute([trim($body['category_name'])]); $category=$query->fetchColumn();
                if (!$category) throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);
                $fields[]='category_id=?'; $values[]=$category;
            }
            if ($archive || array_key_exists('slot_number',$body)) {
                $query=$this->db->prepare('SELECT s.* FROM machine_slots s JOIN machines m ON m.id=s.machine_id WHERE m.machine_code=? OR s.medicine_id=? ORDER BY s.id FOR UPDATE'); $query->execute([$this->machineCode,$id]); $slots=$query->fetchAll();
                $target=null;
                if (!$archive && $body['slot_number']!==null) {
                    $query=$this->db->prepare('SELECT s.* FROM machine_slots s JOIN machines m ON m.id=s.machine_id WHERE m.machine_code=? AND s.slot_number=?'); $query->execute([$this->machineCode,$body['slot_number']]); $target=$query->fetch();
                    if (!$target || ($target['medicine_id']!==null && (int)$target['medicine_id']!==$id)) throw new KioskError('SLOT_UNAVAILABLE','This slot is missing or already assigned.');
                }
                foreach ($slots as $slot) {
                    if ((int)$slot['medicine_id']===$id && (!$target || $slot['id']!==$target['id'])) $this->db->prepare("UPDATE machine_slots SET medicine_id=NULL,slot_status='blocked' WHERE id=?")->execute([$slot['id']]);
                }
                if ($target && (int)$target['medicine_id']!==$id) $this->db->prepare("UPDATE machine_slots SET medicine_id=?,slot_status='ready' WHERE id=?")->execute([$id,$target['id']]);
            }
            $query=$this->db->prepare('SELECT COUNT(*) FROM transaction_items WHERE medicine_id=?'); $query->execute([$id]); $history=(int)$query->fetchColumn();
            if ($archive) { $fields=['is_enabled=0']; $values=[]; }
            if ($fields) { $values[]=$id; $this->db->prepare('UPDATE medicines SET '.implode(',',$fields).' WHERE id=?')->execute($values); }
            elseif (!array_key_exists('slot_number',$body)) throw new KioskError('INVALID_MEDICINE','No editable fields supplied.',422);
            $this->db->commit();
            return ['medicine_id'=>$id,'medicine_name'=>$medicine['name'],'transaction_records_preserved'=>$history,'updated_fields'=>$archive?[]:array_keys($body)];
        } catch (Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
}
