// בדיקות לטופס: מריצים עם  node tests/form.test.js
// הבדיקות פותחות את index.html בדפדפן Chromium (Playwright) ובודקות את בניית הטקסט ואת הפעולות העיקריות.
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

// מגישים את קבצי האתר מ-http מקומי, כמו ב-GitHub Pages (localhost נחשב מאובטח, כך שגם עבודה בלי אינטרנט נבדקת)
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'};
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
  r.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream'}); r.end(fs.readFileSync(f));
});
let URL;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function fresh(browser, opts){
  const ctx = await browser.newContext(opts);
  // הטופס מנסה לטעון את רכיב הכניסה של Google; בבדיקות חוסמים כל רשת חיצונית
  await ctx.route(u => !u.href.startsWith(URL), r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  page.errors = errors;
  return page;
}
const out = (page, k) => page.$eval('#o_' + k, el => el.value);
// מעבר לשלב בטופס לפי מזהה הדף (s_find = הדף הראשון של הממצאים)
const tab = (page, id) => page.evaluate(id => goStep(STEPS.findIndex(s => s.id === (id === 's_find' ? 's_find1' : id))), id);
const chip = (page, group, key) => page.click('[data-chips="' + group + '"] label:has(input[value="' + key + '"])');

test('אין שגיאות JavaScript בטעינה', async b => {
  const page = await fresh(b);
  assert.deepStrictEqual(page.errors, []);
});

test('מגדר: {זכר|נקבה} מוחלף לפי הבחירה', async b => {
  const page = await fresh(b);
  assert.strictEqual(await page.evaluate(() => G('{הגיע|הגיעה}')), 'הגיע');
  await page.selectOption('#gender', 'f');
  assert.strictEqual(await page.evaluate(() => G('{הגיע|הגיעה}')), 'הגיעה');
});

test('משפט הפתיחה ושם הילד', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await page.fill('#ageY', '4'); await page.fill('#ageM', '1');
  await tab(page, 's_bg');
  await page.selectOption('#ref', 'ganenet');
  await chip(page, 'reasons', 'fm');
  assert.strictEqual(await page.evaluate(() => showNames(openingSentence())),
    'נועם ילד מקסים בן 4.1. הגיע לאבחון בריפוי בעיסוק בהפניית הגננת בשל קשיים במוטוריקה עדינה.');
});

test('פיצול משפטים לא חותך מספרים עשרוניים', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => [splitSentences('זמן העתקה 3.5 דק. קצב תקין.'), firstSentence('א 4.1 ב. ג. ד.')]);
  assert.deepStrictEqual(r[0], ['זמן העתקה 3.5 דק.', 'קצב תקין.']);
  assert.strictEqual(r[1], 'א 4.1 ב. ג.');
});

test('הסיכום לא חותך את משפט הכתיבה באמצע מספר', async b => {
  const page = await fresh(b);
  await tab(page, 's_find');
  await page.fill('#copyT', '3.5');
  await page.selectOption('#copyS', 'ok');
  assert.match(await out(page, 'summary'), /בתחום הכתיבה- קצב הכתיבה בהעתקה תקין \(3\.5 דק'\)\./);
});

test('אחוזון מציון תקן ונוסח Beery', async b => {
  const page = await fresh(b);
  await tab(page, 's_find');
  await page.fill('#beery_vmi_s', '85');
  assert.strictEqual(await page.$eval('#beery_vmi_p', el => el.value), '16');
  assert.match(await out(page, 'f_fm'), /באחוזון 16 \(ציון תקן 85\), בטווח הנורמה לגילו, בגבול התחתון/);
});

test('הסתרת שמות ופרטים מזהים לפני שליחה', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם'); await page.fill('#names2', 'דניאל');
  const t = await page.evaluate(() => hideNames('ונועם שיחק עם דניאל, 050-1234567, 12/03/2020, a@b.co'));
  assert.strictEqual(t, 'ו[שם] שיחק עם [שם2], [טלפון], [תאריך], [מייל]');
});

test('הסרת פרטים מזהים בייבוא', async b => {
  const page = await fresh(b);
  const t = await page.evaluate(() => DEID.toPlain(DEID.deidentify('גר בחיפה, טופל אצל ד"ר כהן במכבי.', {cities:true, doctors:true, kupa:true})));
  assert.strictEqual(t, 'גר ב[יישוב], טופל אצל ד"ר [שם רופא] ב[קופ"ח].');
});

test('צ\'יפים נגישים במקלדת (Tab + רווח)', async b => {
  const page = await fresh(b);
  await tab(page, 's_bg');
  await page.focus('[data-chips="reasons"] input[value="fm"]');
  await page.keyboard.press('Space');
  assert.strictEqual(await page.$eval('[data-chips="reasons"] input[value="fm"]', el => el.checked), true);
});

test('שלבים: כפתור המשך, סימון השלב הנוכחי ושחזור השלב אחרי רענון', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await page.click('#st_start [data-go="1"]');
  assert.strictEqual(await page.getAttribute('#stepper [data-step="1"]', 'aria-current'), 'step');
  assert.strictEqual(await page.$eval('#s_import', el => el.classList.contains('on')), true);
  await page.waitForTimeout(800);
  await page.reload();
  assert.strictEqual(await page.$eval('#s_import', el => el.classList.contains('on')), true);
});

test('פרופיל פתיחה, "הכול תואם גיל" ובחירות סותרות', async b => {
  const page = await fresh(b);
  await page.click('[data-preset="preschool"]');
  assert.strictEqual(await page.$eval('[data-chips="reasons"] input[value="fm"]', el => el.checked), true);
  assert.deepStrictEqual(await page.evaluate(() => goalOrder), ['attn','base','graph','vis']);
  await tab(page, 's_find');
  await page.click('[data-norm="מוטוריקה עדינה וגרפומוטוריקה"]');
  assert.strictEqual(await page.$eval('[data-chips="fm"] input[value="cutOk"]', el => el.checked), true);
  await chip(page, 'fm', 'cutNo');
  assert.strictEqual(await page.$eval('[data-chips="fm"] input[value="cutOk"]', el => el.checked), false);
});

test('מטרות מוצעות ובדיקה לפני ייצוא', async b => {
  const page = await fresh(b);
  await tab(page, 's_find');
  await chip(page, 'beh', 'attShort');
  assert.ok((await page.evaluate(() => suggestGoals().map(x => x.k))).includes('attn'));
  await tab(page, 'st_review');
  assert.match(await page.textContent('#checks'), /יש קשיים בלי מטרה מתאימה: השתתפות וקשב/);
});

