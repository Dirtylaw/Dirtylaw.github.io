/* Macro Meter — daily macro tracker PWA
   All data lives in this browser's localStorage. Your OpenAI key never leaves
   your device except in direct calls to api.openai.com. */
'use strict';

/* ---------- tiny helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round = (n) => Math.round((Number(n) || 0));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snacks',    label: 'Snacks' },
];
const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--protein)' },
  { key: 'carbs',   label: 'Carbs',   color: 'var(--carbs)' },
  { key: 'fat',     label: 'Fat',     color: 'var(--fat)' },
];

/* ---------- storage ---------- */
const DB = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Storage is full or blocked — data may not save.'); return false; } },
};
const K = { settings: 'mm.settings', days: 'mm.days', favs: 'mm.favorites', chat: 'mm.chat' };

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gpt-5.4-nano',
  targets:     { calories: 2200, protein: 165, carbs: 250, fat: 70 }, // training day
  restTargets: { calories: 1900, protein: 165, carbs: 170, fat: 70 }, // rest day
  defaultDayType: 'training',
  autoRest: false,
  restThreshold: 500,   // kcal burned below this => rest day (when autoRest on)
  weightUnit: 'lb',
};

let settings = mergeSettings(DB.get(K.settings, {}));
function mergeSettings(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
  out.targets     = Object.assign({}, DEFAULT_SETTINGS.targets, s?.targets || {});
  out.restTargets = Object.assign({}, DEFAULT_SETTINGS.restTargets, s?.restTargets || {});
  return out;
}
let days = DB.get(K.days, {});
let favs = DB.get(K.favs, []);
let chat = DB.get(K.chat, []);

const saveSettings = () => DB.set(K.settings, settings);
const saveDays     = () => DB.set(K.days, days);
const saveFavs     = () => DB.set(K.favs, favs);
const saveChat     = () => DB.set(K.chat, chat);

/* ---------- dates ---------- */
const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => dateStr(new Date());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); };
const prettyDate = (s) => {
  const d = parseDate(s), t = todayStr();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  if (s === addDays(t, 1)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

let currentDate = todayStr();
let currentTab = 'today';

/* ---------- day model ---------- */
function emptyDay() {
  return { meals: { breakfast: [], lunch: [], dinner: [], snacks: [] }, steps: null, burned: null, weight: null, notes: '', dayType: null, typeManual: false };
}
function structureDay(d) {
  if (!d.meals) d.meals = emptyDay().meals;
  for (const m of MEALS) if (!Array.isArray(d.meals[m.key])) d.meals[m.key] = [];
  if (d.weight === undefined) d.weight = null;
  return d;
}
function getDay(date = currentDate) {
  if (!days[date]) days[date] = emptyDay();
  return structureDay(days[date]);
}
function getDayRaw(ds) { return structureDay(days[ds] || emptyDay()); }

function dayHasData(date) {
  const d = days[date];
  if (!d) return false;
  const items = MEALS.reduce((a, m) => a + (d.meals?.[m.key]?.length || 0), 0);
  return items > 0 || d.steps != null || d.burned != null || d.weight != null || (d.notes && d.notes.trim());
}
function totals(day) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const m of MEALS) for (const e of day.meals[m.key]) {
    t.calories += +e.calories || 0; t.protein += +e.protein || 0;
    t.carbs += +e.carbs || 0; t.fat += +e.fat || 0;
  }
  for (const k in t) t[k] = round(t[k]);
  return t;
}

/* ---------- day type + targets ---------- */
function getDayType(day) {
  if (day.typeManual && day.dayType) return day.dayType;
  if (settings.autoRest && day.burned != null) return (+day.burned < settings.restThreshold) ? 'rest' : 'training';
  return settings.defaultDayType || 'training';
}
function activeTargets(day) { return getDayType(day) === 'rest' ? settings.restTargets : settings.targets; }

/* ---------- streak ---------- */
function computeStreak() {
  let n = 0;
  let p = todayStr();
  if (!dayHasData(p)) p = addDays(p, -1); // don't penalize before today's first log
  while (dayHasData(p)) { n++; p = addDays(p, -1); }
  return n;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ================= RENDER ================= */
const app = () => $('#view');

function render() {
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  if (currentTab === 'today') renderToday();
  else if (currentTab === 'history') renderHistory();
  else if (currentTab === 'chat') renderChat();
  else if (currentTab === 'settings') renderSettings();
  app().scrollTop = 0;
}

/* ---------- TODAY ---------- */
function ring(consumed, target) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = target > 0 ? clamp(consumed / target, 0, 1) : 0;
  const over = target > 0 && consumed > target;
  const dash = c * pct;
  return `
  <svg class="cal-ring" viewBox="0 0 130 130" aria-hidden="true">
    <circle cx="65" cy="65" r="${r}" class="ring-track"/>
    <circle cx="65" cy="65" r="${r}" class="ring-fill ${over ? 'over' : ''}"
      stroke-dasharray="${dash} ${c}" transform="rotate(-90 65 65)"/>
  </svg>`;
}

