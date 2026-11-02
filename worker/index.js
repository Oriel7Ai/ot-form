// Worker מתווך בין טופס דוח האבחון ל-Anthropic.
// - מפתח ה-API נשמר רק כאן (סוד ANTHROPIC_API_KEY), לא בדפדפן.
// - כל מאבחנת מקבלת קוד גישה אישי (סוד ACCESS_CODES), שאפשר לבטל בנפרד.
// - ההוראות ל-Claude נשמרות ב-KV (מפתחות prompt:inst, prompt:icf, prompt:extract) ולא מגיעות לדפדפן.
// - הטקסט מגיע אחרי הסרת פרטים מזהים בדפדפן. ה-Worker לא שומר ולא מתעד אותו.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELS = {polish: 'claude-sonnet-5-5', extract: 'claude-opus-5-5'};   // ברירת מחדל לכל סוג בקשה
const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
const FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
const MAX_TOKENS = 32000;
const MAX_BODY = 400000;   // בתים: שליפה של עד 100,000 תווים בעברית, יחד עם רשימת השדות
const PROMPT_KEYS = {inst: 'prompt:inst', icf: 'prompt:icf', extract: 'prompt:extract'};

// ---- בנק הניסוחים המשותף (KV, מפתח bank:v1): פסקאות לדוגמה לפי שדה, גיל וכלי הערכה.
// בניסוח, ה-Worker בוחר את הדוגמאות שמתאימות לבקשה ומצרף אותן להוראות, כדי ש-Claude יכתוב באותו סגנון ועומק.
// כל רשומה: {id, field, age: [מגיל, עד גיל] בשנים, tools: [...], style: 'inst' | 'icf' | 'any', text}
const BANK_KEY = 'bank:v1';
const BANK_FIELDS = {background: 'רקע התפתחותי ורפואי', prev: 'טיפולים בעבר ובהווה', family: 'רקע משפחתי',
  parents: 'דיווח ההורים והילד', school: 'דיווח מסגרת חינוכית', f_beh: 'התנהגות ושיתוף פעולה', f_gm: 'מוטוריקה גסה',
  f_fm: 'מוטוריקה עדינה וגרפומוטוריקה', f_wr: 'כתיבה', f_cog: 'תפיסה וחשיבה', f_play: 'משחק', f_sens: 'ויסות חושי', summary: 'סיכום'};
const BANK_PER_FIELD = 1, BANK_MAX = 6;

// מה שהטופס שולח על הבקשה, בלי פרטים מזהים: גיל מעוגל, השדות שיש בהם טקסט וכלי ההערכה שסומנו
export function cleanCtx(c){
  c = c && typeof c === 'object' ? c : {};
  const age = Number(c.age);
  return {
    age: Number.isFinite(age) && age >= 0 && age <= 21 ? age : null,
    fields: (Array.isArray(c.fields) ? c.fields : []).filter(f => Object.hasOwn(BANK_FIELDS, f)).slice(0, 20),
    tools: (Array.isArray(c.tools) ? c.tools : []).filter(t => typeof t === 'string' && /^[a-z0-9_]{1,16}$/.test(t)).slice(0, 20),
  };
}

// לכל שדה בבקשה: הדוגמה המתאימה ביותר (גיל, ואז כלי הערכה משותפים), עד BANK_MAX בסך הכול
export function pickExamples(bank, ctx, style){
  if (!Array.isArray(bank) || !ctx.fields.length) return [];
  const out = [];
  for (const field of ctx.fields){
    const scored = bank
      .filter(e => e && e.field === field && typeof e.text === 'string' && e.text.trim() && (!e.style || e.style === 'any' || e.style === style))
      .map(e => {
        const inAge = ctx.age === null || !Array.isArray(e.age) || (ctx.age >= e.age[0] && ctx.age <= e.age[1]);
        const tools = (e.tools || []).filter(t => ctx.tools.includes(t)).length;
        return {e, score: (inAge ? 10 : 0) + tools};
      })
      .filter(x => x.score >= 10 || ctx.age === null)
      .sort((a, b) => b.score - a.score || String(a.e.id).localeCompare(String(b.e.id)));
    out.push(...scored.slice(0, BANK_PER_FIELD).map(x => x.e));
    if (out.length >= BANK_MAX) break;
  }
  return out.slice(0, BANK_MAX);
}

