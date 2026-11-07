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
  history: 'jv.history'
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
  version: () => '1.2.0-web',
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
  handsFree: false,
  wakeRequired: true,
  onboarded: false
};

// Stronger models by default: the old lite-first list made answers shallow.
const FAST_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const SMART_MODELS = ['gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview'];

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
    roman: 'Aap bol sakte hain: app kholo, YouTube ya Gmail kholo, WhatsApp message, alarm, timer, flashlight, volume, ya koi bhi sawal. Settings mein voice aur inbox control hai.',
    urdu: 'آپ بول سکتے ہیں: ایپ کھولو، یوٹیوب یا جیمیل کھولو، واٹس ایپ میسج، الارم، ٹائمر، فلیش لائٹ، والیوم، یا کوئی بھی سوال۔ سیٹنگز میں وائس اور ان باکس کنٹرول ہے۔'
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

let memory = loadJSON(LS.memory, null);
if (!memory || !Array.isArray(memory.facts)) {
  memory = { facts: SEED_FACTS.slice(), episodes: [] };
}
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

/* -------------------------------------------------------------------- DOM */
let chatEl, welcomeEl, orbEl, stateLabelEl, transcriptEl, toastEl;

/* ============================================================ SPEECH + TTS */
function setState(next, label) {
  state = next;
  document.body.dataset.state = next;
  if (stateLabelEl) {
    const labels = {
      idle: 'TAP TO SPEAK',
      listening: 'SUN RAHA HOON...',
      thinking: 'SOCH RAHA HOON...',
      speaking: 'BOL RAHA HOON...'
    };
    stateLabelEl.textContent = label || labels[next] || '';
  }
  if (orbEl) orbEl.setAttribute('aria-pressed', next === 'listening' ? 'true' : 'false');
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
  if (settings.handsFree && appActive) scheduleListen(600);
}

function stopEverything() {
  clearTimeout(listenTimer);
  clearListenSafety();
  micStartPending = false;
  try { Native.stopSpeaking(); } catch (e) { }
  try { Native.cancelListening(); } catch (e) { }
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
  listenSafety = setTimeout(() => {
    listenSafety = null;
    if (state !== 'listening') return;
    try { Native.cancelListening(); } catch (e) { }
    setState('idle');
    transcript('');
    toast('Awaaz nahi aayi — dobara bolein.');
  }, ms == null ? 15000 : ms);
}

function scheduleListen(delay) {
  clearTimeout(listenTimer);
  if (!settings.handsFree || !appActive) return;
  listenTimer = setTimeout(() => {
    if (!appActive || !settings.handsFree || state !== 'idle' || busy) return;
    startListening(false);
  }, delay == null ? 700 : delay);
}

function startListening(fromUser) {
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
  saveJSON(LS.history, history);
  try { console.log('JARVIS_REPLY ' + JSON.stringify({ roman: roman, urdu: urdu })); } catch (e) { }
  try { Native.log('REPLY ' + roman); } catch (e) { }
  if (o.silent !== true) speak(roman, urdu);
  else if (settings.handsFree) scheduleListen(700);
}