test('שמירה אוטומטית משחזרת אחרי רענון, בלי השמות', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם'); await page.fill('#surname', 'לוי');
  await tab(page, 's_bg'); await chip(page, 'reasons', 'write');
  await tab(page, 'st_review');
  await page.fill('#o_background', 'טקסט שנערך ביד');
  await page.waitForTimeout(800);
  // השמות לא נשמרים בשמירה האוטומטית, כי היא לא מוצפנת
  const raw = await page.evaluate(() => sessionStorage.getItem(SESSION_STORE));
  assert.ok(!raw.includes('נועם') && !raw.includes('לוי'));
  await page.reload();
  assert.strictEqual(await page.$eval('#name', el => el.value), '');
  assert.match(await page.textContent('#msg'), /השם לא נשמר/);
  assert.strictEqual(await page.$eval('[data-chips="reasons"] input[value="write"]', el => el.checked), true);
  assert.strictEqual(await out(page, 'background'), 'טקסט שנערך ביד');
});

test('ניקוי הטופס וביטול הניקוי', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await page.click('#more summary'); await page.click('#resetAll');
  assert.strictEqual(await page.$eval('#name', el => el.value), '');
  await page.click('#msg .linkbtn');
  assert.strictEqual(await page.$eval('#name', el => el.value), 'נועם');
});

test('אזהרה לפני סגירה כשיש תוכן בכל שדה (לא רק שם)', async b => {
  const page = await fresh(b);
  assert.strictEqual(await page.evaluate(() => !!hasContent()), false);
  await tab(page, 's_find'); await page.selectOption('#coop', 'full');
  assert.strictEqual(await page.evaluate(() => !!hasContent()), true);
});

test('מילוי לפי כותרות לא משכפל טקסט בלחיצה כפולה', async b => {
  const page = await fresh(b);
  await tab(page, 's_import');
  await page.fill('#imPaste', 'רקע משפחתי:\nהמשפחה גרה בבית פרטי');
  await page.click('#imRead');
  await page.click('#imHeads'); await page.click('#imHeads');
  assert.strictEqual(await page.$eval('#famNote', el => el.value), 'המשפחה גרה בבית פרטי');
});

test('שם קובץ ה-Word לא כולל את שם המטופל', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  // בודקים את שם הקובץ שהדף מבקש (Chromium בלי ממשק מחליף שמות בעברית ב-"download")
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; }; });
  await tab(page, 'st_review');
  await page.click('#exportWord');
  const name = await page.evaluate(() => window.__dl);
  assert.ok(!name.includes('נועם'), name);
  assert.match(name, /^דוח_אבחון_\d{4}-\d{2}-\d{2}_\d{4}\.docx$/);
});

test('ניסוח משלי: הוספה, שימוש בדוח ומחיקה', async b => {
  const page = await fresh(b);
  await tab(page, 's_rep');
  await page.click('[data-addph="parGen"]');
  await page.fill('#pLabel', 'אוהב מוזיקה');
  await page.fill('#pPhrase', '{אוהב|אוהבת} מוזיקה');
  await page.click('[data-p="add"]');
  assert.match(await out(page, 'parents'), /לפי דיווח ההורים, \[שם\] אוהב מוזיקה\./);
  await page.reload();   // נשמר בדפדפן
  await tab(page, 's_rep');
  assert.ok(await page.$('[data-chips="parGen"] label.mine'));
  page.once('dialog', d => d.accept());
  await page.click('#more summary'); await page.click('#myPhrases');
  await page.click('[data-p="del"]');
  assert.strictEqual(await page.$('[data-chips="parGen"] label.mine'), null);
});

test('טיוטה מוצפנת: שמירה ופתיחה, כולל תיקון טעות הקלדה בסיסמה', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  const r = await page.evaluate(async () => {
    const enc = await encryptJson(collectState(), 'Secret1');
    const st = await decryptJson(enc, 'sECRET1');   // Caps Lock
    return [st.ctl.name, !!st._passNote];
  });
  assert.deepStrictEqual(r, ['נועם', true]);
});

test('תכונות קיימות נשמרו: ענן, הכתבה קולית ומחשבון אחוזון', async b => {
  const page = await fresh(b);
  for (const id of ['cloudSave', 'cloudOpen', 'saveDraft', 'openDraft', 'keyBtn', 'myPhrases', 'resetAll']) assert.ok(await page.$('#' + id), id);
  assert.strictEqual(await page.evaluate(() => GOOGLE_CLIENT_ID.length > 10), true);
  const hasSR = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  if (hasSR) assert.ok(await page.$$eval('#pages textarea', tas => tas.every(t => t.parentNode.classList.contains('mic-wrap'))));
  await page.evaluate(() => goStep(STEPS.findIndex(s => s.id === 's_find2')));
  await page.fill('#calcScore', '115');
  assert.match(await page.textContent('#calcRes'), /באחוזון 84/);
});

test('נגישות: לכל שדה בטופס יש שם, ולחיצה על הכותרת מעבירה לשדה', async b => {
  const page = await fresh(b);
  const unnamed = await page.$$eval('#pages input:not([type=checkbox]):not([type=file]), #pages select, #pages textarea, #imFiles', els => els.filter(el =>
    !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(el => el.id));
  assert.deepStrictEqual(unnamed, []);
  await tab(page, 's_bg');
  await page.click('label[for="week"]');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'week');
  assert.match(await page.getAttribute('#stepper [data-step="2"]', 'aria-label'), /רקע/);
  assert.strictEqual(await page.$eval('#ref', el => el.options[0].textContent), '— לא נבחר —');
});

test('"הכול תואם גיל" לא דורס בחירות קיימות, ואפשר לבטל', async b => {
  const page = await fresh(b);
  await tab(page, 's_find');
  await page.selectOption('#coop', 'part');
  await chip(page, 'beh', 'attShort');
  await page.click('[data-norm="התנהגות ושיתוף פעולה"]');
  assert.strictEqual(await page.$eval('#coop', e => e.value), 'part');
  assert.strictEqual(await page.$eval('#eye', e => e.value), 'good');
  const c = await page.evaluate(() => ['attShort','attOk','motiv'].map(k => chipInput('beh', k).checked));
  assert.deepStrictEqual(c, [true, false, true]);
  await page.click('#msg .linkbtn');
  assert.strictEqual(await page.$eval('#eye', e => e.value), '');
  assert.strictEqual(await page.evaluate(() => chipInput('beh', 'motiv').checked), false);
});

