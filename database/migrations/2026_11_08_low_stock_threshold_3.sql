-- Threshold settings only: never modify inventory quantities or purchase records.
ALTER TABLE medicines ALTER COLUMN minimum_stock_level SET DEFAULT 3;
UPDATE medicines SET minimum_stock_level=3 WHERE minimum_stock_level<>3;
INSERT INTO system_settings(setting_key,setting_value) VALUES('low_stock_default','3')
ON DUPLICATE KEY UPDATE setting_value='3';
