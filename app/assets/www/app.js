/* =====================================================================
   J.A.R.V.I.S. MOBILE · app.js
   Android WebView + Gemini + native voice bridge.
   ===================================================================== */
'use strict';

/* ----------------------------------------------------------------- utils */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const LS = {
  settings: 'jv.settings',
  memory: 'jv.memory',
  history: 'jv.history',
  // Last model that answered successfully. Trying it first avoids a wasted
  // round trip when the newest model is unavailable on the user's key.
  goodModel: 'jv.goodModel'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function nowLabel() {
  try {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}
function stripMarkdown(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const URDU_WORDS = new Set(('kya kyaa kaise kese kholo khol karo kro kar batao bata mujhe mujhay mera meri ' +
  'mere hai hain haan nahi nahin yaar bhai bhaiya aap tum tumhe tumhen apna apni theek acha achha ' +
  'kahan kidhar kyun kyon kaun koi kuch sab abhi jaldi chalao band likho banao bana do de dein ' +
  'raha rahi rahe gaya gayi gaye ho hoon hun aur phir matlab waqt tarikh aaj kal').split(/\s+/));

const STRONG_URDU = new Set(('kholo khol karo kro batao bata mujhe mujhay mera meri mere hai hain haan ' +
  'nahi nahin yaar bhai bhaiya aap tum apna apni theek acha achha kahan kidhar kyun kyon kaun kuch ' +
  'abhi jaldi chalao band likho banao bana dein raha rahi rahe gaya gayi gaye ho hoon hun aur phir ' +
  'matlab waqt tarikh aaj kal suno bolo bol dikhao lagao laga').split(/\s+/));

function detectLang(text) {
  const low = String(text || '').toLowerCase();
  if (/[\u0600-\u06FF]/.test(low)) return 'ur';
  const words = low.split(/[^a-z]+/).filter(Boolean);
  let hits = 0;
  let strong = 0;
  for (const w of words) {
    if (URDU_WORDS.has(w)) hits++;
    if (STRONG_URDU.has(w)) strong++;
  }
  // Short commands: even one clear Roman-Urdu word is enough ("jarvis brave kholo").
  if (strong >= 1 && words.length <= 7) return 'ur';
  return hits >= 2 ? 'ur' : 'en';
}

/* --------------------------------------------------------- native bridge */
const hasNative = typeof window.Android !== 'undefined';
const Native = window.Android || {
  hasApiKey: () => !!localStorage.getItem('jv.key'),
  getKeyMask: () => (localStorage.getItem('jv.key') || '').slice(0, 6) + '••••',
  setApiKey: (k) => { localStorage.setItem('jv.key', k); return true; },
  clearApiKey: () => localStorage.removeItem('jv.key'),
  getVoicePrefs: () => JSON.stringify({ gender: 'male', rate: 0.97, voice_name: '' }),
  setVoicePrefs: () => { },
  getVoices: () => '[]',
  hasUrduVoice: () => false,
  speak: (roman, urdu) => {
    try {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(roman || urdu || '');
        u.lang = 'en-IN';
        u.pitch = 0.8;
        u.onend = () => window.jarvisNative.onTtsDone();
        speechSynthesis.speak(u);
        return;
      }
    } catch (e) { }
    setTimeout(() => window.jarvisNative.onTtsDone(), 1400);
  },
  stopSpeaking: () => { try { speechSynthesis.cancel(); } catch (e) { } },
  startListening: () => 'unsupported',
  stopListening: () => { },
  cancelListening: () => { },
  isListening: () => false,
  canListen: () => false,
  hasPermission: () => false,
  requestMicPermission: () => { },
  requestCameraPermission: () => { },
  hasNotificationAccess: () => false,
  openNotificationAccess: () => { },
  getGmailNotifications: () => '[]',
  clearGmailNotifications: () => { },
  httpGemini: (id, model, payload) => {
    const key = localStorage.getItem('jv.key') || '';
    fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: payload
    }).then(async r => window.__jarvisHttp(id, r.status, await r.text()))
      .catch(e => window.__jarvisHttp(id, 0, JSON.stringify({ error: { message: String(e), status: 'TRANSPORT' } })));
  },
  executeTool: () => JSON.stringify({ ok: false, message: 'Native tools available nahi hain.' }),
  getStatus: () => JSON.stringify({ ok: true, data: { online: navigator.onLine, battery: -1, network: 'unknown' } }),
  version: () => '2.1.0-web',
  deviceSummary: () => 'Browser',
  toast: (m) => window.jarvisToast && window.jarvisToast(m),
  vibrate: () => { },
  keepAwake: () => { },
  finishApp: () => { },
  copyText: (t) => { try { navigator.clipboard.writeText(t); } catch (e) { } },
  log: (m) => console.log('[Native]', m),
  openTtsSettings: () => { },
  setNeuralPrefs: () => { },
  getNeuralPrefs: () => JSON.stringify({ enabled: true, voice: 'Charon' }),
  setAlwaysOn: () => { },
  isAlwaysOn: () => false,
  setAutoListen: () => { },
  setMicMuted: () => { },
  holdListening: () => { },
  isHoldingMic: () => false,
  openServiceSettings: () => { },
  warmVoice: () => { },
  hasAutomation: () => false,
  openAutomationSettings: () => { },
  startInstall: (id, name) => {
    setTimeout(() => window.jarvisAutomationDone && window.jarvisAutomationDone(id,
      JSON.stringify({ ok: false, message: 'Automation available nahi hai.', needs_user_action: true })), 50);
  },
  uiClick: () => false,
  uiClickId: () => false,
  uiDump: () => '',
  uiType: () => false,
  systemAction: () => false,
  openUrl: (u) => { try { window.open(u, '_blank'); } catch (e) { } }
};

/* -------------------------------------------------------------- constants */
const DEFAULTS = {
  model: 'fast',
  langMode: 'both',
  voiceGender: 'male',
  voiceLocked: true,
  rate: 0.97,
  voiceName: '',
  neuralVoice: true,
  neuralVoiceName: 'Charon',
  handsFree: true,
  alwaysOn: true,
  wakeRequired: true,
  onboarded: false
};

// Stronger models by default: the old lite-first list made answers shallow.
const FAST_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const SMART_MODELS = ['gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview'];

// Tools whose result message is already the final spoken answer. Directly
// returning it in Fast mode removes a whole extra Gemini round trip for simple
// commands like "light on karo" or "timer lagao".
const FAST_TERMINAL_TOOLS = new Set([
  'open_url', 'youtube_search', 'youtube_channel', 'send_whatsapp', 'send_sms',
  'call_number', 'compose_email', 'set_alarm', 'set_timer', 'navigate',
  'set_volume', 'torch', 'share_text', 'open_play_store', 'install_app',
  'smart_home', 'smart_scene', 'smart_home_setup', 'smart_home_help',
  'news_brief', 'remember', 'device_status'
]);
// Opening an app can be the first step of a longer automation ("Instagram
// kholo aur story post karo"), so these only get the shortcut for a short,
// single-intent request.
const FAST_SIMPLE_OPEN_TOOLS = new Set([
  'open_app', 'open_gmail', 'open_inbox', 'open_settings'
]);

function isFastMode() {
  return settings.model !== 'smart';
}

/** Gemini 3 uses thinkingLevel, Gemini 2.5 uses a thinkingBudget. */
function thinkingConfigFor(model) {
  if (/gemini-3/i.test(model)) return { thinkingLevel: 'low' };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return null;
}

function isSimpleActionText(text) {
  const low = String(text || '').toLowerCase().trim();
  if (!low || low.length > 90) return false;
  // Follow-up words mean the model may need another round (e.g. "Instagram
  // kholo aur story post karo"), so never shortcut those.
  if (/(\b(?:aur|phir|then|after|baad|bad|uske|next|step|also|plus|and)\b|[&+]|\u06a9\u06d2 \u0628\u0639\u062f|\u0627\u0648\u0631)/.test(low)) return false;
  // Two or more distinct action verbs usually means a multi-step command.
  const acts = low.match(/\b(?:kholo|khol|chalao|bajao|bhejo|likho|karo|kar|lagao|set|open|play|send|call|install|band)\b/g);
  return !acts || acts.length <= 2;
}

function directToolReply(results, simpleRequest) {
  if (!isFastMode() || settings.langMode === 'en' || settings.langMode === 'ur' || !simpleRequest) return '';
  // Only shortcut a single, already-complete tool call. Multiple calls may be
  // part of a longer chain, so the model gets to summarise those.
  if (results.length !== 1) return '';
  const item = results[0];
  if (!FAST_TERMINAL_TOOLS.has(item.name) &&
      !FAST_SIMPLE_OPEN_TOOLS.has(item.name)) return '';
  if (!item.result || item.result.ok !== true) return '';
  const text = String(item.result.message || '').trim();
  return text.length > 900 ? '' : text;
}

// Fresh install: no personal facts are pre-loaded. Jarvis learns only what
// the user chooses to tell it, and everything stays on the phone.
const SEED_FACTS = [];

const LINES = {
  welcome: {
    roman: 'Jarvis online hai, sir. Boliye kya karna hai?',
    urdu: 'جاروس آن لائن ہے، سر۔ بتائیے کیا کرنا ہے؟'
  },
  yesSir: { roman: 'Ji sir?', urdu: 'جی سر؟' },
  stopped: { roman: 'Theek hai sir, ruk gaya.', urdu: 'ٹھیک ہے سر، رک گیا۔' },
  micOk: {
    roman: 'Mic theek kaam kar raha hai, sir.',
    urdu: 'مائیک ٹھیک کام کر رہا ہے، سر۔'
  },
  voiceLocked: {
    roman: "Sir, voice lock on hai. Pehle 'unlock voice' bolein ya settings mein Unlock dabaiye.",
    urdu: 'سر، وائس لاک آن ہے۔ پہلے اَن لاک وائس بولیں یا سیٹنگز میں اَن لاک دبائیں۔'
  },
  male: { roman: 'Ji sir, male voice set hai.', urdu: 'جی سر، میل وائس سیٹ ہے۔' },
  female: { roman: 'Ji sir, female voice set hai.', urdu: 'جی سر، فیمیل وائس سیٹ ہے۔' },
  voiceUnlocked: {
    roman: 'Voice lock off. Ab aap male ya female voice chun sakte hain.',
    urdu: 'وائس لاک آف۔ اب آپ میل یا فیمیل وائس چن سکتے ہیں۔'
  },
  voiceLockedOn: {
    roman: 'Voice lock on. Awaaz wahi rahegi jo abhi hai.',
    urdu: 'وائس لاک آن۔ آواز وہی رہے گی جو ابھی ہے۔'
  },
  enMode: { roman: 'English mode on.', urdu: 'انگلش موڈ آن۔' },
  urMode: { roman: 'Roman Urdu mode on.', urdu: 'رومن اردو موڈ آن۔' },
  bothMode: { roman: 'Both languages mode on.', urdu: 'دونوں زبانوں کا موڈ آن۔' },
  memoryCleared: { roman: 'Memory saaf kar di, sir.', urdu: 'میموری صاف کر دی، سر۔' },
  help: {
    roman: 'Aap bol sakte hain: app kholo, YouTube ya Gmail kholo, WhatsApp message, alarm, timer, flashlight, volume, ghar ki light ya AC, movie mode, news sunao, ya koi bhi sawal. Settings mein voice, inbox aur smart home control hai.',
    urdu: 'آپ بول سکتے ہیں: ایپ کھولو، یوٹیوب یا جیمیل کھولو، واٹس ایپ میسج، الارم، ٹائمر، فلیش لائٹ، والیوم، گھر کی لائٹ یا اے سی، مووی موڈ، نیوز سناؤ، یا کوئی بھی سوال۔ سیٹنگز میں وائس، ان باکس اور سمارٹ ہوم کنٹرول ہے۔'
  },
  bye: { roman: 'Theek hai sir, app band kar raha hoon.', urdu: 'ٹھیک ہے سر، ایپ بند کر رہا ہوں۔' },
  keyMissing: {
    roman: 'Sir, API key set nahi hai. Settings khol kar Gemini key daal dein.',
    urdu: 'سر، اے پی آئی کی سیٹ نہیں ہے۔ سیٹنگز کھول کر جیمنی کی ڈال دیں۔'
  },
  keyBad: {
    roman: 'Sir, Gemini API key theek nahi hai. Settings mein key check kijiye.',
    urdu: 'سر، جیمنی اے پی آئی کی ٹھیک نہیں ہے۔ سیٹنگز میں کی چیک کیجیے۔'
  },
  quota: {
    roman: 'Sir, Gemini ki limit khatam ho gayi hai. Thori der baad koshish kijiye.',
    urdu: 'سر، جیمنی کی لمٹ ختم ہو گئی ہے۔ تھوڑی دیر بعد کوشش کیجیے۔'
  },
  server: {
    roman: 'Sir, Gemini ka server abhi slow hai, is liye jawab nahi aaya. Dobara bolein.',
    urdu: 'سر، جیمنی کا سرور ابھی سست ہے، اس لیے جواب نہیں آیا۔ دوبارہ بولیں۔'
  },
  network: {
    roman: 'Sir, internet connection nahi mil raha. Wi-Fi ya mobile data check kijiye.',
    urdu: 'سر، انٹرنیٹ کنکشن نہیں مل رہا۔ وائی فائی یا موبائل ڈیٹا چیک کیجیے۔'
  },
  generic: {
    roman: 'Sir, ek masla aa gaya. Dobara bolein.',
    urdu: 'سر، ایک مسئلہ آ گیا۔ دوبارہ بولیں۔'
  },
  noSpeech: {
    roman: 'Sir, kuch samajh nahi aaya. Dobara bolein.',
    urdu: 'سر، کچھ سمجھ نہیں آیا۔ دوبارہ بولیں۔'
  }
};

/* ------------------------------------------------------------------ state */
const saved = loadJSON(LS.settings, {});
let settings = Object.assign({}, DEFAULTS, saved);
settings.rate = clamp(Number(settings.rate) || 0.97, 0.7, 1.3);

/* ------------------------------------------------------------ memory 2.0 */
/* Structured long-term memory: categorised facts, pins, a rolling note about
   earlier conversations, and query-aware recall. Everything stays on the
   phone. The old flat string list is migrated automatically. */
const MEM_CATEGORIES = ['identity', 'preference', 'project', 'goal', 'routine', 'health', 'people', 'work', 'general'];
const MEM_LABELS = {
  identity: 'About you', preference: 'Preferences', project: 'Projects', goal: 'Goals',
  routine: 'Routine', health: 'Health', people: 'People', work: 'Work / Study', general: 'Other'
};
const MEM_STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'are', 'was', 'were', 'with', 'this', 'that', 'have', 'has', 'had',
  'what', 'when', 'where', 'who', 'why', 'how', 'did', 'does', 'about', 'remember', 'please', 'tell', 'say',
  'kya', 'kia', 'hai', 'hain', 'tha', 'thi', 'aur', 'mera', 'meri', 'mere', 'mujhe', 'main', 'mein', 'mai',
  'ka', 'ki', 'ke', 'ko', 'se', 'par', 'per', 'bhi', 'hi', 'na', 'nahi', 'koi', 'kuch', 'yaad', 'batao', 'bata',
  'aap', 'tum', 'tumhe', 'apna', 'apni', 'liye', 'raha', 'rahi', 'hoga', 'hua', 'kar', 'karo', 'mera'
]);