test('פרופיל פתיחה מחליף את הקודם, ואפשר לבטל אותו', async b => {
  const page = await fresh(b);
  await tab(page, 's_bg'); await chip(page, 'reasons', 'write');   // סומן ביד לפני הפרופיל
  await tab(page, 'st_start');
  await page.click('[data-preset="preschool"]');
  await page.click('[data-preset="school"]');
  assert.deepStrictEqual(await page.evaluate(() => goalOrder), ['write','guide']);
  assert.strictEqual(await page.evaluate(() => chipInput('reasons', 'fm').checked), false);
  await page.click('#undoPreset');
  assert.deepStrictEqual(await page.evaluate(() => goalOrder), []);
  assert.strictEqual(await page.evaluate(() => chipInput('reasons', 'write').checked), true);   // מה שסומן ביד נשאר
});

test('סרגל השלבים: ✓ רק לשלב שמולא, וסימן אזהרה לשלב עם חוסר', async b => {
  const page = await fresh(b);
  await tab(page, 's_bg'); await chip(page, 'reasons', 'write');
  await tab(page, 'st_review');
  const cls = await page.$$eval('#stepper .st', els => els.map(e => e.classList.contains('done') ? 'v' : e.classList.contains('warn') ? '!' : '-').join(''));
  assert.strictEqual(cls, '!-!!--!-');   // פתיחה: חסר שם; רקע: חסר גורם מפנה; דיווחים: אין חוזקות; מטרות: לא סומן אם מומלץ טיפול
  await page.evaluate(() => { $('name').value = 'נועם'; $('ref').value = 'parents'; update(); });
  const cls2 = await page.$$eval('#stepper .st', els => els.map(e => e.classList.contains('done') ? 'v' : e.classList.contains('warn') ? '!' : '-').join(''));
  assert.strictEqual(cls2.slice(0, 3), 'v-v');
});

test('בדיקת גיל: חודשים מעל 11 מקבלים אזהרה', async b => {
  const page = await fresh(b);
  await page.fill('#ageY', '4'); await page.fill('#ageM', '14');
  assert.match(await page.textContent('#ageMsg'), /בין 0 ל-11/);
  await page.fill('#ageM', '2');
  assert.strictEqual(await page.textContent('#ageMsg'), '');
});

test('שדה דוח ריק מוצג מכווץ ואפשר להוסיף בו טקסט', async b => {
  const page = await fresh(b);
  await tab(page, 'st_review');
  assert.strictEqual(await page.isVisible('#o_famResp'), false);
  await page.click('[data-addtxt="famResp"]');
  await page.fill('#o_famResp', 'ההורים שותפים לתוכנית');
  assert.strictEqual(await out(page, 'famResp'), 'ההורים שותפים לתוכנית');
});

test('פרטי המאבחנת נכנסים לקובץ ה-Word', async b => {
  const page = await fresh(b);
  await page.click('#more summary'); await page.click('#meBtn');
  await page.fill('#meinst', 'המכון להתפתחות הילד'); await page.fill('#mename', 'רות כהן'); await page.fill('#merole', 'מרפאה בעיסוק');
  await page.click('[data-p="mesave"]');
  await page.fill('#name', 'נועם');
  const xml = await page.evaluate(async () => new TextDecoder().decode(await buildDocx().blob.arrayBuffer()));
  assert.ok(xml.includes('המכון להתפתחות הילד'));
  assert.ok(xml.includes('רות כהן, מרפאה בעיסוק'));
});

test('ענן: Ctrl+S מעדכן את הטיוטה הפתוחה ומציג מתי נשמרה', async b => {
  const page = await fresh(b);
  let patched = 0;
  await page.route(/googleapis\.com\/upload\/drive\/v3\/files\/abc/, r => { patched++; r.fulfill({status: 200, body: '{}'}); });
  await page.route(/googleapis\.com\/drive\/v3\/files\?/, r => r.fulfill({status: 200, contentType: 'application/json', body: '{"files":[]}'}));
  await page.route(/googleapis\.com\/upload\/drive\/v3\/files\?/, r => r.fulfill({status: 200, contentType: 'application/json', body: '{"id":"ph","name":"ot-form-phrases.json"}'}));
  await page.evaluate(async () => {
    window.GOOGLE_CLIENT_ID_OK = true;
    gTok = {token: 't', exp: Date.now() + 3600e3};
    gAesKey = await crypto.subtle.importKey('raw', new Uint8Array(32), {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
    setCloudCur({id: 'abc', name: 'תיק 12.otdraft'});
  });
  assert.match(await page.textContent('#cloudInfo'), /נשמר בענן/);
  await page.fill('#name', 'נועם');
  assert.match(await page.textContent('#cloudInfo'), /שינויים שלא נשמרו/);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /נשמר בענן/.test($('cloudInfo').textContent));
  assert.strictEqual(patched, 1);
});

test('ניסוחים אישיים: מיזוג בין מכשירים בלי להחזיר ניסוח שנמחק', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => mergePhrases({gm: [['u1','א','א1']]}, {gm: [['u2','ב','ב1'], ['u3','ג','ג1']], fm: [['u4','ד','ד1']]}, ['u3']));
  assert.deepStrictEqual(r, {gm: [['u1','א','א1'], ['u2','ב','ב1']], fm: [['u4','ד','ד1']]});
});

test('עבודה בלי אינטרנט: הדף נטען מהמטמון', async b => {
  const ctx = await b.newContext();
  await ctx.route(u => !u.href.startsWith(URL), r => r.abort());
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();   // עכשיו הדף בשליטת ה-service worker
  await ctx.setOffline(true);
  await page.reload();
  assert.ok(await page.$('#stepper .st'));
  assert.strictEqual(await page.isVisible('#offline'), true);
  await ctx.close();
});

test('חוזקות, תחומי עניין ופרשנות הפרופיל החושי נכנסים לדוח', async b => {
  const page = await fresh(b);
  await page.selectOption('#gender', 'f');
  await tab(page, 's_rep');
  await chip(page, 'strengths', 'curious');
  await page.fill('#interests', 'ציור');
  assert.match(await out(page, 'summary'), /בין החוזקות של \[שם\]: סקרנות ורצון להתנסות\./);
  assert.match(await out(page, 'summary'), /תחומי העניין של \[שם\]: ציור\./);
  await tab(page, 's_find2');
  await page.selectOption('#sq_seek', 'mmore');
  assert.match(await out(page, 'f_sens'), /על פי תוצאות השאלון, \[שם\] מחפשת חוויות תחושתיות באופן ניכר יותר מבני גילה\./);
  await tab(page, 's_goals');
  await chip(page, 'recs', 'interests');
  assert.match(await out(page, 'recs'), /שילוב תחומי העניין של \[שם\] \(ציור\) בטיפול/);
  await tab(page, 's_find');
  await page.fill('#beery_vmi_s', '85');
  assert.match(await out(page, 'f_fm'), /בטווח הנורמה לגילה, בגבול התחתון/);
});