function trimHistory() {
  if (history.length > 40) history = history.slice(history.length - 40);
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
  el.textContent = online ? 'ONLINE' : 'OFFLINE';
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
      }, 150000);
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
    const l = replyFor(lang, 'Stopped, sir.', LINES.stopped.roman, LINES.stopped.urdu);
    respond(l.roman, l.urdu);
    return true;
  }

  if (/(unlock|open|band karo) (the )?(voice|awaaz|awaaz lock)|voice unlock|awaaz unlock/.test(low)) {
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
  if (/memory (kholo|dikhao|show)|show memory|yaad kya hai|kya yaad hai/.test(low)) {
    openMemory();
    return true;
  }
  if (/clear memory|memory saaf|sab bhool jao|bhool jao sab/.test(low)) {
    memory.facts = [];
    saveJSON(LS.memory, memory);
    renderMemory();
    respond(LINES.memoryCleared.roman, LINES.memoryCleared.urdu);
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

  if (/(flashlight|torch|light) (on|chalao|jalao)/.test(low)) {
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
  if (/(flashlight|torch|light) (off|band|bujhao)/.test(low)) {
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
      name: 'remember',
      description: 'Save a lasting fact about the user (name, preferences, important things).',
      parameters: {
        type: 'OBJECT',
        properties: { fact: { type: 'STRING' } },
        required: ['fact']
      }
    }
  ];
}

function buildSystemPrompt() {
  const langMode = settings.langMode;
  const langLine = langMode === 'en'
    ? 'The user chose ENGLISH ONLY. Reply in English. The ROMAN line must be plain English and the URDU line repeats the same English.'
    : langMode === 'ur'
      ? 'The user chose ROMAN URDU. Reply in natural Pakistani Roman Urdu (simple everyday words, like a friend talking), and give the same in Urdu script.'
      : 'Match the user: English input -> English reply; Roman Urdu / Urdu / Hindi input -> natural Pakistani Roman Urdu reply. The ROMAN line must sound like a real Pakistani person talking casually, never like an English sentence with Urdu words pasted in.';

  const facts = (memory.facts || []).length
    ? memory.facts.map(f => '- ' + f).join('\n')
    : '- (nothing saved yet)';

  let automation = false;
  try { automation = !!Native.hasAutomation(); } catch (e) { }

  const now = new Date();
  const timeText = now.toLocaleString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  return [
    'You are J.A.R.V.I.S. ("Jarvis"), the user\'s personal Android assistant — the same Jarvis as on their PC, now living inside their phone. Call the user "sir".',
    'PERSONALITY: warm, quick-witted, calm and extremely capable. You have real opinions: when asked, give ONE clear recommendation with a short reason, never "it depends". You may ask one short follow-up question when it truly helps.',
    'You are the MOBILE version: you control this phone, not a PC. If something is PC-only (Word, desktop files, PC apps), say it in one short line and offer the phone alternative.',
    'THINK FIRST: the user speaks English and Roman Urdu, and speech recognition makes mistakes ("jaadui", "travis" = Jarvis; wrong app or song names). Work out the real intent from context. Resolve "isko", "woh", "yahan" from the conversation and from ui_dump when the user is talking about the screen.',
    'ACT, DO NOT LECTURE: use tools immediately and chain as many as needed until the WHOLE request is done. Never reply with instructions telling the user to do the remaining steps themselves. If a tool fails, try a different approach, then report the real reason in one short sentence.',
    'HONESTY (very important): claim a task is done only when the tool result has ok:true. If the result has needs_user_action:true, say it is ready and what to tap. Never invent emails, messages, alarms, installs or subscriptions. YouTube subscribe and Gmail "mark as read" cannot be automated.',
    'PHONE POWERS: open apps; Play Store search and REAL install (install_app taps Install and Open itself when Phone automation is on); read the current screen (ui_dump); tap any visible button or label (ui_click); type into fields (ui_type); Back/Home/Recents/Notifications (system_action); YouTube search; WhatsApp/SMS/email drafts; alarms; timers; maps; volume; torch; battery/network status; clipboard; long-term memory.',
    'INSTALL FLOW: for "Duolingo install karo" or "Play Store se X install karo" call install_app ONCE with the exact app name. Do not also call open_play_store. Wait for its result, then report exactly what happened. If automation is off, the result says so: tell the user in one line to enable Settings > Phone automation, and that Play Store is already open for a manual tap.',
    'AUTOMATION: ' + (automation
      ? 'Phone automation is ON — you can tap through other apps yourself. Use ui_dump to see each screen before tapping.'
      : 'Phone automation is OFF — ui_click / ui_type / ui_dump / system_action and full install will ask the user to enable it. App opens, Play Store search and normal tools still work.'),
    'MEMORY: when the user shares something lasting or says "yaad rakho", call remember with a short English fact. Use saved facts naturally; never read the list out.',
    'STYLE: everything is spoken out loud. For actions: 1-2 short sentences. For questions: up to 4 short spoken sentences. No lists, no markdown, no emojis, no stage directions.',
    'MEMORY (about the user):',
    facts,
    'LANGUAGE: ' + langLine,
    'CURRENT DATE AND TIME: ' + timeText,
    'OUTPUT FORMAT: reply with exactly two lines and nothing else:',
    'ROMAN: <your reply in English or Roman Urdu as the language rule says>',
    'URDU: <the same reply written in Urdu script>'
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

function geminiRequest(model, payload) {
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
    }, 22000);
    pendingRequests[id] = { resolve, reject, timer };
    try { Native.log('HTTP_SEND ' + id + ' ' + model); } catch (e) { }
    try {
      Native.httpGemini(id, model, JSON.stringify(payload), 18000);
    } catch (e) {
      delete pendingRequests[id];
      clearTimeout(timer);
      reject(apiError(0, JSON.stringify({ error: { message: String(e), status: 'TRANSPORT' } })));
    }
  });
}

async function runTool(name, args) {
  if (name === 'remember') {
    const fact = String((args && args.fact) || '').trim();
    if (!fact) return { ok: false, message: 'Kya yaad rakhna hai?' };
    if (!memory.facts.includes(fact)) memory.facts.push(fact);
    if (memory.facts.length > 60) memory.facts = memory.facts.slice(-60);
    saveJSON(LS.memory, memory);
    renderMemory();
    return { ok: true, message: 'Yaad rakh liya.' };
  }
  return callTool(name, args || {});
}