function renderToday() {
  const day = getDay();
  const t = totals(day);
  const tg = activeTargets(day);
  const type = getDayType(day);
  const remaining = tg.calories - t.calories + (day.burned ? +day.burned : 0);
  const streak = computeStreak();

  const v = app();
  v.innerHTML = '';

  // date strip + streak
  const strip = el('div', 'datestrip');
  strip.innerHTML = `
    <button class="nav" id="prevDay" aria-label="Previous day">‹</button>
    <button class="date-label" id="jumpToday">${prettyDate(currentDate)}<span>${parseDate(currentDate).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}</span></button>
    <button class="nav" id="nextDay" aria-label="Next day">›</button>`;
  v.appendChild(strip);

  if (streak > 0) {
    const chip = el('div', 'streak-chip');
    chip.innerHTML = `<span class="flame">🔥</span> ${streak}-day logging streak`;
    v.appendChild(chip);
  }

  // day-type toggle
  const dt = el('div', 'daytype');
  dt.innerHTML = `
    <button data-type="training" class="${type === 'training' ? 'on' : ''}">Training day</button>
    <button data-type="rest" class="${type === 'rest' ? 'on' : ''}">Rest day</button>
    ${day.typeManual ? '<button class="dt-auto" id="dtAuto" title="Use automatic">auto</button>' : ''}`;
  v.appendChild(dt);

  // calorie hero
  const hero = el('section', 'card hero');
  hero.innerHTML = `
    <div class="hero-ring">
      ${ring(t.calories, tg.calories)}
      <div class="hero-center">
        <div class="big-num">${round(remaining)}</div>
        <div class="big-label">${remaining < 0 ? 'over' : 'kcal left'}</div>
      </div>
    </div>
    <div class="hero-stats">
      <div><span class="k">Eaten</span><b class="mono">${t.calories}</b></div>
      <div><span class="k">Target</span><b class="mono">${tg.calories}</b></div>
      <div><span class="k">Burned</span><b class="mono">${day.burned != null ? day.burned : '—'}</b></div>
    </div>`;
  v.appendChild(hero);

  // macro gauges
  const macroCard = el('section', 'card macros');
  for (const m of MACROS) {
    const cons = t[m.key], targ = tg[m.key] || 0;
    const pct = targ > 0 ? clamp(cons / targ, 0, 1) * 100 : 0;
    const row = el('div', 'macro-row');
    row.innerHTML = `
      <div class="macro-head">
        <span class="dot" style="background:${m.color}"></span>
        <span class="macro-name">${m.label}</span>
        <span class="macro-val mono">${cons}<i>/${targ}g</i></span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${m.color}"></div></div>`;
    macroCard.appendChild(row);
  }
  v.appendChild(macroCard);

  // close my gap
  const gapBtn = el('button', 'gap-btn');
  gapBtn.innerHTML = `<span class="spark">✨</span> What can I eat? <i>fills your remaining macros</i>`;
  gapBtn.onclick = () => openGap();
  v.appendChild(gapBtn);

  // meals
  for (const m of MEALS) {
    const entries = day.meals[m.key];
    const mt = entries.reduce((a, e) => a + (+e.calories || 0), 0);
    const sec = el('section', 'card meal');
    const head = el('div', 'meal-head');
    head.innerHTML = `<h3>${m.label}</h3><span class="meal-cal mono">${round(mt)} kcal</span>`;
    const copyBtn = el('button', 'icon-btn', '⧉');
    copyBtn.setAttribute('aria-label', 'Copy a previous ' + m.label);
    copyBtn.onclick = () => openCopyMeal(m.key);
    const addBtn = el('button', 'add-btn', '+');
    addBtn.setAttribute('aria-label', 'Add to ' + m.label);
    addBtn.onclick = () => openAddSheet(m.key);
    head.appendChild(copyBtn);
    head.appendChild(addBtn);
    sec.appendChild(head);

    if (!entries.length) {
      sec.appendChild(el('p', 'empty', 'Nothing logged yet.'));
    } else {
      for (const e of entries) {
        const item = el('button', 'entry');
        item.innerHTML = `
          <div class="entry-main">
            <span class="entry-name">${escapeHtml(e.name)}</span>
            <span class="entry-macros mono">P ${round(e.protein)} · C ${round(e.carbs)} · F ${round(e.fat)}</span>
          </div>
          <span class="entry-cal mono">${round(e.calories)}</span>`;
        item.onclick = () => openEditEntry(m.key, e.id);
        sec.appendChild(item);
      }
    }
    v.appendChild(sec);
  }

  // extras: steps / burned / weight / notes
  const extras = el('section', 'card extras');
  extras.innerHTML = `<h3 class="extras-title">Daily log</h3>`;
  const grid = el('div', 'extras-grid');
  grid.innerHTML = `
    <label class="field">
      <span>Steps</span>
      <input id="steps" class="mono" inputmode="numeric" placeholder="—" value="${day.steps ?? ''}">
    </label>
    <label class="field">
      <span>Calories burned</span>
      <input id="burned" class="mono" inputmode="numeric" placeholder="—" value="${day.burned ?? ''}">
    </label>
    <label class="field">
      <span>Body weight (${settings.weightUnit})</span>
      <input id="weight" class="mono" inputmode="decimal" placeholder="—" value="${day.weight ?? ''}">
    </label>`;
  extras.appendChild(grid);
  const notesWrap = el('label', 'field notes-field');
  notesWrap.innerHTML = `<span>Notes</span>`;
  const notes = el('textarea'); notes.id = 'notes'; notes.placeholder = 'How did today go? Workouts, how you felt, anything…';
  notes.value = day.notes || '';
  notesWrap.appendChild(notes);
  extras.appendChild(notesWrap);
  v.appendChild(extras);

  // bindings
  $('#prevDay').onclick = () => { currentDate = addDays(currentDate, -1); render(); };
  $('#nextDay').onclick = () => { currentDate = addDays(currentDate, 1); render(); };
  $('#jumpToday').onclick = () => { currentDate = todayStr(); render(); };
  $$('.daytype [data-type]').forEach(b => b.onclick = () => {
    const d = getDay(); d.dayType = b.dataset.type; d.typeManual = true; saveDays(); renderToday();
  });
  if ($('#dtAuto')) $('#dtAuto').onclick = () => { const d = getDay(); d.typeManual = false; d.dayType = null; saveDays(); renderToday(); };
  const bindNum = (id, prop, dec) => {
    const inp = $('#' + id);
    inp.onchange = () => {
      const val = inp.value.trim();
      getDay()[prop] = val === '' ? null : (dec ? Math.max(0, Number(val) || 0) : Math.max(0, round(val)));
      saveDays(); renderToday();
    };
  };
  bindNum('steps', 'steps');
  bindNum('burned', 'burned');
  bindNum('weight', 'weight', true);
  notes.onchange = () => { getDay().notes = notes.value; saveDays(); };
}