function memClean(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 400);
}
function memKey(text) {
  return memClean(text).toLowerCase().replace(/[^\w\s\u0600-\u06FF]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function memTokens(text) {
  const out = new Set();
  String(text || '').toLowerCase().replace(/[^\w\s\u0600-\u06FF]+/g, ' ').split(/\s+/).forEach(w => {
    if (w.length >= 3 && !MEM_STOP.has(w)) out.add(w);
  });
  return out;
}
function memCategoryFor(text) {
  const t = ' ' + memClean(text).toLowerCase() + ' ';
  if (/\b(mera naam|my name|naam hai|birthday|salary|age|umar|city|shehar|rehta|rehti|live in|born)\b/.test(t)) return 'identity';
  if (/\b(pasand|like|love|favourite|favorite|prefer|dislike|nafrat|chai|coffee|food|khana|music|song)\b/.test(t)) return 'preference';
  if (/\b(project|startup|business|app|website|client|code|build|bana raha|bana rahi)\b/.test(t)) return 'project';
  if (/\b(goal|target|plan|future|chahta|chahti|want to|seekhna|learn)\b/.test(t)) return 'goal';
  if (/\b(routine|roz|daily|every day|habit|schedule|subah|morning|raat)\b/.test(t)) return 'routine';
  if (/\b(health|dawai|medicine|doctor|gym|sleep|weight|bimari)\b/.test(t)) return 'health';
  if (/\b(dost|friend|boss|teacher|ustad|wife|husband|family|bhai|behen)\b/.test(t)) return 'people';
  if (/\b(job|office|school|college|university|exam|class|kaam)\b/.test(t)) return 'work';
  return 'general';
}
function memNewId() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function memNormalizeFact(f, index) {
  if (typeof f === 'string') {
    const text = memClean(f);
    if (!text) return null;
    return {
      id: 'legacy' + index, text, category: memCategoryFor(text), importance: 3,
      pinned: false, created: Date.now(), updated: Date.now(), hits: 0
    };
  }
  if (!f || typeof f !== 'object') return null;
  const text = memClean(f.text || f.fact || f.value || '');
  if (!text) return null;
  return {
    id: String(f.id || memNewId()),
    text,
    category: MEM_CATEGORIES.indexOf(f.category) >= 0 ? f.category : memCategoryFor(text),
    importance: clamp(Number(f.importance) || 3, 1, 5),
    pinned: !!f.pinned,
    created: Number(f.created) || Date.now(),
    updated: Number(f.updated || f.created) || Date.now(),
    hits: Math.max(0, Number(f.hits) || 0)
  };
}
function normalizeMemory(raw) {
  const out = { version: 2, facts: [], episodes: [], profile: {}, thread: '', threadAt: 0 };
  if (raw && typeof raw === 'object') {
    (Array.isArray(raw.facts) ? raw.facts : []).forEach((f, i) => {
      const n = memNormalizeFact(f, i);
      if (n) out.facts.push(n);
    });
    (Array.isArray(raw.episodes) ? raw.episodes : []).forEach(e => {
      if (typeof e === 'string') {
        const text = memClean(e);
        if (text) out.episodes.push({ text, t: Date.now() });
      } else if (e && typeof e === 'object') {
        const text = memClean(e.text || e.summary || '');
        if (text) out.episodes.push({ text, t: Number(e.t) || Date.now() });
      }
    });
    if (raw.profile && typeof raw.profile === 'object') {
      Object.keys(raw.profile).forEach(k => { out.profile[k] = memClean(raw.profile[k]); });
    }
    out.thread = memClean(raw.thread || '').slice(-600);
    out.threadAt = Number(raw.threadAt) || 0;
  }
  if (!out.facts.length && Array.isArray(SEED_FACTS)) {
    SEED_FACTS.forEach((f, i) => {
      const n = memNormalizeFact(f, i);
      if (n) out.facts.push(n);
    });
  }
  return out;
}
function memRememberName(text) {
  const m = String(text || '').match(/\b(?:mera\s+naam|my\s+name\s+is)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF .'-]{1,30}?)\s*(?:hai|is)?[.!]?$/i);
  if (!m) return '';
  const name = m[1].replace(/\s+/g, ' ').trim();
  if (!name || /^(kya|kia|nahi|nai|hai|is|the)$/i.test(name)) return '';
  memory.profile = memory.profile || {};
  memory.profile.name = name;
  memory.facts = memory.facts.filter(f => !(f.category === 'identity' && /^User name is /i.test(f.text)));
  memory.facts.push({
    id: memNewId(), text: 'User name is ' + name + '.', category: 'identity', importance: 5,
    pinned: true, created: Date.now(), updated: Date.now(), hits: 1
  });
  saveJSON(LS.memory, memory);
  return name;
}
function memSave(text, opts) {
  const o = opts || {};
  const clean = memClean(text);
  if (!clean) return { ok: false, already: false, fact: null };
  const key = memKey(clean);
  const existing = memory.facts.find(f => {
    const k = memKey(f.text);
    return k === key || (key.length >= 12 && k.indexOf(key) >= 0) || (k.length >= 12 && key.indexOf(k) >= 0);
  });
  if (existing) {
    existing.updated = Date.now();
    existing.hits = (existing.hits || 0) + 1;
    if (o.pin) existing.pinned = true;
    if (o.importance) existing.importance = clamp(Number(o.importance) || 3, 1, 5);
    saveJSON(LS.memory, memory);
    return { ok: true, already: true, fact: existing };
  }
  const fact = {
    id: memNewId(),
    text: clean,
    category: MEM_CATEGORIES.indexOf(o.category) >= 0 ? o.category : memCategoryFor(clean),
    importance: clamp(Number(o.importance) || 3, 1, 5),
    pinned: !!o.pin,
    created: Date.now(), updated: Date.now(), hits: 0
  };
  memory.facts.push(fact);
  if (memory.facts.length > 200) {
    memory.facts.sort((a, b) => (b.pinned - a.pinned) || (b.importance - a.importance) || ((b.updated || 0) - (a.updated || 0)));
    memory.facts = memory.facts.slice(0, 200);
  }
  saveJSON(LS.memory, memory);
  return { ok: true, already: false, fact };
}
function memMatch(f, qTokens, qKey) {
  const t = memTokens(f.text);
  let overlap = 0;
  qTokens.forEach(w => { if (t.has(w)) overlap++; });
  const exact = qKey.length >= 4 && memKey(f.text).indexOf(qKey) >= 0;
  return { overlap, exact };
}
function memSearch(query, limit) {
  const qTokens = memTokens(query);
  const qKey = memKey(query);
  if (!qKey) return [];
  const out = [];
  for (const f of memory.facts) {
    const m = memMatch(f, qTokens, qKey);
    if (!m.overlap && !m.exact) continue;
    const score = m.overlap * 3 + (m.exact ? 8 : 0) + (Number(f.importance) || 3) * 0.6 + (f.pinned ? 4 : 0);
    out.push({ f, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, limit || 6)).map(x => x.f);
}
function memRemove(query) {
  const qTokens = memTokens(query);
  const qKey = memKey(query);
  if (!qKey) return [];
  const removed = memory.facts.filter(f => {
    if (f.pinned) return false;
    const m = memMatch(f, qTokens, qKey);
    return m.exact || (qTokens.size >= 2 && m.overlap >= 2 && m.overlap / qTokens.size >= 0.8);
  });
  if (!removed.length) return [];
  const ids = new Set(removed.map(f => f.id));
  memory.facts = memory.facts.filter(f => !ids.has(f.id));
  saveJSON(LS.memory, memory);
  return removed;
}
function memPinFact(query, pinned) {
  const hits = memSearch(query, 1);
  if (!hits.length) return null;
  hits[0].pinned = !!pinned;
  hits[0].updated = Date.now();
  saveJSON(LS.memory, memory);
  return hits[0];
}
function memContext(query) {
  const fast = isFastMode();
  const limit = fast ? 10 : 20;
  const chosen = [];
  const seen = new Set();
  const push = f => {
    if (f && !seen.has(f.id) && chosen.length < limit) { seen.add(f.id); chosen.push(f); }
  };
  memory.facts.filter(f => f.pinned)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .slice(0, fast ? 4 : 8).forEach(push);
  memSearch(query, limit).forEach(push);
  if (chosen.length < (fast ? 5 : 10)) {
    memory.facts.slice().sort((a, b) => (b.importance - a.importance) || ((b.updated || 0) - (a.updated || 0))).forEach(push);
  }
  const bits = [];
  if (memory.profile && memory.profile.name) bits.push('User name: ' + memory.profile.name + '.');
  bits.push(chosen.length
    ? chosen.map(f => '- [' + f.category + (f.pinned ? ', pinned' : '') + '] ' + f.text.slice(0, 220)).join('\n')
    : '- (nothing saved yet)');
  if (memory.thread) bits.push('Earlier conversation: ' + memory.thread.slice(-500));
  const eps = (memory.episodes || []).slice(-(fast ? 2 : 4));
  if (eps.length) bits.push('Past sessions: ' + eps.map(e => e.text.slice(0, 180)).join(' | '));
  return bits.join('\n').slice(0, fast ? 2800 : 4600);
}
function memOverview() {
  const facts = memory.facts || [];
  if (!facts.length) {
    return 'Sir, abhi mere paas aap ke baare mein koi memory nahi hai. Aap "yaad rakho ..." bol kar kuch bhi sikha sakte hain.';
  }
  const groups = {};
  facts.forEach(f => { (groups[f.category] = groups[f.category] || []).push(f); });
  const parts = [];
  Object.keys(groups).forEach(cat => {
    const items = groups[cat]
      .sort((a, b) => (b.pinned - a.pinned) || (b.importance - a.importance) || ((b.updated || 0) - (a.updated || 0)))
      .slice(0, 4)
      .map(f => f.text.replace(/^(?:mera|meri|mujhe|my)\s+/i, '').slice(0, 100));
    parts.push((MEM_LABELS[cat] || 'Other') + ': ' + items.join('; '));
  });
  const text = 'Sir, mujhe yeh yaad hai. ' + parts.join('. ') + '.';
  return text.length > 950 ? text.slice(0, 947) + '...' : text;
}
function memRecall(query) {
  const q = memClean(query);
  if (!q) return memOverview();
  const hits = memSearch(q, 6);
  if (!hits.length) return "Sir, '" + q + "' ke baare mein mujhe kuch yaad nahi hai.";
  return 'Sir, ' + q + ' ke baare mein mujhe yeh yaad hai: ' +
    hits.map(f => f.text.slice(0, 160)).join('; ') + '.';
}
function memStats() {
  const pins = (memory.facts || []).filter(f => f.pinned).length;
  return 'Sir, memory mein ' + (memory.facts || []).length + ' baatein hain, ' + pins +
    ' pinned hain, aur ' + (memory.episodes || []).length + ' purani baatein summary mein hain.';
}
function memThreadUpdate() {
  const upto = Number(memory.threadAt) || 0;
  if (history.length - upto < 6) return;
  const users = history.slice(Math.max(0, history.length - 14))
    .filter(h => h.role === 'user' && h.text)
    .map(h => memClean(h.text).slice(0, 90));
  if (!users.length) return;
  memory.thread = ((memory.thread ? memory.thread + ' · ' : '') + users.join(' · ')).slice(-600);
  memory.threadAt = history.length;
  saveJSON(LS.memory, memory);
}

let memory = normalizeMemory(loadJSON(LS.memory, null));
let history = loadJSON(LS.history, []);
if (!Array.isArray(history)) history = [];

let state = 'idle';           // idle | listening | thinking | speaking
let busy = false;
let pushToTalk = true;
let appActive = true;
let torchOn = false;
let speakSafety = null;
let listenTimer = null;
let listenSafety = null;
let micStartPending = false;
let voicesRetry = null;
let toastTimer = null;
let reqSeq = 0;
const pendingRequests = {};

/* ============================================================ SMART HOME */
/* The virtual home works with no setup. Optional Home Assistant mirroring uses
   the native HTTP bridge, so the phone never needs a second API key. */
const SH_LS = { state: 'jv.smarthome', config: 'jv.smarthome.config' };

const SH_DEFAULT_STATE = {
  lights: {
    drawing_room: { on: false, brightness: 100 },
    bedroom: { on: false, brightness: 100 },
    kitchen: { on: false, brightness: 100 },
    bathroom: { on: false, brightness: 100 },
    study: { on: false, brightness: 100 },
    garden: { on: false, brightness: 100 }
  },
  fans: {
    bedroom: { on: false, speed: 2 },
    drawing_room: { on: false, speed: 2 }
  },
  ac: {
    drawing_room: { on: false, temperature: 24 },
    bedroom: { on: false, temperature: 24 }
  },
  tv: {
    drawing_room: { on: false, channel: 1, volume: 20 }
  },
  doors: {
    main: { locked: true },
    back: { locked: true }
  },
  blinds: {
    drawing_room: { state: 'closed' },
    bedroom: { state: 'closed' },
    kitchen: { state: 'closed' }
  },
  coffee: {
    kitchen: { on: false }
  },
  plugs: {
    charger: { on: false },
    iron: { on: false }
  }
};

const SH_TYPE_ORDER = ['lights', 'fans', 'ac', 'tv', 'doors', 'blinds', 'coffee', 'plugs'];
const SH_TYPE_WORDS = {
  lights: ['light', 'lights', 'lamp', 'lamps', 'batti', 'bati', 'roshni', 'chiragh', 'bulb', 'bulbs'],
  fans: ['fan', 'fans', 'pankha', 'pankhe', 'pankhaa'],
  ac: ['ac', 'acs', 'air conditioner', 'air conditioners', 'aircon', 'air conditioning', 'cooler'],
  tv: ['tv', 'television', 'telly', 'screen'],
  doors: ['door', 'doors', 'darwaza', 'darwaze', 'gate', 'gates'],
  blinds: ['blind', 'blinds', 'curtain', 'curtains', 'parda', 'parde', 'shutter', 'shutters'],
  coffee: ['coffee', 'coffee machine', 'coffee maker', 'espresso', 'cappuccino'],
  plugs: ['plug', 'plugs', 'socket', 'sockets', 'charger', 'iron', 'press']
};

const SH_ROOM_LABELS = {
  drawing_room: 'drawing room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  study: 'study',
  garden: 'garden',
  main: 'main',
  back: 'back',
  charger: 'charger',
  iron: 'iron'
};

const SH_ROOM_ALIASES = {
  drawing_room: ['drawing room', 'living room', 'lounge', 'hall', 'drawing', 'baitha kamra', 'bara kamra', 'drawn room'],
  bedroom: ['bedroom', 'bed room', 'bed rooms', 'room', 'kamra', 'kamre', 'sleeping room'],
  kitchen: ['kitchen', 'rasoi', 'kitchen room', 'cook room'],
  bathroom: ['bathroom', 'bath room', 'washroom', 'ghusal khana', 'toilet'],
  study: ['study', 'study room', 'office', 'library'],
  garden: ['garden', 'lawn', 'yard', 'bagh', 'bahar'],
  main: ['main door', 'front door', 'main gate', 'front gate', 'darwaza', 'gate', 'front'],
  back: ['back door', 'back gate', 'pichla darwaza', 'back'],
  charger: ['charger', 'phone charger', 'mobile charger'],
  iron: ['iron', 'press', 'iron plug']
};

const SH_ALL_WORDS = ['all', 'sab', 'sare', 'saari', 'sabhi', 'sab kuch', 'poore ghar', 'pura ghar'];

const SH_SCENES = {
  morning: [
    ['lights', 'bedroom', { on: true, brightness: 40 }],
    ['lights', 'kitchen', { on: true, brightness: 80 }],
    ['lights', 'drawing_room', { on: false }],
    ['lights', 'bathroom', { on: true, brightness: 60 }],
    ['blinds', 'bedroom', { state: 'open' }],
    ['blinds', 'kitchen', { state: 'open' }],
    ['coffee', 'kitchen', { on: true }],
    ['tv', 'drawing_room', { on: false }]
  ],
  movie: [
    ['lights', 'drawing_room', { on: true, brightness: 20 }],
    ['lights', 'bedroom', { on: false }],
    ['lights', 'kitchen', { on: false }],
    ['lights', 'bathroom', { on: false }],
    ['lights', 'study', { on: false }],
    ['lights', 'garden', { on: false }],
    ['tv', 'drawing_room', { on: true, volume: 35 }],
    ['blinds', 'drawing_room', { state: 'closed' }],
    ['ac', 'drawing_room', { on: true, temperature: 24 }],
    ['doors', 'main', { locked: true }],
    ['doors', 'back', { locked: true }],
    ['coffee', 'kitchen', { on: false }]
  ],
  sleep: [
    ['lights', 'drawing_room', { on: false }],
    ['lights', 'bedroom', { on: false }],
    ['lights', 'kitchen', { on: false }],
    ['lights', 'bathroom', { on: false }],
    ['lights', 'study', { on: false }],
    ['lights', 'garden', { on: false }],
    ['tv', 'drawing_room', { on: false }],
    ['fans', 'bedroom', { on: true, speed: 2 }],
    ['ac', 'bedroom', { on: true, temperature: 25 }],
    ['ac', 'drawing_room', { on: false }],
    ['blinds', 'drawing_room', { state: 'closed' }],
    ['blinds', 'bedroom', { state: 'closed' }],
    ['blinds', 'kitchen', { state: 'closed' }],
    ['doors', 'main', { locked: true }],
    ['doors', 'back', { locked: true }],
    ['coffee', 'kitchen', { on: false }],
    ['plugs', 'iron', { on: false }]
  ],
  guest: [
    ['lights', 'drawing_room', { on: true, brightness: 80 }],
    ['lights', 'kitchen', { on: true, brightness: 90 }],
    ['ac', 'drawing_room', { on: true, temperature: 22 }],
    ['blinds', 'drawing_room', { state: 'open' }],
    ['blinds', 'bedroom', { state: 'open' }],
    ['blinds', 'kitchen', { state: 'open' }],
    ['doors', 'main', { locked: false }],
    ['tv', 'drawing_room', { on: true, volume: 25 }],
    ['coffee', 'kitchen', { on: true }]
  ],
  work: [
    ['lights', 'study', { on: true, brightness: 90 }],
    ['lights', 'drawing_room', { on: false }],
    ['lights', 'bedroom', { on: false }],
    ['tv', 'drawing_room', { on: false }],
    ['ac', 'drawing_room', { on: true, temperature: 24 }],
    ['coffee', 'kitchen', { on: true }],
    ['doors', 'main', { locked: true }]
  ],
  away: [
    ['lights', 'drawing_room', { on: false }],
    ['lights', 'bedroom', { on: false }],
    ['lights', 'kitchen', { on: false }],
    ['lights', 'bathroom', { on: false }],
    ['lights', 'study', { on: false }],
    ['lights', 'garden', { on: false }],
    ['fans', 'bedroom', { on: false }],
    ['fans', 'drawing_room', { on: false }],
    ['ac', 'drawing_room', { on: false }],
    ['ac', 'bedroom', { on: false }],
    ['tv', 'drawing_room', { on: false }],
    ['coffee', 'kitchen', { on: false }],
    ['plugs', 'charger', { on: false }],
    ['plugs', 'iron', { on: false }],
    ['blinds', 'drawing_room', { state: 'closed' }],
    ['blinds', 'bedroom', { state: 'closed' }],
    ['blinds', 'kitchen', { state: 'closed' }],
    ['doors', 'main', { locked: true }],
    ['doors', 'back', { locked: true }]
  ],
  party: [
    ['lights', 'drawing_room', { on: true, brightness: 100 }],
    ['lights', 'kitchen', { on: true, brightness: 100 }],
    ['lights', 'garden', { on: true, brightness: 100 }],
    ['tv', 'drawing_room', { on: true, volume: 55 }],
    ['blinds', 'drawing_room', { state: 'open' }],
    ['ac', 'drawing_room', { on: true, temperature: 22 }],
    ['doors', 'main', { locked: true }],
    ['coffee', 'kitchen', { on: false }]
  ]
};

const SH_SCENE_ALIASES = {
  morning: ['morning', 'good morning', 'subah', 'seher'],
  movie: ['movie', 'film', 'cinema', 'movie mode', 'picture'],
  sleep: ['sleep', 'sleep mode', 'night', 'good night', 'raat', 'sona', 'so jao'],
  guest: ['guest', 'guest mode', 'mehman', 'mehmaan', 'guests'],
  work: ['work', 'work mode', 'office', 'kaam', 'study mode'],
  away: ['away', 'away mode', 'bahar', 'leave', 'lock down', 'lockdown', 'bahar ja raha'],
  party: ['party', 'party mode', 'mehfil', 'dawat', 'celebration']
};

const SH_HA_DOMAIN = {
  lights: 'light', fans: 'fan', ac: 'climate', tv: 'media_player',
  doors: 'lock', blinds: 'cover', coffee: 'switch', plugs: 'switch'
};

function shEscape(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shHasWord(text, word) {
  try { return new RegExp('\\b' + shEscape(word) + '\\b').test(text); }
  catch (e) { return String(text).indexOf(word) !== -1; }
}

function shNorm(text) {
  return String(text == null ? '' : text).toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const m = String(value).match(/-?\d+/);
  if (!m) return fallback;
  const n = parseInt(m[0], 10);
  return isNaN(n) ? fallback : n;
}

function shClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function shDeepMerge(base, data) {
  const out = {};
  const src = data && typeof data === 'object' ? data : {};
  Object.keys(base).forEach(key => {
    const value = base[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const child = src[key] && typeof src[key] === 'object' ? src[key] : {};
      out[key] = shDeepMerge(value, child);
    } else {
      out[key] = Object.prototype.hasOwnProperty.call(src, key) ? src[key] : value;
    }
  });
  Object.keys(src).forEach(key => { if (!(key in out)) out[key] = src[key]; });
  return out;
}

function shLoadState() {
  const data = loadJSON(SH_LS.state, {});
  return shDeepMerge(SH_DEFAULT_STATE, data);
}

function shSaveState(state) {
  saveJSON(SH_LS.state, state);
}

function shLoadConfig() {
  const data = loadJSON(SH_LS.config, {});
  const cfg = Object.assign({ enabled: false, url: '', token: '', entities: {} }, data || {});
  if (!cfg.entities || typeof cfg.entities !== 'object') cfg.entities = {};
  return cfg;
}

function shSaveConfig(cfg) {
  saveJSON(SH_LS.config, cfg);
}

function shAvailable(state, dtype) {
  const devices = state[dtype] || {};
  return Object.keys(devices).filter(id => devices[id] && typeof devices[id] === 'object');
}

function shSingular(dtype) {
  return {
    lights: 'light', fans: 'fan', ac: 'AC', tv: 'TV', doors: 'door',
    blinds: 'blinds', coffee: 'coffee machine', plugs: 'plug'
  }[dtype] || dtype;
}

function shLabel(dtype, id) {
  const room = SH_ROOM_LABELS[id] || String(id).replace(/_/g, ' ');
  if (dtype === 'tv') return 'TV';
  if (dtype === 'coffee') return 'coffee machine';
  if (dtype === 'doors') return room + ' door';
  if (dtype === 'plugs') return room + ' plug';
  if (dtype === 'blinds') return room + ' blinds';
  return room + ' ' + shSingular(dtype);
}

function shDeviceMenu() {
  return 'Devices: drawing room, bedroom, kitchen, bathroom, study and garden lights; ' +
    'bedroom and drawing room fans and ACs; TV; main and back doors; ' +
    'drawing room, bedroom and kitchen blinds; coffee machine; charger and iron plugs.';
}

function shStatusLine(dtype, id, data) {
  const label = shLabel(dtype, id);
  if (dtype === 'lights') {
    return data.on ? label + ' on ' + shInt(data.brightness, 100) + '%' : label + ' off';
  }
  if (dtype === 'fans') {
    return data.on ? label + ' on speed ' + shInt(data.speed, 2) : label + ' off';
  }
  if (dtype === 'ac') {
    return data.on ? label + ' on ' + shInt(data.temperature, 24) + 'C' : label + ' off';
  }
  if (dtype === 'tv') {
    return data.on
      ? 'TV on, channel ' + shInt(data.channel, 1) + ', volume ' + shInt(data.volume, 20) + '%'
      : 'TV off';
  }
  if (dtype === 'doors') return label + (data.locked ? ' locked' : ' unlocked');
  if (dtype === 'blinds') return label + ' ' + (data.state || 'closed');
  return label + (data.on ? ' on' : ' off');
}

function shTypesIn(text) {
  const found = [];
  SH_TYPE_ORDER.forEach(dtype => {
    if (SH_TYPE_WORDS[dtype].some(word => shHasWord(text, word))) found.push(dtype);
  });
  return found;
}

function shRoomsIn(text) {
  const pairs = [];
  Object.keys(SH_ROOM_ALIASES).forEach(id => {
    SH_ROOM_ALIASES[id].forEach(alias => pairs.push([alias.length, id, alias]));
  });
  pairs.sort((a, b) => b[0] - a[0]);
  const found = [];
  const used = {};
  let remaining = ' ' + text + ' ';
  pairs.forEach(pair => {
    const id = pair[1];
    const alias = pair[2];
    if (used[id]) return;
    if (shHasWord(remaining, alias)) {
      found.push(id);
      used[id] = true;
      remaining = remaining.replace(new RegExp('\\b' + shEscape(alias) + '\\b', 'g'), ' ');
    }
  });
  return found;
}

function shAllRequested(text) {
  return SH_ALL_WORDS.some(word => shHasWord(text, word));
}

function shResolveTargets(text, action) {
  const state = shLoadState();
  let types = shTypesIn(text);
  let rooms = shRoomsIn(text).filter(id => SH_ROOM_LABELS[id]);
  const wantAll = shAllRequested(text) || ['', 'ghar', 'home', 'house'].indexOf(String(text).trim()) !== -1;

  if (!types.length && wantAll) {
    if (action === 'lock' || action === 'unlock') types = ['doors'];
    else if (action === 'open' || action === 'close') types = ['blinds'];
    else if (action === 'brightness' || action === 'dim') types = ['lights'];
    else if (action === 'temperature' || action === 'temp') types = ['ac'];
    else if (action === 'volume') types = ['tv'];
    else if (action === 'speed') types = ['fans'];
    else types = ['lights', 'fans', 'ac', 'tv', 'coffee', 'plugs'];
    rooms = [];
  }

  if (!types.length) {
    if (rooms.length) {
      const room = rooms[0];
      const options = SH_TYPE_ORDER.filter(t => state[t] && state[t][room]);
      return 'Which device in the ' + (SH_ROOM_LABELS[room] || room) + '? ' +
        options.map(shSingular).join(', ') + '.';
    }
    return 'I could not find that device. ' + shDeviceMenu();
  }

  const targets = [];
  for (const dtype of types) {
    const ids = shAvailable(state, dtype);
    let chosen = [];
    if (dtype === 'tv') chosen = ['drawing_room'];
    else if (dtype === 'coffee') chosen = ['kitchen'];
    else if (dtype === 'doors' || dtype === 'plugs') {
      chosen = rooms.filter(id => ids.indexOf(id) !== -1);
      if (!chosen.length) chosen = (wantAll || !rooms.length) ? ids.slice() : [];
    } else {
      chosen = rooms.filter(id => ids.indexOf(id) !== -1);
    }
    if (wantAll || (!rooms.length && (dtype === 'tv' || dtype === 'coffee'))) {
      chosen = ids.slice();
    } else if (!chosen.length && !rooms.length) {
      if (ids.length === 1) chosen = ids.slice();
      else return 'Which ' + shSingular(dtype) + '? ' +
        ids.map(id => SH_ROOM_LABELS[id] || id).join(', ') + '.';
    }
    chosen.forEach(id => targets.push([dtype, id, shLabel(dtype, id)]));
  }

  const seen = {};
  const unique = [];
  targets.forEach(item => {
    const key = item[0] + '.' + item[1];
    if (!seen[key]) { seen[key] = true; unique.push(item); }
  });
  return unique;
}

const SH_ACTION_ALIASES = {
  'turn on': 'on', 'switch on': 'on', start: 'on', chalu: 'on', chalao: 'on',
  'turn off': 'off', 'switch off': 'off', stop: 'off', band: 'off', bandh: 'off',
  flip: 'toggle', switch: 'toggle',
  dim: 'brightness', bright: 'brightness', percent: 'brightness', percentage: 'brightness',
  temp: 'temperature',
  lock: 'lock', unlock: 'unlock', open: 'open', close: 'close',
  speed: 'speed', channel: 'channel', volume: 'volume',
  refresh: 'sync', update: 'sync'
};

function shNormAction(action) {
  let act = shNorm(action);
  if (SH_ACTION_ALIASES[act]) act = SH_ACTION_ALIASES[act];
  if (['state', 'report', 'list', 'info', ''].indexOf(act) !== -1) return 'status';
  return act;
}

function shSetFields(dtype, id, data, action, value) {
  const num = shInt(value, null);
  if (dtype === 'lights') {
    if (action === 'on') data.on = true;
    else if (action === 'off') data.on = false;
    else if (action === 'toggle') data.on = !data.on;
    else if (action === 'brightness' || action === 'set') {
      data.brightness = shClamp(num === null ? 100 : num, 0, 100);
      data.on = data.brightness > 0;
    } else if (action === 'status') return [true, shStatusLine(dtype, id, data)];
    else return [false, 'The light supports on, off, toggle and brightness.'];
  } else if (dtype === 'fans') {
    if (action === 'on') data.on = true;
    else if (action === 'off') data.on = false;
    else if (action === 'toggle') data.on = !data.on;
    else if (action === 'speed' || action === 'set') {
      data.speed = shClamp(num === null ? 2 : num, 1, 5);
      data.on = true;
    } else return [false, 'The fan supports on, off, toggle and speed.'];
  } else if (dtype === 'ac') {
    if (action === 'on') data.on = true;
    else if (action === 'off') data.on = false;
    else if (action === 'toggle') data.on = !data.on;
    else if (action === 'temperature' || action === 'set') {
      data.temperature = shClamp(num === null ? 24 : num, 16, 30);
      data.on = true;
    } else return [false, 'The AC supports on, off, toggle and temperature.'];
  } else if (dtype === 'tv') {
    if (action === 'on') data.on = true;
    else if (action === 'off') data.on = false;
    else if (action === 'toggle') data.on = !data.on;
    else if (action === 'volume') {
      data.volume = shClamp(num === null ? 20 : num, 0, 100);
      data.on = true;
    } else if (action === 'channel') {
      data.channel = Math.max(1, num === null ? 1 : num);
      data.on = true;
    } else if (action === 'set') {
      if (String(value || '').indexOf('%') !== -1) data.volume = shClamp(num === null ? 20 : num, 0, 100);
      else data.channel = Math.max(1, num === null ? 1 : num);
      data.on = true;
    } else return [false, 'The TV supports on, off, toggle, channel and volume.'];
  } else if (dtype === 'doors') {
    if (action === 'lock') data.locked = true;
    else if (action === 'unlock') data.locked = false;
    else if (action === 'toggle') data.locked = !data.locked;
    else return [false, 'The door supports lock and unlock.'];
  } else if (dtype === 'blinds') {
    if (action === 'open' || action === 'on') data.state = 'open';
    else if (action === 'close' || action === 'off') data.state = 'closed';
    else if (action === 'toggle') data.state = data.state === 'open' ? 'closed' : 'open';
    else return [false, 'The blinds support open and close.'];
  } else if (dtype === 'coffee' || dtype === 'plugs') {
    if (action === 'on') data.on = true;
    else if (action === 'off') data.on = false;
    else if (action === 'toggle') data.on = !data.on;
    else return [false, 'The ' + shSingular(dtype) + ' supports on, off and toggle.'];
  } else return [false, 'Unknown device type.'];
  return [true, shStatusLine(dtype, id, data)];
}

function shCap(text) {
  const s = String(text == null ? '' : text);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shSummarizeChanges(changes) {
  const counts = {};
  changes.forEach(item => { counts[item[0]] = (counts[item[0]] || 0) + 1; });
  return Object.keys(counts).map(name => counts[name] + ' ' + name.replace(/_/g, ' ')).join(', ');
}

function shHomeStatus() {
  const state = shLoadState();
  const lines = ['Smart home status:'];
  SH_TYPE_ORDER.forEach(dtype => {
    const devices = state[dtype] || {};
    const items = Object.keys(devices)
      .filter(id => devices[id] && typeof devices[id] === 'object')
      .map(id => shStatusLine(dtype, id, devices[id]));
    if (items.length) lines.push('- ' + dtype.replace(/_/g, ' ') + ': ' + items.join(', ') + '.');
  });
  const cfg = shLoadConfig();
  if (cfg.enabled && cfg.url) {
    lines.push('- Home Assistant: connected at ' + cfg.url + " (say 'sync home' to refresh).");
  } else {
    lines.push('- Home Assistant: not configured (virtual devices only).');
  }
  return lines.join('\n');
}

function shHaEntity(dtype, id) {
  const cfg = shLoadConfig();
  const override = (cfg.entities || {})[dtype + '.' + id];
  if (override) return String(override);
  return (SH_HA_DOMAIN[dtype] || 'switch') + '.' + id;
}

function shHaService(dtype, id, data) {
  const entity = shHaEntity(dtype, id);
  if (dtype === 'lights') {
    return data.on
      ? ['light', 'turn_on', { entity_id: entity, brightness_pct: shInt(data.brightness, 100) }]
      : ['light', 'turn_off', { entity_id: entity }];
  }
  if (dtype === 'fans') {
    return data.on
      ? ['fan', 'turn_on', { entity_id: entity, percentage: shInt(data.speed, 2) * 20 }]
      : ['fan', 'turn_off', { entity_id: entity }];
  }
  if (dtype === 'ac') {
    return data.on
      ? ['climate', 'set_temperature', { entity_id: entity, temperature: shInt(data.temperature, 24) }]
      : ['climate', 'turn_off', { entity_id: entity }];
  }
  if (dtype === 'tv') {
    return data.on
      ? ['media_player', 'volume_set', { entity_id: entity, volume_level: shInt(data.volume, 20) / 100 }]
      : ['media_player', 'turn_off', { entity_id: entity }];
  }
  if (dtype === 'doors') {
    return ['lock', data.locked ? 'lock' : 'unlock', { entity_id: entity }];
  }
  if (dtype === 'blinds') {
    return ['cover', data.state === 'open' ? 'open_cover' : 'close_cover', { entity_id: entity }];
  }
  return ['switch', data.on ? 'turn_on' : 'turn_off', { entity_id: entity }];
}

async function shHaRequest(method, path, payload) {
  const cfg = shLoadConfig();
  if (!cfg.enabled || !cfg.url || !cfg.token) return { ok: false, status: 0, body: 'not configured' };
  const url = String(cfg.url).replace(/\/+$/, '') + path;
  const headers = {
    Authorization: 'Bearer ' + cfg.token,
    'Content-Type': 'application/json'
  };
  const body = payload === null || payload === undefined ? '' : JSON.stringify(payload);
  const r = await nativeHttpRequest(method, url, headers, body, 5000);
  return { ok: !!r.ok, status: r.status, body: String(r.body || '') };
}

async function shHaPushMany(changed, state) {
  const cfg = shLoadConfig();
  if (!cfg.enabled) return [];
  const notes = [];
  for (const item of changed) {
    const dtype = item[0];
    const id = item[1];
    const spec = shHaService(dtype, id, state[dtype][id]);
    const r = await shHaRequest('POST', '/api/services/' + spec[0] + '/' + spec[1], spec[2]);
    if (!r.ok) {
      notes.push(String(r.body || (r.status ? 'HTTP ' + r.status : 'failed')).slice(0, 90));
      break;
    }
  }
  return notes;
}

async function shSyncFromHa() {
  const cfg = shLoadConfig();
  if (!cfg.enabled || !cfg.url || !cfg.token) {
    return 'Home Assistant is not configured. Use smart_home_setup with the URL and a long-lived token.';
  }
  const r = await shHaRequest('GET', '/api/states', null);
  if (!r.ok) return 'Could not read Home Assistant states: ' + String(r.body || r.status || '').slice(0, 120) + '.';
  let states;
  try { states = JSON.parse(r.body); } catch (e) { return 'Home Assistant returned an unexpected response.'; }
  const byEntity = {};
  if (Array.isArray(states)) {
    states.forEach(item => {
      if (item && item.entity_id) byEntity[item.entity_id] = item;
    });
  }
  const state = shLoadState();
  let updated = 0;
  SH_TYPE_ORDER.forEach(dtype => {
    const devices = state[dtype] || {};
    Object.keys(devices).forEach(id => {
      const data = devices[id];
      if (!data || typeof data !== 'object') return;
      const entity = byEntity[shHaEntity(dtype, id)];
      if (!entity) return;
      const raw = String(entity.state || '').toLowerCase();
      const attrs = entity.attributes || {};
      try {
        if (dtype === 'lights') {
          data.on = raw === 'on';
          if (attrs.brightness != null) data.brightness = shClamp(Math.round(Number(attrs.brightness) * 100 / 255), 0, 100);
        } else if (dtype === 'fans') {
          data.on = raw === 'on';
          if (attrs.percentage != null) data.speed = shClamp(Math.round(Number(attrs.percentage) / 20), 1, 5);
        } else if (dtype === 'ac') {
          data.on = ['off', 'unavailable', 'unknown'].indexOf(raw) === -1;
          if (attrs.temperature != null) data.temperature = shClamp(Math.round(Number(attrs.temperature)), 16, 30);
        } else if (dtype === 'tv') {
          data.on = ['off', 'standby', 'unavailable', 'unknown'].indexOf(raw) === -1;
          if (attrs.volume_level != null) data.volume = shClamp(Math.round(Number(attrs.volume_level) * 100), 0, 100);
        } else if (dtype === 'doors') {
          data.locked = raw === 'locked';
        } else if (dtype === 'blinds') {
          data.state = raw === 'open' ? 'open' : 'closed';
        } else {
          data.on = raw === 'on';
        }
        updated++;
      } catch (e) { }
    });
  });
  shSaveState(state);
  return 'Synced ' + updated + ' devices from Home Assistant.';
}

async function shSmartHome(action, device, value) {
  const act = shNormAction(action);
  if (act === 'status') return shHomeStatus();
  if (act === 'sync') return await shSyncFromHa();
  if (['on', 'off', 'toggle', 'brightness', 'temperature', 'volume', 'channel', 'speed',
    'lock', 'unlock', 'open', 'close', 'set'].indexOf(act) === -1) {
    return 'Unknown action. Use status, on, off, toggle, brightness, temperature, ' +
      'volume, channel, speed, lock, unlock, open, close or sync.';
  }

  const text = shNorm(device);
  let targets = shResolveTargets(text, act);
  if (typeof targets === 'string') return targets;
  if (!targets.length) return 'I could not find that device. ' + shDeviceMenu();
  if (act === 'lock' || act === 'unlock') targets = targets.filter(t => t[0] === 'doors');
  if (act === 'open' || act === 'close') targets = targets.filter(t => t[0] === 'blinds');
  if (!targets.length) return 'That action only works on doors or blinds.';

  const state = shLoadState();
  const changed = [];
  const messages = [];
  for (const target of targets) {
    const dtype = target[0];
    const id = target[1];
    const data = state[dtype] && state[dtype][id];
    if (!data || typeof data !== 'object') continue;
    const result = shSetFields(dtype, id, data, act, value);
    if (!result[0]) return result[1];
    changed.push([dtype, id]);
    messages.push(result[1]);
  }
  shSaveState(state);

  const notes = await shHaPushMany(changed, state);
  let reply;
  if (messages.length === 1) reply = shCap(messages[0]) + '.';
  else if (messages.length <= 4) reply = 'Done: ' + messages.join('; ') + '.';
  else reply = 'Done: ' + shSummarizeChanges(changed) + ' updated.';
  if (notes.length) reply += ' Home Assistant reported: ' + notes[0] + '.';
  return reply;
}

async function shSmartScene(name) {
  const text = shNorm(name);
  let scene = null;
  Object.keys(SH_SCENE_ALIASES).some(key => {
    if (text === key || SH_SCENE_ALIASES[key].some(alias => text === alias || shHasWord(text, alias))) {
      scene = key;
      return true;
    }
    return false;
  });
  if (!scene) return 'Unknown scene. Available scenes: morning, movie, sleep, guest, work, away, party.';

  const state = shLoadState();
  const changed = [];
  SH_SCENES[scene].forEach(item => {
    const dtype = item[0];
    const id = item[1];
    const fields = item[2];
    const data = state[dtype] && state[dtype][id];
    if (!data || typeof data !== 'object') return;
    Object.assign(data, fields);
    changed.push([dtype, id]);
  });
  shSaveState(state);

  const notes = await shHaPushMany(changed, state);
  let reply = "Scene '" + scene + "' applied: " + shSummarizeChanges(changed) + ' updated.';
  if (notes.length) reply += ' Home Assistant reported: ' + notes[0] + '.';
  return reply;
}

async function shSmartHomeSetup(url, token, enabled) {
  const cfg = shLoadConfig();
  if (enabled === false) {
    cfg.enabled = false;
    shSaveConfig(cfg);
    return 'Home Assistant disabled. The virtual smart home still works.';
  }

  let newUrl = String(url == null ? '' : url).trim();
  const newToken = String(token == null ? '' : token).trim();
  if (newUrl) {
    if (!/^https?:\/\//i.test(newUrl)) newUrl = 'http://' + newUrl;
    cfg.url = newUrl.replace(/\/+$/, '');
  }
  if (newToken) cfg.token = newToken;
  if (!cfg.url) return 'Give me the Home Assistant URL first, for example http://192.168.1.10:8123.';
  if (!cfg.token) return 'I still need a long-lived access token from Home Assistant.';
  cfg.enabled = true;
  shSaveConfig(cfg);

  const r = await shHaRequest('GET', '/api/', null);
  if (!r.ok) {
    return 'Saved, but the connection failed: ' + String(r.body || r.status || '').slice(0, 120) +
      ". Check the URL and token, then say 'test home assistant'.";
  }
  let location = '';
  try {
    const data = JSON.parse(r.body);
    location = data.location_name || '';
  } catch (e) { }
  return 'Home Assistant connected' + (location ? ': ' + location : '') +
    ". Say 'sync home' to import the device states.";
}

function shSmartHomeHelp() {
  return shDeviceMenu() + ' Scenes: morning, movie, sleep, guest, work, away, party. ' +
    'Home Assistant is optional; say "connect home assistant" with the URL and token.';
}

function shConfigStatus() {
  const cfg = shLoadConfig();
  if (cfg.enabled && cfg.url) return 'Connected: ' + cfg.url + (cfg.token ? ' (token saved)' : '');
  if (cfg.url) return 'Saved but disabled: ' + cfg.url;
  return 'Home Assistant not configured — virtual devices only.';
}

async function shHaTest() {
  const cfg = shLoadConfig();
  if (!cfg.url) return 'Home Assistant URL not set.';
  if (!cfg.token) return 'Home Assistant token not set.';
  const r = await shHaRequest('GET', '/api/', null);
  if (r.ok) return 'Home Assistant is reachable.';
  return 'Home Assistant failed: ' + String(r.body || (r.status ? 'HTTP ' + r.status : 'no response')).slice(0, 110);
}

/* ============================================================ NEWS + HTTP */
const pendingHttp = {};
const NEWS_FEED = 'https://news.google.com/rss';
const NEWS_PARAMS = 'hl=en-PK&gl=PK&ceid=PK:en';
const newsCache = {};

window.__jarvisHttpRaw = function (id, code, body) {
  const p = pendingHttp[id];
  if (!p) return;
  delete pendingHttp[id];
  clearTimeout(p.timer);
  const status = Number(code) || 0;
  p.resolve({ ok: status >= 200 && status < 300, status: status, body: String(body == null ? '' : body) });
};

function nativeHttpRequest(method, url, headers, body, timeoutMs) {
  return new Promise(resolve => {
    const id = 'h' + (++reqSeq);
    const timeout = Math.max(3000, Math.min(15000, Number(timeoutMs) || 8000));
    const timer = setTimeout(() => {
      if (pendingHttp[id]) {
        delete pendingHttp[id];
        resolve({ ok: false, status: 0, body: 'timeout' });
      }
    }, timeout + 500);
    pendingHttp[id] = { resolve: resolve, timer: timer };
    try {
      if (hasNative && Native && typeof Native.httpRequest === 'function') {
        Native.httpRequest(id, String(method || 'GET').toUpperCase(), String(url),
          JSON.stringify(headers || {}), String(body == null ? '' : body), timeout);
        return;
      }
      fetch(url, { method: method || 'GET', headers: headers || {}, body: body || undefined })
        .then(r => r.text().then(text => window.__jarvisHttpRaw(id, r.status, text)))
        .catch(e => window.__jarvisHttpRaw(id, 0, 'NETWORK: ' + String(e)));
    } catch (e) {
      delete pendingHttp[id];
      clearTimeout(timer);
      resolve({ ok: false, status: 0, body: 'NETWORK: ' + String(e) });
    }
  });
}

function newsDecodeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function newsCleanTitle(title) {
  let text = String(title || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');
  text = newsDecodeXml(text).replace(/\s+/g, ' ').trim();
  const cut = text.lastIndexOf(' - ');
  if (cut > 0) text = text.slice(0, cut).trim();
  return text;
}

function newsXmlText(block, tag) {
  const m = String(block).match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!m) return '';
  return newsDecodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

function parseNewsRss(xml, limit) {
  const out = [];
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(String(xml), 'text/xml');
      const items = doc.querySelectorAll('item');
      for (let i = 0; i < items.length && out.length < limit; i++) {
        const item = items[i];
        const titleEl = item.querySelector('title');
        const sourceEl = item.querySelector('source');
        const title = newsCleanTitle(titleEl ? titleEl.textContent : '');
        if (!title) continue;
        out.push([title, sourceEl ? String(sourceEl.textContent || '').trim() : '']);
      }
      if (out.length) return out;
    } catch (e) { }
  }
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml))) && out.length < limit) {
    const title = newsCleanTitle(newsXmlText(m[1], 'title'));
    if (!title) continue;
    out.push([title, newsXmlText(m[1], 'source')]);
  }
  return out;
}

async function newsBrief(topic, count) {
  const limit = shClamp(shInt(count, 5), 1, 8);
  topic = String(topic == null ? '' : topic).trim();
  const key = topic.toLowerCase() + '|' + limit;
  const now = Date.now();
  if (newsCache[key] && now - newsCache[key].t < 300000) return newsCache[key].text;

  const url = topic
    ? NEWS_FEED + '/search?q=' + encodeURIComponent(topic) + '&' + NEWS_PARAMS
    : NEWS_FEED + '?' + NEWS_PARAMS;
  const r = await nativeHttpRequest('GET', url, {
    Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
  }, '', 9000);
  if (!r.ok) {
    return 'Could not fetch the news right now: ' +
      String(r.body || (r.status ? 'HTTP ' + r.status : 'no response')).slice(0, 120);
  }
  const items = parseNewsRss(r.body, limit);
  if (!items.length) return 'No news found for ' + (topic || 'top headlines') + ' right now.';

  const lines = [topic ? 'News about "' + topic + '":' : 'Top headlines:'];
  items.forEach((item, index) => {
    lines.push((index + 1) + '. ' + item[0] + (item[1] ? ' (' + item[1] + ')' : ''));
  });
  lines.push('Source: Google News.');
  const text = lines.join('\n');
  newsCache[key] = { t: now, text: text };
  return text;
}

/* Background mode: Android service keeps us alive, native code restarts the mic. */
function bgMode() {
  return settings.alwaysOn !== false && settings.handsFree !== false;
}

/* Explicit microphone mute. While true nothing may start the recognizer until
   the user taps the orb again. It applies to both JS and the native loop. */
let micMuted = false;

function updateMicUI() {
  try {
    document.body.classList.toggle('mic-muted', !!micMuted);
    if (orbEl) {
      orbEl.setAttribute('aria-pressed', state === 'listening' && !micMuted ? 'true' : 'false');
      orbEl.setAttribute('aria-label', micMuted ? 'Turn microphone on' : 'Talk to Jarvis');
      orbEl.setAttribute('title', micMuted ? 'Mic off — tap to turn on' : 'Talk to Jarvis');
    }
  } catch (e) { }
}

function setMicMuted(muted, quiet) {
  micMuted = !!muted;
  clearTimeout(listenTimer);
  clearListenSafety();
  micStartPending = false;
  try {
    Native.setMicMuted(micMuted);
    if (micMuted) {
      Native.setAutoListen(false);
      Native.holdListening(true);
      Native.cancelListening();
      Native.stopSpeaking();
    } else {
      Native.holdListening(false);
      Native.setAutoListen(bgMode());
    }
  } catch (e) { }
  if (micMuted) {
    transcript('');
    setState('idle');
    if (!quiet) toast('Mic band. Dubara tap karne par on ho jayega.');
  }
  updateMicUI();
  updateConnState();
}

/* Orb tap: mute when the mic is (or would be) live, otherwise listen. */
function toggleMic() {
  if (micMuted) {
    setMicMuted(false);
    startListening(true);
    return;
  }
  if (state === 'listening' || settings.handsFree) {
    setMicMuted(true);
    return;
  }
  startListening(true);
}

function applyBackground(on) {
  settings.alwaysOn = !!on;
  saveSettings();
  try {
    Native.setAlwaysOn(!!on);
    Native.setAutoListen(bgMode() && !micMuted);
    Native.holdListening(!!micMuted);
  } catch (e) { }
  // The service holds the CPU awake; the screen itself may sleep.
  try { Native.keepAwake(false); } catch (e) { }
  if (!on) {
    try { Native.cancelListening(); } catch (e) { }
    clearTimeout(listenTimer);
    if (state === 'listening') setState('idle');
  } else if (settings.handsFree && state === 'idle' && !busy && !micMuted) {
    startListening(false);
  }
}

/* -------------------------------------------------------------------- DOM */
let chatEl, welcomeEl, orbEl, stateLabelEl, transcriptEl, toastEl;

/* ============================================================ SPEECH + TTS */
function setState(next, label) {
  state = next;
  document.body.dataset.state = next;
  if (stateLabelEl) {
    const labels = {
      idle: micMuted ? 'MIC OFF · TAP TO ON' : 'TAP TO SPEAK',
      listening: 'SUN RAHA HOON...',
      thinking: 'SOCH RAHA HOON...',
      speaking: 'BOL RAHA HOON...'
    };
    stateLabelEl.textContent = label || labels[next] || '';
  }
  if (orbEl) orbEl.setAttribute('aria-pressed', next === 'listening' && !micMuted ? 'true' : 'false');
  updateMicUI();
}

function transcript(text) {
  if (transcriptEl) transcriptEl.textContent = text || '';
}

function speak(roman, urdu) {
  const r = stripMarkdown(roman || '');
  const u = String(urdu || '').trim();
  if (!r && !u) return;
  if (state === 'listening') {
    try { Native.cancelListening(); } catch (e) { }
  }
  clearListenSafety();
  setState('speaking');
  clearTimeout(speakSafety);
  // Neural voice needs a moment to synthesise, then speaks at normal speed.
  const est = Math.min(90000, 8000 + r.length * 150);
  speakSafety = setTimeout(() => {
    if (state === 'speaking') finishSpeaking();
  }, est);
  try { Native.speak(r, u); } catch (e) { finishSpeaking(); }
}

function finishSpeaking() {
  clearTimeout(speakSafety);
  if (state !== 'speaking') return;
  setState('idle');
  // Muted by the user: never let TTS completion re-open the microphone.
  if (micMuted) {
    try { Native.setAutoListen(false); Native.holdListening(true); } catch (e) { }
    return;
  }
  // Native speech engine released the mic on TTS completion; in background
  // mode it restarts the recognizer by itself, so no JS timer is needed.
  try { Native.holdListening(false); } catch (e) { }
  if (bgMode()) {
    try { Native.setAutoListen(true); } catch (e) { }
    return;
  }
  if (settings.handsFree && appActive) scheduleListen(600);
}

function stopEverything() {
  clearTimeout(listenTimer);
  clearListenSafety();
  micStartPending = false;
  try { Native.stopSpeaking(); } catch (e) { }
  try { Native.cancelListening(); } catch (e) { }
  // Keep the native loop paused until the reply has finished speaking, so it
  // cannot restart the mic in the middle of the "stopped" confirmation.
  try { Native.setAutoListen(false); Native.holdListening(true); } catch (e) { }
  setState('idle');
  transcript('');
}

function clearListenSafety() {
  clearTimeout(listenSafety);
  listenSafety = null;
}

/** If the recognizer goes quiet forever, recover instead of hanging on "SUN RAHA HOON". */
function armListenSafety(ms) {
  clearListenSafety();
  // In background mode the native loop and its watchdog own the microphone.
  // Throttled WebView timers used to fire late and kill healthy sessions,
  // which caused the endless mic on/off cycling and repeat beeps.
  if (bgMode() || micMuted) return;
  listenSafety = setTimeout(() => {
    listenSafety = null;
    if (state !== 'listening' || micMuted) return;
    try { Native.cancelListening(); } catch (e) { }
    setState('idle');
    transcript('');
    toast('Awaaz nahi aayi — dobara bolein.');
  }, ms == null ? 15000 : ms);
}

function scheduleListen(delay) {
  clearTimeout(listenTimer);
  if (micMuted || !settings.handsFree || !appActive) return;
  // In background mode the native loop owns the microphone. JS timers are
  // frozen while the app is hidden, so trusting them here would stop listening.
  if (bgMode()) {
    try { Native.setAutoListen(true); Native.holdListening(false); } catch (e) { }
    return;
  }
  listenTimer = setTimeout(() => {
    if (!appActive || !settings.handsFree || micMuted || state !== 'idle' || busy) return;
    startListening(false);
  }, delay == null ? 700 : delay);
}

function startListening(fromUser) {
  if (micMuted) { updateMicUI(); return; }
  if (busy || state === 'thinking') {
    toast('Ek second sir, jawab aa raha hai.');
    return;
  }
  if (state === 'listening') {
    // Tap again = "done speaking". Keep the final command; never throw it away.
    try { Native.stopListening(); } catch (e) { }
    if (stateLabelEl) stateLabelEl.textContent = 'PROCESSING...';
    armListenSafety(8000);
    return;
  }
  if (state === 'speaking') {
    try { Native.stopSpeaking(); } catch (e) { }
  }
  clearTimeout(listenTimer);
  pushToTalk = fromUser !== false;
  transcript('');
  setState('listening');
  armListenSafety(15000);
  let result = 'ok';
  try { result = Native.startListening(); } catch (e) { result = 'error'; }
  if (result === 'permission') {
    micStartPending = true;
    toast('Microphone permission allow karein.');
    armListenSafety(30000);
  } else if (result === 'unsupported') {
    micStartPending = false;
    clearListenSafety();
    setState('idle');
    toast('Is device par speech recognition available nahi hai.');
  } else if (result === 'error') {
    micStartPending = false;
    clearListenSafety();
    setState('idle');
    toast('Mic start nahi ho saka.');
  } else {
    micStartPending = false;
  }
}

/* =============================================================== UI / CHAT */
function hideWelcome() {
  if (welcomeEl && welcomeEl.parentNode) welcomeEl.parentNode.removeChild(welcomeEl);
  welcomeEl = null;
}

function addBubble(role, roman, urdu, meta) {
  if (!chatEl) return null;
  hideWelcome();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role === 'user' ? 'user' : 'jarvis');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const main = document.createElement('div');
  main.textContent = String(roman == null ? '' : roman);
  bubble.appendChild(main);
  if (urdu && String(urdu).trim()) {
    const u = document.createElement('span');
    u.className = 'urdu';
    u.textContent = String(urdu).trim();
    bubble.appendChild(u);
  }
  const m = document.createElement('span');
  m.className = 'meta';
  m.textContent = (role === 'user' ? 'YOU' : 'JARVIS') + ' · ' + (meta || nowLabel());
  bubble.appendChild(m);
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollChat();
  return wrap;
}

function addSystemLine(text, isError) {
  if (!chatEl) return;
  const div = document.createElement('div');
  div.className = 'sys-line' + (isError ? ' err' : '');
  div.textContent = text;
  chatEl.appendChild(div);
  scrollChat();
  try { console.log('JARVIS_SYS ' + text); } catch (e) { }
}

function scrollChat() {
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message || '';
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
window.jarvisToast = toast;

function respond(roman, urdu, opts) {
  const o = opts || {};
  addBubble('jarvis', roman, urdu);
  history.push({ role: 'model', text: roman });
  trimHistory();
  memThreadUpdate();
  saveJSON(LS.history, history);
  try { console.log('JARVIS_REPLY ' + JSON.stringify({ roman: roman, urdu: urdu })); } catch (e) { }
  try { Native.log('REPLY ' + roman); } catch (e) { }
  if (o.silent !== true) speak(roman, urdu);
  else {
    try { Native.holdListening(!!micMuted); } catch (e) { }
    if (settings.handsFree) scheduleListen(700);
  }
}

function trimHistory() {
  if (history.length > 40) {
    const drop = history.length - 40;
    history = history.slice(drop);
    if (memory && memory.threadAt) memory.threadAt = Math.max(0, memory.threadAt - drop);
  }
}

function renderHistory() {
  if (!chatEl || !history.length) return;
  hideWelcome();
  const slice = history.slice(-12);
  for (const item of slice) {
    if (!item || !item.text) continue;
    addBubble(item.role === 'user' ? 'user' : 'jarvis', item.text, '', item.role === 'user' ? '' : 'SAVED');
  }
}

function updateConnState() {
  const el = $('#connState');
  if (!el) return;
  let online = navigator.onLine;
  try {
    const st = JSON.parse(Native.getStatus());
    if (st && st.ok && st.data) online = !!st.data.online;
  } catch (e) { }
  if (!Native.hasApiKey()) {
    el.textContent = 'KEY MISSING';
    el.classList.add('offline');
    return;
  }
  if (micMuted) {
    el.textContent = 'MIC OFF';
    el.classList.add('offline');
    return;
  }
  el.textContent = online
    ? (settings.alwaysOn !== false ? 'ONLINE · BG' : 'ONLINE')
    : 'OFFLINE';
  el.classList.toggle('offline', !online);
}

/* ============================================================== TOOL CALLS */
const pendingAutomation = {};
let automationSeq = 0;

/* Native posts the real install result here (Play Store install takes time). */
window.jarvisAutomationDone = function (id, json) {
  const p = pendingAutomation[id];
  if (!p) return;
  delete pendingAutomation[id];
  clearTimeout(p.timer);
  let result;
  try { result = JSON.parse(json); } catch (e) { result = { ok: false, message: String(json) }; }
  if (!result || typeof result !== 'object') result = { ok: false, message: 'Bad automation result' };
  if (typeof result.ok !== 'boolean') result.ok = false;
  p.resolve(result);
};

/**
 * Runs a phone tool. Most tools answer immediately; install_app waits for the
 * real Play Store result (search -> Install -> wait -> Open) and can take a
 * couple of minutes for a big app.
 */
function callTool(name, args) {
  if (name === 'install_app') {
    return new Promise((resolve) => {
      const id = 'auto' + (++automationSeq);
      const appName = String((args && args.app_name) || '').trim();
      if (!appName) {
        resolve({ ok: false, message: 'App ka naam nahi mila.', needs_user_action: false });
        return;
      }
      const timer = setTimeout(() => {
        if (!pendingAutomation[id]) return;
        delete pendingAutomation[id];
        resolve({
          ok: false,
          message: 'Install ka jawab nahi mila. Play Store khol kar Install dabaiye.',
          needs_user_action: true
        });
      }, 240000);
      pendingAutomation[id] = { resolve, timer };
      try {
        Native.startInstall(id, appName);
      } catch (e) {
        delete pendingAutomation[id];
        clearTimeout(timer);
        resolve({ ok: false, message: 'Install start nahi hua: ' + e, needs_user_action: true });
      }
    });
  }

  let raw = '';
  try {
    raw = Native.executeTool(name, JSON.stringify(args || {}));
  } catch (e) {
    return { ok: false, message: 'Tool call fail: ' + e };
  }
  let result;
  try { result = JSON.parse(raw); } catch (e) { result = { ok: false, message: String(raw) }; }
  if (!result || typeof result !== 'object') result = { ok: false, message: 'Bad tool result' };
  if (typeof result.ok !== 'boolean') result.ok = false;
  return result;
}

function toolLog(name, result) {
  const ok = result && result.ok;
  const msg = result && result.message ? ' · ' + result.message : '';
  addSystemLine('TOOL · ' + name + ' · ' + (ok ? 'OK' : 'FAIL') + msg, !ok);
  try { console.log('JARVIS_TOOL ' + name + ' ' + JSON.stringify(result)); } catch (e) { }
  try { Native.log('TOOL ' + name + ' ' + JSON.stringify(result)); } catch (e) { }
}

/* ============================================================== LOCAL CMDS */
const APP_WORDS = [
  'brave', 'chrome', 'youtube', 'gmail', 'whatsapp', 'instagram', 'facebook', 'messenger',
  'telegram', 'tiktok', 'snapchat', 'spotify', 'netflix', 'maps', 'google maps', 'photos',
  'gallery', 'play store', 'phone', 'dialer', 'messages', 'contacts', 'calendar', 'keep',
  'files', 'file manager', 'settings', 'calculator', 'clock', 'alarm', 'camera', 'music',
  'browser', 'internet', 'email', 'mail', 'video'
];
const APP_ALIAS = {
  video: 'youtube', music: 'music', browser: 'browser', internet: 'browser',
  email: 'gmail', mail: 'gmail', alarm: 'clock', gallery: 'photos'
};

/* ------------------------------------------- speech accuracy (STT repair)
   Google's recognizer often returns several guesses; the first one is not
   always what was said ("Brave" heard as "Brain").  We repair the common
   Roman-Urdu mistakes, score every candidate against Jarvis vocabulary and
   keep the best one.  Mobile port of the desktop _ROMAN_FIXES. */
const ROMAN_FIXES = {
  // wake word
  javis: 'jarvis', jarvish: 'jarvis', garvis: 'jarvis', travis: 'jarvis', jervis: 'jarvis',
  jaarv: 'jarvis', jarv: 'jarvis', jarwis: 'jarvis', jaadui: 'jarvis', jadui: 'jarvis',
  // browsers / apps
  brav: 'brave', brev: 'brave', breve: 'brave', bray: 'brave', bravy: 'brave',
  brabe: 'brave', brayn: 'brave', brein: 'brave', bravo: 'brave', brafee: 'brave',
  crome: 'chrome', chrom: 'chrome', crom: 'chrome', krom: 'chrome',
  utube: 'youtube', youtub: 'youtube', youtbe: 'youtube', yutub: 'youtube',
  whatsap: 'whatsapp', watsapp: 'whatsapp', whatsab: 'whatsapp',
  insta: 'instagram', instgram: 'instagram', fecebook: 'facebook', facebok: 'facebook',
  gmale: 'gmail', jmail: 'gmail', googal: 'google', gogle: 'google', googel: 'google',
  // common Roman-Urdu action words
  khol: 'kholo', kolo: 'kholo', colo: 'kholo', khulo: 'kholo', khola: 'kholo',
  khole: 'kholo', khoolo: 'kholo', kholow: 'kholo',
  bnd: 'band', bund: 'band', baind: 'band',
  kro: 'karo', krdo: 'karo', kardo: 'karo', kero: 'karo',
  btao: 'batao', bta: 'batao', bataao: 'batao',
  dikha: 'dikhao', dhundo: 'dhoondo', dhoondo: 'dhoondo',
  chlao: 'chalao', chala: 'chalao', chalado: 'chalao',
  lgao: 'lagao', lagado: 'lagao', likh: 'likho', likhdo: 'likho',
  baja: 'bajao', bhej: 'bhejo', bhejdo: 'bhejo',
  bana: 'banao', banado: 'banao', bhul: 'bhool', yad: 'yaad'
};

/* Words that are real English but, next to an action word, are almost always
   a misheard app name: "brain kholo" -> "brave kholo". */
const CONTEXT_FIXES = {
  brain: 'brave', brian: 'brave', brade: 'brave', brafe: 'brave',
  braze: 'brave', brace: 'brave', braid: 'brave'
};
const STT_ACTION = /^(kholo|khol|khulo|open|launch|chalao|chala|start|band|karo|bajao|padho|browser|app|apps|play)$/;

const STT_WORDS = new Set((APP_WORDS.join(' ') + ' ' + [
  'jarvis', 'hey', 'hi', 'ok', 'okay', 'salam', 'assalam', 'please', 'plz', 'sir', 'bro', 'bhai', 'yaar',
  'kholo', 'khol', 'khulo', 'band', 'karo', 'kro', 'chalao', 'chala', 'start', 'open', 'launch', 'play', 'bajao',
  'batao', 'bata', 'dikhao', 'dikha', 'suno', 'sunao', 'samjhao', 'likho', 'banao', 'bhejo', 'padho', 'lagao',
  'timer', 'alarm', 'reminder', 'flashlight', 'torch', 'volume', 'battery', 'time', 'waqt', 'date', 'tarikh',
  'inbox', 'email', 'gmail', 'message', 'call', 'check', 'read', 'send', 'set', 'on', 'off', 'up', 'down',
  'kaise', 'kya', 'haal', 'hai', 'ho', 'good', 'morning', 'night', 'thanks', 'thank', 'mujhe', 'mera', 'meri',
  'ka', 'ki', 'ko', 'se', 'mein', 'aur', 'and', 'the', 'a', 'an', 'to', 'for', 'my', 'me', 'is', 'it',
  'screenshot', 'brightness', 'wifi', 'bluetooth', 'airplane', 'mode', 'notification',
  'youtube', 'brave', 'chrome', 'google', 'maps', 'whatsapp', 'instagram', 'facebook', 'messenger', 'telegram',
  'tiktok', 'snapchat', 'spotify', 'netflix', 'photos', 'gallery', 'store', 'phone', 'dialer', 'messages',
  'contacts', 'calendar', 'keep', 'files', 'file', 'manager', 'settings', 'calculator', 'clock', 'camera',
  'music', 'browser', 'internet', 'video', 'app', 'apps'
].join(' ')).split(/\s+/).filter(Boolean));

const STT_PHRASES = [
  'play store', 'google maps', 'file manager', 'kaise ho', 'kya haal', 'khol do', 'band karo',
  'time kya', 'battery kitni', 'message bhejo', 'call karo', 'flashlight on', 'flashlight off',
  'timer lagao', 'alarm lagao', 'volume kam', 'volume zyada', 'inbox check', 'good morning', 'good night'
];

function repairSpeech(text) {
  let s = String(text || '').trim();
  if (!s) return s;
  s = s.replace(/\byou\s*tube\b/gi, 'youtube')
    .replace(/\bwhats\s*app\b/gi, 'whatsapp')
    .replace(/\bgoogle\s*maps?\b/gi, 'google maps')
    .replace(/\bplay\s*store\b/gi, 'play store')
    .replace(/\bfile\s*manager\b/gi, 'file manager');
  const words = s.split(/\s+/);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const key = raw.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
    let fixed = ROMAN_FIXES[key];
    if (!fixed && CONTEXT_FIXES[key]) {
      const next = String(words[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
      if (STT_ACTION.test(next)) fixed = CONTEXT_FIXES[key];
    }
    out.push(fixed || raw);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function scoreCandidate(text) {
  const clean = String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return -999;
  const words = clean.split(' ');
  let score = 0;
  for (const w of words) {
    if (STT_WORDS.has(w)) score += 2;
    else if (w.length > 2) score -= 1;
  }
  for (const p of STT_PHRASES) if (clean.indexOf(p) !== -1) score += 3;
  if (/\b(jarvis|kholo|khol|band|chalao|batao|open|launch|set|play|call|send|check)\b/.test(clean)) score += 2;
  return score;
}

/** Pick the candidate that best matches Jarvis vocabulary, then repair it. */
function chooseHeard(primary, alternatives) {
  const seen = {};
  const list = [];
  const add = (t) => {
    const s = String(t || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    list.push(s);
  };
  add(primary);
  if (Array.isArray(alternatives)) alternatives.forEach(add);
  if (!list.length) return '';
  let best = repairSpeech(list[0]);
  let bestScore = -1e9;
  for (let i = 0; i < list.length; i++) {
    const fixed = repairSpeech(list[i]);
    const score = scoreCandidate(fixed) - i * 0.15;
    if (score > bestScore) { bestScore = score; best = fixed; }
  }
  return best;
}

function pick(en, roman, urdu) {
  if (settings.langMode === 'en') return { roman: en, urdu: en };
  if (settings.langMode === 'ur') return { roman: roman, urdu: urdu };
  return null;
}

function replyFor(mode, en, roman, urdu) {
  if (mode === 'en') return { roman: en, urdu: en };
  return { roman: roman, urdu: urdu };
}

function tryLocalOpen(low) {
  if (!/(kholo|khol do|khol|open|launch|chalao|start)/.test(low)) return false;
  const parts = low.split(/\s+(?:aur|and|phir|then)\s+/);
  const found = [];
  for (const part of parts) {
    for (const word of APP_WORDS) {
      const re = new RegExp('\\b' + word.replace(/ /g, '\\s+') + '\\b');
      if (re.test(part)) {
        if (!found.includes(word)) found.push(word);
        break;
      }
    }
  }
  if (!found.length) return false;

  let rest = low;
  for (const word of APP_WORDS) {
    rest = rest.replace(new RegExp('\\b' + word.replace(/ /g, '\\s+') + '\\b', 'g'), ' ');
  }
  rest = rest.replace(/\b(kholo|khol|open|launch|chalao|start|aur|and|phir|then|do|de|please|plz|jarvis|hey|hi|mera|meri|liye|ka|ki|ko|abhi|jaldi|se|kar|karo)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (rest.length > 1) return false;

  const opened = [];
  const failed = [];
  for (const word of found) {
    const target = APP_ALIAS[word] || word;
    const r = callTool('open_app', { app_name: target });
    toolLog('open_app', r);
    if (r.ok) opened.push(word);
    else failed.push(word);
  }
  let roman, urdu, en;
  if (opened.length) {
    const nice = opened.map(w => w.replace(/\b\w/g, c => c.toUpperCase())).join(' aur ');
    en = 'Done sir, ' + opened.join(' and ') + ' opened.' + (failed.length ? ' ' + failed.join(', ') + ' not found.' : '');
    roman = 'Ji sir, ' + nice + ' khol diya.' + (failed.length ? ' ' + failed.join(', ') + ' nahi mila.' : '');
    urdu = 'جی سر، کھول دیا ہے۔';
  } else {
    en = 'Sir, ' + failed.join(', ') + ' is not installed.';
    roman = 'Sir, ' + failed.join(', ') + ' nahi mila.';
    urdu = 'سر، وہ ایپ نہیں ملی۔';
  }
  const line = replyFor(detectLang(low), en, roman, urdu);
  respond(line.roman, line.urdu);
  return true;
}

async function localCommand(text) {
  const low = text.toLowerCase().trim();
  const lang = detectLang(low);

  if (/^(stop|ruk jao|ruk|chup raho|chup|band karo voice)$/.test(low) ||
      /^(stop|ruk|chup)/.test(low) && text.length < 24) {
    stopEverything();
    setMicMuted(true, true);
    const l = replyFor(lang, 'Stopped, sir.', LINES.stopped.roman, LINES.stopped.urdu);
    respond(l.roman, l.urdu);
    return true;
  }

  if (/(unlock|open) (the )?(voice|awaaz|awaaz lock)|voice unlock|awaaz unlock/.test(low)) {
    settings.voiceLocked = false;
    saveSettings();
    renderSettings();
    respond(LINES.voiceUnlocked.roman, LINES.voiceUnlocked.urdu);
    return true;
  }
  if (/(lock|band karo) (the )?(voice|awaaz)|voice lock/.test(low) && !/unlock/.test(low)) {
    settings.voiceLocked = true;
    saveSettings();
    renderSettings();
    respond(LINES.voiceLockedOn.roman, LINES.voiceLockedOn.urdu);
    return true;
  }
  if (/\b(male|mard|man) (voice|awaaz)\b/.test(low) || low === 'male voice') {
    applyVoiceGender('male');
    return true;
  }
  if (/\b(female|ladki|aurat|woman) (voice|awaaz)\b/.test(low) || low === 'female voice') {
    if (settings.voiceLocked) {
      respond(LINES.voiceLocked.roman, LINES.voiceLocked.urdu);
    } else {
      applyVoiceGender('female', true);
    }
    return true;
  }
  if (/english mode|english only|speak english|english mein/.test(low)) {
    settings.langMode = 'en'; saveSettings(); renderSettings();
    respond(LINES.enMode.roman, LINES.enMode.urdu);
    return true;
  }
  if (/urdu mode|roman urdu mode|urdu mein|urdu bolo/.test(low)) {
    settings.langMode = 'ur'; saveSettings(); renderSettings();
    respond(LINES.urMode.roman, LINES.urMode.urdu);
    return true;
  }
  if (/both mode|dono (language|zaban)|both languages/.test(low)) {
    settings.langMode = 'both'; saveSettings(); renderSettings();
    respond(LINES.bothMode.roman, LINES.bothMode.urdu);
    return true;
  }

  if (/^(settings|setting|settings kholo|setting kholo)$/.test(low)) {
    openSheet('sheet');
    return true;
  }
  if (/^(?:memory\s+(?:kholo|dikhao|show)|show\s+memory|memory\s+open|memory\s+khulo)$/.test(low)) {
    openMemory();
    return true;
  }
  if (/clear memory|memory saaf|sab bhool jao|bhool jao sab|memory clear/.test(low)) {
    memory = normalizeMemory(null);
    saveJSON(LS.memory, memory);
    renderMemory();
    respond(LINES.memoryCleared.roman, LINES.memoryCleared.urdu);
    return true;
  }
  if (/^(?:memory\s+(?:stats|status|kitni|kitna)|yaad\s+kitna\s+hai)\??$/.test(low)) {
    respond(memStats(), '');
    return true;
  }
  if (/^(?:mujhe\s+)?(?:mere\s+baare\s+(?:me|mein|mai)\s+)?(?:kya\s+yaad\s+hai|yaad\s+kya\s+hai|memory\s+batao|memory\s+recap|what\s+do\s+you\s+remember|tumhe\s+kya\s+yaad\s+hai)\??$/.test(low)) {
    respond(memOverview(), '');
    return true;
  }
  const pinMatch = text.match(/^(?:isay|isko|yeh|ye)\s+(?:kabhi\s+)?(?:mat|na)\s+bhoolna[\s:,]+(.+)$/i) ||
    text.match(/^(?:kabhi\s+mat\s+bhoolna|pin\s+karo|pin\s+this|never\s+forget)[\s:,]+(.+)$/i);
  if (pinMatch) {
    memRememberName(pinMatch[1]);
    memSave(pinMatch[1], { importance: 5, pin: true });
    renderMemory();
    const l = replyFor(lang, 'Pinned forever, sir.', 'Hamesha ke liye yaad rakh liya, sir.', 'ہمیشہ کے لیے یاد رکھ لیا، سر۔');
    respond(l.roman, l.urdu);
    return true;
  }
  const saveMatch = text.match(/^(?:mujhe\s+)?(?:yaad\s+rakho|yaad\s+rakhna|yaad\s+rakhein|remember(?:\s+this)?|note\s+karo)[\s:,]+(?:ke\s+|that\s+)?(.{2,300})$/i);
  if (saveMatch) {
    memRememberName(saveMatch[1]);
    const saved = memSave(saveMatch[1], { importance: 4 });
    renderMemory();
    const l = saved.already
      ? replyFor(lang, 'Already remembered, sir.', 'Yeh baat pehle se yaad hai, sir.', 'یہ بات پہلے سے یاد ہے، سر۔')
      : replyFor(lang, 'Remembered, sir.', 'Yaad rakh liya, sir.', 'یاد رکھ لیا، سر۔');
    respond(l.roman, l.urdu);
    return true;
  }
  const forgetMatch = text.match(/^(?:bhool\s+jao|bhool\s+do|bhool\s+jana|forget|memory\s+se\s+hatao)[\s:,]+(?:ke\s+|that\s+)?(.{2,200})$/i);
  if (forgetMatch) {
    const pinnedHit = memSearch(forgetMatch[1], 1)[0];
    if (pinnedHit && pinnedHit.pinned) {
      respond('Sir, woh baat pinned hai. Pehle memory mein unpin karein ya "sab bhool jao" bolein.',
        'سر، وہ بات پن شدہ ہے۔ پہلے اسے اَن پن کریں یا "سب بھول جاؤ" بولیں۔');
      return true;
    }
    const removed = memRemove(forgetMatch[1]);
    renderMemory();
    const l = removed.length
      ? replyFor(lang, 'Forgotten, sir.', 'Bhool gaya, sir.', 'بھول گیا، سر۔')
      : replyFor(lang, 'I could not find that memory, sir.', 'Sir, mujhe aisi koi baat yaad nahi mili.', 'سر، مجھے ایسی کوئی بات یاد نہیں ملی۔');
    respond(l.roman, l.urdu);
    return true;
  }
  const recallMatch = text.match(/^(.{2,80}?)\s+ke\s+(?:baare|bare)\s+(?:me|mein|mai)\s+(?:kya\s+)?yaad\s+hai\??$/i) ||
    text.match(/^(?:do\s+you\s+remember|tumhe(?:n)?\s+yaad\s+hai|aapko\s+yaad\s+hai)\s+(.{2,80})$/i);
  if (recallMatch) {
    respond(memRecall(recallMatch[1]), '');
    return true;
  }
  const nameSeen = memRememberName(text);
  if (nameSeen) {
    renderMemory();
    const l = replyFor(lang,
      'Noted, ' + nameSeen + ' sir. I will remember your name.',
      'Ji ' + nameSeen + ' sir, aap ka naam yaad rakh liya.',
      'جی سر، آپ کا نام یاد رکھ لیا۔');
    respond(l.roman, l.urdu);
    return true;
  }
  if (/mic test|microphone test|mic check/.test(low)) {
    respond(LINES.micOk.roman, LINES.micOk.urdu);
    return true;
  }
  if (/^(help|madad|kya kar sakte ho|what can you do)/.test(low)) {
    respond(LINES.help.roman, LINES.help.urdu);
    return true;
  }
  if (/^(shutdown|shut down|exit|quit|app band|jarvis band|close app|bye jarvis)/.test(low)) {
    respond(LINES.bye.roman, LINES.bye.urdu);
    setTimeout(() => { try { Native.finishApp(); } catch (e) { } }, 2100);
    return true;
  }

  if (/^(time|waqt) (kya|kitna)|what time|time batao/.test(low)) {
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const l = replyFor(lang, 'It is ' + t + ', sir.', 'Sir, abhi ' + t + ' baje hain.', 'سر، ابھی ' + t + ' بجے ہیں۔');
    respond(l.roman, l.urdu);
    return true;
  }
  if (/^(date|tarikh|aaj kya din)|what.*date|today.*date/.test(low)) {
    const d = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const l = replyFor(lang, 'Today is ' + d + ', sir.', 'Sir, aaj ' + d + ' hai.', 'سر، آج ' + d + ' ہے۔');
    respond(l.roman, l.urdu);
    return true;
  }
  if (/battery|charge|charging/.test(low)) {
    try {
      const st = JSON.parse(Native.getStatus());
      const d = st.data || {};
      const b = Number(d.battery);
      if (!(b >= 0)) {
        respond('Sir, battery ka pata nahi chala.', 'سر، بیٹری کا پتہ نہیں چلا۔');
        return true;
      }
      const ch = d.charging ? ' aur charge ho rahi hai' : '';
      const l = replyFor(lang,
        'Battery is ' + b + ' percent' + (d.charging ? ' and charging' : '') + ', sir.',
        'Sir, battery ' + b + ' percent hai' + ch + '.',
        'سر، بیٹری ' + b + ' فیصد ہے' + (d.charging ? ' اور چارج ہو رہی ہے' : '') + '۔');
      respond(l.roman, l.urdu);
    } catch (e) { respond(LINES.generic.roman, LINES.generic.urdu); }
    return true;
  }

  const volMatch = low.match(/volume\s*(\d{1,3})|awaaz\s*(\d{1,3})/);
  if (volMatch) {
    const pct = clamp(parseInt(volMatch[1] || volMatch[2], 10), 0, 100);
    const r = callTool('set_volume', { percent: pct });
    toolLog('set_volume', r);
    if (r.ok) {
      const l = replyFor(lang, 'Volume set to ' + pct + ' percent, sir.', 'Sir, volume ' + pct + ' percent kar diya.', 'سر، والیوم ' + pct + ' فیصد کر دیا۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Volume change nahi hua, sir.', LINES.generic.urdu);
    }
    return true;
  }
  if (/volume (up|barhao|badhao)|awaaz (barhao|badhao|up)/.test(low)) {
    const r = callTool('set_volume', { direction: 'up' });
    toolLog('set_volume', r);
    if (r.ok) {
      const l = replyFor(lang, 'Volume up, sir.', 'Volume barha diya, sir.', 'والیوم بڑھا دیا، سر۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Volume barha nahi saka, sir.', LINES.generic.urdu);
    }
    return true;
  }
  if (/volume (down|kam|ghatao)|awaaz (kam|down)/.test(low)) {
    const r = callTool('set_volume', { direction: 'down' });
    toolLog('set_volume', r);
    if (r.ok) {
      const l = replyFor(lang, 'Volume down, sir.', 'Volume kam kar diya, sir.', 'والیوم کم کر دیا، سر۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Volume kam nahi kar saka, sir.', LINES.generic.urdu);
    }
    return true;
  }
  if (/(mute|silent) (karo|kar do|volume)|volume mute|mute volume/.test(low)) {
    const r = callTool('set_volume', { direction: 'mute' });
    toolLog('set_volume', r);
    if (r.ok) {
      const l = replyFor(lang, 'Muted, sir.', 'Volume mute kar diya, sir.', 'والیوم خاموش کر دیا، سر۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Mute nahi hua, sir.', LINES.generic.urdu);
    }
    return true;
  }

  const sceneMatch = low.match(/\b(morning|movie|sleep|guest|work|away|party|mehman|mehmaan|dawat|mehfil)\s+(mode|scene)\b/);
  if (sceneMatch) {
    const sceneName = sceneMatch[1];
    const sceneReply = await shSmartScene(sceneName);
    if (!/^Scene '/.test(String(sceneReply || ''))) {
      // Unknown scene / real failure: report what actually happened.
      respond(sceneReply, sceneReply);
      return true;
    }
    const l = replyFor(lang,
      sceneName + ' scene applied, sir.',
      'Ji sir, ' + sceneName + ' scene set kar diya.',
      'جی سر، ' + sceneName + ' سین سیٹ کر دیا۔');
    respond(l.roman, l.urdu);
    return true;
  }
  if (/^(ghar|home|house)\s*(ka\s*)?(status|haal|state)$|^smart home status$|^home status$/.test(low)) {
    const status = shHomeStatus();
    respond(status, status);
    return true;
  }
  if (/^(news|khabar|khabrein|headlines)(\s+(sunao|batao|dikhao|bolo|suno|brief))?$/.test(low) ||
      /^(aaj ki|latest|today'?s)\s+(news|khabar|khabrein|headlines)$/.test(low)) {
    const news = await newsBrief('', 5);
    respond(news, news);
    return true;
  }

  if (/(flashlight|torch) (on|chalao|jalao)/.test(low)) {
    const r = callTool('torch', { on: true });
    toolLog('torch', r);
    if (r.ok) {
      torchOn = true;
      const l = replyFor(lang, 'Flashlight on, sir.', 'Flashlight on kar di, sir.', 'فلیش لائٹ آن کر دی، سر۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Flashlight on nahi ho saka, sir.', LINES.generic.urdu);
    }
    return true;
  }
  if (/(flashlight|torch) (off|band|bujhao)/.test(low)) {
    const r = callTool('torch', { on: false });
    toolLog('torch', r);
    if (r.ok) {
      torchOn = false;
      const l = replyFor(lang, 'Flashlight off, sir.', 'Flashlight off kar di, sir.', 'فلیش لائٹ بند کر دی، سر۔');
      respond(l.roman, l.urdu);
    } else {
      respond(r.message || 'Flashlight off nahi ho saka, sir.', LINES.generic.urdu);
    }
    return true;
  }

  if (tryLocalOpen(low)) return true;
  return false;
}

/* ============================================================== GEMINI BRAIN */
function toolDeclarations() {
  return [
    {
      name: 'open_app',
      description: 'Open an installed app on this phone by name (YouTube, Chrome, Brave, Gmail, WhatsApp, Instagram, Spotify, Maps, Camera, Settings, Calculator, Clock...).',
      parameters: {
        type: 'OBJECT',
        properties: { app_name: { type: 'STRING', description: 'App name, e.g. Brave or YouTube' } },
        required: ['app_name']
      }
    },
    {
      name: 'open_url',
      description: 'Open a web link in the phone browser.',
      parameters: {
        type: 'OBJECT',
        properties: { url: { type: 'STRING', description: 'https:// link' } },
        required: ['url']
      }
    },
    {
      name: 'youtube_search',
      description: 'Open YouTube search results for a song, video or topic.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING' } },
        required: ['query']
      }
    },
    {
      name: 'youtube_channel',
      description: 'Open a YouTube channel page. Subscribing cannot be automated; the user must tap Subscribe.',
      parameters: {
        type: 'OBJECT',
        properties: { channel_name: { type: 'STRING' } },
        required: ['channel_name']
      }
    },
    {
      name: 'send_whatsapp',
      description: 'Prepare a WhatsApp message. It opens WhatsApp with the text ready; the user must tap Send.',
      parameters: {
        type: 'OBJECT',
        properties: {
          message: { type: 'STRING' },
          phone: { type: 'STRING', description: 'Optional number with country code' }
        },
        required: ['message']
      }
    },
    {
      name: 'send_sms',
      description: 'Prepare an SMS. The user must tap Send.',
      parameters: {
        type: 'OBJECT',
        properties: { phone: { type: 'STRING' }, message: { type: 'STRING' } },
        required: ['phone', 'message']
      }
    },
    {
      name: 'call_number',
      description: 'Open the dialer with a number ready.',
      parameters: {
        type: 'OBJECT',
        properties: { phone: { type: 'STRING' } },
        required: ['phone']
      }
    },
    {
      name: 'compose_email',
      description: 'Prepare an email in Gmail. The user must tap Send.',
      parameters: {
        type: 'OBJECT',
        properties: {
          to: { type: 'STRING' },
          subject: { type: 'STRING' },
          body: { type: 'STRING' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'open_gmail',
      description: 'Open the Gmail app.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'read_inbox',
      description: 'Read the latest Gmail notification summaries on this phone. Requires Notification Access. Marking emails read is NOT possible here.',
      parameters: {
        type: 'OBJECT',
        properties: { limit: { type: 'INTEGER', description: 'How many emails, default 8' } }
      }
    },
    {
      name: 'open_inbox',
      description: 'Open Gmail so the user can read or mark emails themselves.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'set_alarm',
      description: 'Set an alarm in the Clock app. The user confirms in the Clock app.',
      parameters: {
        type: 'OBJECT',
        properties: {
          hour: { type: 'INTEGER', description: '24-hour clock 0-23' },
          minute: { type: 'INTEGER' },
          label: { type: 'STRING' }
        },
        required: ['hour', 'minute']
      }
    },
    {
      name: 'set_timer',
      description: 'Set a countdown timer in the Clock app.',
      parameters: {
        type: 'OBJECT',
        properties: {
          seconds: { type: 'INTEGER' },
          label: { type: 'STRING' }
        },
        required: ['seconds']
      }
    },
    {
      name: 'navigate',
      description: 'Open Google Maps navigation to a place.',
      parameters: {
        type: 'OBJECT',
        properties: { place: { type: 'STRING' } },
        required: ['place']
      }
    },
    {
      name: 'web_search',
      description: 'Open a Google search in the browser.',
      parameters: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING' } },
        required: ['query']
      }
    },
    {
      name: 'device_status',
      description: 'Get real battery, charging, network and storage status of this phone.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'set_volume',
      description: 'Change media volume: direction up/down/mute/unmute, or percent 0-100.',
      parameters: {
        type: 'OBJECT',
        properties: {
          direction: { type: 'STRING' },
          percent: { type: 'INTEGER' }
        }
      }
    },
    {
      name: 'torch',
      description: 'Turn the phone flashlight on or off.',
      parameters: {
        type: 'OBJECT',
        properties: { on: { type: 'BOOLEAN' } },
        required: ['on']
      }
    },
    {
      name: 'open_settings',
      description: 'Open a phone settings screen: wifi, bluetooth, sound, display, battery, location, accessibility...',
      parameters: {
        type: 'OBJECT',
        properties: { section: { type: 'STRING' } }
      }
    },
    {
      name: 'list_apps',
      description: 'List installed apps on this phone.',
      parameters: {
        type: 'OBJECT',
        properties: { limit: { type: 'INTEGER' } }
      }
    },
    {
      name: 'share_text',
      description: 'Open the Android share menu with text.',
      parameters: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' } },
        required: ['text']
      }
    },
    {
      name: 'open_play_store',
      description: 'Open Play Store search for an app.',
      parameters: {
        type: 'OBJECT',
        properties: { app_name: { type: 'STRING' } },
        required: ['app_name']
      }
    },
    {
      name: 'install_app',
      description: 'Search an app on the Play Store, tap Install (or Update), wait for the download, then open it. Use this for "install Duolingo", "ye app install karo". Requires Phone automation enabled; if it is off the result asks the user to enable it.',
      parameters: {
        type: 'OBJECT',
        properties: {
          app_name: { type: 'STRING', description: 'Exact app name, e.g. Duolingo' }
        },
        required: ['app_name']
      }
    },
    {
      name: 'ui_dump',
      description: 'Read the visible text and buttons of the CURRENT screen (any app). Use it when the user refers to what is on screen.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'ui_click',
      description: 'Tap a visible button, link or label on the current screen by its text. Works in any app when Phone automation is enabled.',
      parameters: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING', description: 'Visible label, e.g. Install or Follow' } },
        required: ['text']
      }
    },
    {
      name: 'ui_type',
      description: 'Type text into the focused (or first) text field of the current screen.',
      parameters: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' } },
        required: ['text']
      }
    },
    {
      name: 'system_action',
      description: 'Press a phone system button: back, home, recents, notifications, quick_settings, lock, screenshot.',
      parameters: {
        type: 'OBJECT',
        properties: { action: { type: 'STRING' } },
        required: ['action']
      }
    },
    {
      name: 'smart_home',
      description: 'Control the smart home: lights, fans, AC, TV, doors, blinds, coffee machine and plugs. The built-in virtual home needs no setup. Use "all"/"sab" for every device of a type.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: {
            type: 'STRING',
            description: 'status, on, off, toggle, brightness, temperature, volume, channel, speed, lock, unlock, open, close or sync'
          },
          device: {
            type: 'STRING',
            description: 'Room and/or type, e.g. "drawing room light", "bedroom ac", "tv", "main door", "kitchen blinds", "coffee machine", "iron plug", "all lights"'
          },
          value: { type: 'STRING', description: 'Number/text for brightness, temperature, volume, channel or speed' }
        }
      }
    },
    {
      name: 'smart_scene',
      description: 'Apply a whole-home scene: morning, movie, sleep, guest, work, away or party.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Scene name, e.g. movie, good night, mehman, bahar ja raha hoon' }
        },
        required: ['name']
      }
    },
    {
      name: 'smart_home_setup',
      description: 'Connect or disconnect an optional Home Assistant instance with its URL and a long-lived access token. The virtual home works without this.',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING', description: 'Home Assistant URL, e.g. http://192.168.1.10:8123' },
          token: { type: 'STRING', description: 'Long-lived access token; leave empty to keep the saved one' },
          enabled: { type: 'BOOLEAN', description: 'false disables Home Assistant and keeps the virtual home' }
        }
      }
    },
    {
      name: 'smart_home_help',
      description: 'Explain the smart-home devices, commands and scenes.',
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'news_brief',
      description: 'Read the latest news headlines from Google News. No API key is needed. Never invent headlines; use exactly what this tool returns.',
      parameters: {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING', description: 'Optional subject, e.g. Pakistan, technology, cricket. Empty for top headlines.' },
          count: { type: 'INTEGER', description: 'How many headlines, 1-8, default 5' }
        }
      }
    },
    {
      name: 'remember',
      description: 'Save a lasting fact about the user in long-term memory (name, preferences, projects, goals, people, routine). Use pin:true only for a detail that must never be forgotten.',
      parameters: {
        type: 'OBJECT',
        properties: {
          fact: { type: 'STRING', description: 'Short English fact, e.g. "Likes black coffee in the morning."' },
          category: { type: 'STRING', description: 'identity, preference, project, goal, routine, health, people, work or general' },
          importance: { type: 'INTEGER', description: '1-5, default 3' },
          pin: { type: 'BOOLEAN', description: 'true keeps this memory forever' }
        },
        required: ['fact']
      }
    },
    {
      name: 'recall_memory',
      description: 'Search long-term memory (facts, pins and earlier conversation notes) for anything about a topic. Use before saying you do not remember.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Topic to recall, e.g. "my project" or "favourite drink"' }
        },
        required: ['query']
      }
    },
    {
      name: 'forget_memory',
      description: 'Delete one saved memory that matches the query. Only use when the user asks to forget it.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Text or topic to forget' }
        },
        required: ['query']
      }
    }
  ];
}