test('סיכום: קודם הקשיים והציונים שמתחת לנורמה', async b => {
  const page = await fresh(b);
  await page.evaluate(() => {
    $('gender').value = 'f';
    ['manip','midNo','cutNo'].forEach(k => chipInput('fm', k).checked = true);
    ['motiv','attShort','dist'].forEach(k => chipInput('beh', k).checked = true);
    chipInput('cog', 'colors').checked = true;
    $('beery_vmi_p').value = '12'; $('beery_vp_p').value = '45';
    update();
  });
  const sum = await out(page, 'summary');
  assert.match(sum, /הראתה טווחי קשב קצרים לגילה, מוסחות מגירויים פנימיים וחיצוניים\./);
  assert.match(sum, /בתחום המוטוריקה העדינה- נצפה קושי בחציית קו האמצע\. קושי בגזירה/);
  assert.match(sum, /באבחון BEERY התקבלו ציונים מתחת לטווח הנורמה לגילה: אינטגרציה ויזו-מוטורית \(באחוזון 12\)\./);
  assert.ok(!/ביצוע מניפולציות/.test(sum));   // תפקוד תקין בתחום עם קשיים לא נכנס לסיכום
  assert.match(sum, /בתחום התפיסה והחשיבה- משיימת צבעי יסוד\./);   // תחום בלי קשיים: מה שתקין
});

test('ניסוחים במגדר נקבה: תסכול ומקום בין האחים', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { $('gender').value = 'f'; chipInput('parGen', 'frust').checked = true; $('sib').value = 'young'; update(); });
  assert.match(await out(page, 'parents'), /מתוסכלת ומתעצבנת מהר כשלא מצליחה/);
  assert.match(await out(page, 'family'), /הצעירה בין אחיה/);
});

test('מטרות מוצעות לפי Beery קואורדינציה ו-MAP, ובדיקת התאמה בין כלים לתוצאות', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => {
    $('beery_mc_p').value = '5'; $('map_nonverb_p').value = '3'; chipInput('tools', 'sp2').checked = true; update();
    return {sugg: suggestGoals().map(x => x.k), checks: $('checks').textContent};
  });
  assert.ok(r.sugg.includes('graph') && r.sugg.includes('vis'), r.sugg.join());
  assert.match(r.checks, /סומן פרופיל חושי \(SP2\) באמצעי ההערכה, אבל לא הוזנו תוצאות/);
  assert.match(r.checks, /הוזנו תוצאות Beery, אבל Beery לא מסומן באמצעי ההערכה/);
  assert.match(r.checks, /לא צוין איך הקשיים משפיעים על התפקוד/);
});

test('השפעה על התפקוד בסיכום, מסגרת זמן למטרות ותאריך האבחון', async b => {
  const page = await fresh(b);
  await page.fill('#adate', '2026-10-12');
  await tab(page, 's_goals');
  await page.fill('#impact', 'נמנעת מפעילויות יצירה בגן.');
  await page.click('#goalChips label:has(input[value="graph"])');
  await page.selectOption('#dur', '15 טיפולים');
  assert.match(await out(page, 'summary'), /נמנעת מפעילויות יצירה בגן\./);
  assert.match(await out(page, 'goals'), /^מטרה 1 \(בתום 15 טיפולים\):/);
  const xml = await page.evaluate(async () => new TextDecoder().decode(await buildDocx().blob.arrayBuffer()));
  assert.ok(xml.includes('תאריך האבחון: 12/10/2026'));
});

test('הדפסה / PDF: רק הדוח מוצג בהדפסה', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await tab(page, 'st_review');
  await page.click('#printReport');
  assert.strictEqual(await page.evaluate(() => window.__printed), true);
  await page.emulateMedia({media: 'print'});
  assert.strictEqual(await page.isVisible('#printArea'), true);
  assert.strictEqual(await page.isVisible('#pages'), false);
  assert.match(await page.textContent('#printArea'), /דוח סיכום אבחון[\s\S]*נועם ילד מקסים/);
});

test('ציפיות לפי גיל: הערה בכרטיס, בדיקה לפני ייצוא והצעת מטרה', async b => {
  const page = await fresh(b);
  await page.fill('#ageY', '6');
  await tab(page, 's_find');
  await chip(page, 'shapes', 'v'); await chip(page, 'shapes', 'h'); await chip(page, 'shapes', 'c');
  await page.selectOption('#grip', 'fist');
  const note = await page.textContent('#an_fm');
  assert.match(note, /צלב \(מגיל 4\)/);
  assert.match(note, /אחיזה אגרוף \(טריפוד מצופה מגיל 4 וחצי\)/);
  assert.ok(!(await out(page, 'f_fm')).includes('מגיל'));   // ההערה לא נכתבת לדוח
  assert.ok((await page.evaluate(() => suggestGoals().find(x => x.k === 'graph').why)).includes('מתחת למצופה לגיל'));
  assert.match(await page.textContent('#checks'), /מוטוריקה עדינה מתחת למצופה לגיל/);
  await page.evaluate(() => { $('ageY').value = '3'; update(); });
  assert.strictEqual(await page.textContent('#an_fm'), '');   // בגיל 3 קו ועיגול מספיקים
});

test('אחרי ניסוח: בדיקה שכל מספר ותגית נשמרו', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { apiKey = 'sk-ant-test'; $('beery_vmi_p').value = '12'; $('beery_vmi_s').value = '82'; update(); });
  const reply = {f_fm: 'באבחון BEERY, בחלק הבודק אינטגרציה ויזו-מוטורית קיבל ציון נמוך מהנורמה.'};
  await page.route('https://api.anthropic.com/v1/messages', r => r.fulfill({status: 200, contentType: 'text/event-stream', body:
    'data: ' + JSON.stringify({type:'content_block_delta', index:0, delta:{type:'text_delta', text: JSON.stringify(reply)}}) + '\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'}));
  await tab(page, 'st_review');
  await page.click('#polish'); await page.click('[data-send="yes"]');
  await page.waitForSelector('#status .warnbox');
  assert.match(await page.textContent('#status'), /ממצאי האבחון - מוטוריקה עדינה וגרפומוטוריקה: 12, 82/);
  assert.match(await page.textContent('#bd_f_fm'), /חסרים פרטים/);
  await page.click('#undoPolish');
  assert.ok(!(await page.textContent('#bd_f_fm')).includes('חסרים'));
});