/* ---------- CLOSE MY GAP ---------- */
async function openGap() {
  if (!requireKey()) return;
  const day = getDay(), t = totals(day), tg = activeTargets(day);
  const rem = { cal: tg.calories - t.calories, p: tg.protein - t.protein, c: tg.carbs - t.carbs, f: tg.fat - t.fat };
  const sheet = buildSheet('What can I eat?');
  const body = $('.sheet-body', sheet);
  body.innerHTML = `
    <p class="gap-rem">Remaining today (${getDayType(day)} day): <b class="mono">${round(rem.cal)}</b> kcal ·
      <b class="mono">${round(rem.p)}g</b> P · <b class="mono">${round(rem.c)}g</b> C · <b class="mono">${round(rem.f)}g</b> F</p>
    <div id="gapOut" class="gap-out"><div class="gap-loading"><span class="spin dark"></span> Thinking of options…</div></div>
    <button class="ghost" id="gapAgain" style="margin-top:12px" disabled>Suggest again</button>`;
  const run = async () => {
    const out = $('#gapOut', sheet); $('#gapAgain', sheet).disabled = true;
    out.innerHTML = `<div class="gap-loading"><span class="spin dark"></span> Thinking of options…</div>`;
    try {
      const text = await aiCloseGap(rem, getDayType(day));
      out.innerHTML = `<div class="gap-text"></div>`;
      $('.gap-text', out).textContent = text;
    } catch (e) { out.innerHTML = `<p class="empty">${escapeHtml(e.message || 'Error')}</p>`; }
    $('#gapAgain', sheet).disabled = false;
  };
  $('#gapAgain', sheet).onclick = run;
  run();
}
async function aiCloseGap(rem, type) {
  const sys = `You are a practical nutrition coach. The user has these macros REMAINING for the day and wants to fill them. Suggest 2-3 specific, realistic foods or simple meal combos that roughly fit what's left. For each: name, portion, and approx calories/protein/carbs/fat. Keep it tight — a short list, no preamble. If remaining values are negative or near zero, say they're basically done and suggest a light option if needed.`;
  const user = `Remaining for this ${type} day: ${round(rem.cal)} kcal, protein ${round(rem.p)}g, carbs ${round(rem.c)}g, fat ${round(rem.f)}g.`;
  return await callOpenAI([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: false });
}

/* ---------- COPY A MEAL ---------- */
function openCopyMeal(meal) {
  const sheet = buildSheet('Copy ' + label(meal));
  const body = $('.sheet-body', sheet);
  const sources = [];
  for (const ds of Object.keys(days).sort().reverse()) {
    if (ds === currentDate) continue;
    const list = days[ds]?.meals?.[meal] || [];
    if (list.length) sources.push({ ds, list });
    if (sources.length >= 30) break;
  }
  if (!sources.length) {
    body.innerHTML = `<p class="empty pad">No previous ${label(meal)} to copy yet. Once you log some, you can pull them in here.</p>`;
    return;
  }
  body.innerHTML = `<p class="hint" style="margin:0 0 12px">Tap a day to copy its ${label(meal)} into ${prettyDate(currentDate)}.</p>
    <div class="copy-list">${sources.map((s, i) => {
      const kcal = round(s.list.reduce((a, e) => a + (+e.calories || 0), 0));
      const names = s.list.map(e => e.name).join(', ');
      return `<div class="copy-row" data-i="${i}">
        <div class="copy-main"><span class="copy-date">${prettyDate(s.ds)}</span><span class="copy-names">${escapeHtml(names)}</span></div>
        <span class="copy-cal mono">${kcal}</span></div>`;
    }).join('')}</div>`;
  $$('.copy-row', sheet).forEach(row => row.onclick = () => {
    const src = sources[+row.dataset.i];
    const day = getDay();
    for (const e of src.list) day.meals[meal].push({ id: uid(), time: Date.now(), name: e.name, calories: round(e.calories), protein: round(e.protein), carbs: round(e.carbs), fat: round(e.fat) });
    saveDays(); closeSheet(); renderToday();
    toast(`Copied ${src.list.length} item${src.list.length > 1 ? 's' : ''} to ${label(meal)}`);
  });
}

/* ---------- ADD / EDIT SHEET ---------- */
let sheetMeal = 'breakfast';
let lastPhoto = null;

function openAddSheet(meal) {
  sheetMeal = meal;
  lastPhoto = null;
  const recents = recentFoods();
  const sheet = buildSheet('Add to ' + label(meal));
  const body = $('.sheet-body', sheet);

  body.innerHTML = `
    <div class="seg">
      <button data-mode="describe" class="active">Describe</button>
      <button data-mode="photo">Photo</button>
      <button data-mode="scan">Scan</button>
      <button data-mode="manual">Manual</button>
      <button data-mode="saved">Saved</button>
    </div>
    <div id="mode-describe" class="mode">
      <div class="describe-box">
        <textarea id="descInput" placeholder="e.g. grilled chicken breast, 1 cup white rice, side of broccoli"></textarea>
        <button class="voice-btn" id="voiceBtn" aria-label="Dictate" title="Speak">🎤</button>
      </div>
      <button class="primary" id="estimateText">Estimate with AI</button>
      <p class="hint">Type or tap the mic. AI gives a quick estimate — you can edit every number before saving.</p>
    </div>
    <div id="mode-photo" class="mode hidden">
      <label class="photo-drop" id="photoLabel">
        <input type="file" id="photoInput" accept="image/*" capture="environment" hidden>
        <span id="photoText">Take or choose a photo</span>
        <img id="photoPreview" class="hidden" alt="">
      </label>
      <input id="photoHint" placeholder="Optional hint (e.g. ~12 oz, cooked in oil)">
      <button class="primary" id="estimatePhoto" disabled>Estimate from photo</button>
    </div>
    <div id="mode-scan" class="mode hidden">
      <div id="reader" class="reader"><span class="reader-ph">Camera preview appears here</span></div>
      <button class="primary" id="startScan">Start camera</button>
      <div class="or">— or type the number —</div>
      <div class="manual-barcode">
        <input id="barcodeInput" inputmode="numeric" placeholder="Barcode digits">
        <button class="ghost" id="lookupBarcode">Look up</button>
      </div>
      <p class="hint">Looks up the free Open Food Facts database. Needs a connection.</p>
    </div>
    <div id="mode-manual" class="mode hidden">${reviewFormHtml({})}</div>
    <div id="mode-saved" class="mode hidden">${savedListHtml(recents)}</div>
    <div id="reviewSlot"></div>`;

  // segment switching
  $$('.seg button', sheet).forEach(b => b.onclick = () => {
    stopScanner();
    $$('.seg button', sheet).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.mode', sheet).forEach(m => m.classList.add('hidden'));
    $('#mode-' + b.dataset.mode, sheet).classList.remove('hidden');
    $('#reviewSlot', sheet).innerHTML = '';
  });

  // describe + voice
  $('#estimateText', sheet).onclick = async () => {
    const desc = $('#descInput', sheet).value.trim();
    if (!desc) return toast('Type or say what you ate first.');
    if (!requireKey()) return;
    await withBusy($('#estimateText', sheet), 'Estimating…', async () => {
      const est = await aiEstimateText(desc);
      showReview(sheet, est);
    });
  };
  $('#voiceBtn', sheet).onclick = () => startVoice($('#descInput', sheet), $('#voiceBtn', sheet));

  // photo
  const photoInput = $('#photoInput', sheet);
  $('#photoLabel', sheet).onclick = (e) => { if (e.target.tagName !== 'INPUT') photoInput.click(); };
  photoInput.onchange = async () => {
    const f = photoInput.files[0];
    if (!f) return;
    const dataUrl = await downscaleImage(f, 1024, 0.8);
    lastPhoto = dataUrl;
    const img = $('#photoPreview', sheet);
    img.src = dataUrl; img.classList.remove('hidden');
    $('#photoText', sheet).classList.add('hidden');
    $('#estimatePhoto', sheet).disabled = false;
  };
  $('#estimatePhoto', sheet).onclick = async () => {
    if (!lastPhoto) return;
    if (!requireKey()) return;
    const hint = $('#photoHint', sheet).value.trim();
    await withBusy($('#estimatePhoto', sheet), 'Analyzing photo…', async () => {
      const est = await aiEstimatePhoto(lastPhoto, hint);
      showReview(sheet, est);
    });
  };

  // scan
  const startBtn = $('#startScan', sheet);
  startBtn.onclick = async () => {
    if (scannerOn) { stopScanner(); startBtn.textContent = 'Start camera'; return; }
    startBtn.textContent = 'Starting…'; startBtn.disabled = true;
    try {
      await startScanner($('#reader', sheet), async (code) => {
        startBtn.textContent = 'Start camera';
        await handleBarcode(code, sheet);
      });
      startBtn.textContent = 'Stop camera';
    } catch (e) { toast(e.message || 'Could not start the camera.'); startBtn.textContent = 'Start camera'; }
    startBtn.disabled = false;
  };
  $('#lookupBarcode', sheet).onclick = async () => {
    const code = $('#barcodeInput', sheet).value.trim();
    if (!code) return toast('Enter a barcode number.');
    await withBusy($('#lookupBarcode', sheet), 'Looking…', async () => { await handleBarcode(code, sheet); });
  };

  // manual + saved
  wireReviewForm($('#mode-manual', sheet), null, sheet);
  wireSavedList(sheet, recents);
}