function buildSystemPrompt(userText) {
  const langMode = settings.langMode;
  const langLine = langMode === 'en'
    ? 'The user chose ENGLISH ONLY. Reply in English. The ROMAN line must be plain English and the URDU line repeats the same English.'
    : langMode === 'ur'
      ? 'The user chose ROMAN URDU. Reply in natural Pakistani Roman Urdu (simple everyday words, like a friend talking), and give the same in Urdu script.'
      : 'Match the user: English input -> English reply; Roman Urdu / Urdu / Hindi input -> natural Pakistani Roman Urdu reply. The ROMAN line must sound like a real Pakistani person talking casually, never like an English sentence with Urdu words pasted in.';

  // Only relevant, recent and pinned memories go into the prompt. This keeps
  // the request small (faster replies) while still recalling the right detail.
  const memoryBlock = memContext(userText || '');

  let automation = false;
  try { automation = !!Native.hasAutomation(); } catch (e) { }

  const now = new Date();
  const timeText = now.toLocaleString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  return [
    'You are J.A.R.V.I.S. ("Jarvis"), the user\'s personal Android assistant — the same Jarvis as on their PC, now inside their phone. Call the user "sir".',
    'PERSONALITY: warm, quick-witted, calm, extremely capable. When asked for advice give ONE clear recommendation with a short reason, never "it depends". One short follow-up question only if it truly helps.',
    'You are the MOBILE version: you control this phone, not a PC. For PC-only things (desktop files, Word) say it in one short line and offer the phone alternative.',
    'THINK FIRST: the user speaks English and Roman Urdu and speech recognition makes mistakes ("jaadui", "travis" = Jarvis; wrong app/song names). Infer the real intent. Resolve "isko", "woh", "yahan" from the conversation and from ui_dump.',
    'ACT, DO NOT LECTURE: use tools immediately and chain them until the WHOLE request is done. Never tell the user to do the remaining steps themselves. If a tool fails, try another way, then report the real reason in one short sentence.',
    'HONESTY: say a task is done only when a tool returned ok:true. If needs_user_action:true, say what to tap. Never invent emails, messages, alarms, installs or subscriptions. YouTube subscribe and Gmail mark-as-read cannot be automated.',
    'PHONE POWERS: open apps; Play Store search and REAL install (install_app taps Install and Open when Phone automation is on); read screen (ui_dump); tap (ui_click); type (ui_type); Back/Home/Recents/Notifications (system_action); YouTube search; WhatsApp/SMS/email drafts; alarms; timers; maps; volume; torch; battery/network; clipboard; memory.',
    'SMART HOME: smart_home controls lights, fans, AC, TV, doors, blinds, coffee and plugs. A virtual home works with no setup; Home Assistant is optional. For "light on karo", "AC 22 degree", "TV band", "darwaza lock", "parda kholo" call smart_home. smart_scene applies morning/movie/sleep/guest/work/away/party for "movie mode" or "good night". Use smart_home_help if unsure.',
    'NEWS: news_brief reads live Google News headlines with no API key. Use it for "news sunao" or "latest news about cricket". Read only what it returned; never invent headlines.',
    'INSTALL: for "X install karo" call install_app ONCE with the exact app name, not open_play_store too. Wait for the result and report exactly what happened.',
    'AUTOMATION: ' + (automation
      ? 'ON — you can tap through other apps. Use ui_dump before tapping.'
      : 'OFF — ui_click / ui_type / ui_dump / system_action and full install will ask the user to enable it. App opens, Play Store search and normal tools still work.'),
    'MEMORY: you have real long-term memory on this phone. When the user shares something lasting, or says "yaad rakho" / "never forget", call remember with a short English fact, a category and importance (pin:true for a permanent detail). When asked what you remember about a topic, call recall_memory FIRST; never say you forgot before checking. Use forget_memory when the user asks you to forget something. Answer naturally and never read the whole list out.',
    'SPEED AND STYLE: your answer is spoken aloud. Answer the question asked, do not pad. Actions: 1-2 short sentences. Questions: up to 4 short sentences. No lists, markdown, emojis or stage directions.',
    'MEMORY (about the user):',
    memoryBlock,
    'LANGUAGE: ' + langLine,
    'NOW: ' + timeText,
    'OUTPUT: exactly two lines, nothing else:',
    'ROMAN: <reply in English or Roman Urdu as the language rule says>',
    'URDU: <the same reply in Urdu script>'
  ].join('\n');
}

