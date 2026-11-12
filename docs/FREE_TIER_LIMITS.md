# حدود Cloudflare للتجربة المجانية

| الخدمة | الحدود المرجعية |
|---|---|
| Workers Free | 100,000 طلب يوميًا، 10 ms CPU للطلب، 128 MB للذاكرة. Pages Functions تشارك حصة Workers. |
| D1 Free | 5 ملايين صف مقروء و100 ألف صف مكتوب يوميًا، 500 MB لكل قاعدة و5 GB للحساب، 10 قواعد، 50 استعلامًا لكل استدعاء Worker. يحتسب `batch()` استعلامًا واحدًا لهذا الحد. Time Travel لمدة 7 أيام. |
| Pages Free | 500 بناء شهريًا، 20,000 ملف، و25 MiB لكل ملف. |
| R2 Standard | للحساب حصة استخدام شهري مجانية وتوجد رسوم بعد تجاوزها. تخزين التجربة يستخدم D1 للصور الصغيرة. |

احسب أثر الفهارس والـtriggers على صفوف D1 المكتوبة. القوائم تُقسّم إلى صفحات، والتصدير داخل Worker محدود، والعمليات الحساسة تحمل `no-store`. تمنع مفاتيح المحاولة إعادة تنفيذ الكتابة المالية نفسها عند نتيجة اتصال غير مؤكدة. أرقام وقت الاستجابة المحلي لا تقيس وقت CPU في Cloudflare. سجّل CPU و`rows_read` و`rows_written` من الطلبات المحدودة عند توفر النشر.

المصادر [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) و[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) و[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) و[Pages limits](https://developers.cloudflare.com/pages/platform/limits/) و[R2 pricing](https://developers.cloudflare.com/r2/pricing/).