async function handleBarcode(code, sheet) {
  try {
    const est = await lookupBarcode(code);
    // switch to a place the review shows; reveal under whatever mode
    showReview(sheet, est);
    toast('Found: ' + est.name);
  } catch (e) { toast(e.message || 'Not found.'); }
}

function showReview(sheet, est) {
  const slot = $('#reviewSlot', sheet);
  slot.innerHTML = `
    <div class="review">
      ${est.notes ? `<p class="ai-note">${est.confidence ? `<b class="conf ${est.confidence}">${est.confidence} confidence</b> · ` : ''}${escapeHtml(est.notes)}</p>` : ''}
      ${reviewFormHtml(est)}
    </div>`;
  wireReviewForm(slot, est, sheet);
  slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function reviewFormHtml(e) {
  return `
    <div class="rf">
      <label class="field full"><span>Food</span><input class="rf-name" value="${escapeAttr(e.name || '')}" placeholder="Name"></label>
      <label class="field"><span>Calories</span><input class="rf-cal mono" inputmode="numeric" value="${e.calories ?? ''}" placeholder="0"></label>
      <label class="field"><span>Protein (g)</span><input class="rf-protein mono" inputmode="numeric" value="${e.protein ?? ''}" placeholder="0"></label>
      <label class="field"><span>Carbs (g)</span><input class="rf-carbs mono" inputmode="numeric" value="${e.carbs ?? ''}" placeholder="0"></label>
      <label class="field"><span>Fat (g)</span><input class="rf-fat mono" inputmode="numeric" value="${e.fat ?? ''}" placeholder="0"></label>
    </div>
    <div class="rf-actions">
      <button class="ghost rf-fav" title="Save to Saved foods">☆ Save food</button>
      <button class="primary rf-add">Add to ${label(sheetMeal)}</button>
    </div>`;
}

function readForm(scope) {
  return {
    name: $('.rf-name', scope).value.trim() || 'Food',
    calories: round($('.rf-cal', scope).value),
    protein: round($('.rf-protein', scope).value),
    carbs: round($('.rf-carbs', scope).value),
    fat: round($('.rf-fat', scope).value),
  };
}

function wireReviewForm(scope, est, sheet) {
  const addBtn = $('.rf-add', scope); if (!addBtn) return;
  addBtn.onclick = () => {
    const data = readForm(scope);
    addEntry(sheetMeal, data);
    closeSheet();
    toast(`Added to ${label(sheetMeal)}`);
  };
  $('.rf-fav', scope).onclick = () => {
    const data = readForm(scope);
    if (!favs.find(f => f.name.toLowerCase() === data.name.toLowerCase())) {
      favs.unshift(data); favs = favs.slice(0, 60); saveFavs();
      toast('Saved to your foods');
    } else toast('Already saved');
  };
}

function savedListHtml(recents) {
  const list = [];
  if (favs.length) list.push(`<p class="sub">Saved foods</p>`);
  for (let i = 0; i < favs.length; i++) list.push(savedRow(favs[i], 'fav', i));
  if (recents.length) list.push(`<p class="sub">Recent</p>`);
  for (let i = 0; i < recents.length; i++) list.push(savedRow(recents[i], 'recent', i));
  if (!list.length) return `<p class="empty pad">No saved or recent foods yet. They'll show up here as you log.</p>`;
  return `<div class="saved-list">${list.join('')}</div>`;
}
function savedRow(e, kind, i) {
  return `<div class="saved-row" data-kind="${kind}" data-i="${i}">
      <div class="saved-main"><span class="saved-name">${escapeHtml(e.name)}</span>
      <span class="saved-macros mono">${round(e.calories)} kcal · P${round(e.protein)} C${round(e.carbs)} F${round(e.fat)}</span></div>
      <span class="saved-add">Add</span>
    </div>`;
}
function wireSavedList(sheet, recents) {
  $$('.saved-row', sheet).forEach(row => {
    row.onclick = () => {
      const kind = row.dataset.kind, i = +row.dataset.i;
      const src = kind === 'fav' ? favs[i] : recents[i];
      if (!src) return;
      addEntry(sheetMeal, { name: src.name, calories: round(src.calories), protein: round(src.protein), carbs: round(src.carbs), fat: round(src.fat) });
      closeSheet();
      toast(`Added to ${label(sheetMeal)}`);
    };
  });
}

function recentFoods() {
  const seen = new Set(), out = [];
  const dates = Object.keys(days).sort().reverse();
  for (const d of dates) {
    for (const m of MEALS) for (const e of (days[d].meals?.[m.key] || [])) {
      const key = e.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: e.name, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat });
      if (out.length >= 20) return out;
    }
  }
  return out;
}