function apiError(code, body) {
  let status = '';
  let message = '';
  try {
    const j = JSON.parse(body);
    status = (j.error && (j.error.status || j.error.code)) || '';
    message = (j.error && j.error.message) || body;
  } catch (e) {
    message = String(body || '');
  }
  const err = new Error(message || ('HTTP ' + code));
  err.code = code;
  err.status = String(status || '');
  err.body = body;
  const s = (err.status + ' ' + message).toLowerCase();
  err.timeout = /timeout|timed out|deadline/.test(s);
  err.network = code === 0 && /unknownhost|unable to resolve|connect|network|refused|unreachable|ssl|certificate|no address|failed to connect/.test(s);
  return err;
}

window.__jarvisHttp = function (id, code, body) {
  const p = pendingRequests[id];
  try { Native.log('HTTP_RES ' + id + ' code=' + code + ' body=' + String(body || '').slice(0, 240)); } catch (e) { }
  if (!p) return;
  delete pendingRequests[id];
  clearTimeout(p.timer);
  if (code >= 200 && code < 300) {
    p.resolve(body);
  } else {
    p.reject(apiError(code, body));
  }
};

function geminiRequest(model, payload, timeoutMs) {
  const limit = Math.max(5000, Math.min(20000, timeoutMs || 12000));
  return new Promise((resolve, reject) => {
    const id = 'r' + (++reqSeq);
    const timer = setTimeout(() => {
      if (pendingRequests[id]) {
        delete pendingRequests[id];
        const err = new Error('Gemini request timeout');
        err.code = 0;
        err.timeout = true;
        reject(err);
      }
    }, limit + 1000);
    pendingRequests[id] = { resolve, reject, timer };
    try { Native.log('HTTP_SEND ' + id + ' ' + model); } catch (e) { }
    try {
      Native.httpGemini(id, model, JSON.stringify(payload), limit);
    } catch (e) {
      delete pendingRequests[id];
      clearTimeout(timer);
      reject(apiError(0, JSON.stringify({ error: { message: String(e), status: 'TRANSPORT' } })));
    }
  });
}

