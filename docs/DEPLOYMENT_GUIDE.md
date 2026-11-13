# تشغيل Cloud Edition محليًا ونشر التجربة

## التشغيل المحلي

المتطلبات هي Node.js 22 وnpm. على Windows استخدم `npm.cmd` إذا منعت سياسة PowerShell تشغيل `npm.ps1`.

1. في `cloud/api` نفّذ `npm ci` ثم `npm run migrate:local`.
2. انسخ `.dev.vars.example` إلى `.dev.vars` وأدخل قيمة عشوائية خاصة لـ`AUTH_PEPPER` من 32 حرفًا أو أكثر. اضبط `WEB_ORIGIN` على عنوان Vite الذي ستفتحه في المتصفح.
3. عيّن `AUTH_PEPPER` بالقيمة نفسها و`STORE_USER_EMAIL` في بيئة العملية محليًا. يتيح `STORE_USER_USERNAME` تهيئة اسم الدخول لتجربة Kotlin.
4. لإنشاء مفتاح دخول عشوائي، اترك `STORE_USER_PASSWORD` دون تعيين ونفّذ `npm run provision:sql -- admin.generated.sql --access-key-file admin.generated.key`. لتجربة كلمة مرور، عيّن `STORE_USER_PASSWORD` بقيمة خاصة لا تقل عن 12 حرفًا ونفّذ `npm run provision:sql -- admin.generated.sql`. طبّق الملف عبر `npx wrangler d1 execute DB --local --file admin.generated.sql` ثم احذفه. في وضع المفتاح، انقله من الملف الخاص إلى مدير كلمات مرور موثوق واحذف الملف. يُدخل المفتاح في حقل كلمة المرور في الويب وAndroid.
5. نفّذ `npm run dev` في `cloud/api`. تحقق من `http://localhost:8787/health`.
6. في نافذة ثانية افتح `cloud/web`، ثم نفّذ `npm ci` و`npm run dev`. افتح العنوان الذي يطبعه Vite. تستقبل الواجهة `/api/v1` عبر وكيل Vite.
7. لتحميل عينات الكتالوج راجع [دليل ترحيل البيانات](DATABASE_MIGRATION.md).

## نشر النسخة التجريبية

البيئة الحالية [Pages](https://henra-store-demo-ui.pages.dev) و[Worker health](https://henra-store-demo-api.heshambackup23.workers.dev/health). تم الرفع الأول للواجهة عبر Direct Upload لملفات Vite ونسخة Pages Function المجمعة، مع ربط `STORE_API` بالـWorker. المسار أدناه يتيح إعادة نشر الإصدار من المصدر باستخدام Wrangler.

تأكد في الحساب من خطة Workers Free والحصص المتاحة ومن أن الأسماء التالية مخصصة لهذا المشروع. تحقّق من تفعيل نطاق `workers.dev`. تتم خطوات النشر على بيانات اصطناعية.

1. أنشئ D1 باسم `henra-store-demo-db` ومشروع Pages باسم `henra-store-demo-ui`. استخدم `cloudflare-full-migration` فرع النشر لمشروع العرض.
2. اضبط `HENRA_STORE_D1_ID` محليًا على UUID القاعدة التي تحققت من اسمها وحسابها. من `cloud/api` نفّذ `node scripts/demo-config.mjs`. ينشئ إعداد `.wrangler-demo.json` المتجاهل في Git.
3. طبّق `npx wrangler d1 migrations apply DB --config .wrangler-demo.json --remote` على قاعدة التجربة ثم `npx wrangler deploy --config .wrangler-demo.json`.
4. عيّن `AUTH_PEPPER` باستخدام `wrangler secret put` للتطبيق `henra-store-demo-api`. ضع عنوان Pages الفعلي في `WEB_ORIGIN` عند استخدام مصدر متصفح آخر مصرح به. هيّئ حساب عرض خاصًا بواسطة أداة التهيئة وقاعدة التجربة. يمكن للمسؤول إصدار مفتاح لحساب موظف أو إعادة إصداره، ويمكن لصاحب الحساب استبدال بيانات دخوله بعد تأكيد بيانات الدخول الحالية. يُعرض المفتاح عند إصداره فقط.
5. من `cloud/web` نفّذ `npm ci` و`npm run build`، ثم `node ../api/node_modules/wrangler/bin/wrangler.js pages deploy ./dist --project-name henra-store-demo-ui --branch cloudflare-full-migration`. يقرأ Pages تعريف Service Binding من `cloud/web/wrangler.jsonc`.
6. تحقق من `/health` على Worker ومن تسجيل الدخول وCookies والصلاحيات عبر عنوان Pages. أجرِ اختبارًا قصيرًا لبيع واسترجاع اصطناعي وراجع CPU وD1 analytics. استخدم [سجل الاختبار](TESTING_REPORT.md) لتسجيل النتيجة.

ينشر GitHub Actions من فرع `cloudflare-full-migration` فقط بعد فحوص Worker وD1 وبناء الواجهة. يطبّق ترحيلات D1، ثم ينشر Worker وPages، ثم يتحقق من الصحة وربط واجهة Pages بالـAPI. إعداداته هي متغير المستودع `HENRA_STORE_DEPLOY_ENABLED=true` وبيئة `henra-store-demo` المقيدة بالفرع، وفيها متغيرا `HENRA_STORE_CF_ACCOUNT_ID` و`HENRA_STORE_D1_ID` وسر `HENRA_STORE_CF_API_TOKEN`. يبقى `AUTH_PEPPER` في Cloudflare. رمز Cloudflare المخصص للتجربة ينتهي في 11 فبراير 2027؛ جدّده في GitHub قبل الموعد. لإيقاف النشر الآلي مع استمرار الاختبارات اضبط متغير التفعيل على `false`.

راجع [تجهيز بيئة تشغيل هلال](PRODUCTION_DEPLOYMENT_AR.md) لإعداد الموارد المعزولة، وفحصها، واختبار النسخة الخاصة قبل النشر اليدوي.

المراجع [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) و[Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) و[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
