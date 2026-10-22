import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

try { process.loadEnvFile?.('.env'); } catch {}

const E = process.env, PORT = +E.PORT || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data'), PUB = path.join(ROOT, 'public');
fs.mkdirSync(DATA, {recursive: true});
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const wr = (f, o) => { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(p + '.tmp', p); };

/* ---------- Danh sách AI (thứ tự và chế độ duyệt nằm trong settings) ---------- */
const REG = {
  claude: {name: 'Claude', kind: 'anthropic', model: E.CLAUDE_MODEL || 'claude-sonnet-5-5', quota: 'Theo API', ok: () => !!E.ANTHROPIC_API_KEY},
  openai: {name: 'ChatGPT', kind: 'openai', url: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: E.OPENAI_MODEL || 'gpt-4o-mini', quota: 'Theo API', ok: () => !!E.OPENAI_API_KEY},
  gemini: {name: 'Gemini', kind: 'gemini', model: E.GEMINI_MODEL || 'gemini-2.5-flash', quota: 'Theo API', ok: () => !!E.GEMINI_API_KEY},
  openrouter: {name: 'OpenRouter (free)', kind: 'openai', url: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: E.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', quota: 'Theo Model / Free Tier', ok: () => !!E.OPENROUTER_API_KEY},
  groq: {name: 'Groq (free)', kind: 'openai', url: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: E.GROQ_MODEL || 'llama-3.3-70b-versatile', quota: '14,400 RPD (Free Tier)', ok: () => !!E.GROQ_API_KEY},
  router9: {name: '9Router (local)', kind: 'openai', url: E.NINEROUTER_URL || 'http://localhost:20128/v1', key: 'NINEROUTER_API_KEY', model: E.NINEROUTER_MODEL || '', quota: 'Không giới hạn (Local)', ok: () => !!E.NINEROUTER_MODEL}
};
const DEF = {email: E.NOTIFY_EMAIL || '', retryMin: 30, providers: [
  {id: 'claude', mode: 'auto'}, {id: 'openai', mode: 'ask'}, {id: 'gemini', mode: 'ask'},
  {id: 'openrouter', mode: 'ask'}, {id: 'groq', mode: 'ask'}, {id: 'router9', mode: 'ask'}]};
let ST = Object.assign({}, DEF, rd('settings.json', {}));
ST.modelOverrides = ST.modelOverrides || {};
const saveST = () => wr('settings.json', ST);
let JOBS = rd('jobs.json', []);
const saveJ = () => wr('jobs.json', JOBS);
const cool = {};

/* ---------- Hệ thống thống kê Token thật theo từng AI ---------- */
const TOKENS_FILE = 'tokens.json';
const todayStr = () => new Date().toISOString().slice(0, 10);
const DEF_TOKENS = {
  claude: { used: 0, today: 0, lastReset: todayStr() },
  openai: { used: 0, today: 0, lastReset: todayStr() },
  gemini: { used: 0, today: 0, lastReset: todayStr() },
  openrouter: { used: 0, today: 0, lastReset: todayStr() },
  groq: { used: 0, today: 0, lastReset: todayStr() },
  router9: { used: 0, today: 0, lastReset: todayStr() }
};
let TOKENS = Object.assign({}, DEF_TOKENS, rd(TOKENS_FILE, {}));
const saveTokens = () => wr(TOKENS_FILE, TOKENS);

function getTokens(id) {
  if (!TOKENS[id]) TOKENS[id] = { used: 0, today: 0, lastReset: todayStr() };
  const d = todayStr();
  if (TOKENS[id].lastReset !== d) {
    TOKENS[id].today = 0;
    TOKENS[id].lastReset = d;
    saveTokens();
  }
  return TOKENS[id];
}

function recordTokens(id, count) {
  if (!id || !count) return;
  const t = getTokens(id);
  t.used = (t.used || 0) + count;
  t.today = (t.today || 0) + count;
  saveTokens();
}

/* ---------- Gọi AI ---------- */
async function post(url, headers, body) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body), signal: AbortSignal.timeout(180000)});
  const t = await r.text(); let j = {};
  try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(r.status + ' ' + String(j.error?.message || t).slice(0, 200)); e.status = r.status; throw e; }
  return j;
}
function getModel(id) { return ST.modelOverrides?.[id] || REG[id]?.model || ''; }
async function call(id, sys, usr, max) {
  const r = REG[id];
  const model = getModel(id);
  if (r.kind === 'anthropic') {
    const j = await post('https://api.anthropic.com/v1/messages', {'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01'},
      {model, max_tokens: max, system: sys, messages: [{role: 'user', content: usr}]});
    return {text: (j.content || []).map(c => c.text || '').join(''), tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0)};
  }
  if (r.kind === 'gemini') {
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {'x-goog-api-key': E.GEMINI_API_KEY},
      {systemInstruction: {parts: [{text: sys}]}, contents: [{role: 'user', parts: [{text: usr}]}], generationConfig: {maxOutputTokens: max}});
    return {text: (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''), tokens: j.usageMetadata?.totalTokenCount || 0};
  }
  const h = E[r.key] ? {authorization: 'Bearer ' + E[r.key]} : {};
  const j = await post(r.url + '/chat/completions', h, {model, max_tokens: max, messages: [{role: 'system', content: sys}, {role: 'user', content: usr}]});
  return {text: j.choices?.[0]?.message?.content || '', tokens: j.usage?.total_tokens || 0};
}
const ev = (j, role, text) => { (j.events = j.events || []).push({n: j.seq = (j.seq || 0) + 1, t: Date.now(), role, text: String(text).slice(0, 300)}); if (j.events.length > 200) j.events.shift(); };