test('ההוראות ל-Claude: לא להשמיט קשיים ולא להמציא השפעה תפקודית', async b => {
  const page = await fresh(b);
  const g = await page.evaluate(() => STYLE_GUIDE);
  assert.match(g, /אסור להשמיט קושי, ממצא חריג או ציון מתחת לנורמה/);
  assert.match(g, /אל תכתוב השפעה תפקודית שלא כתובה בשדות/);
  assert.ok(!/4-8 משפטים/.test(g));
});

test('מעבר שלב: הפוקוס עובר לכותרת השלב החדש', async b => {
  const page = await fresh(b);
  await page.focus('#st_start [data-go="1"]'); await page.keyboard.press('Enter');
  assert.strictEqual(await page.evaluate(() => document.activeElement.matches('#s_import > h2')), true);
});

test('מטרות מדידות בבנק המטרות', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { $('gender').value = 'f'; addGoal('graph'); update(); });
  assert.match(await out(page, 'goals'), /- תשתמש ביד הדומיננטית ב-4 מתוך 5 פעילויות ליד שולחן/);
});

test('שם משפחה: מוסר מכל טקסט שנשלח, ונעצר אם דלף', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועה'); await page.fill('#surname', 'כהן');
  assert.strictEqual(await page.evaluate(() => hideNames('נועה כהן ומשפחת כהן')), '[שם] [שם משפחה] ומשפחת [שם משפחה]');
  // שם המשפחה נכנס לכותרת ה-Word (נשאר במחשב), לא לטקסט הדוח
  const xml = await page.evaluate(async () => new TextDecoder().decode(await buildDocx().blob.arrayBuffer()));
  assert.ok(xml.includes('שם: נועה כהן'));
  assert.ok(!(await out(page, 'background')).includes('כהן'));
});

test('ייבוא: זיהוי שם משפחה אפשרי ושמות הורים, והסרה בלחיצה', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועה');
  await tab(page, 's_import');
  await page.fill('#imPaste', 'נועה לוי הגיעה לאבחון עם אמה, רחל לוי. משפחת לוי גרה ליד הגן.');
  await page.click('#imRead');
  assert.match(await page.textContent('#imInfo'), /ייתכן שזה שם משפחה שלא הוסר: לוי/);
  const flagged = await page.$$eval('#imPreview .w.fl', els => els.map(e => e.textContent));
  assert.ok(flagged.includes('רחל') && flagged.includes('לוי'), flagged.join());
  await page.click('#imInfo [data-sur="לוי"]');
  assert.strictEqual(await page.$eval('#surname', e => e.value), 'לוי');
  assert.strictEqual(await page.evaluate(() => importOutgoing()), '[שם] [שם משפחה] הגיעה לאבחון עם אמה, רחל [שם משפחה]. משפחת [שם משפחה] גרה ליד הגן.');
});

test('הפחתת תנועה: בלי אנימציות למי שביקש', async b => {
  const page = await fresh(b, {reducedMotion: 'reduce'});
  assert.strictEqual(await page.$eval('.page.on', e => getComputedStyle(e).animationName), 'none');
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
});

test('שליפה מקבצים כוללת את "השפעה על התפקוד"', async b => {
  const page = await fresh(b);
  assert.strictEqual(await page.evaluate(() => 'impact' in extractSchema() && /impact:/.test(EXTRACT_GUIDE)), true);
});

// תשובת Claude מדומה בהזרמה; שומרת את גוף הבקשה כדי לבדוק אילו הוראות נשלחו
async function mockClaude(page, reply){
  const sent = [];
  await page.route('https://api.anthropic.com/v1/messages', r => { sent.push(JSON.parse(r.request().postData())); r.fulfill({status: 200, contentType: 'text/event-stream', body:
    'data: ' + JSON.stringify({type:'content_block_delta', index:0, delta:{type:'text_delta', text: JSON.stringify(reply)}}) + '\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'}); });
  await page.evaluate(() => { apiKey = 'sk-ant-test'; });
  return sent;
}

test('סגנון ניסוח: ברירת מחדל סגנון המכון, ובחירה ב-ICF נשמרת ונשלחת', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { chipInput('fm', 'midNo').checked = true; update(); });
  const sent = await mockClaude(page, {f_fm: 'נצפה קושי בחציית קו האמצע.'});
  await tab(page, 'st_review');
  assert.strictEqual(await page.$eval('#polishStyle', e => e.value), 'inst');
  await page.click('#polish'); await page.click('[data-send="yes"]'); await page.waitForSelector('#undoPolish');
  assert.match(sent[0].system, /בסגנון של המכון/);
  await page.selectOption('#polishStyle', 'icf');
  assert.match(await page.textContent('#styleHint'), /\[לבדיקה/);
  await page.reload();
  await page.evaluate(() => { apiKey = 'sk-ant-test'; });   // המפתח נשמר בזיכרון בלבד, ונדרש שוב אחרי רענון
  await tab(page, 'st_review');
  assert.strictEqual(await page.$eval('#polishStyle', e => e.value), 'icf');   // נשמר בדפדפן
  await page.click('#polish'); await page.click('[data-send="yes"]'); await page.waitForSelector('#undoPolish');
  assert.match(sent[1].system, /מודל ה-ICF/);
});

test('הוראות ה-ICF שומרות על כללי הבטיחות, וחוזקות קודם בסיכום', async b => {
  const page = await fresh(b);
  const g = await page.evaluate(() => ICF_GUIDE);
  [/החזר אך ורק אובייקט JSON תקין/, /שמור על המגדר/, /אל תקבע אבחנה רפואית/, /לעגל או להשמיט/, /אסור להשמיט קושי/,
   /חובה לעטוף את כל המשפט בסימון \[לבדיקה: \.\.\.\]/, /פתח במשפט הפתיחה, ואחריו בחוזקות/].forEach(re => assert.match(g, re));
  assert.strictEqual(await page.evaluate(() => 'polishStyle' in collectState().ctl), false);   // לא חלק מהטיוטה
});