/* ---------- EDIT ENTRY ---------- */
function openEditEntry(meal, id) {
  const day = getDay();
  const e = day.meals[meal].find(x => x.id === id);
  if (!e) return;
  sheetMeal = meal;
  const sheet = buildSheet('Edit item');
  const body = $('.sheet-body', sheet);
  body.innerHTML = `<div class="mode">${reviewFormHtml(e)}</div>`;
  const scope = body;
  $('.rf-add', scope).textContent = 'Save changes';
  $('.rf-add', scope).onclick = () => {
    Object.assign(e, readForm(scope));
    saveDays(); closeSheet(); renderToday(); toast('Updated');
  };
  $('.rf-fav', scope).onclick = () => {
    const data = readForm(scope);
    if (!favs.find(f => f.name.toLowerCase() === data.name.toLowerCase())) { favs.unshift(data); saveFavs(); toast('Saved to your foods'); }
  };
  const del = el('button', 'danger-link', 'Delete this item');
  del.onclick = () => {
    day.meals[meal] = day.meals[meal].filter(x => x.id !== id);
    saveDays(); closeSheet(); renderToday(); toast('Deleted');
  };
  body.appendChild(del);
}

function addEntry(meal, data) {
  const day = getDay();
  day.meals[meal].push(Object.assign({ id: uid(), time: Date.now() }, data));
  saveDays(); renderToday();
}

/* ---------- sheet scaffolding ---------- */
function buildSheet(title) {
  closeSheet();
  const back = el('div', 'sheet-backdrop'); back.id = 'sheetBack';
  const sheet = el('div', 'sheet');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-top"><h2>${title}</h2><button class="sheet-close" aria-label="Close">✕</button></div>
    <div class="sheet-body"></div>`;
  back.appendChild(sheet);
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('open'));
  $('.sheet-close', sheet).onclick = closeSheet;
  back.onclick = (e) => { if (e.target === back) closeSheet(); };
  return sheet;
}
function closeSheet() {
  stopScanner();
  const b = $('#sheetBack');
  if (!b) return;
  b.classList.remove('open');
  setTimeout(() => b.remove(), 220);
}

/* ---------- busy state ---------- */
async function withBusy(btn, msg, fn) {
  const old = btn.textContent; btn.disabled = true; btn.dataset.busy = '1';
  btn.innerHTML = `<span class="spin"></span>${msg}`;
  try { await fn(); }
  catch (err) { toast(err.message || 'Something went wrong.'); console.error(err); }
  finally { btn.disabled = false; delete btn.dataset.busy; btn.textContent = old; }
}

/* ================= BARCODE (Open Food Facts + zxing via html5-qrcode) ================= */
const _scripts = {};
function loadScript(src) {
  if (_scripts[src]) return _scripts[src];
  _scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not load the scanner (no connection?). Type the number instead.'));
    document.head.appendChild(s);
  });
  return _scripts[src];
}

let h5 = null, scannerOn = false;
async function startScanner(container, onCode) {
  await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
  if (!window.Html5Qrcode) throw new Error('Scanner unavailable. Type the number instead.');
  container.innerHTML = '';
  const fmts = window.Html5QrcodeSupportedFormats;
  const formatsToSupport = fmts ? [fmts.EAN_13, fmts.EAN_8, fmts.UPC_A, fmts.UPC_E, fmts.CODE_128, fmts.CODE_39] : undefined;
  h5 = new window.Html5Qrcode(container.id, { formatsToSupport, verbose: false });
  scannerOn = true;
  await h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 150 } },
    (txt) => { stopScanner(); onCode(txt); }, () => {});
}
function stopScanner() {
  if (!h5) { scannerOn = false; return; }
  const inst = h5; h5 = null; scannerOn = false;
  try { inst.stop().then(() => { try { inst.clear(); } catch {} }).catch(() => {}); } catch {}
}
async function lookupBarcode(code) {
  let res;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size`);
  } catch { throw new Error('Network error looking up barcode.'); }
  const j = await res.json();
  if (j.status !== 1 || !j.product) throw new Error('Product not found. Enter it manually.');
  const n = j.product.nutriments || {};
  const hasServing = n['energy-kcal_serving'] != null || n['proteins_serving'] != null;
  const basis = hasServing ? 'serving' : '100g';
  const pick = (k) => round(n[`${k}_${basis}`] ?? n[`${k}_100g`] ?? 0);
  const kcal = round(n[`energy-kcal_${basis}`] ?? n['energy-kcal_100g'] ?? 0);
  const nm = (j.product.product_name || 'Food') + (j.product.brands ? ` (${j.product.brands.split(',')[0]})` : '');
  return {
    name: nm.slice(0, 80),
    calories: kcal,
    protein: pick('proteins'),
    carbs: pick('carbohydrates'),
    fat: pick('fat'),
    confidence: '',
    notes: basis === 'serving' ? `Per serving${j.product.serving_size ? ` (${j.product.serving_size})` : ''} — adjust if needed.` : 'Per 100 g — scale to your portion.',
  };
}

/* ================= VOICE ================= */
let recog = null;
function startVoice(textarea, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice isn’t supported here — use the keyboard’s mic key instead.'); return; }
  if (recog) { try { recog.stop(); } catch {} recog = null; btn.classList.remove('listening'); return; }
  recog = new SR();
  recog.lang = 'en-US'; recog.interimResults = true; recog.continuous = false;
  btn.classList.add('listening');
  recog.onresult = (e) => {
    let s = '';
    for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
    textarea.value = s;
  };
  recog.onerror = (e) => { if (e.error !== 'aborted') toast('Didn’t catch that — try again.'); };
  recog.onend = () => { btn.classList.remove('listening'); recog = null; };
  try { recog.start(); } catch { btn.classList.remove('listening'); recog = null; }
}

/* ================= OPENAI ================= */
function requireKey() {
  if (!settings.apiKey) { toast('Add your OpenAI API key in Settings first.'); currentTab = 'settings'; render(); return false; }
  return true;
}