/* Router: đi theo thứ tự ưu tiên; hết token/lỗi thì sang AI kế tiếp; AI chưa được duyệt thì dừng chờ duyệt */
async function route(job, sys, usr, max) {
  const configured = ST.providers.some(p => REG[p.id]?.ok());
  if (!configured) throw {no_keys: true};
  for (const p of ST.providers) {
    const r = REG[p.id];
    if (!r || !r.ok() || p.mode === 'deny' || (cool[p.id] || 0) > Date.now()) continue;
    if (p.mode !== 'auto' && !job.once?.[p.id]) throw {need: p.id};
    try {
      const o = await call(p.id, sys, usr, max);
      if (!o.text) throw new Error('phản hồi rỗng');
      o.provider = p.id; return o;
    } catch (e) {
      cool[p.id] = Date.now() + (+E.COOLDOWN_MIN || 60) * 60000;
      ev(job, 'Tiến độ & Token', `${r.name} lỗi hoặc hết hạn mức (${String(e.message).slice(0, 80)}). Chuyển sang AI kế tiếp.`);
    }
  }
  throw {exhausted: true};
}

/* ---------- Quy trình các agent ---------- */
const SYS = r => `Bạn là ${r} của một công ty tech nhỏ gồm các AI agent. Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm.`;
const STEPS = [
  {role: 'CEO', max: 600, p: (j, c) => `Yêu cầu của chủ đầu tư: "${j.req}"\nXác định mục tiêu và phạm vi MVP trong tối đa 8 gạch đầu dòng.`},
  {role: 'PM', max: 1200, p: (j, c) => `Phạm vi MVP:\n${c(0)}\nViết PRD gồm 4 user story, tiêu chí chấp nhận và phân công cho Dev BE, Dev FE, QA.`},
  {role: 'Dev BE', max: 1500, p: (j, c) => `PRD:\n${c(1)}\nThiết kế bảng dữ liệu và danh sách REST API (method, path, body, response).`},
  {role: 'Dev FE', max: 4000, html: 1, p: (j, c) => `PRD:\n${c(1)}\nAPI:\n${c(2)}\nViết MỘT file HTML duy nhất (CSS và JS nội tuyến, responsive, tiếng Việt) hiện thực sản phẩm, dùng dữ liệu giả thay cho API. Chỉ trả về mã HTML hoàn chỉnh, không giải thích.`},
  {role: 'QA/QC', max: 1200, p: (j, c) => `PRD:\n${c(1)}\nMã giao diện:\n${c(3, 6000)}\nViết 6 test case, kiểm tra bằng cách đọc mã, kết luận Pass/Fail từng case và liệt kê bug nếu có.`},
  {role: 'Dev FE', max: 4000, html: 1, p: (j, c) => `Báo cáo QA:\n${c(4)}\nMã hiện tại:\n${c(3, 6000)}\nSửa các bug đã nêu và trả về MỘT file HTML hoàn chỉnh, không giải thích.`},
  {role: 'PM', max: 800, p: (j, c) => `Tổng hợp báo cáo bàn giao (tối đa 10 dòng) từ:\nPRD: ${c(1, 1200)}\nQA: ${c(4, 1200)}`},
  {role: 'CEO', max: 400, p: (j, c) => `Báo cáo:\n${c(6)}\nQuyết định duyệt release và nhận xét ngắn (3 dòng).`}
];

