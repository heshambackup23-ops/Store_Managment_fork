CREATE TABLE mobile_edit_operations (
  operation_id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  target_id INTEGER NOT NULL
) STRICT;
