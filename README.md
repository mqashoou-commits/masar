# مسار (Masar) — AI Career Path & Interview Coach

مشروع هاكاثون: مساعد ذكاء اصطناعي يحلل السيرة الذاتية، يقترح مسارات مهنية، ويدرب المستخدم على مقابلات العمل — بواجهة ثنائية اللغة (عربي/إنجليزي).

## البنية
```
masar/
  server.js          # Express backend + Groq API calls
  package.json
  .env.example
  public/
    index.html        # الواجهة الرئيسية
    style.css          # التصميم (design tokens: navy/amber/teal)
    script.js          # منطق الواجهة + Three.js + GSAP
    i18n.js            # قاموس الترجمة عربي/إنجليزي
```

## التشغيل محلياً

1. **تثبيت الحزم**
   ```bash
   npm install
   ```

2. **إعداد مفتاح API**
   انسخ `.env.example` إلى `.env` وحط مفتاحك المجاني من [console.groq.com/keys](https://console.groq.com/keys) (بدون بطاقة بنكية):
   ```bash
   cp .env.example .env
   # عدل GROQ_API_KEY بالملف
   ```

3. **تشغيل السيرفر**
   ```bash
   npm start
   ```
   افتح المتصفح على: http://localhost:3000

## الـ Endpoints

| Method | Route | الوظيفة |
|---|---|---|
| POST | `/api/extract-cv` | يستخرج النص من ملف PDF مرفوع |
| POST | `/api/analyze-cv` | يحلل نص السيرة الذاتية ويرجع نقاط القوة/الفجوات/المسارات المقترحة |
| POST | `/api/interview` | يدير محادثة محاكاة المقابلة، سؤال بسؤال |

## النشر (Deployment)

المشروع جاهز للنشر على **Vercel** أو أي منصة تدعم Node.js:
- تأكد من إضافة `GROQ_API_KEY` كـ Environment Variable بإعدادات المشروع على المنصة (**لا ترفع ملف `.env` على GitHub**)
- أضف `.env` لملف `.gitignore` قبل أول `git push`

## التقنيات المستخدمة
- **Backend**: Node.js, Express, Groq API (Llama 3.3 70B)
- **Frontend**: Vanilla JS, Three.js (خلفية تفاعلية), GSAP (أنيميشن)
- **PDF Parsing**: pdf-parse

## الخطوات الجاية
- ربط قاعدة بيانات حقيقية لفرص العمل بدل الاعتماد على اقتراحات الموديل فقط
- لوحة تتبع تقدم المستخدم عبر عدة مقابلات
- شراكات مع مراكز التوظيف الجامعية