async function callOpenAI(messages, { json = false } = {}) {
  const body = { model: settings.model, messages };
  if (json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) { throw new Error('Network error — check your connection.'); }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || ''; } catch {}
    if (json && /response_format|json/i.test(detail)) return callOpenAI(messages, { json: false });
    if (res.status === 401) throw new Error('Invalid API key. Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited or out of credit. Try again shortly.');
    throw new Error(detail || `OpenAI error (${res.status}).`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

const EST_SYS = `You are a precise nutrition estimator. Given a food description or photo, estimate the macros for the WHOLE portion shown or described.
Respond with ONLY a JSON object — no markdown, no prose — with exactly these keys:
{"name": string (short food name), "calories": number, "protein": number, "carbs": number, "fat": number, "confidence": "low"|"medium"|"high", "notes": string (one short sentence on assumptions/portion)}
Use grams for protein, carbs, fat and kcal for calories. Assume typical US home/restaurant portions when size is unclear. Round to whole numbers.`;

function parseEstimate(raw) {
  let s = raw.replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b >= 0) s = s.slice(a, b + 1);
  let o;
  try { o = JSON.parse(s); } catch { throw new Error('Could not read the AI estimate. Try rephrasing.'); }
  return {
    name: (o.name || 'Food').toString().slice(0, 80),
    calories: round(o.calories), protein: round(o.protein), carbs: round(o.carbs), fat: round(o.fat),
    confidence: ['low', 'medium', 'high'].includes(o.confidence) ? o.confidence : 'medium',
    notes: (o.notes || '').toString().slice(0, 200),
  };
}

async function aiEstimateText(desc) {
  const out = await callOpenAI([
    { role: 'system', content: EST_SYS },
    { role: 'user', content: `Estimate macros for: ${desc}` },
  ], { json: true });
  return parseEstimate(out);
}
async function aiEstimatePhoto(dataUrl, hint) {
  const out = await callOpenAI([
    { role: 'system', content: EST_SYS },
    { role: 'user', content: [
      { type: 'text', text: 'Estimate the macros for the food in this image.' + (hint ? ' Hint: ' + hint : '') },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] },
  ], { json: true });
  return parseEstimate(out);
}

/* ---------- image downscale ---------- */
function downscaleImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) {
          const r = Math.min(max / width, max / height);
          width = Math.round(width * r); height = Math.round(height * r);
        }
        const c = el('canvas'); c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        try { resolve(c.toDataURL('image/jpeg', quality)); } catch { resolve(reader.result); }
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

/* ================= HISTORY ================= */
let calMonth = (() => { const d = parseDate(currentDate); return { y: d.getFullYear(), m: d.getMonth() }; })();

function renderHistory() {
  const v = app(); v.innerHTML = '';
  const { y, m } = calMonth;
  const first = new Date(y, m, 1);
  const startWd = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const head = el('div', 'datestrip');
  head.innerHTML = `
    <button class="nav" id="prevMonth" aria-label="Previous month">‹</button>
    <div class="date-label static">${monthName}</div>
    <button class="nav" id="nextMonth" aria-label="Next month">›</button>`;
  v.appendChild(head);

  const cal = el('section', 'card cal');
  const wd = el('div', 'cal-week');
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => wd.appendChild(el('span', 'wd', d)));
  cal.appendChild(wd);
  const grid = el('div', 'cal-grid');
  for (let i = 0; i < startWd; i++) grid.appendChild(el('div', 'cal-cell empty'));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const cell = el('button', 'cal-cell');
    if (ds === todayStr()) cell.classList.add('is-today');
    if (ds === currentDate) cell.classList.add('is-selected');
    cell.innerHTML = `<span class="cal-d">${d}</span>`;
    if (dayHasData(ds)) {
      const raw = getDayRaw(ds);
      const tot = totals(raw);
      const tg = activeTargets(raw).calories;
      const ratio = tg > 0 ? tot.calories / tg : 0;
      const cls = ratio === 0 ? '' : ratio <= 1.05 ? 'good' : 'over';
      cell.classList.add('logged');
      cell.appendChild(el('span', 'cal-dot ' + cls));
    }
    cell.onclick = () => { currentDate = ds; currentTab = 'today'; render(); };
    grid.appendChild(cell);
  }
  cal.appendChild(grid);
  v.appendChild(cal);

  // weight trend
  v.appendChild(weightCard());

  // 7-day summary
  const summary = el('section', 'card');
  const last7 = [];
  for (let i = 0; i < 7; i++) last7.push(addDays(todayStr(), -i));
  const logged = last7.filter(dayHasData);
  let avg = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ds of logged) { const t = totals(getDayRaw(ds)); for (const k in avg) avg[k] += t[k]; }
  const n = logged.length || 1;
  summary.innerHTML = `
    <h3 class="extras-title">Last 7 days</h3>
    <div class="avg-grid">
      <div><span class="k">Days logged</span><b class="mono">${logged.length}/7</b></div>
      <div><span class="k">Avg kcal</span><b class="mono">${round(avg.calories / n)}</b></div>
      <div><span class="k">Avg protein</span><b class="mono">${round(avg.protein / n)}g</b></div>
      <div><span class="k">Avg carbs</span><b class="mono">${round(avg.carbs / n)}g</b></div>
      <div><span class="k">Avg fat</span><b class="mono">${round(avg.fat / n)}g</b></div>
      <div><span class="k">Streak</span><b class="mono">${computeStreak()} 🔥</b></div>
    </div>`;
  v.appendChild(summary);

  $('#prevMonth').onclick = () => { calMonth.m--; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } renderHistory(); };
  $('#nextMonth').onclick = () => { calMonth.m++; if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } renderHistory(); };
}

