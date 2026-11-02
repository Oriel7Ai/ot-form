// בדיקות ל-Worker המתווך (worker/index.js): מריצים עם  node tests/worker.test.js
// Anthropic ו-KV מדומים; בודקים הרשאות, CORS, בחירת הוראות ומודל, מגבלת שימוש והעברת ההזרמה.
const path = require('path');
const assert = require('assert');

const ORIGIN = 'https://oriel7ai.github.io';
const CODE = 'ruth-7f3a9c21';
const tests = [];
const test = (name, fn) => tests.push({name, fn});

function makeEnv(over){
  const kv = new Map([['prompt:inst', 'הוראות סגנון המכון'], ['prompt:icf', 'הוראות ICF'], ['prompt:extract', 'הוראות שליפה']]);
  return Object.assign({
    ALLOWED_ORIGINS: ORIGIN + ', http://127.0.0.1:8080', DAILY_LIMIT: '3', ANTHROPIC_API_KEY: 'sk-ant-server',
    ACCESS_CODES: 'רות=' + CODE + '\nדנה=dana-55aa77bb',
    OT_FORM: {kv, get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }},
  }, over || {});
}
const req = (body, opts) => new Request('https://ot-form-proxy.example.workers.dev/', Object.assign({method: 'POST',
  headers: {'content-type': 'application/json', origin: ORIGIN, 'x-ot-code': CODE}, body: JSON.stringify(body)}, opts || {}));
// fetch מדומה ל-Anthropic: שומר את הבקשה ומחזיר הזרמה קצרה
let upstream;
global.fetch = async (url, init) => {
  upstream = {url, headers: init.headers, body: JSON.parse(init.body)};
  return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"שלום"}}\n\n', {status: 200, headers: {'content-type': 'text/event-stream'}});
};

test('כתובת לא מורשית נדחית, ובקשת preflight מקבלת CORS', async w => {
  const bad = await w.fetch(req({kind: 'polish', user: 'x'}, {headers: {origin: 'https://evil.example', 'x-ot-code': CODE}}), makeEnv());
  assert.strictEqual(bad.status, 403);
  const pre = await w.fetch(new Request('https://x/', {method: 'OPTIONS', headers: {origin: ORIGIN}}), makeEnv());
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-ot-code/);
});

test('קוד גישה שגוי, קצר או שבוטל נדחה', async w => {
  for (const c of ['wrong-code-123', 'short', '']){
    const r = await w.fetch(req({kind: 'polish', user: 'x'}, {headers: {'content-type': 'application/json', origin: ORIGIN, 'x-ot-code': c}}), makeEnv());
    assert.strictEqual(r.status, 401, c);
  }
});

