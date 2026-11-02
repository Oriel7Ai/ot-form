# Worker מתווך לטופס דוח האבחון

ה-Worker יושב בין הטופס לבין Claude. הוא מאפשר:
- **מפתח API אחד בשרת**, במקום מפתח לכל מאבחנת.
- **קוד גישה אישי לכל מאבחנת**, שאפשר לבטל בנפרד.
- **הוראות מוסתרות:** ההוראות ל-Claude שמורות ב-Cloudflare, ולא בקוד האתר.
- **מגבלת שימוש יומית** לכל קוד.

**מה הוא לא עושה:**
- **לא מסיר פרטים מזהים.** את זה עושה הטופס בדפדפן, לפני השליחה.
- **לא שומר ולא מתעד** את הטקסט שעובר דרכו.

---

## מה צריך לפני שמתחילים
- **חשבון Cloudflare:** חינמי, נפתח ב-https://dash.cloudflare.com/sign-up
- **מפתח API של Anthropic:** מ-https://console.anthropic.com. מומלץ ליצור מפתח נפרד ל-Worker.
- **תקרת הוצאה חודשית ב-Anthropic Console:** זו ההגנה הסופית על העלות. גם אם קוד גישה ידלוף, החשבון לא יעבור את התקרה.
- **שלושה קובצי הוראות:** `prompt-inst.txt`, ‏`prompt-icf.txt` ו-`prompt-extract.txt`. הם נשלחים בנפרד ולא נמצאים בריפו, כדי שלא יתפרסמו.

---

## הקמה דרך לוח הבקרה, בלי להתקין כלום

### 1. אחסון להוראות (KV)
1. ב-Cloudflare: **Storage & Databases** ← **Workers KV** ← **Create namespace**. שם: `ot-form`.
2. בתוך ה-namespace מוסיפים שלושה מפתחות. כל ערך הוא כל התוכן של הקובץ המתאים:

| Key | הערך |
|---|---|
| `prompt:inst` | התוכן של `prompt-inst.txt` (סגנון המכון) |
| `prompt:icf` | התוכן של `prompt-icf.txt` (דוח אינטגרטיבי, ICF) |
| `prompt:extract` | התוכן של `prompt-extract.txt` (שליפה מקבצים) |

### 2. ה-Worker
1. **Compute (Workers)** ← **Create** ← **Worker** ← שם: `ot-form-proxy` ← **Deploy**.
2. **Edit code** ← מוחקים את הקוד לדוגמה ← מדביקים את כל התוכן של `worker/index.js` ← **Deploy**.

### 3. חיבור ה-Worker לאחסון
**Settings** ← **Bindings** ← **Add** ← **KV namespace**:
- **Variable name:** `OT_FORM`. חייב להיות בדיוק כך.
- **KV namespace:** `ot-form`.

### 4. משתנים וסודות
**Settings** ← **Variables and Secrets** ← **Add**:

| שם | סוג | ערך |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | מפתח ה-API מ-Anthropic |
| `ACCESS_CODES` | Secret | שורה לכל מאבחנת: `שם=קוד` (פירוט למטה) |
| `ALLOWED_ORIGINS` | Text | `https://oriel7ai.github.io`. אחרי המעבר ל-Cloudflare Pages מוסיפים בפסיק גם את הכתובת החדשה |
| `DAILY_LIMIT` | Text | `60`: מספר הבקשות המרבי ליום לכל קוד |

**ככה נראה `ACCESS_CODES`:**
```
רות=ruth-Xk29fQp7LmWz
דנה=dana-Hq84VbN3rTsY
```
- **הקוד:** כל מחרוזת אקראית באורך 12 תווים לפחות, בלי הסימן `=`. אפשר ליצור כזו בכל מחולל סיסמאות.
- **השם שלפני ה-`=`:** משמש רק למגבלת השימוש היומית.