test('קשר שסומן [לבדיקה]: הודעה, תג, בדיקה לפני ייצוא ואישור לפני ייצוא', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { store(STYLE_STORE, 'icf'); styleSync(); chipInput('fm', 'midNo').checked = true; update(); });
  await mockClaude(page, {f_fm: 'נצפה קושי בחציית קו האמצע. [לבדיקה: הקושי עשוי להשפיע על הכתיבה בגן.]'});
  await tab(page, 'st_review');
  await page.click('#polish'); await page.click('[data-send="yes"]'); await page.waitForSelector('#undoPolish');
  assert.match(await page.textContent('#status'), /Claude הציע 1 קשרים בין ממצאים לתפקוד/);
  assert.match(await page.textContent('#bd_f_fm'), /1 לבדיקה/);
  assert.match(await page.textContent('#checks'), /יש קשרים ש-Claude הציע ועוד לא אושרו/);
  // ייצוא: נשאלת שאלה, ו"ביטול" עוצר את הייצוא
  let asked = 0; page.on('dialog', d => { asked++; d.dismiss(); });
  await page.evaluate(() => { window.__dl = null; HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; }; });
  await page.click('#exportWord');
  assert.strictEqual(asked, 1);
  assert.strictEqual(await page.evaluate(() => window.__dl), null);
  // אישור הקשר: מוחקים את הסימון, ואז הייצוא עובר בלי שאלה
  await page.fill('#o_f_fm', 'נצפה קושי בחציית קו האמצע. הקושי עשוי להשפיע על הכתיבה בגן.');
  assert.ok(!(await page.textContent('#checks')).includes('לא אושרו'));
  await page.click('#exportWord');
  assert.strictEqual(asked, 1);
  assert.match(await page.evaluate(() => window.__dl), /\.docx$/);
});

test('שמירה אוטומטית: גם בשדה שנערך ביד השם לא נשמר, וחוזר כשמקלידים אותו', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await tab(page, 'st_review');
  await page.fill('#o_background', 'נועם ילד מקסים. עריכה ידנית.');
  await page.evaluate(() => saveSession());
  assert.ok(!(await page.evaluate(() => sessionStorage.getItem(SESSION_STORE))).includes('נועם'));
  await page.reload();
  assert.strictEqual(await out(page, 'background'), '[שם] ילד מקסים. עריכה ידנית.');
  await tab(page, 'st_start'); await page.fill('#name', 'נועם');
  assert.strictEqual(await out(page, 'background'), 'נועם ילד מקסים. עריכה ידנית.');
});

test('פענוח JSON מ-Claude: עטיפה, שבירת שורה, ושגיאה ברורה', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => {
    const t = s => { try { return JSON.stringify(parseJsonReply(s)); } catch(e){ return 'ERR: ' + e.message; } };
    return [t('הנה:\n```json\n{"a":"x"}\n```'), t('{"a":"שורה 1\nשורה 2"}'), t('מצטער, לא הבנתי'), t('{"a":"משקל 3 ק"ג"}')];
  });
  assert.strictEqual(r[0], '{"a":"x"}');
  assert.strictEqual(r[1], '{"a":"שורה 1\\nשורה 2"}');
  assert.match(r[2], /^ERR: Claude לא החזיר תשובה במבנה הצפוי/);
  assert.match(r[3], /^ERR: התשובה של Claude לא הייתה במבנה תקין/);
});

test('מטרות מוצעות: קשיים במוטוריקה גסה, איירס משמעותי ועצמאות מדיווח ההורים', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => {
    chipInput('gm', 'nojump').checked = true; chipInput('gm', 'fatigue').checked = true; $('ay_equil').value = 'sig';
    chipInput('parGen', 'fmdiff').checked = true; update();
    return Object.fromEntries(suggestGoals().map(x => [x.k, x.why.join('|')]));
  });
  assert.match(r.plan, /לא קופץ/); assert.match(r.base, /מתעייף/); assert.match(r.base, /איירס: תגובות שיווי משקל/);
  assert.match(r.adl, /דיווח ההורים/);
});

test('נעילה אחרי חוסר פעילות: מסתירה את הטופס בלי למחוק', async b => {
  const page = await fresh(b);
  await page.evaluate(() => { IDLE_MS = 0; idleCheck(); });
  assert.strictEqual(await page.isVisible('#lock'), false);   // טופס ריק: אין מה להסתיר
  await page.fill('#name', 'נועם');
  await page.evaluate(() => { IDLE_MS = 0; idleCheck(); });
  assert.strictEqual(await page.isVisible('#lock'), true);
  assert.strictEqual(await page.evaluate(() => $('pages').inert), true);
  await page.click('#unlock');
  assert.strictEqual(await page.isVisible('#lock'), false);
  assert.strictEqual(await page.$eval('#name', e => e.value), 'נועם');
});

test('הכתבה: הסבר פרטיות לפני השימוש הראשון', async b => {
  const page = await fresh(b);
  const has = await page.evaluate(() => !!SR);
  if (!has) return;   // דפדפן בלי זיהוי דיבור: אין כפתורי מיקרופון
  await tab(page, 's_bg');
  await page.evaluate(() => { window.__started = 0; toggleDict = () => { window.__started++; }; });
  await page.click('#s_bg .mic');
  assert.match(await page.textContent('#modal'), /לא לומר בהכתבה שמות/);
  await page.click('[data-dict="ok"]');
  assert.strictEqual(await page.evaluate(() => window.__started), 1);
  await page.click('#s_bg .mic');   // בפעם השנייה בלי הסבר
  assert.strictEqual(await page.evaluate(() => window.__started), 2);
  assert.strictEqual(await page.isVisible('#modalWrap'), false);
});

test('שליפה: מסמכים קודמים לא ממלאים ממצאים; רשמי האבחון ממלאים גם ממצאים וציונים', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => { const p = extractSchema('prev'), n = extractSchema('notes');
    return {prevFm: 'fm' in p, prevBeery: 'beery_vmi_p' in p, prevTools: Object.keys(p.tools.options).sort().join(),
      notesFm: 'fm' in n, notesBeery: 'beery_vmi_p' in n, notesAyres: 'ay_equil' in n, notesSp2: 'sq_seek' in n, notesTools: 'beery' in n.tools.options}; });
  assert.deepStrictEqual(r, {prevFm: false, prevBeery: false, prevTools: 'q_gan,q_par,q_teach,talk', notesFm: true, notesBeery: true, notesAyres: true, notesSp2: true, notesTools: true});
});