test('ניסוח: ההוראות נלקחות מ-KV לפי הסגנון, המפתח מהשרת, וההזרמה עוברת כמו שהיא', async w => {
  const r = await w.fetch(req({kind: 'polish', style: 'icf', user: 'שדות', model: 'claude-fable-5-1'}), makeEnv());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(await r.text(), /שלום/);
  assert.strictEqual(upstream.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(upstream.headers['x-api-key'], 'sk-ant-server');
  assert.strictEqual(upstream.body.system, 'הוראות ICF');
  assert.strictEqual(upstream.body.model, 'claude-sonnet-5-5');   // מודל שלא ברשימה מוחלף בברירת המחדל
  assert.strictEqual(upstream.body.stream, true);
  assert.strictEqual(upstream.body.output_config, undefined);
  await w.fetch(req({kind: 'polish', style: 'משהו אחר', user: 'שדות'}), makeEnv());
  assert.strictEqual(upstream.body.system, 'הוראות סגנון המכון');
});

test('שליפה: Opus, הוראות השליפה, ומבנה התשובה מהטופס', async w => {
  const format = {type: 'json_schema', schema: {type: 'object'}};
  await w.fetch(req({kind: 'extract', user: 'טקסט', format}), makeEnv());
  assert.strictEqual(upstream.body.model, 'claude-opus-5-5');
  assert.strictEqual(upstream.body.system, 'הוראות שליפה');
  assert.deepStrictEqual(upstream.body.output_config, {format});
});

test('הוראות שלא הוגדרו ב-KV: שגיאה ברורה, בלי פנייה ל-Anthropic', async w => {
  const env = makeEnv(); env.OT_FORM.kv.delete('prompt:icf'); upstream = null;
  const r = await w.fetch(req({kind: 'polish', style: 'icf', user: 'x'}), env);
  assert.strictEqual(r.status, 500); assert.match((await r.json()).error.message, /prompt:icf/);
  assert.strictEqual(upstream, null);
});

test('מגבלת שימוש יומית לכל קוד, בנפרד', async w => {
  const env = makeEnv();
  for (let i = 0; i < 3; i++) assert.strictEqual((await w.fetch(req({kind: 'polish', user: 'x'}), env)).status, 200);
  const r = await w.fetch(req({kind: 'polish', user: 'x'}), env);
  assert.strictEqual(r.status, 429); assert.match((await r.json()).error.message, /מספר הבקשות היומי/);
  const other = await w.fetch(req({kind: 'polish', user: 'x'}, {headers: {'content-type': 'application/json', origin: ORIGIN, 'x-ot-code': 'dana-55aa77bb'}}), env);
  assert.strictEqual(other.status, 200);
});

test('בקשה לא תקינה או גדולה מדי נדחית', async w => {
  assert.strictEqual((await w.fetch(req({kind: 'other', user: 'x'}), makeEnv())).status, 400);
  assert.strictEqual((await w.fetch(req({kind: 'polish', user: ''}), makeEnv())).status, 400);
  assert.strictEqual((await w.fetch(req({kind: 'polish', user: 'א'.repeat(450000)}), makeEnv())).status, 413);
});

const BANK = [
  {id: 'fm-young', field: 'f_fm', age: [3, 4.5], tools: ['obs'], style: 'any', text: 'דוגמה מוטוריקה עדינה לגיל צעיר'},
  {id: 'fm-beery', field: 'f_fm', age: [4, 6.5], tools: ['beery', 'obs'], style: 'any', text: 'דוגמה מוטוריקה עדינה עם Beery'},
  {id: 'fm-plain', field: 'f_fm', age: [4, 6.5], tools: ['obs'], style: 'any', text: 'דוגמה מוטוריקה עדינה בלי Beery'},
  {id: 'sens', field: 'f_sens', age: [3, 8], tools: ['sp2'], style: 'any', text: 'דוגמה ויסות חושי'},
  {id: 'sum-inst', field: 'summary', age: [4, 7], tools: [], style: 'inst', text: 'דוגמה סיכום בסגנון המכון'},
];

test('בנק ניסוחים: לכל שדה הדוגמה שמתאימה לגיל ולכלי ההערכה, ורק בסגנון המתאים', async w => {
  const env = makeEnv({DAILY_LIMIT: '50'}); env.OT_FORM.kv.set('bank:v1', JSON.stringify(BANK));
  await w.fetch(req({kind: 'polish', style: 'inst', user: 'x', ctx: {age: 5, fields: ['f_fm', 'f_sens', 'summary', 'f_gm'], tools: ['beery', 'sp2']}}), env);
  const sys = upstream.body.system;
  assert.match(sys, /^הוראות סגנון המכון\n\nדוגמאות לניסוח/);
  assert.ok(sys.includes('דוגמה מוטוריקה עדינה עם Beery') && !sys.includes('בלי Beery') && !sys.includes('לגיל צעיר'));
  assert.ok(sys.includes('— ויסות חושי —\nדוגמה ויסות חושי'));
  assert.ok(sys.includes('דוגמה סיכום בסגנון המכון'));
  assert.match(sys, /אל תעתיק מהן ממצאים/);
  // סגנון ICF: דוגמת הסיכום של סגנון המכון לא נכנסת
  await w.fetch(req({kind: 'polish', style: 'icf', user: 'x', ctx: {age: 5, fields: ['summary', 'f_fm'], tools: []}}), env);
  assert.ok(!upstream.body.system.includes('דוגמה סיכום') && upstream.body.system.includes('— מוטוריקה עדינה וגרפומוטוריקה —'));
  // גיל מחוץ לטווח של כל הדוגמאות: בלי דוגמאות
  await w.fetch(req({kind: 'polish', user: 'x', ctx: {age: 12, fields: ['f_fm'], tools: []}}), env);
  assert.strictEqual(upstream.body.system, 'הוראות סגנון המכון');
});

test('בנק ניסוחים: בלי בנק, בנק פגום, ctx לא תקין או שליפה, ההוראות לא משתנות', async w => {
  const env = makeEnv({DAILY_LIMIT: '50'});
  await w.fetch(req({kind: 'polish', user: 'x', ctx: {age: 5, fields: ['f_fm']}}), env);
  assert.strictEqual(upstream.body.system, 'הוראות סגנון המכון');
  env.OT_FORM.kv.set('bank:v1', '{not json');
  assert.strictEqual((await w.fetch(req({kind: 'polish', user: 'x', ctx: {age: 5, fields: ['f_fm']}}), env)).status, 200);
  assert.strictEqual(upstream.body.system, 'הוראות סגנון המכון');
  env.OT_FORM.kv.set('bank:v1', JSON.stringify(BANK));
  await w.fetch(req({kind: 'polish', user: 'x', ctx: {age: 'abc', fields: ['__proto__', 'constructor', 'evil'], tools: ['<script>']}}), env);
  assert.strictEqual(upstream.body.system, 'הוראות סגנון המכון');
  await w.fetch(req({kind: 'extract', user: 'x', ctx: {age: 5, fields: ['f_fm']}}), env);
  assert.strictEqual(upstream.body.system, 'הוראות שליפה');
  const m = await import(path.resolve(__dirname, '..', 'worker', 'index.js'));
  assert.deepStrictEqual(m.cleanCtx({age: 5.5, fields: ['f_fm', 'x'], tools: ['beery', 'BAD TOOL']}), {age: 5.5, fields: ['f_fm'], tools: ['beery']});
});

const CKEY = Buffer.from(Array.from({length: 32}, (_, i) => i)).toString('base64');
const PARA = 'בתחום המוטוריקה העדינה- אוחז בעיפרון באחיזה תלת-אצבעית, וגוזר על קו ישר בדיוק טוב.';

const REP = {age: 5.5, tools: ['beery', 'BAD'], sections: [{field: 'f_fm', text: PARA}, {field: 'summary', text: 'לסיכום, ' + PARA}, {field: 'recs', text: 'מומלץ לשלב פעילויות גזירה ' + PARA}]};

test('ייבוא דוחות למאגר: כל דוח נשמר מוצפן בתור המתנה, עם הפרקים וקוד המשתף, בלי לפנות ל-Claude', async w => {
  const env = makeEnv({CONTRIB_KEY: CKEY}); upstream = null;
  const r = await w.fetch(req({kind: 'contribute', attest: true, reports: [REP, {sections: [{field: 'f_gm', text: PARA}]}]}), env);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), {ok: true, count: 2});
  assert.strictEqual(upstream, null);
  const keys = [...env.OT_FORM.kv.keys()].filter(k => k.startsWith('contrib:pending:'));
  assert.strictEqual(keys.length, 2);
  const m = await import(path.resolve(__dirname, '..', 'worker', 'index.js'));
  const recs = await Promise.all(keys.map(k => m.openRecord(CKEY, env.OT_FORM.kv.get(k))));
  keys.forEach(k => assert.ok(!env.OT_FORM.kv.get(k).includes('אוחז') && !env.OT_FORM.kv.get(k).includes('רות'), 'נשמר מוצפן'));
  const full = recs.find(x => x.sections.length === 3);
  assert.strictEqual(full.by, 'רות'); assert.strictEqual(full.age, 5.5); assert.deepStrictEqual(full.tools, ['beery']);
  assert.deepStrictEqual(full.sections.map(x => x.field), ['f_fm', 'summary', 'recs']);
  assert.strictEqual(env.OT_FORM.kv.get('bank:v1'), undefined, 'לא נכנס למאגר לפני אישור');
});