### 5. בדיקה
- **הכתובת:** בדף ה-Worker מופיעה הכתובת שלו, למשל `https://ot-form-proxy.<שם-החשבון>.workers.dev`.
- **שולחים לי את הכתובת:** אחבר אליה את הטופס בשינוי נפרד. רק אז הטופס עובר לעבוד דרך ה-Worker.

---

## תחזוקה שוטפת
- **עריכת ההוראות ל-Claude:**
  - **איפה:** Workers KV ← `ot-form` ← עורכים את הערך של המפתח.
  - **מתי זה תופס:** בתוך כדקה, בלי לגעת בקוד ובלי GitHub.
- **מאבחנת חדשה:** מוסיפים שורה ל-`ACCESS_CODES` ← **Deploy**.
- **ביטול גישה:** מוחקים את השורה של המאבחנת מ-`ACCESS_CODES` ← **Deploy**. הקוד מפסיק לעבוד מיד.
- **פרטיות:**
  - **לא להוסיף `console.log` לקוד ה-Worker.** הוא יכול לרשום טקסט קליני ביומני Cloudflare.
  - הטקסט עובר אחרי הסרת הפרטים המזהים, אבל הוא עדיין קליני.

### הקמה עם wrangler (למי שמעדיף שורת פקודה)
```bash
cd worker
npx wrangler kv namespace create OT_FORM          # מעתיקים את ה-id לקובץ wrangler.toml
npx wrangler kv key put --binding OT_FORM "prompt:inst" --path prompt-inst.txt --remote
npx wrangler kv key put --binding OT_FORM "prompt:icf" --path prompt-icf.txt --remote
npx wrangler kv key put --binding OT_FORM "prompt:extract" --path prompt-extract.txt --remote
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODES
npx wrangler deploy
```

---

## מעבר ל-Cloudflare Pages והפיכת הריפו לפרטי
**הסדר חשוב.** ברגע שהריפו פרטי, האתר ב-GitHub Pages יורד, כי בחשבון החינמי של GitHub אפשר לפרסם אתר רק מריפו ציבורי. לכן קודם מקימים את האתר החדש, ורק אחר כך סוגרים את הריפו.

1. **הקמת האתר החדש:** Cloudflare ← **Workers & Pages** ← **Create** ← **Pages** ← **Connect to Git**. בוחרים את הריפו `ot-form`, ובהגדרות הבנייה:
   - **Build command:** `sh build.sh` (מעתיק לתיקייה `dist` רק את קובצי האתר, בלי הבדיקות וקוד ה-Worker)
   - **Build output directory:** `dist`
   - **Environment variables:** `SKIP_DEPENDENCY_INSTALL` = `1` (לבנייה לא צריך להתקין כלום)
   - **כותרות אבטחה:** נקבעות בקובץ `_headers`, ו-Cloudflare Pages מחיל אותן אוטומטית.
2. **בדיקת הכתובת החדשה:** למשל `https://ot-form.pages.dev`. מוודאים שהטופס נטען ועובד.
3. **Google:** ב-Google Cloud Console, במזהה הכניסה של הטופס (OAuth Client ID), מוסיפים את הכתובת החדשה ל-**Authorized JavaScript origins**. בלי זה השמירה בענן לא תעבוד באתר החדש.
4. **ה-Worker:** מוסיפים את הכתובת החדשה ל-`ALLOWED_ORIGINS`.
5. **סגירת הריפו:** רק עכשיו, ב-GitHub: **Settings** ← **General** ← **Danger Zone** ← **Change visibility** ← **Private**.

**מה לא עובר לכתובת החדשה,** כי הדפדפן שומר מידע לפי כתובת:
- **פרטי המאבחנת, קוד הגישה ותובנות השימוש:** צריך להגדיר מחדש.
- **"הניסוחים שלי":** חוזרים אחרי כניסה לענן, כי הם מסונכרנים לחשבון Google.
- **טיוטות בענן:** לא נפגעות.
- **מי שהתקין את האתר כאפליקציה:** צריך להתקין מחדש מהכתובת החדשה.