function weightCard() {
  // gather last 45 days of weights
  const pts = [];
  for (let i = 44; i >= 0; i--) {
    const ds = addDays(todayStr(), -i);
    const w = days[ds]?.weight;
    if (w != null && !isNaN(+w)) pts.push({ ds, w: +w });
  }
  const card = el('section', 'card');
  if (pts.length < 1) {
    card.innerHTML = `<h3 class="extras-title">Body weight</h3><p class="empty">Log your weight on the Today tab to see a trend here.</p>`;
    return card;
  }
  const latest = pts[pts.length - 1].w;
  const firstW = pts[0].w;
  const delta = +(latest - firstW).toFixed(1);
  const sign = delta > 0 ? '+' : '';
  const spark = sparkline(pts.map(p => p.w), 300, 70);
  card.innerHTML = `
    <h3 class="extras-title">Body weight</h3>
    <div class="weight-head">
      <div><b class="mono big">${latest}</b> <span class="unit">${settings.weightUnit}</span></div>
      <div class="weight-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${pts.length > 1 ? `${sign}${delta} ${settings.weightUnit} over ${pts.length} entries` : 'first entry'}</div>
    </div>
    ${spark}`;
  return card;
}
function sparkline(values, w, h) {
  if (values.length === 1) values = [values[0], values[0]];
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const pad = 6;
  const n = values.length;
  const x = (i) => pad + (i / (n - 1)) * (w - pad * 2);
  const yv = (val) => pad + (1 - (val - min) / range) * (h - pad * 2);
  const pointsArr = values.map((v, i) => `${x(i).toFixed(1)},${yv(v).toFixed(1)}`);
  const points = pointsArr.join(' ');
  const area = `${pad},${h - pad} ${points} ${(w - pad)},${h - pad}`;
  const lastX = x(n - 1).toFixed(1), lastY = yv(values[n - 1]).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${area}" class="spark-area"/>
    <polyline points="${points}" class="spark-line"/>
    <circle cx="${lastX}" cy="${lastY}" r="3.5" class="spark-dot"/>
  </svg>`;
}

/* ================= CHAT ================= */
function renderChat() {
  const v = app(); v.innerHTML = '';
  const wrap = el('section', 'chat-wrap');
  wrap.innerHTML = `
    <div class="chat-head">
      <h3>Coach</h3>
      <button id="clearChat" class="ghost sm">Clear</button>
    </div>
    <div class="chat-log" id="chatLog"></div>
    <div class="chat-input">
      <textarea id="chatInput" rows="1" placeholder="Ask about nutrition, your day, swaps…"></textarea>
      <button id="chatSend" class="primary round" aria-label="Send">↑</button>
    </div>`;
  v.appendChild(wrap);

  const log = $('#chatLog');
  if (!chat.length) {
    log.appendChild(bubble('assistant', "Hey — I'm your nutrition coach. Ask me to estimate a meal, suggest a high-protein snack, or check how your day's tracking."));
  } else {
    for (const m of chat) log.appendChild(bubble(m.role, m.content));
  }
  log.scrollTop = log.scrollHeight;

  const input = $('#chatInput');
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    if (!requireKey()) return;
    input.value = ''; input.style.height = 'auto';
    chat.push({ role: 'user', content: text }); saveChat();
    log.appendChild(bubble('user', text));
    const thinking = bubble('assistant', '…'); thinking.classList.add('thinking'); log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const reply = await aiChat();
      thinking.classList.remove('thinking');
      thinking.querySelector('.bubble-text').textContent = reply;
      chat.push({ role: 'assistant', content: reply }); saveChat();
    } catch (err) {
      thinking.classList.remove('thinking');
      thinking.querySelector('.bubble-text').textContent = '⚠️ ' + (err.message || 'Error');
    }
    log.scrollTop = log.scrollHeight;
  };
  $('#chatSend').onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  $('#clearChat').onclick = () => { chat = []; saveChat(); renderChat(); };
}

function bubble(role, text) {
  const b = el('div', 'bubble ' + role);
  b.innerHTML = `<span class="bubble-text"></span>`;
  b.querySelector('.bubble-text').textContent = text;
  return b;
}

async function aiChat() {
  const day = getDay(); const t = totals(day); const tg = activeTargets(day);
  const context = `Today (${currentDate}, ${getDayType(day)} day): ${t.calories}/${tg.calories} kcal, protein ${t.protein}/${tg.protein}g, carbs ${t.carbs}/${tg.carbs}g, fat ${t.fat}/${tg.fat}g.` +
    (day.burned ? ` Burned: ${day.burned} kcal.` : '') + (day.steps ? ` Steps: ${day.steps}.` : '') + (day.weight ? ` Weight: ${day.weight}${settings.weightUnit}.` : '');
  const msgs = [
    { role: 'system', content: `You are a concise, practical nutrition and fitness coach inside a macro-tracking app for an endurance runner. Keep answers short and actionable. Use the user's current numbers when relevant. ${context}` },
    ...chat.slice(-12),
  ];
  return await callOpenAI(msgs, { json: false });
}

