CREATE TABLE mobile_product_operations (
  operation_id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX mobile_product_operations_product_idx ON mobile_product_operations(product_id);