test('שליפה וניתוח: Opus עם מבנה מובטח, ציטוט לכל פריט, אישור לפני מילוי ומטרות מוצעות', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועה');
  await tab(page, 's_bg'); await page.selectOption('#ref', 'parents');   // כבר מולא: לא ישתנה
  await tab(page, 's_import');
  await page.check('[name="imMode"][value="notes"]');
  await page.fill('#imPaste', 'הגננת הפנתה בגלל קושי בגזירה. נצפה קושי בחציית קו האמצע. ב-Beery אינטגרציה ויזו-מוטורית אחוזון 9.');
  await page.click('#imRead');
  const items = [
    {field: 'fm', value: 'midNo', quote: 'נצפה קושי בחציית קו האמצע'},
    {field: 'beery_vmi_p', value: '9', quote: 'אינטגרציה ויזו-מוטורית אחוזון 9'},
    {field: 'fm', value: 'cutNo', quote: 'הגזירה הייתה איטית מאוד'},          // ציטוט שלא מופיע בטקסט
    {field: 'ref', value: 'ganenet', quote: 'הגננת הפנתה'},                   // שדה שכבר מולא
    {field: 'fm', value: 'לא-קיים', quote: 'נצפה קושי'},                      // מפתח לא חוקי: נזרק
  ];
  const sent = await mockClaude(page, {items});
  await page.click('#imExtract'); await page.click('[data-send="yes"]');
  await page.waitForSelector('#imReview .rvlist');
  assert.strictEqual(sent[0].model, 'claude-opus-5-5');
  assert.strictEqual(sent[0].output_config.format.type, 'json_schema');
  const rows = await page.$$eval('#imReview [data-rvi]', els => els.map(e => [e.checked, e.disabled, e.closest('li').textContent]));
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows.map(r => [r[0], r[1]]), [[true, false], [true, false], [false, false], [false, true]]);
  assert.match(rows[2][2], /הציטוט לא נמצא בטקסט/);
  assert.match(rows[3][2], /כבר מולא/);
  assert.strictEqual(await page.evaluate(() => chipInput('fm', 'midNo').checked), false);   // לפני אישור: כלום לא השתנה
  await page.click('[data-rv="apply"]');
  assert.strictEqual(await page.evaluate(() => chipInput('fm', 'midNo').checked), true);
  assert.strictEqual(await page.$eval('#beery_vmi_p', e => e.value), '9');
  assert.strictEqual(await page.evaluate(() => chipInput('fm', 'cutNo').checked), false);
  assert.strictEqual(await page.$eval('#ref', e => e.value), 'parents');
  // מטרות לפי הממצאים שאושרו
  assert.ok(await page.$('#imReview [data-goal="graph"]'));
  await page.click('[data-rv="goals"]');
  assert.ok((await page.evaluate(() => goalOrder)).includes('graph'));
});

test('שליפה: אם המודל לא תומך במבנה מובטח (400), נשלחת שוב בלי', async b => {
  const page = await fresh(b);
  await tab(page, 's_import'); await page.fill('#imPaste', 'רקע משפחתי: בת שנייה מתוך שלושה.'); await page.click('#imRead');
  await page.evaluate(() => { apiKey = 'sk-ant-test'; });
  const sent = [];
  await page.route('https://api.anthropic.com/v1/messages', r => { const b = JSON.parse(r.request().postData()); sent.push(b);
    if (b.output_config) return r.fulfill({status: 400, contentType: 'application/json', body: '{"error":{"message":"output_config not supported"}}'});
    r.fulfill({status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({type:'content_block_delta', index:0, delta:{type:'text_delta', text: '{"items":[{"field":"famNote","value":"בת שנייה מתוך שלושה.","quote":"בת שנייה מתוך שלושה"}]}'}}) + '\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'}); });
  await page.click('#imExtract'); await page.click('[data-send="yes"]');
  await page.waitForSelector('#imReview .rvlist');
  assert.strictEqual(sent.length, 2); assert.ok(sent[0].output_config); assert.ok(!sent[1].output_config);
});

test('טיוטה מוצפנת שומרת את הטקסט המיובא; השמירה האוטומטית לא', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועה');
  await tab(page, 's_import'); await page.check('[name="imMode"][value="notes"]');
  await page.fill('#imPaste', 'נועה הגיעה עם אמה. נצפה קושי בגזירה.'); await page.click('#imRead');
  const r = await page.evaluate(async () => {
    saveSession(); const sess = sessionStorage.getItem(SESSION_STORE);
    const enc = await encryptJson(collectState(true), 'Secret1');
    restoreState({});                                   // טופס ריק
    const empty = importOutgoing();
    restoreState(await decryptJson(enc, 'Secret1'));
    return {sessHasText: sess.includes('גזירה'), empty, back: importOutgoing(), mode: importMode};
  });
  assert.strictEqual(r.sessHasText, false);
  assert.strictEqual(r.empty, '');
  assert.strictEqual(r.back, '[שם] הגיעה עם אמה. נצפה קושי בגזירה.');
  assert.strictEqual(r.mode, 'notes');
});

test('גרסאות טיוטה: טיוטה מהגרסה הנוכחית נטענת, וטיוטה מגרסה עתידית לא נטענת בשקט', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => {
    const st = {v: 1, ctl: {ageY: '5'}, chips: {}, goals: [], out: {}};
    const same = migrateState(st) === st;
    sessionStorage.setItem(SESSION_STORE, JSON.stringify({v: CURRENT_STATE_VERSION + 1, ctl: {ageY: '9'}, chips: {}, goals: [], out: {}}));
    return {same, future: restoreSession()};
  });
  assert.deepStrictEqual(r, {same: true, future: false});
});

test('תובנות שימוש: זמן בשלבים, צ\'יפים, עריכות, ניסוח וביטול — בלי טקסט מהדוח', async b => {
  const ctx = await b.newContext(); await ctx.route(u => !u.href.startsWith(URL), r => r.abort());
  const page = await ctx.newPage(); await page.clock.install(); await page.goto(URL);
  await page.fill('#name', 'נועם');
  await page.clock.fastForward(7000);
  await tab(page, 's_bg'); await chip(page, 'reasons', 'write');
  await tab(page, 'st_review');
  await page.fill('#o_background', 'נועם ילד מקסים. טקסט פרטי מהדוח.');
  const sent = await mockClaude(page, {f_fm: 'x'});
  await page.evaluate(() => { chipInput('fm', 'midNo').checked = true; update(); });
  await page.click('#polish'); await page.click('[data-send="yes"]'); await page.waitForSelector('#undoPolish');
  await page.click('#undoPolish');
  const d = await page.evaluate(() => TELEMETRY.data());
  assert.ok(d.stepDurationsSec.st_start >= 7, JSON.stringify(d.stepDurationsSec));
  assert.strictEqual(d.chipSelections['reasons:write'], 1);
  assert.strictEqual(d.fieldStats.background.dirty, 1);
  assert.strictEqual(d.fieldStats.f_fm.polish, 1); assert.strictEqual(d.fieldStats.f_fm.polishUndo, 1);
  const raw = await page.evaluate(() => localStorage.getItem('ot_form_telemetry_v1'));
  assert.ok(!raw.includes('נועם') && !raw.includes('טקסט פרטי'));
  await ctx.close();
});

