# خريطة REST من Laravel إلى Cloud Edition

تبدأ المسارات في الجدول بـ`/api/v1` عدا `/api/user`. يشير `:id` إلى معرّف رقمي. قد تتغير حقول الطلب والاستجابة حتى عندما يظل المسار كما هو، خاصة مبالغ العملة وحالة الدفعات. عقد العامل الفعلي في `cloud/api/src`.

| Laravel عند مرجع النقل | Cloud Edition |
|---|---|
| `GET /api/user` | `GET /me` أو `GET /auth/me`. |
| `POST /auth/token`, `GET /me`, `DELETE /auth/token` | مسارات التوكن الأصلية، إضافة إلى `POST /auth/login` و`POST /auth/logout` لجلسة الويب. |
| `GET /profile`, `PUT /profile` | `GET /profile` و`PATCH /profile` و`POST /profile/password`. توجد مواءمة `PUT` لحقول Android الأساسية. |
| `GET /backup`, `POST /backup/import` | `GET /backup/catalog.csv` للتصدير المحدود. استعادة SQL عبر مسؤول D1. صيغة ZIP/XLSX الأصلية تحتاج محولًا. |
| `GET /products`, `POST /products`, `GET /products/{product}`, `PUT /products/{product}`, `DELETE /products/{product}` | CRUD للكتالوج مع `PATCH` للتعديل. تغيير الرصيد عبر `POST /inventory/adjustments`. الأرشفة تحفظ المراجع التاريخية. |
| `POST /products/{product}/image` | `PUT /products/:id/image` لرفع ملف الصورة كجسم الطلب، و`GET`/`DELETE` على المسار نفسه. |
| `GET /categories`, `POST /categories`, `GET /categories/{category}`, `PUT /categories/{category}`, `DELETE /categories/{category}` | قائمة، قراءة، إضافة، تحديث وحذف في `/categories`. |
| `GET /customers`, `POST /customers`, `GET /customers/{customer}`, `PUT /customers/{customer}`, `DELETE /customers/{customer}` | قائمة، قراءة، إضافة، تحديث وحذف في `/customers`. |
| `GET /invoices`, `POST /invoices`, `GET /invoices/{invoice}` | `/invoices` و`/invoices/:id` مع بنود وأسعار خادمية. |
| `PUT /invoices/{invoice}` | `POST /invoices/:id/reissue` يعكس الأصل ويصدر فاتورة مرتبطة. |
| `GET /invoices/{invoice}/pdf` | صفحة طباعة في الويب تدعم حفظ PDF من المتصفح. |
| `GET /cashier/products`, `POST /cashier/checkout` | مسارا توافق Kotlin مع سعر عشري وحساب الباقي. يستخدم الويب أيضًا `/products` و`/invoices`. |
| `POST /invoices/{invoice}/pay`, `POST /invoices/{invoice}/refund` | `POST /invoices/:id/payments` و`POST /invoices/:id/refund`. |
| `GET /installments`, `POST /installments`, `GET /installments/{installment}`, `PUT /installments/{installment}` | قائمة/إضافة/تفاصيل/تعديل بـ`PATCH` على `/installments`. |
| `POST /installments/{installment}/pay`, `POST /installments/{installment}/status`, `DELETE /installments/{installment}` | `/installments/:id/payments`. الحالة المالية مشتقة من الدفعات وتبقى القيود التاريخية محفوظة. |
| `GET /personal-debts`, `POST /personal-debts`, `GET /personal-debts/{debt}`, `PUT /personal-debts/{debt}`, `DELETE /personal-debts/{debt}`, `POST /personal-debts/{debt}/pay` | `/debts` و`/debts/:id` و`/debts/:id/payments`. راجع حدود دورة الحذف في سجل الحالة. |
| `GET /suppliers`, `POST /suppliers`, `GET /suppliers/{supplier}`, `PUT /suppliers/{supplier}`, `DELETE /suppliers/{supplier}` | `/suppliers` و`/suppliers/:id`، ومشتريات/دفعات وتقارير عبر `/purchases` و`/purchases/:id/payments` و`/reports/suppliers`. |
| `GET /wallets`, `POST /wallets`, `POST /wallets/{wallet}/toggle`, `POST /wallets/{wallet}/adjust` | `/wallets` و`PATCH /wallets/:id` و`/wallets/:id/transactions`، مع سجل الصندوق في `/wallet-cash`. |
| `GET /wallet-cashier`, `POST /wallet-cashier`, `POST /wallet-cashier/{transaction}/settle`, `POST /wallet-cashier/{transaction}/reverse` | `/wallet-transactions` و`/wallets/:id/transactions`، و`/wallet-debts/:id/payments` لتسوية الذمم، و`/wallet-transactions/:id/reverse` للعكس. |
| `GET /damaged/products`, `GET /damaged`, `POST /damaged`, `GET /damaged/{item}`, `PUT /damaged/{item}`, `POST /damaged/{item}/void` | البحث من `/products`، عرض وتسجيل الهالك من `/damaged`، والعكس عبر `/damaged/:id/reverse`. |
| `GET /maintenance`, `POST /maintenance`, `GET /maintenance/{maintenance}`, `PUT /maintenance/{maintenance}`, `DELETE /maintenance/{maintenance}` | `/maintenance` و`/maintenance/:id` مع `PATCH` للانتقالات و`/maintenance/:id/payments` عند السداد. |
| `GET /sales` | `GET /reports/sales` والتصدير من واجهة التقرير. |
| `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/{notification}/read` | المسارات الأساسية للإشعارات، إضافة إلى إدارة الإشعارات من الويب. |

تضم الواجهة السحابية أيضًا `/dashboard` و`/staff` و`/roles` و`/settings` لعمليات كانت تعتمد على Blade في المصدر. نقطة صحة Worker هي `/health`.