async function runTool(name, args) {
  if (name === 'smart_home') {
    return { ok: true, message: await shSmartHome(args && args.action, args && args.device, args && args.value) };
  }
  if (name === 'smart_scene') {
    return { ok: true, message: await shSmartScene(args && args.name) };
  }
  if (name === 'smart_home_setup') {
    return { ok: true, message: await shSmartHomeSetup(args && args.url, args && args.token, !(args && args.enabled === false)) };
  }
  if (name === 'smart_home_help') {
    return { ok: true, message: shSmartHomeHelp() };
  }
  if (name === 'news_brief') {
    return { ok: true, message: await newsBrief(args && args.topic, args && args.count) };
  }
  if (name === 'remember') {
    const fact = String((args && (args.fact || args.text)) || '').trim();
    if (!fact) return { ok: false, message: 'Kya yaad rakhna hai?' };
    const saved = memSave(fact, {
      category: String((args && args.category) || ''),
      importance: args && args.importance,
      pin: !!(args && args.pin)
    });
    renderMemory();
    return { ok: true, message: saved.already ? 'Yeh baat pehle se yaad hai.' : 'Yaad rakh liya.' };
  }
  if (name === 'recall_memory') {
    const query = String((args && args.query) || '').trim();
    return { ok: true, message: query ? memRecall(query) : memOverview() };
  }
  if (name === 'forget_memory') {
    const query = String((args && args.query) || '').trim();
    const removed = memRemove(query);
    renderMemory();
    if (!removed.length) return { ok: false, message: 'Mujhe aisi koi memory nahi mili.' };
    return { ok: true, message: 'Bhool gaya: ' + removed.map(f => f.text).join('; ') };
  }
  return callTool(name, args || {});
}