test('משוב על שלב: נשמר בלי פרטים מזהים, ומופיע בקובץ התובנות', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם'); await page.fill('#surname', 'לוי');
  await tab(page, 's_find');
  await page.click('#s_find1 [data-fb]');
  await page.fill('#fbText', 'אצל נועם לוי מחיפה חסר צ\'יפ על אחיזת מספריים. טל 050-1234567');
  assert.match(await page.textContent('#fbPrev'), /\[שם\] \[שם משפחה\] מ\[יישוב\] חסר צ'יפ על אחיזת מספריים\. טל \[טלפון\]/);
  await page.click('[data-fb-save]');
  // לוכדים את תוכן הקובץ לפני ההורדה (ה-CSP של האתר לא מאפשר fetch לכתובות blob:)
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = function(){ window.__dl = this.download; };
    const orig = URL.createObjectURL; URL.createObjectURL = b => { window.__blob = b; return orig(b); }; });
  await page.click('#more summary'); await page.click('#insightsBtn');
  assert.match(await page.textContent('#modal'), /הערות משוב: 1/);
  await page.click('[data-ins="dl"]');
  const bundle = await page.evaluate(() => window.__blob.text());
  assert.match(await page.evaluate(() => window.__dl), /^ot-form-insights-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(!bundle.includes('נועם') && !bundle.includes('לוי') && !bundle.includes('050-1234567') && !bundle.includes('חיפה'));
  const fb = JSON.parse(bundle).telemetry.feedbackItems[0];
  assert.strictEqual(fb.step, 's_find1');
  // מחיקה
  page.once('dialog', d => d.accept());
  await page.click('#more summary'); await page.click('#insightsBtn'); await page.click('[data-ins="clear"]');
  assert.strictEqual(await page.evaluate(() => TELEMETRY.data().feedbackItems.length), 0);
});

test('מצב Worker מתווך: קוד גישה, בלי מפתח ובלי הוראות בבקשה', async b => {
  // ה-CSP של האתר עדיין לא כולל כתובת Worker, ולכן הבדיקה עוקפת אותו
  const page = await fresh(b, {bypassCSP: true});
  const W = 'https://ot-form-proxy.example.workers.dev/';
  await page.evaluate(w => { PROXY.url = w; keyStatus(); chipInput('fm', 'midNo').checked = true; update(); }, W);
  assert.strictEqual(await page.textContent('#keyBtn'), 'קוד גישה');
  const sent = [];
  await page.route(W, r => { sent.push({h: r.request().headers(), b: JSON.parse(r.request().postData())}); r.fulfill({status: 200, contentType: 'text/event-stream', body:
    'data: ' + JSON.stringify({type:'content_block_delta', index:0, delta:{type:'text_delta', text: '{"f_fm":"נצפה קושי בחציית קו האמצע."}'}}) + '\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'}); });
  await tab(page, 'st_review');
  await page.selectOption('#polishStyle', 'icf');
  await page.click('#polish');
  await page.fill('#aCode', 'ruth-7f3a9c21'); await page.click('[data-k="acc-save"]');   // בקשת קוד, ואז ממשיכים
  await page.click('[data-send="yes"]'); await page.waitForSelector('#undoPolish');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].h['x-ot-code'], 'ruth-7f3a9c21');
  assert.strictEqual(sent[0].h['x-api-key'], undefined);
  assert.deepStrictEqual([sent[0].b.kind, sent[0].b.style, 'system' in sent[0].b], ['polish', 'icf', false]);
  assert.strictEqual(await page.textContent('#keyBtn'), 'קוד גישה: מוגדר');
});

test('פענוח תשובת Claude בהזרמה, כולל מעבר למודל חלופי', async b => {
  const page = await fresh(b);
  const r = await page.evaluate(() => parseSSE([
    'event: content_block_delta', 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"חלקי"}}', '',
    'event: content_block_start', 'data: {"type":"content_block_start","index":1,"content_block":{"type":"fallback"}}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"{\\"a\\":"}}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"1}"}}', '',
    'event: message_delta', 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}', ''].join('\n')));
  assert.deepStrictEqual(r, {text: '{"a":1}', stop: 'end_turn', error: null});
});

test('ניסוח בעזרת Claude: התקדמות, תשובה קטועה, וביטול הניסוח', async b => {
  const page = await fresh(b);
  const sse = obj => ['data: ' + JSON.stringify({type:'content_block_delta', index:0, delta:{type:'text_delta', text: JSON.stringify(obj)}}),
    'data: ' + JSON.stringify({type:'message_delta', delta:{stop_reason: obj.__stop || 'end_turn'}}), ''].join('\n');
  let reply = {f_beh: 'ניסוח מלוטש.'}, bodySent = null;
  await page.evaluate(() => { apiKey = 'sk-ant-test'; });
  await page.route('https://api.anthropic.com/v1/messages', r => { bodySent = JSON.parse(r.request().postData()); r.fulfill({status: 200, contentType: 'text/event-stream', body: sse(reply)}); });
  await tab(page, 's_find'); await page.selectOption('#coop', 'full');
  const auto = await out(page, 'f_beh');
  await tab(page, 'st_review');
  await page.click('#polish'); await page.click('[data-send="yes"]');
  await page.waitForSelector('#undoPolish');
  assert.strictEqual(bodySent.model, 'claude-sonnet-5-5');
  assert.strictEqual(bodySent.stream, true);
  assert.ok(bodySent.max_tokens >= 16000);
  assert.strictEqual(await out(page, 'f_beh'), 'ניסוח מלוטש.');
  await page.click('#undoPolish');
  assert.strictEqual(await out(page, 'f_beh'), auto);
  reply = {f_beh: 'x', __stop: 'max_tokens'};
  await page.click('#polish'); await page.click('[data-send="yes"]');
  await page.waitForSelector('#status .warnbox');
  assert.match(await page.textContent('#status'), /נקטעה/);
  assert.strictEqual(await out(page, 'f_beh'), auto);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  let fail = 0;
  for (const t of tests){
    try { await t.fn(browser); console.log('✓ ' + t.name); }
    catch (e){ fail++; console.log('✗ ' + t.name + '\n   ' + (e.message || e).split('\n').join('\n   ')); }
  }
  await browser.close(); server.close();
  console.log('\n' + (tests.length - fail) + '/' + tests.length + ' עברו');
  process.exit(fail ? 1 : 0);
})();
