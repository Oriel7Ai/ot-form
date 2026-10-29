// בדיקות לטופס: מריצים עם  node tests/form.test.js
// הבדיקות פותחות את index.html בדפדפן Chromium (Playwright) ובודקות את בניית הטקסט ואת הפעולות העיקריות.
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

// מגישים את הדף מ-http מקומי, כמו ב-GitHub Pages (ב-file:// הדפדפן מתעלם משמות קבצים להורדה)
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'));
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); });
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
const tab = (page, id) => page.click('[data-tab="' + id + '"]');
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

test('לשוניות עם תפקידי נגישות וחיצים', async b => {
  const page = await fresh(b);
  assert.strictEqual(await page.getAttribute('#tabs', 'role'), 'tablist');
  await page.focus('#tab_s_import');
  await page.keyboard.press('ArrowLeft');
  assert.strictEqual(await page.getAttribute('#tab_s_bg', 'aria-selected'), 'true');
  assert.strictEqual(await page.$eval('#s_bg', el => el.classList.contains('on')), true);
});

test('שמירה אוטומטית משחזרת אחרי רענון', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await tab(page, 's_bg'); await chip(page, 'reasons', 'write');
  await page.fill('#o_family', 'טקסט שנערך ביד');
  await page.waitForTimeout(800);
  await page.reload();
  assert.strictEqual(await page.$eval('#name', el => el.value), 'נועם');
  assert.strictEqual(await page.$eval('[data-chips="reasons"] input[value="write"]', el => el.checked), true);
  assert.strictEqual(await out(page, 'family'), 'טקסט שנערך ביד');
});

test('ניקוי הטופס וביטול הניקוי', async b => {
  const page = await fresh(b);
  await page.fill('#name', 'נועם');
  await page.click('#more summary'); await page.click('#resetAll');
  assert.strictEqual(await page.$eval('#name', el => el.value), '');
  await page.click('#undoReset');
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