/* ---------- Email (Resend) ---------- */
async function mail(subject, text) {
  if (!ST.email || !E.RESEND_API_KEY) throw new Error('Thiếu email nhận hoặc RESEND_API_KEY');
  await post('https://api.resend.com/emails', {authorization: 'Bearer ' + E.RESEND_API_KEY},
    {from: E.MAIL_FROM || 'AI Tech Office <onboarding@resend.dev>', to: [ST.email], subject: '[AI Tech Office] ' + subject, text});
}
async function notify(job, kind) {
  if (!ST.email || !E.RESEND_API_KEY) return;
  job.sent = job.sent || [];
  const k = kind + job.step + (job.need || '');
  if (job.sent.includes(k)) return;
  job.sent.push(k);
  const base = E.PUBLIC_URL || `http://localhost:${PORT}`;
  const subj = {done: 'Hoàn tất: ', paused: 'Tạm dừng (hết token): ', approval: 'Cần duyệt dùng AI: ', failed: 'Lỗi: '}[kind] + job.req;
  const text = `Công việc: ${job.req}\nTrạng thái: ${job.status}\nTiến độ: ${job.step}/${STEPS.length} bước\nToken đã dùng: ${job.tokens || 0}\nAI đã dùng: ${(job.providers || []).map(i => REG[i].name).join(', ') || '-'}\n`
    + (kind === 'approval' ? `\nCần duyệt: ${REG[job.need].name}. Mở ${base} và chọn Router AI để duyệt, công việc sẽ tự chạy tiếp.\n` : '')
    + (kind === 'paused' ? `\nĐã lưu sổ tại bước ${job.step + 1}. Hệ thống tự thử lại sau ${ST.retryMin} phút.\n` : '')
    + (kind === 'done' ? `\nKết quả: ${base}/api/jobs/${job.id}/output?k=${job.key}\n\n${(job.out[6] || '').slice(0, 1500)}` : '')
    + (kind === 'failed' ? `\nLỗi: ${job.err}` : '');
  try { await mail(subj, text); ev(job, 'Thư ký', 'Đã gửi email thông báo tới ' + ST.email); }
  catch (e) { ev(job, 'Thư ký', 'Gửi email lỗi: ' + String(e.message).slice(0, 100)); }
}