export function examplesBlock(examples){
  if (!examples.length) return '';
  return '\n\nדוגמאות לניסוח מהבנק של המכון. הן ממחישות סגנון, עומק ומבנה בלבד: אל תעתיק מהן ממצאים, ציונים, מספרים או פרטים שלא מופיעים בשדות שקיבלת. ' +
    'הדוגמאות כתובות בלשון זכר; שמור על המגדר שצוין בבקשה.\n' +
    examples.map(e => '\n— ' + BANK_FIELDS[e.field] + ' —\n' + e.text.trim()).join('\n');
}

// "שם=קוד" בכל שורה. מחזיר את השם, או null אם הקוד לא קיים.
export function codeOwner(codes, code){
  if (!code || code.length < 8) return null;
  for (const line of String(codes || '').split(/\r?\n/)){
    const i = line.lastIndexOf('='); if (i < 1) continue;
    if (line.slice(i + 1).trim() === code) return line.slice(0, i).trim();
  }
  return null;
}

function cors(origin, env){
  const ok = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ok.includes(origin)) return null;
  return {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-ot-code', 'access-control-max-age': '86400', 'vary': 'origin'};
}
const fail = (status, message, headers) => new Response(JSON.stringify({error: {message}}),
  {status, headers: Object.assign({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}, headers)});

// ---- תרומות לבנק: פסקאות שמטפלים שולחים מהטופס, אחרי הסרת פרטים מזהים ובדיקה ידנית אצלם.
// הן נשמרות מוצפנות בתור המתנה (contrib:pending:<id>), ונכנסות לבנק רק אחרי אישור בדף הניהול.
const CONTRIB_FIELDS = ['f_beh', 'f_gm', 'f_fm', 'f_wr', 'f_cog', 'f_play', 'f_sens', 'summary'];
const CONTRIB_MAX_ITEMS = 12, CONTRIB_MIN = 30, CONTRIB_MAX = 4000, CONTRIB_DAILY = 40;
// רשת ביטחון בשרת: פרטים שהטופס היה אמור להסיר
const PII_RES = [/[\w.+\-]+@[\w\-]+(\.[\w\-]+)+/, /(?<!\d)(?:\+972[\-\s]?|0)(?:5\d|7\d|[23489])[\-\s]?\d{3}[\-\s]?\d{4}(?!\d)/,
  /(?<!\d)\d{8,9}(?!\d)/, /(?<!\d)\d{1,2}[.\/\-]\d{1,2}[.\/\-](?:\d{4}|\d{2})(?!\d)/];

export function cleanContribution(req){
  if (req.attest !== true) return {error: 'חסר אישור על הסרת הפרטים המזהים.'};
  const items = Array.isArray(req.items) ? req.items : [];
  if (!items.length || items.length > CONTRIB_MAX_ITEMS) return {error: 'אפשר לתרום בין 1 ל-' + CONTRIB_MAX_ITEMS + ' פסקאות בכל פעם.'};
  const ctx = cleanCtx({age: req.age, fields: [], tools: req.tools});
  const out = [];
  for (const it of items){
    const field = it && it.field, text = it && typeof it.text === 'string' ? it.text.trim() : '';
    if (!CONTRIB_FIELDS.includes(field)) return {error: 'אפשר לתרום רק פסקאות של ממצאים וסיכום.'};
    if (text.length < CONTRIB_MIN || text.length > CONTRIB_MAX) return {error: 'כל פסקה צריכה להיות באורך ' + CONTRIB_MIN + ' עד ' + CONTRIB_MAX + ' תווים.'};
    if (PII_RES.some(re => re.test(text))) return {error: 'נמצא בטקסט פרט שנראה מזהה (מייל, טלפון, מספר מזהה או תאריך). הסירי אותו ונסי שוב.'};
    out.push({field, text});
  }
  return {items: out, age: ctx.age, tools: ctx.tools};
}

async function contribKey(secret){
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = u8 => btoa(String.fromCharCode(...u8));
export async function sealRecord(secret, rec){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await contribKey(secret), new TextEncoder().encode(JSON.stringify(rec))));
  return JSON.stringify({v: 1, iv: b64(iv), ct: b64(ct)});
}
export async function openRecord(secret, sealed){
  const s = JSON.parse(sealed), un = x => Uint8Array.from(atob(x), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: un(s.iv)}, await contribKey(secret), un(s.ct))));
}

