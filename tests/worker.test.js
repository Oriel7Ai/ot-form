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