async function toolLoop(model, baseContents, systemPrompt, simpleRequest) {
  const contents = baseContents.map(c => JSON.parse(JSON.stringify(c)));
  const fast = isFastMode();
  const requestTimeout = fast ? 8500 : 12000;
  const maxOutputTokens = fast ? 500 : 900;
  let useThinking = fast;
  for (let round = 0; round < 8; round++) {
    const generationConfig = {
      temperature: fast ? 0.45 : 0.55,
      maxOutputTokens
    };
    const think = useThinking ? thinkingConfigFor(model) : null;
    if (think) generationConfig.thinkingConfig = think;
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: toolDeclarations() }],
      generationConfig
    };
    let raw;
    try {
      raw = await geminiRequest(model, payload, requestTimeout);
    } catch (e) {
      // Some keys/models reject thinkingConfig. Retry once without it instead
      // of failing the whole command.
      if (think && String(e.status || '').indexOf('INVALID_ARGUMENT') >= 0) {
        useThinking = false;
        round--;
        continue;
      }
      throw e;
    }
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('Gemini ne ghalat jawab bheja.'); }
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('Gemini ne jawab block kar diya (' + data.promptFeedback.blockReason + ').');
    }
    const cand = data.candidates && data.candidates[0];
    if (!cand) throw new Error('Gemini se koi jawab nahi aaya.');
    const parts = (cand.content && cand.content.parts) || [];
    const calls = parts.filter(p => p && p.functionCall);

    if (calls.length) {
      contents.push({ role: 'model', parts });
      const responses = [];
      const results = [];
      for (const part of calls) {
        const fc = part.functionCall;
        let result;
        try {
          result = await runTool(fc.name, fc.args || {});
        } catch (e) {
          result = { ok: false, message: 'Tool error: ' + e };
        }
        toolLog(fc.name, result);
        results.push({ name: fc.name, result });
        responses.push({ functionResponse: { name: fc.name, response: result } });
      }
      // Fast path: the tool already produced the exact sentence to speak, so
      // skip the second Gemini call that used to add 2-4 seconds.
      const direct = directToolReply(results, simpleRequest);
      if (direct) return 'ROMAN: ' + direct;
      contents.push({ role: 'user', parts: responses });
      continue;
    }

    const text = parts.filter(p => p && p.text && !p.thought).map(p => p.text).join('\n').trim();
    if (text) return text;
    throw new Error('Gemini ne khali jawab diya.');
  }
  throw new Error('Kaam mukammal nahi ho saka, tools bar bar chal rahe the.');
}

