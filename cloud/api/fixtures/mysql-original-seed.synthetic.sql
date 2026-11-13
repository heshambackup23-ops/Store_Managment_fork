-- Synthetic, reproducible rows for the original Laravel migrations. No operational data.
SET NAMES utf8mb4;
SET time_zone = '+00:00';
START TRANSACTION;
INSERT INTO categories (id,name,created_at,updated_at)
VALUES (21,'تصنيف اختبار النقل','2026-10-01 08:00:00','2026-10-01 08:00:00');
INSERT INTO products (id,name,price,description,notes,barcode,stock,total_sold,category_id,created_at,updated_at)
VALUES
  (42,'منتج اختباري',9.90,NULL,'عينة اصطناعية','000123',7,2,21,'2026-10-01 08:00:00','2026-10-01 08:00:00'),
  (43,'قطعة اختبار',8.50,'','',NULL,0,1,21,'2026-10-01 08:00:00','2026-10-01 08:00:00');
INSERT INTO customers (id,name,phone,address,created_at,updated_at)
VALUES (41,'عميل اختباري','00123',NULL,'2026-10-01 08:00:00','2026-10-01 08:00:00');
INSERT INTO invoices
  (id,invoice_number,product_id,customer,invoice_date,quantity,status,total_amount,product_price,items,notes,paid_amount,created_at,updated_at)
VALUES
  (201,'HILAL-FIXTURE-201',42,'عميل اختباري','2026-10-01',2,'unpaid',19.80,9.90,
    '[{"product_id":42,"name":"اسم وقت البيع","quantity":2,"price":"9.90","line_total":"19.80"}]',NULL,3.70,
    '2026-10-01 08:30:00','2026-10-04 08:30:00'),
  (202,'HILAL-FIXTURE-202',43,'عميل نقدي اختباري','2026-10-02',1,'paid',8.50,8.50,NULL,NULL,8.50,
    '2026-10-02 09:30:00','2026-10-02 09:30:00');
INSERT INTO installments
  (id,invoice_id,customer_id,customer,product_id,product_name,product_price,payment_date,next_payment_date,paid_amount,remaining,quantity,status,created_at,updated_at)
VALUES (302,201,41,'عميل اختباري',42,'اسم وقت البيع',19.80,'2026-10-04','2026-11-01',3.70,16.10,2,'pending',
  '2026-10-01 08:30:00','2026-10-04 08:30:00');
INSERT INTO personal_debts
  (id,creditor,description,total_amount,paid_amount,remaining,due_date,status,notes,created_at,updated_at)
VALUES (401,'دائن اختباري','عينة اصطناعية',15.00,4.25,10.75,'2026-11-30','open',NULL,
  '2026-10-01 08:30:00','2026-10-05 08:30:00');
INSERT INTO personal_debt_payments
  (id,personal_debt_id,amount,paid_on,notes,created_at,updated_at)
VALUES (402,401,4.25,'2026-10-05',NULL,'2026-10-06 08:30:00','2026-10-06 08:30:00');
COMMIT;