async function contribute(req, owner, env, ch){
  if (!env.CONTRIB_KEY) return fail(500, 'התרומות לבנק עוד לא הוגדרו ב-Worker.', ch);
  const c = cleanContribution(req);
  if (c.error) return fail(422, c.error, ch);
  const day = new Date().toISOString().slice(0, 10), key = 'contrib-usage:' + owner + ':' + day;
  const used = Number(await env.OT_FORM.get(key)) || 0;
  if (used + c.items.length > CONTRIB_DAILY) return fail(429, 'הגעת למספר התרומות היומי (' + CONTRIB_DAILY + ' פסקאות). אפשר להמשיך מחר.', ch);
  const at = new Date().toISOString();
  for (const it of c.items){
    const id = crypto.randomUUID();
    const rec = {id, src: 'contrib', by: owner, at, field: it.field, age: c.age, tools: c.tools, text: it.text};
    await env.OT_FORM.put('contrib:pending:' + id, await sealRecord(env.CONTRIB_KEY, rec));
  }
  await env.OT_FORM.put(key, String(used + c.items.length), {expirationTtl: 3 * 86400});
  return new Response(JSON.stringify({ok: true, count: c.items.length}),
    {status: 200, headers: Object.assign({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}, ch)});
}

export default {
  async fetch(request, env){
    const origin = request.headers.get('origin') || '';
    const ch = cors(origin, env);
    if (!ch) return fail(403, 'הכתובת שממנה נשלחה הבקשה לא מורשית.');
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: ch});
    if (request.method !== 'POST') return fail(405, 'רק POST.', ch);

    const owner = codeOwner(env.ACCESS_CODES, request.headers.get('x-ot-code'));
    if (!owner) return fail(401, 'קוד הגישה לא תקין או בוטל.', ch);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, 'הטקסט ארוך מדי לבקשה אחת.', ch);
    let req; try { req = JSON.parse(raw); } catch(e){ return fail(400, 'בקשה לא תקינה.', ch); }
    if (req && req.kind === 'contribute') return contribute(req, owner, env, ch);
    const kind = req.kind === 'extract' ? 'extract' : req.kind === 'polish' ? 'polish' : null;
    if (!kind || typeof req.user !== 'string' || !req.user.trim()) return fail(400, 'בקשה לא תקינה.', ch);
    const promptKey = kind === 'extract' ? 'extract' : (req.style === 'icf' ? 'icf' : 'inst');

    // מגבלת שימוש יומית לכל קוד
    const day = new Date().toISOString().slice(0, 10), usageKey = 'usage:' + owner + ':' + day;
    const used = Number(await env.OT_FORM.get(usageKey)) || 0, limit = Number(env.DAILY_LIMIT) || 60;
    if (used >= limit) return fail(429, 'הגעת למספר הבקשות היומי (' + limit + '). אפשר להמשיך מחר.', ch);

    let system = await env.OT_FORM.get(PROMPT_KEYS[promptKey]);
    if (!system) return fail(500, 'ההוראות ל-Claude עוד לא הוגדרו ב-Worker (' + PROMPT_KEYS[promptKey] + ').', ch);

    if (kind === 'polish'){
      let bank = null;
      try { bank = JSON.parse(await env.OT_FORM.get(BANK_KEY, {cacheTtl: 60}) || 'null'); } catch(e){ bank = null; }   // בנק פגום: ממשיכים בלי דוגמאות
      system += examplesBlock(pickExamples(bank, cleanCtx(req.ctx), promptKey));
    }

    const model = ALLOWED_MODELS.includes(req.model) ? req.model : MODELS[kind];
    const body = {model, max_tokens: MAX_TOKENS, stream: true, system, messages: [{role: 'user', content: req.user}]};
    if (kind === 'extract' && req.format && typeof req.format === 'object') body.output_config = {format: req.format};
    const headers = {'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01'};
    if (FALLBACK_MODELS.includes(model)){ headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }

    await env.OT_FORM.put(usageKey, String(used + 1), {expirationTtl: 3 * 86400});
    let up;
    try { up = await fetch(API_URL, {method: 'POST', headers, body: JSON.stringify(body)}); }
    catch(e){ return fail(502, 'אין חיבור ל-Claude מה-Worker.', ch); }
    // התשובה (הזרמה או שגיאה) עוברת כמו שהיא, עם כותרות CORS
    return new Response(up.body, {status: up.status, headers: Object.assign({
      'content-type': up.headers.get('content-type') || 'text/event-stream', 'cache-control': 'no-store'}, ch)});
  },
};
