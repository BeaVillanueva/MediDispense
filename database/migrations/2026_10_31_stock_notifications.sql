-- Preserve existing notification types and records; add restock notifications.
ALTER TABLE notifications MODIFY notification_type
  ENUM('low_stock','out_of_stock','near_expiry','expired','dispensing_failure','payment_failure','system_error','stock_added') NOT NULL;
