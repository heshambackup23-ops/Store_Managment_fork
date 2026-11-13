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
    '2026-10-02 09:30:00','2026-10-02 09:30:00'),
  (203,'HILAL-FIXTURE-203',42,'عميل اختباري','2026-10-07',1,'refunded',5.50,5.50,NULL,
    'مرتجع تجريبي موثق',5.50,'2026-10-07 09:00:00','2026-10-08 10:00:00');
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
INSERT INTO suppliers (id,name,opening_balance,balance,created_at,updated_at)
VALUES (501,'مورد هلال التجريبي',10.00,42.25,'2026-10-02 08:00:00','2026-10-05 11:00:00');
INSERT INTO purchases (id,supplier_id,invoice_number,purchase_date,payment_type,total_amount,paid_amount,remaining,status,created_at,updated_at)
VALUES
  (502,501,'HILAL-PURCHASE-502','2026-10-03','credit',20.25,20.25,0.00,'paid','2026-10-03 09:00:00','2026-10-05 11:00:00'),
  (504,501,'HILAL-PURCHASE-504','2026-10-04','credit',40.00,7.75,32.25,'partial','2026-10-04 09:00:00','2026-10-05 11:00:00');
INSERT INTO supplier_payments (id,supplier_id,purchase_id,receipt_number,amount,payment_date,notes,created_at,updated_at)
VALUES (503,501,502,'HILAL-RECEIPT-503',28.00,'2026-10-05','دفعة اختبار على أقدم مشتريين',
  '2026-10-05 11:00:00','2026-10-05 11:00:00');
INSERT INTO wallets (id,name,provider,identifier,holder_name,opening_balance,balance,per_transaction_limit,daily_send_limit,daily_receive_limit,
  monthly_send_limit,monthly_receive_limit,warn_at_percent,default_commission_percent,default_fee_percent,is_active,created_at,updated_at)
VALUES
  (601,'محفظة هلال التجريبية','vodafone_cash','QA-WALLET-601','مسؤول اختباري',100.00,66.00,50.00,25.00,100.00,150.00,200.00,75,
    2.00,1.00,1,'2026-10-01 07:00:00','2026-10-09 12:00:00'),
  (606,'محفظة احتياطية تجريبية','instapay','QA-WALLET-606',NULL,0.00,0.00,25.00,NULL,NULL,NULL,NULL,80,
    0.00,0.00,0,'2026-10-01 08:00:00','2026-10-01 08:00:00');
INSERT INTO wallet_transactions
  (id,uuid,wallet_id,type,status,amount,commission,fee,profit,wallet_delta,cash_delta,balance_after,payment_method,receivable,
    customer_id,counterparty,customer_name,settles_id,occurred_at,created_at,updated_at)
VALUES
  (602,'00000000-0000-4000-8000-000000000602',601,'send','completed',20.00,4.00,3.00,1.00,-23.00,24.00,77.00,
    'cash',0.00,NULL,'QA-CASH-602',NULL,NULL,'2026-10-04 10:00:00','2026-10-04 10:00:00','2026-10-04 10:00:00'),
  (605,'00000000-0000-4000-8000-000000000605',601,'send','completed',10.00,2.00,1.00,1.00,-11.00,0.00,66.00,
    'deferred',7.00,41,'QA-CREDIT-605','عميل اختباري',NULL,'2026-10-06 10:00:00','2026-10-06 10:00:00','2026-10-09 12:00:00'),
  (607,'00000000-0000-4000-8000-000000000607',601,'settlement','completed',0.00,0.00,0.00,0.00,0.00,5.00,66.00,
    'cash',0.00,41,NULL,'عميل اختباري',605,'2026-10-09 12:00:00','2026-10-09 12:00:00','2026-10-09 12:00:00');
INSERT INTO wallet_cash_adjustments (id,kind,amount,note,occurred_at,created_at,updated_at)
VALUES (603,'opening',5.00,'افتتاح درج اختباري','2026-10-01 07:00:00','2026-10-01 07:00:00','2026-10-01 07:00:00');
INSERT INTO wallet_expenses (id,category,amount,note,spent_on,created_at,updated_at)
VALUES (604,'مصروف اختبار',0.50,'مصروف درج اختباري','2026-10-04','2026-10-04 15:00:00','2026-10-04 15:00:00');
INSERT INTO wallet_audit_logs (id,user_name,action,subject_type,subject_id,meta,created_at)
VALUES (608,'مشغل اختباري','send','wallet_transaction',602,JSON_OBJECT('fixture','HILAL-602'),'2026-10-04 10:00:01');
INSERT INTO damaged_items (id,product_id,product_name,product_barcode,quantity,unit_value,total_value,reason,notes,
  damaged_on,stock_before,stock_after,status,created_at,updated_at)
VALUES (701,42,'منتج اختباري','000123',2,1.25,2.50,'broken','قيد هالك اختباري',
  '2026-10-10',9,7,'recorded','2026-10-10 10:00:00','2026-10-10 10:00:00');
COMMIT;
