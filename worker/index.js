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
    const kind = req.kind === 'extract' ? 'extract' : req.kind === 'polish' ? 'polish' : null;
    if (!kind || typeof req.user !== 'string' || !req.user.trim()) return fail(400, 'בקשה לא תקינה.', ch);
    const promptKey = kind === 'extract' ? 'extract' : (req.style === 'icf' ? 'icf' : 'inst');

    // מגבלת שימוש יומית לכל קוד
    const day = new Date().toISOString().slice(0, 10), usageKey = 'usage:' + owner + ':' + day;
    const used = Number(await env.OT_FORM.get(usageKey)) || 0, limit = Number(env.DAILY_LIMIT) || 60;
    if (used >= limit) return fail(429, 'הגעת למספר הבקשות היומי (' + limit + '). אפשר להמשיך מחר.', ch);

    const system = await env.OT_FORM.get(PROMPT_KEYS[promptKey]);
    if (!system) return fail(500, 'ההוראות ל-Claude עוד לא הוגדרו ב-Worker (' + PROMPT_KEYS[promptKey] + ').', ch);

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