test('ייבוא דוחות למאגר: בלי אישור, פרק רקע, פרק כפול, טקסט קצר או פרט מזהה, נדחה', async w => {
  const env = makeEnv({CONTRIB_KEY: CKEY});
  const bad = async (body, re) => { const r = await w.fetch(req(Object.assign({kind: 'contribute', attest: true}, body)), env);
    assert.strictEqual(r.status, 422); assert.match((await r.json()).error.message, re); };
  const one = secs => ({reports: [{sections: secs}]});
  await bad(Object.assign({attest: false}, one([{field: 'f_fm', text: PARA}])), /אישור/);
  await bad({reports: []}, /בין 1 ל-10/);
  await bad({reports: Array.from({length: 11}, () => REP)}, /בין 1 ל-10/);
  await bad(one([]), /לפחות פרק/);
  await bad(one([{field: 'family', text: PARA}]), /ממצאים, סיכום, המלצות ומטרות/);
  await bad(one([{field: 'f_fm', text: PARA}, {field: 'f_fm', text: PARA}]), /פעם אחת/);
  await bad(one([{field: 'f_fm', text: 'קצר'}]), /באורך/);
  await bad(one([{field: 'f_fm', text: PARA + ' טלפון 052-1234567'}]), /מזהה/);
  await bad(one([{field: 'f_fm', text: PARA + ' ת"ז 123456789'}]), /מזהה/);
  await bad(one([{field: 'f_fm', text: PARA + ' נבדק ב-12.3.2025'}]), /מזהה/);
  assert.strictEqual([...env.OT_FORM.kv.keys()].filter(k => k.startsWith('contrib:')).length, 0);
  const off = await w.fetch(req({kind: 'contribute', attest: true, reports: [REP]}), makeEnv());
  assert.strictEqual(off.status, 500);
});

test('ייבוא דוחות למאגר: מגבלה יומית של 30 דוחות לכל קוד', async w => {
  const env = makeEnv({CONTRIB_KEY: CKEY});
  const ten = Array.from({length: 10}, () => REP);
  for (let i = 0; i < 2; i++) assert.strictEqual((await w.fetch(req({kind: 'contribute', attest: true, reports: ten}), env)).status, 200);
  assert.strictEqual((await w.fetch(req({kind: 'contribute', attest: true, reports: ten.concat([]).slice(0, 10).concat([])}), env)).status, 200);
  assert.strictEqual((await w.fetch(req({kind: 'contribute', attest: true, reports: [REP]}), env)).status, 429);
});

(async () => {
  const w = (await import(path.resolve(__dirname, '..', 'worker', 'index.js'))).default;
  let fail = 0;
  for (const t of tests){
    try { await t.fn(w); console.log('✓ ' + t.name); }
    catch (e){ fail++; console.log('✗ ' + t.name + '\n   ' + (e.message || e)); }
  }
  console.log('\n' + (tests.length - fail) + '/' + tests.length + ' עברו (Worker)');
  process.exit(fail ? 1 : 0);
})();
