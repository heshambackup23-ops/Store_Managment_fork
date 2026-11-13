ALTER TABLE products ADD COLUMN variant_group TEXT;
ALTER TABLE products ADD COLUMN variant_color TEXT;
ALTER TABLE products ADD COLUMN variant_size TEXT;
ALTER TABLE products ADD COLUMN compatible_models TEXT;
ALTER TABLE products ADD COLUMN units_per_pack INTEGER NOT NULL DEFAULT 1 CHECK (units_per_pack BETWEEN 1 AND 1000000);
ALTER TABLE products ADD COLUMN pack_barcode TEXT;

CREATE UNIQUE INDEX retail_pack_barcode_unique ON products(pack_barcode) WHERE pack_barcode IS NOT NULL;

CREATE TRIGGER retail_pack_barcode_insert BEFORE INSERT ON products
WHEN (NEW.pack_barcode IS NOT NULL AND (NEW.units_per_pack < 2 OR NEW.tracking <> 'quantity'
        OR NEW.pack_barcode = NEW.barcode OR EXISTS (SELECT 1 FROM products WHERE barcode = NEW.pack_barcode)))
    OR (NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM products WHERE pack_barcode = NEW.barcode))
BEGIN SELECT RAISE(ABORT, 'RETAIL_PACK_BARCODE'); END;

CREATE TRIGGER retail_pack_barcode_update BEFORE UPDATE OF barcode, pack_barcode, units_per_pack, tracking ON products
WHEN (NEW.pack_barcode IS NOT NULL AND (NEW.units_per_pack < 2 OR NEW.tracking <> 'quantity'
        OR NEW.pack_barcode = NEW.barcode OR EXISTS (SELECT 1 FROM products WHERE barcode = NEW.pack_barcode AND id <> NEW.id)))
    OR (NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM products WHERE pack_barcode = NEW.barcode AND id <> NEW.id))
BEGIN SELECT RAISE(ABORT, 'RETAIL_PACK_BARCODE'); END;

ALTER TABLE maintenance_requests ADD COLUMN retail_device_id INTEGER REFERENCES retail_devices(id);
CREATE INDEX maintenance_retail_device ON maintenance_requests(retail_device_id) WHERE retail_device_id IS NOT NULL;