async function askBrain(userText) {
  const fast = isFastMode();
  // Short history keeps the request small: a big prompt was the main reason
  // replies took several seconds. Fast mode needs far less context for speech.
  const turns = fast ? 8 : 10;
  const chars = fast ? 550 : 700;
  const contents = history.slice(-turns).map(item => ({
    role: item.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(item.text || '').slice(0, chars) }]
  }));
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: userText }] });
  }
  const systemPrompt = buildSystemPrompt(userText);
  const models = settings.model === 'smart' ? SMART_MODELS : FAST_MODELS;
  let ordered = models;
  try {
    const cached = localStorage.getItem(LS.goodModel) || '';
    if (cached && models.indexOf(cached) >= 0) {
      ordered = [cached].concat(models.filter(m => m !== cached));
    }
  } catch (e) { }
  const simpleRequest = isSimpleActionText(userText);
  const started = Date.now();
  const budget = fast ? 15000 : 18000;
  let last = null;

  for (const model of ordered) {
    if (Date.now() - started > budget) break;
    try { Native.log('ASK ' + model); } catch (e) { }
    try {
      const reply = await toolLoop(model, contents, systemPrompt, simpleRequest);
      try { localStorage.setItem(LS.goodModel, model); } catch (e) { }
      return reply;
    } catch (e) {
      last = e;
      if (e.code === 401 || e.code === 403 || e.code === 429) break;
      // 404 (model gone), 500/503/504, timeout: try the next model.
    }
  }
  throw last || new Error('Gemini se jawab nahi aaya.');
}

function parseReply(text) {
  let body = String(text || '').trim();
  let urdu = '';
  const mu = body.match(/(?:^|\n)\s*URDU\s*:\s*([\s\S]*)$/i);
  if (mu) {
    urdu = mu[1].trim();
    body = body.slice(0, mu.index).trim();
  }
  let roman = body.replace(/^\s*ROMAN\s*:\s*/i, '').trim();
  if (!roman) roman = urdu;
  roman = stripMarkdown(roman);
  urdu = urdu.replace(/^\s*URDU\s*:\s*/i, '').trim();
  return { roman, urdu };
}

function errorReply(err) {
  const msg = String((err && (err.status + ' ' + err.message)) || '').toLowerCase();
  let line = LINES.generic;
  if ((err && err.code === 401) || (err && err.code === 403)) line = LINES.keyBad;
  else if (err && err.code === 429) line = LINES.quota;
  else if (/no_api_key/.test(msg)) line = LINES.keyMissing;
  else if (err && (err.timeout || [500, 502, 503, 504].includes(err.code)) ||
           /deadline|overloaded|unavailable|timed out|timeout/.test(msg)) line = LINES.server;
  else if ((err && err.network) || /unknownhost|no address|connection refused|network is unreachable|ssl|certificate/.test(msg)) line = LINES.network;

  addSystemLine('ERROR · ' + ((err && err.message) || 'unknown'), true);
  try { Native.log('ERR ' + ((err && (err.status + ' ' + err.message)) || 'unknown')); } catch (e) { }
  respond(line.roman, line.urdu);
}

async function handleCommand(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  try { Native.log('CMD ' + text); } catch (e) { }
  transcript('');
  hideWelcome();
  addBubble('user', text);
  history.push({ role: 'user', text });
  trimHistory();
  saveJSON(LS.history, history);

  let handledLocally = false;
  try { handledLocally = await localCommand(text); }
  catch (e) {
    try { Native.log('LOCAL_ERR ' + (e && (e.stack || e.message || e))); } catch (x) { }
  }
  if (handledLocally) return;

  busy = true;
  setState('thinking');
  // No mic restarts while the brain is working or the voice is answering.
  try { Native.holdListening(true); } catch (e) { }
  try {
    const reply = await askBrain(text);
    const parsed = parseReply(reply);
    if (!parsed.roman && !parsed.urdu) throw new Error('Khali jawab.');
    respond(parsed.roman, parsed.urdu);
  } catch (e) {
    try { Native.log('CATCH ' + (e && (e.stack || e.message || e))); } catch (x) { }
    errorReply(e);
  } finally {
    busy = false;
    if (state !== 'speaking' && !micMuted) {
      try { Native.holdListening(false); } catch (e) { }
    }
  }
}

/* ================================================================ SETTINGS */
function saveSettings() {
  saveJSON(LS.settings, settings);
  try {
    Native.setVoicePrefs(settings.voiceGender, settings.rate, settings.voiceName || '');
    Native.setNeuralPrefs(settings.neuralVoice !== false, settings.neuralVoiceName || 'Charon');
  } catch (e) { }
}

function applyVoiceGender(gender, force) {
  if (settings.voiceLocked && !force && gender !== settings.voiceGender) {
    respond(LINES.voiceLocked.roman, LINES.voiceLocked.urdu);
    return;
  }
  if (settings.voiceLocked && gender !== 'male' && !force) {
    respond(LINES.voiceLocked.roman, LINES.voiceLocked.urdu);
    return;
  }
  settings.voiceGender = gender;
  settings.voiceName = '';
  saveSettings();
  renderSettings();
  const line = gender === 'female' ? LINES.female : LINES.male;
  respond(line.roman, line.urdu);
}

function renderSettings() {
  const modelSeg = $('#modelSeg');
  if (modelSeg) $$('button', modelSeg).forEach(b => b.classList.toggle('active', b.dataset.model === settings.model));
  const voiceSeg = $('#voiceSeg');
  if (voiceSeg) $$('button', voiceSeg).forEach(b => b.classList.toggle('active', b.dataset.gender === settings.voiceGender));
  const langSeg = $('#langSeg');
  if (langSeg) $$('button', langSeg).forEach(b => b.classList.toggle('active', b.dataset.lang === settings.langMode));

  const lockState = $('#lockState');
  const lockBtn = $('#lockBtn');
  if (lockState) {
    lockState.textContent = 'VOICE LOCK: ' + (settings.voiceLocked ? 'ON' : 'OFF');
    lockState.classList.toggle('off', !settings.voiceLocked);
  }
  if (lockBtn) lockBtn.textContent = settings.voiceLocked ? 'Unlock' : 'Lock';

  const rate = $('#rateRange');
  if (rate) rate.value = String(settings.rate);
  const rateVal = $('#rateVal');
  if (rateVal) rateVal.textContent = Number(settings.rate).toFixed(2);

  const hands = $('#handsFreeToggle');
  if (hands) hands.checked = !!settings.handsFree;
  const wake = $('#wakeToggle');
  if (wake) wake.checked = !!settings.wakeRequired;
  const bg = $('#alwaysOnToggle');
  if (bg) bg.checked = settings.alwaysOn !== false;
  const bgState = $('#bgState');
  if (bgState) {
    bgState.textContent = settings.alwaysOn !== false
      ? 'ON — app band karne ke baad bhi “Hey Jarvis” sunta rahega (notification rehti hai).'
      : 'Off — sirf app khuli ho tab sunta hai.';
  }

  const keyHint = $('#keyHint');
  if (keyHint) {
    let mask = '';
    try { mask = Native.getKeyMask(); } catch (e) { }
    keyHint.textContent = mask ? 'Key set hai: ' + mask : 'Key set nahi hai.';
  }

  const notifState = $('#notifState');
  if (notifState) {
    let ok = false;
    try { ok = Native.hasNotificationAccess(); } catch (e) { }
    notifState.textContent = ok ? 'Permission ON — inbox summary ready.' : 'Permission nahi hai.';
  }

  const urduHint = $('#urduVoiceHint');
  if (urduHint) {
    let has = false;
    try { has = Native.hasUrduVoice(); } catch (e) { }
    urduHint.textContent = has
      ? 'Urdu TTS voice mil gayi: Urdu script mein sunaya jayega.'
      : 'Urdu TTS voice install nahi. Roman Urdu ko en-IN male voice mein sunaya jayega.';
  }

  const neuralToggle = $('#neuralToggle');
  if (neuralToggle) neuralToggle.checked = settings.neuralVoice !== false;
  const neuralVoice = $('#neuralVoice');
  if (neuralVoice) neuralVoice.value = settings.neuralVoiceName || 'Charon';
  const neuralHint = $('#neuralHint');
  if (neuralHint) {
    neuralHint.textContent = settings.neuralVoice === false
      ? 'Neural voice off — Android ki default awaaz.'
      : 'Neural voice: ' + (settings.neuralVoiceName || 'Charon') + ' (Gemini TTS)';
  }

  const autoState = $('#autoState');
  const autoBtn = $('#autoBtn');
  if (autoState) {
    let on = false;
    try { on = !!Native.hasAutomation(); } catch (e) { }
    autoState.textContent = on
      ? 'ON — Jarvis khud buttons dabata hai, Play Store install bhi.'
      : 'Off hai — Play Store install aur screen taps ke liye on karein.';
    if (autoBtn) autoBtn.textContent = on ? 'Settings' : 'Enable';
  }

  const shState = $('#shState');
  if (shState) shState.textContent = shConfigStatus();
  const haUrl = $('#haUrl');
  if (haUrl && !haUrl.value) {
    try { haUrl.value = shLoadConfig().url || ''; } catch (e) { }
  }
  const haToken = $('#haToken');
  if (haToken) {
    let saved = false;
    try { saved = !!shLoadConfig().token; } catch (e) { }
    haToken.placeholder = saved ? 'Token saved — leave blank to keep' : 'Long-lived access token (optional)';
  }

  const memCount = $('#memoryCount');
  if (memCount) {
    const pins = (memory.facts || []).filter(f => f.pinned).length;
    memCount.textContent = (memory.facts || []).length + ' baatein yaad hain' + (pins ? ' (' + pins + ' pinned)' : '') + '.';
  }

  const about = $('#aboutText');
  if (about) {
    let v = '2.1.0';
    let d = 'Android';
    try { v = Native.version(); d = Native.deviceSummary(); } catch (e) { }
    about.textContent = 'Jarvis Mobile ' + v + ' · ' + d;
  }
}

/* --------------------------------------------------------- first-run key */
function isKeySet() {
  try { return !!Native.hasApiKey(); } catch (e) { return false; }
}

function openAiStudio() {
  const url = 'https://aistudio.google.com/app/apikey';
  try {
    if (hasNative && typeof Native.openUrl === 'function') {
      Native.openUrl(url);
      return;
    }
    window.open(url, '_blank');
  } catch (e) {
    try { Native.copyText(url); } catch (x) { }
    toast('Google AI Studio: ' + url);
  }
}

function renderSetupKeyState() {
  const hint = $('#setupKeyStatus');
  if (!hint) return;
  let mask = '';
  try { mask = Native.getKeyMask(); } catch (e) { }
  hint.textContent = mask ? 'Key set hai: ' + mask : 'Key set nahi hai.';
}

function showKeySetup() {
  closeSheets();
  const el = $('#keySetup');
  if (el) el.classList.remove('hidden');
  renderSetupKeyState();
}

function hideKeySetup() {
  const el = $('#keySetup');
  if (el) el.classList.add('hidden');
}

function saveSetupKey() {
  const input = $('#setupKeyInput');
  const key = input ? input.value.trim() : '';
  if (!key) { toast('Pehle Gemini API key paste karein.'); return; }
  let ok = false;
  try { ok = Native.setApiKey(key); } catch (e) { ok = false; }
  if (!ok) {
    const hint = $('#setupKeyStatus');
    if (hint) hint.textContent = 'Key theek nahi lag rahi — pura key paste karein (AIza... ya AQ...).';
    toast('Key theek nahi lag rahi.');
    return;
  }
  if (input) input.value = '';
  if (input) input.type = 'password';
  hideKeySetup();
  renderSettings();
  updateConnState();
  try { Native.requestMicPermission(); } catch (e) { }
  try { Native.warmVoice(); } catch (e) { }
  setTimeout(() => {
    respond(LINES.welcome.roman, LINES.welcome.urdu);
    if (settings.handsFree && state === 'idle') scheduleListen(700);
  }, 320);
}

function openSheet(id) {
  closeSheets();
  const overlay = $('#overlay');
  const sheet = document.getElementById(id);
  if (overlay) overlay.classList.remove('hidden');
  if (sheet) sheet.classList.remove('hidden');
  document.body.classList.add('sheet-open');
  if (id === 'sheet') renderSettings();
  if (id === 'memorySheet') renderMemory();
  if (id === 'voiceSheet') renderVoices();
}

function closeSheets() {
  const overlay = $('#overlay');
  if (overlay) overlay.classList.add('hidden');
  $$('.sheet').forEach(s => s.classList.add('hidden'));
  document.body.classList.remove('sheet-open');
}

function anySheetOpen() {
  const overlay = $('#overlay');
  return $$('.sheet').some(s => !s.classList.contains('hidden')) ||
    !!(overlay && !overlay.classList.contains('hidden'));
}

function applySettingsInitial() {
  if (!saved || !Object.keys(saved).length) {
    try {
      const vp = JSON.parse(Native.getVoicePrefs());
      if (vp) {
        settings.voiceGender = vp.gender || 'male';
        settings.rate = clamp(Number(vp.rate) || 0.97, 0.7, 1.3);
        settings.voiceName = vp.voice_name || '';
      }
    } catch (e) { }
    try {
      const np = JSON.parse(Native.getNeuralPrefs());
      if (np) {
        settings.neuralVoice = np.enabled !== false;
        settings.neuralVoiceName = np.voice || 'Charon';
      }
    } catch (e) { }
  }
  settings.voiceGender = settings.voiceGender === 'female' ? 'female' : 'male';
  if (!settings.neuralVoiceName) settings.neuralVoiceName = 'Charon';
  saveSettings();
  renderSettings();
}