async function toolLoop(model, baseContents, systemPrompt) {
  const contents = baseContents.map(c => JSON.parse(JSON.stringify(c)));
  for (let round = 0; round < 8; round++) {
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: toolDeclarations() }],
      generationConfig: { temperature: 0.55, maxOutputTokens: 1600 }
    };
    const raw = await geminiRequest(model, payload);
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
      for (const part of calls) {
        const fc = part.functionCall;
        let result;
        try {
          result = await runTool(fc.name, fc.args || {});
        } catch (e) {
          result = { ok: false, message: 'Tool error: ' + e };
        }
        toolLog(fc.name, result);
        responses.push({ functionResponse: { name: fc.name, response: result } });
      }
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
  const contents = history.slice(-20).map(item => ({
    role: item.role === 'user' ? 'user' : 'model',
    parts: [{ text: item.text }]
  }));
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: userText }] });
  }
  const systemPrompt = buildSystemPrompt();
  const models = settings.model === 'smart' ? SMART_MODELS : FAST_MODELS;
  const started = Date.now();
  let last = null;

  for (const model of models) {
    if (Date.now() - started > 26000) break;
    try { Native.log('ASK ' + model); } catch (e) { }
    try {
      return await toolLoop(model, contents, systemPrompt);
    } catch (e) {
      last = e;
      if (e.code === 401 || e.code === 403 || e.code === 429) break;
      if (String(e.status || '').indexOf('INVALID_ARGUMENT') >= 0) break;
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

  const memCount = $('#memoryCount');
  if (memCount) memCount.textContent = memory.facts.length + ' baatein yaad hain.';

  const about = $('#aboutText');
  if (about) {
    let v = '1.2.0';
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
    if (hint) hint.textContent = 'Key theek nahi lag rahi — AIza se shuru honi chahiye.';
    toast('Key theek nahi lag rahi.');
    return;
  }
  if (input) input.value = '';
  if (input) input.type = 'password';
  hideKeySetup();
  renderSettings();
  updateConnState();
  try { Native.requestMicPermission(); } catch (e) { }
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
  return $$('.sheet').some(s => !s.classList.contains('hidden')) ||
    !$('#overlay').classList.contains('hidden');
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
  const facts = memory.facts || [];
  if (!facts.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Abhi koi memory nahi hai.';
    list.appendChild(p);
    return;
  }
  facts.forEach((fact, index) => {
    const row = document.createElement('div');
    row.className = 'memory-item';
    const span = document.createElement('span');
    span.textContent = fact;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Delete');
    del.onclick = () => {
      memory.facts.splice(index, 1);
      saveJSON(LS.memory, memory);
      renderMemory();
      renderSettings();
    };
    row.appendChild(span);
    row.appendChild(del);
    list.appendChild(row);
  });
  const count = $('#memoryCount');
  if (count) count.textContent = facts.length + ' baatein yaad hain.';
}

function openMemory() {
  openSheet('memorySheet');
}

function addMemoryFact() {
  const input = $('#memoryInput');
  if (!input) return;
  const fact = input.value.trim();
  if (!fact) return;
  if (!memory.facts.includes(fact)) memory.facts.push(fact);
  input.value = '';
  saveJSON(LS.memory, memory);
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
    if (state === 'listening') stateLabelEl.textContent = 'BOLIYE...';
  },
  onSpeechPartial(text) {
    if (state === 'listening') transcript(text);
  },
  onSpeechFinal(text, alternativesJson) {
    if (state !== 'listening') return;
    clearListenSafety();
    micStartPending = false;
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
  },
  onSpeechEnd() {
    if (state === 'listening') stateLabelEl.textContent = 'PROCESSING...';
  },
  onSpeechError(code, message) {
    if (state !== 'listening') return;
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
      return;
    }
    toast(message || 'Speech error.');
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
        if (micStartPending) {
          // The native side starts the recognizer right after this callback;
          // keep the UI in listening state so the first command is not lost.
          micStartPending = false;
          setState('listening');
          armListenSafety(15000);
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
    appActive = false;
    clearTimeout(listenTimer);
    clearListenSafety();
    if (state !== 'idle') setState('idle');
  },
  onAppResume() {
    appActive = true;
    updateConnState();
    renderSettings();
    if (settings.handsFree && settings.onboarded && state === 'idle') scheduleListen(900);
  }
};

/* ================================================================== EVENTS */
function bindEvents() {
  $('#orb').addEventListener('click', () => startListening(true));
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

  $('#handsFreeToggle').addEventListener('change', e => {
    settings.handsFree = !!e.target.checked;
    saveSettings();
    try { Native.keepAwake(settings.handsFree); } catch (err) { }
    if (settings.handsFree) {
      toast('Hands-free ON. “Hey Jarvis” bolein.');
      if (state === 'idle') scheduleListen(500);
    } else {
      clearTimeout(listenTimer);
      try { Native.cancelListening(); } catch (err) { }
      if (state === 'listening') setState('idle');
      toast('Hands-free OFF.');
    }
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
    memory.facts = [];
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
    } else if (settings.handsFree) {
      try { Native.keepAwake(true); } catch (e) { }
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