/* ---------- Chạy job nền, ghi sổ sau mỗi bước ---------- */
async function run(job) {
  job.status = 'running'; job.need = null; saveJ();
  try {
    while (job.step < STEPS.length) {
      const st = STEPS[job.step], c = (i, n = 1500) => (job.out[i] || '').slice(0, n);
      ev(job, st.role, `Bắt đầu bước ${job.step + 1}/${STEPS.length}`);
      const o = await route(job, SYS(st.role), st.p(job, c), st.max);
      job.out[job.step] = st.html ? o.text.replace(/^[\s\S]*?(<!DOCTYPE|<html)/i, '$1').replace(/```[\s\S]*$/, '').trim() : o.text;
      job.tokens = (job.tokens || 0) + o.tokens;
      job.providers = [...new Set([...(job.providers || []), o.provider])];
      recordTokens(o.provider, o.tokens);
      ev(job, st.role, `Xong bước ${job.step + 1} bằng ${REG[o.provider].name}: ` + o.text.replace(/\s+/g, ' ').slice(0, 160));
      job.step++;
      ev(job, 'Thư ký', `Đã ghi sổ bước ${job.step}/${STEPS.length} (tổng ${job.tokens} token).`);
      saveJ();
    }
    const dir = path.join(DATA, 'out', String(job.id));
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'index.html'), job.out[5] || '');
    fs.writeFileSync(path.join(dir, 'report.md'), (job.out[6] || '') + '\n\n' + (job.out[7] || ''));
    job.status = 'done'; ev(job, 'CEO', 'Duyệt release và bàn giao.');
    await notify(job, 'done');
  } catch (e) {
    if (e.need) {
      job.status = 'waiting_approval'; job.need = e.need;
      ev(job, 'Tiến độ & Token', `Cần duyệt dùng ${REG[e.need].name} để tiếp tục.`);
      await notify(job, 'approval');
    } else if (e.no_keys) {
      job.status = 'paused'; job.retryAt = Date.now() + 60000;
      ev(job, 'Thư ký', 'Chưa cấu hình API Key nào! Dù dùng model miễn phí (như Groq hay Gemini), nhà cung cấp vẫn bắt buộc phải có API Key để kết nối. Hãy mở Router AI -> 4. Nhập API Key.');
      await notify(job, 'failed');
    } else if (e.exhausted) {
      job.status = 'paused'; job.retryAt = Date.now() + ST.retryMin * 60000;
      ev(job, 'Thư ký', `Mọi AI đã hết hạn mức. Đã lưu sổ tại bước ${job.step + 1}, tự thử lại sau ${ST.retryMin} phút.`);
      await notify(job, 'paused');
    } else {
      job.status = 'failed'; job.err = String(e.message || e);
      await notify(job, 'failed');
    }
  }
  saveJ();
}
let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    for (const j of JOBS) {
      const pr = ST.providers.find(p => p.id === j.need);
      if (j.status === 'waiting_approval' && (!pr || pr.mode !== 'ask' || j.once?.[j.need])) j.status = 'queued';
      if (j.status === 'paused' && Date.now() >= (j.retryAt || 0)) j.status = 'queued';
      if (j.status === 'queued') await run(j);
    }
  } finally { busy = false; }
}
JOBS.forEach(j => { if (j.status === 'running') j.status = 'queued'; });
setInterval(tick, 10000); setImmediate(tick);

/* ---------- HTTP API ---------- */
const J = (res, c, o) => { res.writeHead(c, {'content-type': 'application/json'}); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const view = j => ({id: j.id, key: j.key, req: j.req, status: j.status, step: j.step, total: STEPS.length, tokens: j.tokens || 0, need: j.need, retryAt: j.retryAt, providers: j.providers || [], events: j.events || [], seq: j.seq || 0, err: j.err});
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css'};

const buildProviders = () => Object.fromEntries(Object.entries(REG).map(([k, r]) => {
  const tok = getTokens(k);
  const isCool = (cool[k] || 0) > Date.now();
  const isReady = r.ok();
  return [k, {
    name: r.name,
    model: getModel(k),
    ready: isReady,
    cooldownMs: Math.max(0, (cool[k] || 0) - Date.now()),
    quota: r.quota || 'Theo API',
    used: tok.used || 0,
    today: tok.today || 0,
    status: !isReady ? 'no_key' : (isCool ? 'cooldown' : 'available'),
    statusLabel: !isReady ? '⚪ Chưa cài API Key' : (isCool ? '🟡 Hết hạn mức / Cooldown' : '🟢 Available')
  }];
}));

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
  const outKey = /^\/api\/jobs\/\d+\/output$/.test(p) && JOBS.some(j => String(j.id) === p.split('/')[3] && j.key && j.key === u.searchParams.get('k'));
  if (p.startsWith('/api/') && p !== '/api/health' && !outKey && E.ADMIN_TOKEN && req.headers.authorization !== 'Bearer ' + E.ADMIN_TOKEN) return J(res, 401, {error: 'unauthorized'});
  try {
    if (p === '/api/health') return J(res, 200, {ok: true});
    if (p === '/api/settings') {
      if (m === 'PUT') {
        const b = await body(req);
        if (typeof b.email === 'string') ST.email = b.email.trim();
        if (b.retryMin) ST.retryMin = Math.max(1, +b.retryMin);
        if (Array.isArray(b.providers)) ST.providers = b.providers.filter(x => REG[x.id]).map(x => ({id: x.id, mode: ['auto', 'ask', 'deny'].includes(x.mode) ? x.mode : 'ask'}));
        if (b.pricing && typeof b.pricing === 'object') ST.pricing = b.pricing;
        if (b.modelOverrides && typeof b.modelOverrides === 'object') ST.modelOverrides = Object.fromEntries(Object.entries(b.modelOverrides).filter(([id, model]) => REG[id] && typeof model === 'string' && model.trim()).map(([id, model]) => [id, model.trim().slice(0, 200)]));
        saveST(); setImmediate(tick);
      }
      return J(res, 200, {settings: ST, tokens: TOKENS, providers: buildProviders()});
    }
    if (p === '/api/tokens' && m === 'GET') {
      return J(res, 200, {tokens: TOKENS, providers: buildProviders()});
    }
    if (p === '/api/tokens/reset' && m === 'POST') {
      TOKENS = Object.assign({}, DEF_TOKENS);
      saveTokens();
      return J(res, 200, {ok: true, tokens: TOKENS});
    }
    if (p === '/api/keys' && m === 'POST') {
      const b = await body(req);
      const keyMap = {
        groq: 'GROQ_API_KEY',
        gemini: 'GEMINI_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
        claude: 'ANTHROPIC_API_KEY'
      };
      const saveEnvKey = (kName, val) => {
        const envPath = path.join(ROOT, '.env');
        let content = '';
        try { content = fs.readFileSync(envPath, 'utf8'); } catch {}
        const regex = new RegExp(`^${kName}=.*$`, 'm');
        if (regex.test(content)) content = content.replace(regex, `${kName}=${val}`);
        else content += `\n${kName}=${val}`;
        fs.writeFileSync(envPath, content);
      };
      for (const [k, v] of Object.entries(b)) {
        const envName = keyMap[k];
        if (envName && typeof v === 'string' && v.trim()) {
          const trimmed = v.trim();
          E[envName] = trimmed;
          saveEnvKey(envName, trimmed);
          delete cool[k];
        }
      }
      return J(res, 200, {ok: true, providers: buildProviders()});
    }
    if (p === '/api/ai-catalog' && m === 'GET') {
      const fetchJson = async (url, headers = {}) => {
        const r = await fetch(url, {headers, signal: AbortSignal.timeout(20000)});
        if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 120));
        return r.json();
      };
      const out = {};
      const add = (id, name, models, source) => {
        out[id] = {name, source, models: models.filter(Boolean).slice(0, 100)};
      };
      const modelItem = (id, billingLabel, source, pricing) => ({id, billingLabel, source, pricing});
      const tasks = [];
      if (E.OPENAI_API_KEY) tasks.push(fetchJson('https://api.openai.com/v1/models', {authorization: 'Bearer ' + E.OPENAI_API_KEY}).then(j => add('openai','ChatGPT',(j.data || []).map(x => modelItem(x.id,'Trả phí / theo tài khoản','OpenAI API')), 'OpenAI API')).catch(e => add('openai','ChatGPT',[modelItem(getModel('openai'),'Không xác định','OpenAI API')],'OpenAI API')));
      if (E.ANTHROPIC_API_KEY) tasks.push(fetchJson('https://api.anthropic.com/v1/models', {'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01'}).then(j => add('claude','Claude',(j.data || []).map(x => modelItem(x.id,'Trả phí / theo tài khoản','Anthropic API')),'Anthropic API')).catch(e => add('claude','Claude',[modelItem(getModel('claude'),'Không xác định','Anthropic API')],'Anthropic API')));
      if (E.GEMINI_API_KEY) tasks.push(fetchJson('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(E.GEMINI_API_KEY)).then(j => add('gemini','Gemini',(j.models || []).filter(x => (x.supportedGenerationMethods || []).includes('generateContent')).map(x => modelItem(x.name.replace(/^models\//,''),'Có thể có quota miễn phí / theo tài khoản','Gemini API')),'Gemini API')).catch(e => add('gemini','Gemini',[modelItem(getModel('gemini'),'Không xác định','Gemini API')],'Gemini API')));
      if (E.OPENROUTER_API_KEY) tasks.push(fetchJson('https://openrouter.ai/api/v1/models', {authorization:'Bearer '+E.OPENROUTER_API_KEY}).then(j => add('openrouter','OpenRouter',(j.data || []).map(x => { const free = Number(x.pricing?.prompt || 0) === 0 && Number(x.pricing?.completion || 0) === 0; return modelItem(x.id, free ? 'Miễn phí' : 'Trả phí','OpenRouter',x.pricing); }),'OpenRouter API')).catch(e => add('openrouter','OpenRouter',[modelItem(getModel('openrouter'),'Không xác định','OpenRouter API')],'OpenRouter API')));
      if (E.GROQ_API_KEY) tasks.push(fetchJson('https://api.groq.com/openai/v1/models', {authorization:'Bearer '+E.GROQ_API_KEY}).then(j => add('groq','Groq',(j.data || []).map(x => modelItem(x.id,'Theo gói/quota Groq','Groq API')),'Groq API')).catch(e => add('groq','Groq',[modelItem(getModel('groq'),'Không xác định','Groq API')],'Groq API')));
      add('router9','9Router (local)',getModel('router9')?[modelItem(getModel('router9'),'Local / theo proxy','9Router')]:[],'9Router');
      await Promise.all(tasks);
      return J(res, 200, {updatedAt: Date.now(), providers: out});
    }
    if (p === '/api/test-email' && m === 'POST') { await mail('Email thử', 'Email thử từ AI Tech Office. Cấu hình gửi thư hoạt động.'); return J(res, 200, {ok: true}); }
    if (p === '/api/jobs' && m === 'GET') return J(res, 200, JOBS.map(view).reverse());
    if (p === '/api/jobs' && m === 'POST') {
      const q = String((await body(req)).req || '').trim().slice(0, 300);
      if (!q) return J(res, 400, {error: 'Thiếu nội dung yêu cầu'});
      const j = {id: Date.now(), key: crypto.randomUUID(), req: q, status: 'queued', step: 0, out: [], events: [], tokens: 0};
      JOBS.push(j); saveJ(); setImmediate(tick); return J(res, 200, view(j));
    }
    const mm = p.match(/^\/api\/jobs\/(\d+)(?:\/(output|resume))?$/);
    if (mm) {
      const j = JOBS.find(x => String(x.id) === mm[1]);
      if (!j) return J(res, 404, {error: 'not found'});
      if (mm[2] === 'output') {
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'sandbox allow-scripts'});
        return res.end(j.out[5] || '<p>Chưa có kết quả.</p>');
      }
      if (mm[2] === 'resume' && m === 'POST' && j.status !== 'done' && j.status !== 'running') {
        Object.keys(cool).forEach(k => delete cool[k]); j.status = 'queued'; saveJ(); setImmediate(tick);
      }
      return J(res, 200, view(j));
    }
    if (p === '/api/approve' && m === 'POST') {
      const b = await body(req), pr = ST.providers.find(x => x.id === b.providerId), j = JOBS.find(x => x.id === +b.jobId);
      if (!pr) return J(res, 400, {error: 'provider không hợp lệ'});
      if (b.decision === 'allow') { pr.mode = 'auto'; saveST(); }
      else if (b.decision === 'deny') { pr.mode = 'deny'; saveST(); }
      else if (j) { j.once = {...j.once, [pr.id]: true}; saveJ(); }
      setImmediate(tick); return J(res, 200, {ok: true});
    }
    const f = path.join(PUB, p === '/' ? 'index.html' : p);
    if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'content-type': MIME[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  } catch (e) { J(res, 500, {error: String(e.message || e)}); }
}).listen(PORT, () => {
  console.log('AI Tech Office chạy tại http://localhost:' + PORT);
  if (!E.ADMIN_TOKEN) console.warn('CẢNH BÁO: chưa đặt ADMIN_TOKEN, không nên mở ra Internet.');
});