/* ------------------------------------------------------------------ memory */
function renderMemory() {
  const list = $('#memoryList');
  if (!list) return;
  list.textContent = '';
  const facts = (memory.facts || []).slice().sort((a, b) =>
    (b.pinned - a.pinned) || (b.importance - a.importance) || ((b.updated || 0) - (a.updated || 0)));
  if (!facts.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Abhi koi memory nahi hai. "Yaad rakho ..." bol kar kuch bhi sikhayein.';
    list.appendChild(p);
  } else {
    facts.forEach(fact => {
      const row = document.createElement('div');
      row.className = 'memory-item' + (fact.pinned ? ' pinned' : '');
      const span = document.createElement('span');
      const cat = document.createElement('b');
      cat.className = 'memory-cat';
      cat.textContent = MEM_LABELS[fact.category] || 'Other';
      span.appendChild(cat);
      span.appendChild(document.createTextNode(fact.text));
      const pin = document.createElement('button');
      pin.className = 'memory-pin';
      pin.textContent = fact.pinned ? '★' : '☆';
      pin.title = fact.pinned ? 'Unpin' : 'Pin forever';
      pin.setAttribute('aria-label', pin.title);
      pin.onclick = () => {
        fact.pinned = !fact.pinned;
        fact.updated = Date.now();
        saveJSON(LS.memory, memory);
        renderMemory();
        renderSettings();
      };
      const del = document.createElement('button');
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete');
      del.onclick = () => {
        memory.facts = memory.facts.filter(f => f.id !== fact.id);
        saveJSON(LS.memory, memory);
        renderMemory();
        renderSettings();
      };
      row.appendChild(span);
      row.appendChild(pin);
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  const count = $('#memoryCount');
  if (count) {
    const pins = (memory.facts || []).filter(f => f.pinned).length;
    count.textContent = (memory.facts || []).length + ' baatein yaad hain' +
      (pins ? ' (' + pins + ' pinned)' : '') + '.';
  }
}

function openMemory() {
  openSheet('memorySheet');
}

function addMemoryFact() {
  const input = $('#memoryInput');
  if (!input) return;
  const fact = input.value.trim();
  if (!fact) return;
  memRememberName(fact);
  memSave(fact, { importance: 3 });
  input.value = '';
  renderMemory();
  renderSettings();
  toast('Yaad rakh liya.');
}

/* ------------------------------------------------------------------ voices */
function renderVoices(attempt) {
  attempt = attempt || 0;
  const list = $('#voiceList');
  if (!list) return;
  list.textContent = '';
  let voices = [];
  try { voices = JSON.parse(Native.getVoices()); } catch (e) { voices = []; }
  voices = voices.filter(v => v && v.locale && /^(en|ur)/i.test(v.locale));
  voices.sort((a, b) => {
    const score = v => {
      let s = 0;
      if (v.gender === 'male') s += 1000;
      if (/^en-IN/i.test(v.locale)) s += 200;
      if (/^en-GB/i.test(v.locale)) s += 120;
      if (/^ur/i.test(v.locale)) s += 60;
      if (v.network) s -= 30;
      return s - (Number(v.quality) || 0);
    };
    return score(b) - score(a);
  });

  if (!voices.length) {
    // TTS engine may still be initialising right after boot; retry a few times.
    if (attempt < 3) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Voices load ho rahi hain...';
      list.appendChild(p);
      clearTimeout(voicesRetry);
      voicesRetry = setTimeout(() => renderVoices(attempt + 1), 900);
      return;
    }
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Koi installed voice nahi mili. Android Settings > Text-to-speech se voice install karein.';
    list.appendChild(p);
    return;
  }
  clearTimeout(voicesRetry);
  voicesRetry = null;

  voices.slice(0, 60).forEach(v => {
    const b = document.createElement('button');
    b.className = 'voice-item' + (settings.voiceName === v.name ? ' active' : '');
    const name = document.createElement('b');
    name.textContent = (v.gender === 'male' ? '♂ ' : v.gender === 'female' ? '♀ ' : '') +
      (v.name || 'voice');
    const small = document.createElement('small');
    small.textContent = v.locale + ' · q' + (v.quality || 0) + (v.network ? ' · network' : ' · offline');
    b.appendChild(name);
    b.appendChild(small);
    b.onclick = () => {
      if (settings.voiceLocked && v.gender === 'female') {
        toast('Voice lock ON hai — pehle Unlock karein.');
        return;
      }
      settings.voiceName = v.name || '';
      if (v.gender === 'male' || v.gender === 'female') settings.voiceGender = v.gender;
      saveSettings();
      renderSettings();
      renderVoices();
      toast('Voice chun li: ' + (v.name || v.locale));
      try { Native.speak('Ji sir, yeh meri nayi awaaz hai.', 'جی سر، یہ میری نئی آواز ہے۔'); } catch (e) { }
    };
    list.appendChild(b);
  });
}

/* ================================================================ QUICK ACTIONS */
function quickAction(key) {
  if (key === 'flashlight') {
    const want = !torchOn;
    const r = callTool('torch', { on: want });
    toolLog('torch', r);
    if (r.ok) torchOn = want;
    toast(r.ok ? (torchOn ? 'Flashlight on.' : 'Flashlight off.') : (r.message || 'Flashlight control nahi hua.'));
    return;
  }
  const map = {
    youtube: 'youtube',
    gmail: 'gmail',
    whatsapp: 'whatsapp',
    maps: 'maps',
    camera: 'camera'
  };
  const app = map[key];
  if (!app) return;
  const r = callTool('open_app', { app_name: app });
  toolLog('open_app', r);
  toast(r.message || (r.ok ? 'Khol diya.' : 'Nahi khul saka.'));
}

/* ================================================================ WAKE WORD */
function wakeCommand(text) {
  const clean = String(text || '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = clean.match(/^(?:hey|hi|ok|okay|salam|assalam|aray|are)?\s*(jarvis|javis|jarviss|jaarvis|jaadui|jadui|jarv|jaarv|jarwis)\b[\s,.]*(.*)$/);
  if (!m) return null;
  return (m[2] || '').trim();
}

function stripWake(text) {
  const clean = String(text || '').replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(?:hey|hi|ok|okay|salam|assalam|aray|are)?\s*(jarvis|javis|jarviss|jaarvis|jaadui|jadui|jarv|jaarv|jarwis)\b[\s,.]*(.*)$/i);
  return m ? (m[2] || '').trim() : clean;
}

/* ================================================================ NATIVE HOOKS */
window.jarvisNative = {
  onTtsDone() {
    if (state === 'speaking') finishSpeaking();
  },
  onTtsError(message) {
    if (message) addSystemLine('VOICE · ' + message, true);
    if (state === 'speaking') finishSpeaking();
  },
  onSpeechReady() {
    // A background restart of the recognizer happens inside native code, so
    // the UI has to follow it here; otherwise the transcript is thrown away.
    // Ignore stale callbacks that arrive while muted or while TTS is running.
    if (micMuted || state === 'thinking' || state === 'speaking') return;
    if (state !== 'listening') {
      setState('listening');
      transcript('');
    }
    if (stateLabelEl) stateLabelEl.textContent = 'BOLIYE...';
    armListenSafety(15000);
  },
  onSpeechPartial(text) {
    if (!micMuted && state === 'listening') transcript(text);
  },
  onSpeechFinal(text, alternativesJson) {
    if (micMuted) {
      try { Native.cancelListening(); } catch (e) { }
      return;
    }
    if (state !== 'listening') return;
    clearListenSafety();
    micStartPending = false;
    // Stop any native restart that was already queued before we decide
    // whether this utterance was a command.
    try { Native.holdListening(true); } catch (e) { }
    let alts = [];
    try { alts = JSON.parse(alternativesJson || '[]'); } catch (e) { alts = []; }
    if (!Array.isArray(alts)) alts = [];
    const heard = chooseHeard(text || '', alts);
    let command = heard || '';
    transcript('“' + command + '”');
    try {
      Native.log('HEARD ' + JSON.stringify({ raw: text || '', chosen: command, alts: alts.slice(0, 8) }));
    } catch (e) { }

    if (!pushToTalk && settings.wakeRequired) {
      const rest = wakeCommand(command);
      if (rest === null) {
        // No wake word: stay quiet and listen again if hands-free.
        setState('idle');
        if (settings.handsFree) scheduleListen(500);
        return;
      }
      if (!rest) {
        respond(LINES.yesSir.roman, LINES.yesSir.urdu);
        return;
      }
      command = rest;
    } else {
      command = stripWake(command);
    }

    if (!command) {
      setState('idle');
      if (settings.handsFree) scheduleListen(500);
      return;
    }
    handleCommand(command);
    if (bgMode()) pushToTalk = false;
  },
  onSpeechEnd() {
    if (!micMuted && state === 'listening') stateLabelEl.textContent = 'PROCESSING...';
  },
  onSpeechError(code, message) {
    if (micMuted || state !== 'listening') return;
    clearListenSafety();
    micStartPending = false;
    if (code === 7 || code === 6) {
      // No match / silence: silent retry in hands-free, gentle note otherwise.
      setState('idle');
      transcript('');
      if (settings.handsFree) scheduleListen(700);
      else toast('Kuch samajh nahi aaya — dobara bolein.');
      return;
    }
    setState('idle');
    if (code === 9) {
      toast('Microphone permission chahiye.');
      try { Native.requestMicPermission(); } catch (e) { }
      return;
    }
    if (code === 2 || code === 3) {
      toast('Speech service ko internet nahi mil raha.');
      if (settings.handsFree && appActive) scheduleListen(2500);
      return;
    }
    toast(message || 'Speech error.');
    if (settings.handsFree && appActive) scheduleListen(1500);
  },
  onSpeechRms(rms) {
    if (state === 'listening' && orbEl) {
      const level = clamp((Number(rms) + 2) / 12, 0, 1);
      orbEl.style.setProperty('--rms', String(level));
    }
  },
  onPermission(which, granted) {
    if (which === 'mic') {
      if (!granted) {
        micStartPending = false;
        clearListenSafety();
        toast('Mic permission ke baghair voice command nahi chalegi.');
        if (state === 'listening') setState('idle');
      } else {
        if (micMuted) {
          micStartPending = false;
          try { Native.setAutoListen(false); Native.holdListening(true); } catch (e) { }
          return;
        }
        if (micStartPending) {
          // The native side starts the recognizer right after this callback;
          // keep the UI in listening state so the first command is not lost.
          micStartPending = false;
          setState('listening');
          armListenSafety(15000);
        } else if (settings.handsFree && appActive && state === 'idle' && !busy) {
          // Permission was granted after a "code 9" error: resume the mic.
          scheduleListen(300);
        }
        toast('Mic ready.');
      }
    }
    if (which === 'camera' && granted) toast('Camera permission mil gayi.');
  },
  onBack() {
    if (!$('#onboard').classList.contains('hidden')) return true;
    if (anySheetOpen()) { closeSheets(); return true; }
    return false;
  },
  onAppPause() {
    // A user mute always wins over background mode: never re-arm the mic.
    if (micMuted) {
      appActive = true;
      pushToTalk = false;
      try {
        Native.setAutoListen(false);
        Native.holdListening(true);
      } catch (e) { }
      return;
    }
    // Background mode: keep listening and keep talking. Only a real "always
    // online OFF" setting stops the assistant when the app leaves the screen.
    if (bgMode()) {
      appActive = true;
      pushToTalk = false;
      try {
        Native.setAlwaysOn(true);
        Native.setAutoListen(true);
        Native.holdListening(state === 'speaking' || state === 'thinking');
      } catch (e) { }
      return;
    }
    appActive = false;
    clearTimeout(listenTimer);
    clearListenSafety();
    if (state !== 'idle') setState('idle');
  },
  onAppResume() {
    appActive = true;
    updateConnState();
    renderSettings();
    updateMicUI();
    if (micMuted) {
      try {
        Native.setMicMuted(true);
        Native.setAutoListen(false);
        Native.holdListening(true);
      } catch (e) { }
      if (state !== 'idle') setState('idle');
      return;
    }
    if (bgMode()) {
      try {
        Native.setAlwaysOn(true);
        Native.setAutoListen(true);
      } catch (e) { }
      if (settings.onboarded && state === 'idle' && !busy) {
        try { Native.holdListening(false); Native.startListening(); } catch (e) { }
        setState('listening');
        armListenSafety(15000);
      }
      return;
    }
    if (settings.handsFree && settings.onboarded && state === 'idle') scheduleListen(900);
  }
};

/* ================================================================== EVENTS */
function bindEvents() {
  $('#orb').addEventListener('click', toggleMic);
  $('#orb').addEventListener('contextmenu', e => e.preventDefault());

  $('#btnSend').addEventListener('click', sendTyped);
  $('#textInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendTyped(); }
  });

  $('#btnSettings').addEventListener('click', () => openSheet('sheet'));
  $('#btnMemory').addEventListener('click', openMemory);
  $('#sheetClose').addEventListener('click', closeSheets);
  $('#memoryClose').addEventListener('click', closeSheets);
  $('#voiceClose').addEventListener('click', closeSheets);
  $('#overlay').addEventListener('click', closeSheets);

  $$('#modelSeg button').forEach(b => b.addEventListener('click', () => {
    settings.model = b.dataset.model === 'smart' ? 'smart' : 'fast';
    saveSettings();
    renderSettings();
    toast(settings.model === 'smart' ? 'Smart model on (thora slow).' : 'Fast model on.');
  }));

  $$('#voiceSeg button').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.gender === 'female' ? 'female' : 'male';
    if (g === settings.voiceGender) return;
    if (settings.voiceLocked) {
      toast("Voice lock ON hai. Pehle 'Unlock' dabaiye.");
      return;
    }
    settings.voiceGender = g;
    settings.voiceName = '';
    saveSettings();
    renderSettings();
    testVoice();
  }));

  $$('#langSeg button').forEach(b => b.addEventListener('click', () => {
    settings.langMode = b.dataset.lang || 'both';
    saveSettings();
    renderSettings();
    toast('Language mode: ' + settings.langMode.toUpperCase());
  }));

  $('#lockBtn').addEventListener('click', () => {
    settings.voiceLocked = !settings.voiceLocked;
    saveSettings();
    renderSettings();
    toast(settings.voiceLocked ? 'Voice lock ON.' : 'Voice lock OFF.');
  });

  $('#rateRange').addEventListener('input', e => {
    settings.rate = clamp(Number(e.target.value) || 0.97, 0.7, 1.3);
    const rateVal = $('#rateVal');
    if (rateVal) rateVal.textContent = settings.rate.toFixed(2);
  });
  $('#rateRange').addEventListener('change', () => saveSettings());

  $('#testVoice').addEventListener('click', testVoice);
  $('#pickVoice').addEventListener('click', () => openSheet('voiceSheet'));
  $('#voiceAuto').addEventListener('click', () => {
    settings.voiceName = '';
    saveSettings();
    renderVoices();
    toast('Auto male voice selected.');
    testVoice();
  });
  $('#ttsSettings').addEventListener('click', () => {
    try { Native.openTtsSettings(); } catch (e) { }
  });

  const neuralToggle = $('#neuralToggle');
  if (neuralToggle) neuralToggle.addEventListener('change', e => {
    settings.neuralVoice = !!e.target.checked;
    saveSettings();
    renderSettings();
    toast(settings.neuralVoice ? 'Neural voice ON — PC jaisi awaaz.' : 'Neural voice OFF — Android voice.');
  });
  const neuralVoice = $('#neuralVoice');
  if (neuralVoice) neuralVoice.addEventListener('change', e => {
    settings.neuralVoiceName = e.target.value || 'Charon';
    saveSettings();
    renderSettings();
    testVoice();
  });
  const autoBtn = $('#autoBtn');
  if (autoBtn) autoBtn.addEventListener('click', () => {
    try { Native.openAutomationSettings(); } catch (e) { }
    toast('Accessibility mein "Jarvis Automation" on karein.');
  });

  const haSave = $('#haSave');
  if (haSave) haSave.addEventListener('click', async () => {
    const urlInput = $('#haUrl');
    const tokenInput = $('#haToken');
    const url = urlInput ? urlInput.value.trim() : '';
    const token = tokenInput ? tokenInput.value.trim() : '';
    if (!url) { toast('Home Assistant URL daalein.'); return; }
    haSave.disabled = true;
    try {
      const result = await shSmartHomeSetup(url, token, true);
      if (result.indexOf('connected') !== -1) {
        if (tokenInput) tokenInput.value = '';
        toast('Home Assistant connected.');
      } else {
        toast(result);
      }
      renderSettings();
    } catch (e) {
      toast('Home Assistant error: ' + String(e));
    } finally {
      haSave.disabled = false;
    }
  });
  const haTest = $('#haTest');
  if (haTest) haTest.addEventListener('click', async () => {
    haTest.disabled = true;
    try { toast(await shHaTest()); }
    catch (e) { toast('Test failed: ' + String(e)); }
    finally { haTest.disabled = false; }
  });
  const haDisable = $('#haDisable');
  if (haDisable) haDisable.addEventListener('click', async () => {
    try {
      const result = await shSmartHomeSetup('', '', false);
      toast(result);
      renderSettings();
    } catch (e) { toast('Disable failed: ' + String(e)); }
  });

  $('#handsFreeToggle').addEventListener('change', e => {
    settings.handsFree = !!e.target.checked;
    saveSettings();
    try {
      Native.setAutoListen(bgMode());
      Native.setAlwaysOn(settings.alwaysOn !== false);
    } catch (err) { }
    if (settings.handsFree) {
      toast('Hands-free ON. “Hey Jarvis” bolein.');
      if (!micMuted) {
        try { Native.holdListening(false); } catch (err) { }
        if (state === 'idle') startListening(false);
      }
    } else {
      clearTimeout(listenTimer);
      try { Native.setAutoListen(false); Native.cancelListening(); } catch (err) { }
      if (state === 'listening') setState('idle');
      toast('Hands-free OFF.');
    }
  });
  const alwaysOn = $('#alwaysOnToggle');
  if (alwaysOn) alwaysOn.addEventListener('change', e => {
    applyBackground(!!e.target.checked);
    renderSettings();
    toast(settings.alwaysOn ? 'Background mode ON — hamesha online.' : 'Background mode OFF.');
  });
  $('#wakeToggle').addEventListener('change', e => {
    settings.wakeRequired = !!e.target.checked;
    saveSettings();
    toast(settings.wakeRequired ? 'Wake word zaroori hai.' : 'Bina wake word bhi sunega.');
  });

  $('#saveKey').addEventListener('click', () => {
    const input = $('#apiKeyInput');
    const key = input ? input.value.trim() : '';
    if (!key) { toast('Key daalein.'); return; }
    let ok = false;
    try { ok = Native.setApiKey(key); } catch (e) { ok = false; }
    if (ok) {
      if (input) input.value = '';
      hideKeySetup();
      renderSettings();
      updateConnState();
      try { Native.warmVoice(); } catch (e) { }
      toast('API key save ho gayi.');
    } else {
      toast('Key theek nahi lag rahi (bohat choti hai).');
    }
  });

  $('#openAiStudioBtn').addEventListener('click', openAiStudio);
  $('#openAiStudio').addEventListener('click', openAiStudio);
  $('#setupKeySave').addEventListener('click', saveSetupKey);
  $('#setupKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveSetupKey(); }
  });
  $('#setupKeyLater').addEventListener('click', () => {
    hideKeySetup();
    openSheet('sheet');
    toast('Settings mein API key daal sakte hain.');
  });

  $('#removeKey').addEventListener('click', () => {
    try { Native.clearApiKey(); } catch (e) { }
    renderSettings();
    updateConnState();
    toast('API key hata di.');
  });

  $('#notifBtn').addEventListener('click', () => {
    try { Native.openNotificationAccess(); } catch (e) { }
    toast('Jarvis ko Notification Access mein allow karein.');
  });
  $('#clearNotifs').addEventListener('click', () => {
    try { Native.clearGmailNotifications(); } catch (e) { }
    toast('Saved notifications clear.');
  });

  $('#openMemory').addEventListener('click', openMemory);
  $('#memoryAdd').addEventListener('click', addMemoryFact);
  $('#memoryInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addMemoryFact(); }
  });
  $('#memoryClear').addEventListener('click', () => {
    if (!confirm('Sab memory clear karni hai?')) return;
    memory = normalizeMemory(null);
    saveJSON(LS.memory, memory);
    renderMemory();
    renderSettings();
    toast('Memory clear.');
  });

  $$('#quick button').forEach(b => b.addEventListener('click', () => quickAction(b.dataset.quick)));

  $('#onboardStart').addEventListener('click', () => {
    settings.onboarded = true;
    saveSettings();
    $('#onboard').classList.add('hidden');
    try { Native.requestMicPermission(); } catch (e) { }
    updateConnState();
    if (settings.handsFree) applyBackground(settings.alwaysOn !== false);
    if (!isKeySet()) {
      showKeySetup();
      return;
    }
    setTimeout(() => {
      respond(LINES.welcome.roman, LINES.welcome.urdu);
    }, 350);
  });

  window.addEventListener('online', updateConnState);
  window.addEventListener('offline', updateConnState);
}

function sendTyped() {
  const input = $('#textInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  handleCommand(text);
}

function testVoice() {
  try { Native.cancelListening(); } catch (e) { }
  const roman = settings.voiceGender === 'female'
    ? 'Ji sir, yeh female voice hai. Main Jarvis hoon.'
    : 'Ji sir, yeh male voice hai. Main Jarvis hoon.';
  const urdu = 'جی سر، یہ میری آواز ہے۔ میں جاروس ہوں۔';
  try { Native.speak(roman, urdu); } catch (e) { toast('Voice output fail hua.'); }
}

/* ==================================================================== INIT */
function init() {
  chatEl = $('#chat');
  welcomeEl = $('#welcome');
  orbEl = $('#orb');
  stateLabelEl = $('#stateLabel');
  transcriptEl = $('#transcript');
  toastEl = $('#toast');

  bindEvents();
  applySettingsInitial();
  setState('idle');

  if (!settings.onboarded) {
    $('#onboard').classList.remove('hidden');
  } else {
    if (history.length) renderHistory();
    updateConnState();
    if (!isKeySet()) {
      showKeySetup();
    } else {
      // Always-on is the default: start the foreground service and the
      // native listen loop as soon as the app is ready.
      if (settings.handsFree) applyBackground(settings.alwaysOn !== false);
      try { Native.warmVoice(); } catch (e) { }
    }
  }

  // Keep the chat visible when the keyboard opens.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      setTimeout(scrollChat, 80);
    });
  }
  window.addEventListener('beforeunload', () => {
    try { Native.cancelListening(); Native.stopSpeaking(); } catch (e) { }
  });

  // Expose a tiny self-test for adb debugging.
  window.__jarvisSelfTest = () => {
    const status = (() => { try { return JSON.parse(Native.getStatus()); } catch (e) { return null; } })();
    return JSON.stringify({
      native: hasNative,
      key: !!Native.hasApiKey(),
      urduVoice: (() => { try { return Native.hasUrduVoice(); } catch (e) { return false; } })(),
      neural: (() => { try { return JSON.parse(Native.getNeuralPrefs()); } catch (e) { return null; } })(),
      automation: (() => { try { return !!Native.hasAutomation(); } catch (e) { return false; } })(),
      status,
      model: settings.model,
      voice: settings.voiceGender,
      lang: settings.langMode,
      stt: (() => { try { return Native.canListen(); } catch (e) { return false; } })(),
      voices: (() => { try { return JSON.parse(Native.getVoices()).length; } catch (e) { return -1; } })(),
      maleVoices: (() => {
        try {
          return JSON.parse(Native.getVoices())
            .filter(v => v && v.gender === 'male')
            .slice(0, 8)
            .map(v => v.locale + ' | ' + v.name);
        } catch (e) { return []; }
      })(),
      enVoices: (() => {
        try {
          return JSON.parse(Native.getVoices())
            .filter(v => v && /^(en-IN|en-GB|ur)/i.test(v.locale || ''))
            .slice(0, 40)
            .map(v => (v.locale || '') + '|' + v.name + '|q' + (v.quality || 0));
        } catch (e) { return []; }
      })()
    });
  };

  // adb / QA entry point:
  //   adb shell am start -n com.jarvis.mobile/.MainActivity --es cmd "jarvis brave kholo"
  window.jarvisDebugCommand = (text) => {
    try {
      const raw = String(text || '').trim();
      if (/^(mic[ _]?test|__listen__)$/i.test(raw)) {
        try { Native.log('MIC_TEST start canListen=' + Native.canListen()); } catch (e) { }
        try { Native.startListening(); } catch (e) { }
        return;
      }
      settings.onboarded = true;
      settings.handsFree = false;
      saveSettings();
      const ob = $('#onboard');
      if (ob) ob.classList.add('hidden');
      hideKeySetup();
      renderSettings();
      Promise.resolve(handleCommand(String(text || ''))).catch(function (e) {
        try { Native.log('DEBUG_ERR ' + (e && (e.stack || e.message || e))); } catch (x) { }
      });
    } catch (e) {
      try { console.log('JARVIS_DEBUG_ERR ' + e); } catch (x) { }
    }
  };

  try {
    console.log('JARVIS_BOOT native=' + hasNative + ' key=' + Native.hasApiKey() +
      ' urduVoice=' + (() => { try { return Native.hasUrduVoice(); } catch (e) { return false; } })());
  } catch (e) { }
}

document.addEventListener('DOMContentLoaded', init);