/* ================= SETTINGS ================= */
function renderSettings() {
  const v = app(); v.innerHTML = '';
  const tg = settings.targets, rt = settings.restTargets;
  const s = el('div', 'settings');
  s.innerHTML = `
    <section class="card">
      <h3 class="extras-title">OpenAI</h3>
      <label class="field full"><span>API key</span>
        <div class="key-row">
          <input id="apiKey" type="password" placeholder="sk-…" value="${escapeAttr(settings.apiKey)}" autocomplete="off" spellcheck="false">
          <button id="toggleKey" class="ghost sm" type="button">Show</button>
        </div>
      </label>
      <label class="field full"><span>Model</span>
        <select id="model">
          ${modelOpt('gpt-5.4-nano', 'GPT-5.4 nano — cheapest, fast')}
          ${modelOpt('gpt-5.4-mini', 'GPT-5.4 mini — better photo accuracy')}
          ${modelOpt('gpt-5.5', 'GPT-5.5 — most accurate, pricier')}
        </select>
      </label>
      <div class="row-actions">
        <button id="saveKey" class="primary">Save</button>
        <button id="testKey" class="ghost">Test key</button>
      </div>
      <p class="hint">Your key is stored only on this device (localStorage) and sent only to OpenAI. Get one at platform.openai.com.</p>
    </section>

    <section class="card">
      <h3 class="extras-title">Training-day targets</h3>
      <div class="targets-grid">
        <label class="field"><span>Calories</span><input id="t-cal" class="mono" inputmode="numeric" value="${tg.calories}"></label>
        <label class="field"><span>Protein (g)</span><input id="t-protein" class="mono" inputmode="numeric" value="${tg.protein}"></label>
        <label class="field"><span>Carbs (g)</span><input id="t-carbs" class="mono" inputmode="numeric" value="${tg.carbs}"></label>
        <label class="field"><span>Fat (g)</span><input id="t-fat" class="mono" inputmode="numeric" value="${tg.fat}"></label>
      </div>
    </section>

    <section class="card">
      <h3 class="extras-title">Rest-day targets</h3>
      <div class="targets-grid">
        <label class="field"><span>Calories</span><input id="r-cal" class="mono" inputmode="numeric" value="${rt.calories}"></label>
        <label class="field"><span>Protein (g)</span><input id="r-protein" class="mono" inputmode="numeric" value="${rt.protein}"></label>
        <label class="field"><span>Carbs (g)</span><input id="r-carbs" class="mono" inputmode="numeric" value="${rt.carbs}"></label>
        <label class="field"><span>Fat (g)</span><input id="r-fat" class="mono" inputmode="numeric" value="${rt.fat}"></label>
      </div>
      <label class="field full" style="margin-top:12px"><span>Default for new days</span>
        <select id="defType">
          <option value="training">Training day</option>
          <option value="rest">Rest day</option>
        </select>
      </label>
      <label class="toggle">
        <input type="checkbox" id="autoRest">
        <span>Auto-set rest days from calories burned</span>
      </label>
      <label class="field full ${settings.autoRest ? '' : 'dim'}" id="threshWrap"><span>…when burned is below (kcal)</span>
        <input id="restThresh" class="mono" inputmode="numeric" value="${settings.restThreshold}">
      </label>
      <button id="saveTargets" class="primary" style="margin-top:6px">Save targets</button>
    </section>

    <section class="card">
      <h3 class="extras-title">Units</h3>
      <label class="field full"><span>Body weight unit</span>
        <select id="wUnit"><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select>
      </label>
    </section>

    <section class="card">
      <h3 class="extras-title">Apple Health sync (iOS Shortcut)</h3>
      <p class="hint" style="margin-top:0">A web app can't read Health directly. Build the Shortcut in the README, and it opens this app with your steps and active energy in the link. The app reads them automatically. You can also test it:</p>
      <button id="testSync" class="ghost" style="margin-top:10px">Simulate a sync (demo)</button>
    </section>

    <section class="card">
      <h3 class="extras-title">Your data</h3>
      <p class="hint">Everything lives in this browser. Back it up regularly — clearing Safari data will erase it.</p>
      <div class="row-actions wrap">
        <button id="exportBtn" class="ghost">Export backup</button>
        <button id="importBtn" class="ghost">Import backup</button>
        <input id="importFile" type="file" accept="application/json" hidden>
        <button id="wipeBtn" class="danger">Erase all data</button>
      </div>
    </section>

    <p class="footer-note">Macro Meter · built for iPhone home screen · v2</p>`;
  v.appendChild(s);

  $('#toggleKey').onclick = () => {
    const k = $('#apiKey'); const sh = k.type === 'password';
    k.type = sh ? 'text' : 'password'; $('#toggleKey').textContent = sh ? 'Hide' : 'Show';
  };
  $('#model').value = settings.model;
  $('#defType').value = settings.defaultDayType;
  $('#autoRest').checked = !!settings.autoRest;
  $('#wUnit').value = settings.weightUnit;
  $('#autoRest').onchange = () => $('#threshWrap').classList.toggle('dim', !$('#autoRest').checked);

  $('#saveKey').onclick = () => {
    settings.apiKey = $('#apiKey').value.trim();
    settings.model = $('#model').value;
    saveSettings(); toast('Saved');
  };
  $('#model').onchange = () => { settings.model = $('#model').value; saveSettings(); };
  $('#testKey').onclick = async () => {
    const key = $('#apiKey').value.trim();
    if (!key) return toast('Enter a key first.');
    settings.apiKey = key; settings.model = $('#model').value; saveSettings();
    await withBusy($('#testKey'), 'Testing…', async () => {
      const r = await callOpenAI([{ role: 'user', content: 'Reply with the single word: ok' }], { json: false });
      toast(r ? 'Key works ✓' : 'No response, but no error.');
    });
  };
  $('#saveTargets').onclick = () => {
    const num = (id) => Math.max(0, round($(id).value));
    settings.targets     = { calories: num('#t-cal'), protein: num('#t-protein'), carbs: num('#t-carbs'), fat: num('#t-fat') };
    settings.restTargets = { calories: num('#r-cal'), protein: num('#r-protein'), carbs: num('#r-carbs'), fat: num('#r-fat') };
    settings.defaultDayType = $('#defType').value;
    settings.autoRest = $('#autoRest').checked;
    settings.restThreshold = num('#restThresh');
    saveSettings(); toast('Targets saved');
  };
  $('#wUnit').onchange = () => { settings.weightUnit = $('#wUnit').value; saveSettings(); toast('Saved'); };
  $('#testSync').onclick = () => {
    const day = getDay(todayStr());
    day.steps = 8200; day.burned = 540; saveDays();
    toast('Demo: steps 8200, burned 540 written to today');
  };
  $('#exportBtn').onclick = exportData;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = importData;
  $('#wipeBtn').onclick = wipeData;
}
function modelOpt(val, label) { return `<option value="${val}">${label}</option>`; }

function exportData() {
  const payload = { app: 'macro-meter', version: 2, exported: new Date().toISOString(), settings, days, favs, chat };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a'); a.href = url; a.download = `macro-meter-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Backup downloaded');
}
function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.days) { days = data.days; saveDays(); }
      if (data.settings) { settings = mergeSettings(data.settings); saveSettings(); }
      if (data.favs) { favs = data.favs; saveFavs(); }
      if (data.chat) { chat = data.chat; saveChat(); }
      toast('Backup restored'); render();
    } catch { toast('That file could not be read.'); }
  };
  reader.readAsText(f);
  e.target.value = '';
}
function wipeData() {
  if (!confirm('Erase ALL logged days, foods, settings and chat on this device? This cannot be undone.')) return;
  [K.days, K.favs, K.chat, K.settings].forEach(k => localStorage.removeItem(k));
  days = {}; favs = []; chat = []; settings = mergeSettings({});
  toast('All data erased'); currentDate = todayStr(); render();
}

/* ---------- utils ---------- */
function label(meal) { return MEALS.find(m => m.key === meal)?.label || meal; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- Shortcut / Health URL ingest ---------- */
function ingestQuery() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.get('date') || '') ? p.get('date') : todayStr();
  const day = getDay(date);
  let changed = false, parts = [];
  if (p.has('steps'))  { day.steps  = Math.max(0, round(p.get('steps')));  changed = true; parts.push(`${day.steps} steps`); }
  if (p.has('burned')) { day.burned = Math.max(0, round(p.get('burned'))); changed = true; parts.push(`${day.burned} kcal burned`); }
  if (p.has('weight')) { const w = Number(p.get('weight')); if (!isNaN(w)) { day.weight = w; changed = true; parts.push(`${w}${settings.weightUnit}`); } }
  if (changed) {
    saveDays();
    currentDate = date;
    setTimeout(() => toast('Synced: ' + parts.join(' · ')), 400);
  }
  history.replaceState({}, '', location.pathname);
}

/* ---------- boot ---------- */
$$('.tabbar button').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; render(); });
ingestQuery();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
