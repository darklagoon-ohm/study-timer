/* ============================================================
   STUDY TIMER — lógica do aplicativo (JavaScript puro)

   Modelo de dados:
   Estudo -> Atividade -> Questão -> Tentativas (tempos em segundos inteiros)

   Tudo é salvo em localStorage. Não há servidor, login ou API.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   1. PERSISTÊNCIA
   ------------------------------------------------------------ */

const STORAGE_KEY = 'study-timer.v1';

/* Temas disponíveis. As cores de cada um ficam em style.css
   ([data-theme="id"]); aqui só ficam o id e o nome exibido. */
const THEMES = [
  { id: 'retro',      name: 'RETRO' },
  { id: 'midnight',   name: 'MIDNIGHT' },
  { id: 'cyberpunk',  name: 'CYBERPUNK' },
  { id: 'forest',     name: 'FOREST' },
  { id: 'sakura',     name: 'SAKURA' },
  { id: 'dracula',    name: 'DRACULA' },
  { id: 'minimalist', name: 'MINIMALIST' },
  { id: 'coffee',     name: 'COFFEE' },
  { id: 'nord',       name: 'NORD' },
  { id: 'gameboy',    name: 'GAMEBOY' }
];
const DEFAULT_THEME = 'retro';

/** Estrutura padrão usada quando não há nada salvo. */
function emptyDB() {
  return {
    version: 1,
    sound: true,
	lastBackup: 0,          // quando foi o último backup (0 = nunca)
	reminders: [],          // [{id, time:'21:00', days:[0..6]}]  (0 = domingo)
    reminderSeen: 0,        // até quando o aviso foi dispensado
	theme: DEFAULT_THEME,
    studies: [],            // [{id, name, createdAt, activities:[...]}]
    ui: { view: 'home', studyId: null, activityId: null, questionId: null, open: {} }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDB();
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch (err) {
    console.warn('Não foi possível ler os dados salvos:', err);
    return emptyDB();
  }
}

/** Garante que dados vindos do storage/import tenham todos os campos. */
function normalize(obj) {
  const base = emptyDB();
  if (!obj || typeof obj !== 'object') return base;
  base.sound = obj.sound !== false;
  base.lastBackup = Number(obj.lastBackup) || 0;
    base.reminderSeen = Number(obj.reminderSeen) || 0;
  base.reminders = (Array.isArray(obj.reminders) ? obj.reminders : [])
    .filter(r => r && /^\d{2}:\d{2}$/.test(r.time) && Array.isArray(r.days))
    .map(r => ({ id: r.id || uid(), time: r.time, days: r.days.filter(d => d >= 0 && d <= 6) }));
  base.theme = THEMES.some(t => t.id === obj.theme) ? obj.theme : DEFAULT_THEME;
  base.ui = Object.assign(base.ui, obj.ui || {});
  base.ui.open = (obj.ui && obj.ui.open) || {};
  base.studies = (Array.isArray(obj.studies) ? obj.studies : []).map(s => ({
    id: s.id || uid(),
    name: String(s.name || 'Sem nome'),
    createdAt: s.createdAt || Date.now(),
    activities: (Array.isArray(s.activities) ? s.activities : []).map(a => ({
      id: a.id || uid(),
      name: String(a.name || 'Sem nome'),
      createdAt: a.createdAt || Date.now(),
      questions: (Array.isArray(a.questions) ? a.questions : []).map((q, i) => ({
        id: q.id || uid(),
        index: Number.isFinite(q.index) ? q.index : i + 1,
        label: String(q.label || ''),
        caption: String(q.caption || ''),               // legenda (opcional)
        comment: String(q.comment || ''),                // comentário/observações (opcional)
        answer: String(q.answer || ''),                  // resposta registrada (opcional)
        color: typeof q.color === 'string' ? q.color : '', // cor personalizada do bloco ('' = usa a cor padrão)
        attempts: (Array.isArray(q.attempts) ? q.attempts : [])
          // precisão mínima: 1 segundo inteiro
          .map(t => ({ id: t.id || uid(), seconds: Math.max(1, Math.round(Number(t.seconds) || 0)), at: t.at || Date.now() }))
      }))
    }))
  }));
  return base;
}

/** Grava no localStorage (chamado depois de qualquer alteração). */
function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('Falha ao salvar:', err);
    toast('SEM ESPAÇO PARA SALVAR');
  }
}

let db = loadDB();

/** Aplica o tema atual no <html>; o CSS faz o resto via variáveis. */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', db.theme);
}
applyTheme();

/* ------------------------------------------------------------
   2. UTILITÁRIOS
   ------------------------------------------------------------ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const pad2 = n => String(n).padStart(2, '0');

/** Formata segundos inteiros como MM:SS (ou HH:MM:SS acima de 1h). */
function fmt(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** Escapa texto do usuário antes de injetar no HTML. */
function esc(str) {
  return String(str).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* --- Localizadores no modelo --- */
const getStudy = id => db.studies.find(s => s.id === id) || null;
const getActivity = (study, id) => (study ? study.activities.find(a => a.id === id) : null) || null;
const getQuestion = (act, id) => (act ? act.questions.find(q => q.id === id) : null) || null;

function current() {
  const study = getStudy(db.ui.studyId);
  const activity = getActivity(study, db.ui.activityId);
  const question = getQuestion(activity, db.ui.questionId);
  return { study, activity, question };
}

/* --- Estatísticas --- */
function questionStats(q) {
  const times = q.attempts.map(a => a.seconds);
  const total = times.reduce((a, b) => a + b, 0);
  return {
    count: times.length,
    total,
    avg: times.length ? Math.round(total / times.length) : 0,
    min: times.length ? Math.min(...times) : 0,
    max: times.length ? Math.max(...times) : 0
  };
}

function activityStats(act) {
  const perQ = act.questions.map(questionStats);
  const total = perQ.reduce((a, s) => a + s.total, 0);
  const attempts = perQ.reduce((a, s) => a + s.count, 0);
  const solved = perQ.filter(s => s.count > 0).length;
  return {
    total,
    attempts,
    questions: act.questions.length,
    avgPerQuestion: solved ? Math.round(total / solved) : 0
  };
}

/* --- Bipe retrô opcional (Web Audio, sem arquivos externos) --- */
let audioCtx = null;
function beep(freq = 440, ms = 70) {
  if (!db.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';                 // onda quadrada = som de console antigo
    osc.frequency.value = freq;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch (_) { /* áudio é opcional */ }
}

/* ------------------------------------------------------------
   3. CRONÔMETRO
   Contagem baseada em timestamps (imune a atrasos do setInterval).
   Exibe e salva apenas segundos inteiros.
   ------------------------------------------------------------ */

const timer = {
  running: false,
  startedAt: 0,      // momento em que a contagem atual começou
  accumulated: 0,    // milissegundos acumulados em pausas anteriores
  questionId: null,  // questão travada no início da sessão
  tickId: null,

  elapsedMs() {
    return this.accumulated + (this.running ? Date.now() - this.startedAt : 0);
  },
  seconds() {
    return Math.floor(this.elapsedMs() / 1000);
  },
  active() {                       // existe sessão em andamento (rodando ou pausada)?
    return this.running || this.accumulated > 0;
  },
  start(questionId) {
    if (this.running) return;
    if (!this.active()) this.questionId = questionId;
    this.running = true;
    this.startedAt = Date.now();
    this.tickId = setInterval(paintTimer, 200);
    beep(660, 60);
    paintTimer();
  },
  pause() {
    if (!this.running) return;
    this.accumulated += Date.now() - this.startedAt;
    this.running = false;
    clearInterval(this.tickId);
    beep(330, 60);
    paintTimer();
  },
  /** Encerra e devolve os segundos inteiros da sessão (0 se descartada). */
  clear() {
    clearInterval(this.tickId);
    this.running = false;
    this.accumulated = 0;
    this.startedAt = 0;
    this.questionId = null;
  }
};

/* ------------------------------------------------------------
   4. AÇÕES SOBRE OS DADOS
   ------------------------------------------------------------ */

/** Salva a sessão atual do cronômetro como uma nova tentativa. */
function stopAndSave() {
  const secs = timer.seconds();
  const { activity } = current();
  const q = getQuestion(activity, timer.questionId);
  timer.clear();

  if (!q) { toast('QUESTÃO NÃO ENCONTRADA'); render(); return; }
  if (secs < 1) { toast('TEMPO MENOR QUE 00:01 — DESCARTADO'); render(); return; }

  addAttempt(q, secs);
  beep(880, 90);
  toast(`Q${pad2(q.index)} +${fmt(secs)}`);
  render();
}

/** Nunca apaga tentativas anteriores: sempre adiciona ao final da lista. */
function addAttempt(question, seconds) {
  question.attempts.push({ id: uid(), seconds: Math.max(1, Math.round(seconds)), at: Date.now() });
  db.ui.open[question.id] = true;   // abre o detalhe para dar retorno visual
  saveDB();
}

function nextQuestion(step = 1) {
  const { activity } = current();
  if (!activity || !activity.questions.length) return;
  const i = activity.questions.findIndex(q => q.id === db.ui.questionId);
  const next = activity.questions[(i + step + activity.questions.length) % activity.questions.length];
  selectQuestion(next.id);
}

/** Troca a questão selecionada, protegendo uma sessão em andamento. */
async function selectQuestion(id) {
  if (timer.active() && timer.questionId && timer.questionId !== id) {
    const { activity } = current();
    const running = getQuestion(activity, timer.questionId);
    const choice = await showModal({
      title: 'SESSÃO EM ANDAMENTO',
      html: `<p>O cronômetro está em <b>Q${pad2(running ? running.index : 0)}</b> com ${fmt(timer.seconds())}.
             O que fazer antes de trocar de questão?</p>`,
      buttons: [
        { label: 'SALVAR E TROCAR', value: 'save', primary: true },
        { label: 'DESCARTAR', value: 'discard' },
        { label: 'CANCELAR', value: null }
      ]
    });
    if (choice === null) return;
    if (choice === 'save') { const s = timer.seconds(); if (s >= 1 && running) addAttempt(running, s); }
    timer.clear();
  }
  db.ui.questionId = id;
  saveDB();
  render();
}

function addManualTime() {
  const minEl = document.getElementById('manualMin');
  const secEl = document.getElementById('manualSec');
  const { question } = current();
  if (!question) { toast('SELECIONE UMA QUESTÃO'); return; }

  let m = parseInt(minEl.value, 10); if (!Number.isFinite(m) || m < 0) m = 0;
  let s = parseInt(secEl.value, 10); if (!Number.isFinite(s) || s < 0) s = 0;
  if (s > 59) { m += Math.floor(s / 60); s = s % 60; }   // 90s vira 01:30

  const total = m * 60 + s;
  if (total < 1) { toast('MÍNIMO 00:01'); secEl.focus(); return; }

  addAttempt(question, total);
  beep(770, 70);
  toast(`Q${pad2(question.index)} +${fmt(total)}`);
  render();
  const again = document.getElementById('manualMin');
  if (again) again.focus();
}

/* ------------------------------------------------------------
   5. RENDERIZAÇÃO
   ------------------------------------------------------------ */

const app = document.getElementById('app');
const crumbEl = document.getElementById('breadcrumb');
const statusEl = document.getElementById('statusbar');

function render() {
  const { study, activity } = current();

  // Corrige rota inválida (ex.: item apagado)
  if (db.ui.view === 'activity' && !activity) db.ui.view = study ? 'study' : 'home';
  if (db.ui.view === 'study' && !study) db.ui.view = 'home';

  document.getElementById('soundBtn').textContent = 'SOM: ' + (db.sound ? 'ON' : 'OFF');
  crumbEl.innerHTML = renderCrumb();

  if (db.ui.view === 'home') { app.innerHTML = viewHome(); statusEl.innerHTML = 'Dados salvos neste navegador.'; }
  else if (db.ui.view === 'study') { app.innerHTML = viewStudy(study); statusEl.innerHTML = 'Escolha uma atividade para cronometrar.'; }
  else { app.innerHTML = viewActivity(activity); statusEl.innerHTML = shortcutsHTML(); paintTimer(); }
  paintBackupBanner();
}

function renderCrumb() {
  const { study, activity } = current();
  const parts = ['<b>DASHBOARD</b>'];
  if (study && db.ui.view !== 'home') parts.push(`<b>${esc(study.name)}</b>`);
  if (activity && db.ui.view === 'activity') parts.push(`<b>${esc(activity.name)}</b>`);
  return parts.join(' &rsaquo; ');
}

function shortcutsHTML() {
  return `<kbd>ESPAÇO</kbd>play/pause &nbsp; <kbd>ENTER</kbd>parar e salvar &nbsp;
          <kbd>R</kbd>descartar &nbsp; <kbd>N</kbd>próxima questão &nbsp; <kbd>ESC</kbd>voltar`;
}

/* --- Dashboard --- */
function viewHome() {
  const rows = db.studies.map(s => {
    const acts = s.activities.length;
    const total = s.activities.reduce((sum, a) => sum + activityStats(a).total, 0);
    return `<li class="row">
      <button class="row-main" data-act="open-study" data-id="${s.id}">
        <span class="row-title">&gt; ${esc(s.name)}</span>
        <span class="row-sub">${acts} ${acts === 1 ? 'atividade' : 'atividades'} · ${fmt(total)} estudado</span>
      </button>
      <span class="row-actions">
        <button class="btn btn-sm btn-ghost" data-act="rename-study" data-id="${s.id}">REN</button>
        <button class="btn btn-sm btn-ghost" data-act="delete-study" data-id="${s.id}">DEL</button>
      </span>
    </li>`;
  }).join('');

  return `<section class="panel">
    <div class="panel-head">
      <h2>MEUS ESTUDOS</h2>
      <button class="btn" data-act="new-study">+ NOVO ESTUDO</button>
    </div>
    ${db.studies.length
      ? `<ul class="list">${rows}</ul>`
      : `<div class="empty"><strong>NENHUM ESTUDO AINDA</strong>
           Crie um estudo (Física, matemática...) para começar a cronometrar.</div>`}
  </section>`;
}

/* --- Estudo: lista de atividades --- */
function viewStudy(study) {
  const rows = study.activities.map(a => {
    const st = activityStats(a);
    return `<li class="row">
      <button class="row-main" data-act="open-activity" data-id="${a.id}">
        <span class="row-title">&gt; ${esc(a.name)}</span>
        <span class="row-sub">${st.questions} questões · ${st.attempts} tentativas · ${fmt(st.total)}</span>
      </button>
      <span class="row-actions">
        <button class="btn btn-sm btn-ghost" data-act="rename-activity" data-id="${a.id}">REN</button>
        <button class="btn btn-sm btn-ghost" data-act="delete-activity" data-id="${a.id}">DEL</button>
      </span>
    </li>`;
  }).join('');

  return `<section class="panel">
    <div class="panel-head">
      <h2>${esc(study.name)}</h2>
      <span class="row-actions">
        <button class="btn btn-sm" data-act="go-home">&lt; VOLTAR</button>
        <button class="btn" data-act="new-activity">+ NOVA ATIVIDADE</button>
      </span>
    </div>
    ${study.activities.length
      ? `<ul class="list">${rows}</ul>`
      : `<div class="empty"><strong>SEM ATIVIDADES</strong>
           Crie uma lista, prova ou capítulo — por exemplo "Lista 03 - Integrais".</div>`}
  </section>`;
}

/* --- Atividade: cronômetro + questões + estatísticas --- */
function viewActivity(act) {
  const st = activityStats(act);
  const sel = getQuestion(act, db.ui.questionId);

  return `<div class="activity-grid">
    <div class="col-list">
      <section class="panel">
        <div class="panel-head">
          <h2>${esc(act.name)}</h2>
          <span class="row-actions">
            <button class="btn btn-sm" data-act="go-study">&lt; VOLTAR</button>
            <button class="btn btn-sm" data-act="new-question">+ QUESTÃO</button>
            <button class="btn btn-sm btn-ghost" data-act="new-questions">+ VÁRIAS</button>
          </span>
        </div>
        ${act.questions.length
          ? `<ul class="q-list">${act.questions.map(q => questionItem(q, sel)).join('')}</ul>`
          : `<div class="empty"><strong>SEM QUESTÕES</strong>
               Adicione a primeira questão para liberar o cronômetro.</div>`}
      </section>

      <section class="panel">
        <div class="panel-head"><h3>RESUMO DA ATIVIDADE</h3></div>
        <div class="metrics">
          <div class="metric"><span class="k">TEMPO TOTAL</span><span class="v">${fmt(st.total)}</span></div>
          <div class="metric"><span class="k">QUESTÕES</span><span class="v">${pad2(st.questions)}</span></div>
          <div class="metric"><span class="k">TENTATIVAS</span><span class="v">${pad2(st.attempts)}</span></div>
          <div class="metric"><span class="k">MÉDIA/QUESTÃO</span><span class="v">${fmt(st.avgPerQuestion)}</span></div>
        </div>
        ${chartHTML(act)}
      </section>
    </div>

    <div class="col-timer">
      ${timerHTML(sel)}
    </div>
  </div>`;
}

function questionItem(q, sel) {
  const st = questionStats(q);
  const open = !!db.ui.open[q.id];
  const active = sel && sel.id === q.id;

  const chips = q.attempts.map((a, i) => `<li class="chip">
      <span class="n">${pad2(i + 1)}</span>${fmt(a.seconds)}
      <button data-act="delete-attempt" data-id="${q.id}" data-aid="${a.id}" title="Apagar esta tentativa">X</button>
    </li>`).join('');

  // Cor personalizada: aplicada só como uma faixa na borda esquerda do card,
  // para não sacrificar o alto contraste do resto da interface. Sem cor
  // definida, o card usa exatamente a aparência padrão (nenhuma mudança).
  const accentStyle = q.color ? ` style="border-left:6px solid ${esc(q.color)};"` : '';

  return `<li class="q-item ${active ? 'is-active' : ''}"${accentStyle}>
    <div class="q-row">
      <button class="q-head" data-act="pick-question" data-id="${q.id}">
        <span class="q-num">Q${pad2(q.index)}</span>
        <span class="q-label">${q.label ? esc(q.label) : (active ? 'selecionada' : '&nbsp;')}</span>
        <span class="q-total">${st.count ? fmt(st.total) : '--:--'}</span>
        <span class="q-num" data-act="toggle-question" data-id="${q.id}">${open ? '[-]' : '[+]'}</span>
      </button>
    </div>
    ${open ? `<div class="q-body">
      <div class="q-stats">
        <span>TENTATIVAS <b>${pad2(st.count)}</b></span>
        <span>TOTAL <b>${fmt(st.total)}</b></span>
        <span>MÉDIA <b>${fmt(st.avg)}</b></span>
        <span>MENOR <b>${st.count ? fmt(st.min) : '--:--'}</b></span>
        <span>MAIOR <b>${st.count ? fmt(st.max) : '--:--'}</b></span>
      </div>
      ${st.count ? `<ul class="attempts">${chips}</ul>` : '<p class="dim">Nenhum tempo registrado.</p>'}
      <div class="q-body-actions">
        <button class="btn btn-sm btn-ghost" data-act="open-details" data-id="${q.id}">DETALHES</button>
        <button class="btn btn-sm btn-ghost" data-act="rename-question" data-id="${q.id}">RENOMEAR</button>
        <button class="btn btn-sm btn-ghost" data-act="delete-question" data-id="${q.id}">APAGAR QUESTÃO</button>
      </div>
    </div>` : ''}
  </li>`;
}

function timerHTML(sel) {
  const { activity } = current();
  const locked = getQuestion(activity, timer.questionId);
  const target = locked || sel;
  const has = !!target;

  return `<section class="timer-box">
    <div class="timer-target">${has ? `QUESTÃO ${pad2(target.index)}` : 'NENHUMA QUESTÃO'}</div>
    <div class="timer-digits is-idle" id="timerDigits">00:00</div>
    <div class="timer-state" id="timerState"></div>

    <div class="timer-controls">
      <button class="btn btn-lg" data-act="play" id="playBtn" ${has ? '' : 'disabled'}>&#9654; PLAY</button>
      <button class="btn btn-lg" data-act="stop" id="stopBtn" ${has ? '' : 'disabled'}>&#9632; STOP</button>
    </div>
    <div class="timer-controls">
      <button class="btn btn-sm" data-act="reset" ${has ? '' : 'disabled'}>R — DESCARTAR</button>
      <button class="btn btn-sm" data-act="next-question" ${has ? '' : 'disabled'}>N — PRÓXIMA</button>
    </div>

    <div class="manual">
      <div class="field">
        <label for="manualMin">MIN</label>
        <input type="number" id="manualMin" min="0" max="999" step="1" placeholder="00" inputmode="numeric">
      </div>
      <div class="field">
        <label for="manualSec">SEG</label>
        <input type="number" id="manualSec" min="0" max="59" step="1" placeholder="00" inputmode="numeric">
      </div>
      <button class="btn" data-act="add-manual" ${has ? '' : 'disabled'}>+ ADICIONAR TEMPO</button>
    </div>
  </section>${detailsHTML(target)}`;
}

/** Bloco somente-leitura com legenda/comentário/resposta da questão em foco.
    Some por completo quando nenhum dos três campos estiver preenchido, e
    mostra só os campos que têm conteúdo (nunca campos vazios). */
function detailsHTML(q) {
  if (!q) return '';
  const rows = [];
  if (q.caption) rows.push(`<div class="detail-field"><span class="detail-label">LEGENDA</span><p>${esc(q.caption)}</p></div>`);
  if (q.comment) rows.push(`<div class="detail-field"><span class="detail-label">COMENTÁRIO</span><p>${esc(q.comment)}</p></div>`);
  if (q.answer) rows.push(`
    <div class="detail-field">
      <div class="detail-label-row">
        <span class="detail-label" style="margin:0">RESPOSTA</span>
        <button class="btn btn-sm btn-ghost" data-act="toggle-answer">MOSTRAR</button>
      </div>
      <p class="answer-text is-hidden">${esc(q.answer)}</p>
    </div>`);
  if (!rows.length) return '';
  return `<section class="panel details-panel">${rows.join('')}</section>`;
}

/** Atualiza só os dígitos e o estado — não redesenha a tela inteira. */
function paintTimer() {
  const digits = document.getElementById('timerDigits');
  if (!digits) return;
  const state = document.getElementById('timerState');
  const playBtn = document.getElementById('playBtn');
  const secs = timer.seconds();

  digits.textContent = fmt(secs);
  digits.classList.toggle('is-idle', !timer.active());

  if (timer.running) { state.textContent = 'GRAVANDO'; state.className = 'timer-state is-rec'; }
  else if (timer.active()) { state.textContent = 'PAUSADO'; state.className = 'timer-state'; }
  else { state.textContent = 'PRONTO'; state.className = 'timer-state'; }

  if (playBtn) playBtn.innerHTML = timer.running ? '&#10073;&#10073; PAUSE' : '&#9654; PLAY';
}

/** Gráfico de barras em blocos: tempo total por questão. */
function chartHTML(act) {
  const withTime = act.questions.filter(q => q.attempts.length);
  if (!withTime.length) return '';
  const max = Math.max(...withTime.map(q => questionStats(q).total));
  const rows = withTime.map(q => {
    const t = questionStats(q).total;
    const pct = Math.max(4, Math.round((t / max) * 100));
    return `<div class="chart-row">
      <span>Q${pad2(q.index)}</span>
      <span class="bar" style="background-size:${pct}% 100%"></span>
      <span class="val">${fmt(t)}</span>
    </div>`;
  }).join('');
  return `<div class="chart" style="margin-top:14px">${rows}</div>`;
}

/* ------------------------------------------------------------
   6. DIÁLOGOS (modal retrô) E AVISOS
   ------------------------------------------------------------ */

const modalLayer = document.getElementById('modalLayer');
let modalResolve = null;

function modalOpen() { return !modalLayer.hidden; }

/**
 * Abre um diálogo e devolve o valor do botão escolhido (ou null se cancelado).
 * @param {{title:string, html?:string, buttons:Array<{label:string,value:any,primary?:boolean}>}} cfg
 */
function showModal(cfg) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalLayer.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(cfg.title)}">
      <h2>${esc(cfg.title)}</h2>
      ${cfg.html || ''}
      <div class="modal-actions">
        ${cfg.buttons.map((b, i) => `<button class="btn ${b.primary ? '' : 'btn-ghost'}" data-mb="${i}">${esc(b.label)}</button>`).join('')}
      </div>
    </div>`;
    modalLayer.hidden = false;

    modalLayer.querySelectorAll('[data-mb]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = cfg.buttons[Number(btn.dataset.mb)];
        closeModal(typeof b.collect === 'function' ? b.collect(modalLayer) : b.value);
      });
    });

    const first = modalLayer.querySelector('input, textarea') || modalLayer.querySelector('.btn');
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}

function closeModal(value) {
  modalLayer.hidden = true;
  modalLayer.innerHTML = '';
  const r = modalResolve; modalResolve = null;
  if (r) r(value === undefined ? null : value);
}

/** Diálogo simples de texto. Devolve a string digitada ou null. */
async function askText(title, labelText, initial = '') {
  return showModal({
    title,
    html: `<div class="field" style="margin-top:6px">
             <label for="modalInput">${esc(labelText)}</label>
             <input type="text" id="modalInput" value="${esc(initial)}" maxlength="80" autocomplete="off">
           </div>`,
    buttons: [
      { label: 'CONFIRMAR', primary: true, collect: layer => (layer.querySelector('#modalInput').value.trim() || null) },
      { label: 'CANCELAR', value: null }
    ]
  });
}

async function confirmBox(title, message, okLabel = 'APAGAR') {
  const r = await showModal({
    title,
    html: `<p>${message}</p>`,
    buttons: [{ label: okLabel, value: true, primary: true }, { label: 'CANCELAR', value: null }]
  });
  return r === true;
}

let toastId = null;
const toastEl = document.getElementById('toast');
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastId);
  toastId = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

/* ------------------------------------------------------------
   7. EXPORTAR / IMPORTAR
   ------------------------------------------------------------ */

function exportJSON() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), studies: db.studies }, null, 2);
  showModal({
    title: 'EXPORTAR DADOS',
    html: `<p>Copie o texto abaixo ou baixe o arquivo .json como backup.</p>
           <textarea id="exportArea" readonly>${esc(payload)}</textarea>`,
    buttons: [
      { label: 'BAIXAR .JSON', primary: true, collect: () => { download(payload); return null; } },
      { label: 'FECHAR', value: null }
    ]
  });
}

function download(text) {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-timer-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
	markBackup();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast('DOWNLOAD BLOQUEADO — COPIE O TEXTO');
  }
}

async function importJSON() {
  const choice = await showModal({
    title: 'IMPORTAR DADOS',
    html: `<p>Cole o JSON do backup ou escolha um arquivo. Importar substitui ou mescla com os estudos atuais.</p>
           <textarea id="importArea" placeholder='{ "studies": [ ... ] }'></textarea>`,
    buttons: [
      { label: 'MESCLAR', primary: true, collect: layer => ({ mode: 'merge', text: layer.querySelector('#importArea').value }) },
      { label: 'SUBSTITUIR', collect: layer => ({ mode: 'replace', text: layer.querySelector('#importArea').value }) },
      { label: 'ARQUIVO...', value: { mode: 'file' } },
      { label: 'CANCELAR', value: null }
    ]
  });
  if (!choice) return;

  if (choice.mode === 'file') { document.getElementById('fileInput').click(); return; }
  applyImport(choice.text, choice.mode);
}

function applyImport(text, mode) {
  let incoming;
  try { incoming = normalize(JSON.parse(text)); }
  catch (err) { toast('JSON INVÁLIDO'); return; }

  if (!incoming.studies.length) { toast('NENHUM ESTUDO NO ARQUIVO'); return; }

  if (mode === 'replace') {
    db.studies = incoming.studies;
    db.ui = { view: 'home', studyId: null, activityId: null, questionId: null, open: {} };
  } else {
    // mescla: ids novos para não colidir com os existentes
    incoming.studies.forEach(s => {
      s.id = uid();
      s.activities.forEach(a => { a.id = uid(); a.questions.forEach(q => { q.id = uid(); q.attempts.forEach(t => t.id = uid()); }); });
      db.studies.push(s);
    });
  }
  saveDB();
  toast(`${incoming.studies.length} ESTUDO(S) IMPORTADO(S)`);
  render();
}

document.getElementById('fileInput').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const mode = await showModal({
    title: 'COMO IMPORTAR?',
    html: `<p>Arquivo: <b>${esc(file.name)}</b></p>`,
    buttons: [
      { label: 'MESCLAR', value: 'merge', primary: true },
      { label: 'SUBSTITUIR TUDO', value: 'replace' },
      { label: 'CANCELAR', value: null }
    ]
  });
  ev.target.value = '';
  if (mode) applyImport(text, mode);
});

/* ------------------------------------------------------------
   8. EVENTOS (delegação de cliques)
   ------------------------------------------------------------ */

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || modalOpen() && !modalLayer.contains(el)) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const { study, activity, question } = current();

  switch (act) {
    /* --- navegação --- */
    case 'go-home': db.ui.view = 'home'; saveDB(); render(); break;
    case 'go-study': db.ui.view = 'study'; saveDB(); render(); break;
    case 'open-study': db.ui.studyId = id; db.ui.view = 'study'; saveDB(); render(); break;
    case 'open-activity': {
      db.ui.activityId = id;
      db.ui.view = 'activity';
      const a = getActivity(study, id);
      // seleciona automaticamente a primeira questão: menos cliques para começar
      db.ui.questionId = a && a.questions.length ? (getQuestion(a, db.ui.questionId) ? db.ui.questionId : a.questions[0].id) : null;
      timer.clear();
      saveDB(); render();
      break;
    }

    /* --- estudos --- */
    case 'new-study': {
      const name = await askText('NOVO ESTUDO', 'Nome do estudo', '');
      if (!name) break;
      const s = { id: uid(), name, createdAt: Date.now(), activities: [] };
      db.studies.push(s);
      db.ui.studyId = s.id; db.ui.view = 'study';
      saveDB(); render();
      break;
    }
    case 'rename-study': {
      const s = getStudy(id);
      const name = await askText('RENOMEAR ESTUDO', 'Nome do estudo', s.name);
      if (name) { s.name = name; saveDB(); render(); }
      break;
    }
    case 'delete-study': {
      const s = getStudy(id);
      if (await confirmBox('APAGAR ESTUDO', `Apagar <b>${esc(s.name)}</b> e todos os tempos registrados nele? Isso não pode ser desfeito.`)) {
        db.studies = db.studies.filter(x => x.id !== id);
        if (db.ui.studyId === id) { db.ui.studyId = null; db.ui.view = 'home'; }
        saveDB(); render();
      }
      break;
    }

    /* --- atividades --- */
    case 'new-activity': {
      const name = await askText('NOVA ATIVIDADE', 'Nome da atividade', '');
      if (!name) break;
      const a = { id: uid(), name, createdAt: Date.now(), questions: [] };
      study.activities.push(a);
      db.ui.activityId = a.id; db.ui.questionId = null; db.ui.view = 'activity';
      timer.clear();
      saveDB(); render();
      break;
    }
    case 'rename-activity': {
      const a = getActivity(study, id);
      const name = await askText('RENOMEAR ATIVIDADE', 'Nome da atividade', a.name);
      if (name) { a.name = name; saveDB(); render(); }
      break;
    }
    case 'delete-activity': {
      const a = getActivity(study, id);
      if (await confirmBox('APAGAR ATIVIDADE', `Apagar <b>${esc(a.name)}</b> com suas questões e tempos?`)) {
        study.activities = study.activities.filter(x => x.id !== id);
        if (db.ui.activityId === id) { db.ui.activityId = null; db.ui.view = 'study'; }
        saveDB(); render();
      }
      break;
    }

    /* --- questões --- */
    case 'new-question': {
      const q = createQuestion(activity);
      db.ui.questionId = q.id;
      saveDB(); render();
      break;
    }
    case 'new-questions': {
      const n = await askText('ADICIONAR VÁRIAS', 'Quantas questões?', '10');
      const qty = Math.min(200, Math.max(1, parseInt(n, 10) || 0));
      if (!qty) break;
      let last = null;
      for (let i = 0; i < qty; i++) last = createQuestion(activity);
      if (!db.ui.questionId && last) db.ui.questionId = activity.questions[0].id;
      saveDB(); render();
      break;
    }
	    /* --- backup --- */
    case 'share-backup': shareBackup(); break;
        case 'snooze-backup':
      backupSnoozed = true;
      db.reminderSeen = Date.now();     // dispensa o lembrete atual; o próximo horário volta a avisar
      saveDB(); paintBackupBanner();
      break;
    case 'open-reminders': openReminders(); break;
    case 'add-reminder': {
      const time = document.getElementById('remTime').value;
      const days = [...document.querySelectorAll('.remDay:checked')].map(c => Number(c.value));
      if (!time) { toast('ESCOLHA UM HORÁRIO'); break; }
      if (!days.length) { toast('ESCOLHA PELO MENOS UM DIA'); break; }
      db.reminders.push({ id: uid(), time, days });
      db.reminderSeen = Date.now();     // não avisa por horários que já passaram hoje
      saveDB(); closeModal(null); openReminders(); paintBackupBanner();
      break;
    }
    case 'del-reminder':
      db.reminders = db.reminders.filter(r => r.id !== id);
      saveDB(); closeModal(null); openReminders(); paintBackupBanner();
      break;
    // O [+]/[-] fica dentro do botão da questão; a delegação resolve o mais interno.
    case 'toggle-question':
      db.ui.open[id] = !db.ui.open[id];
      saveDB(); render();
      break;
    case 'pick-question':
      selectQuestion(id);
      break;
    case 'rename-question': {
      const q = getQuestion(activity, id);
      const label = await askText(`Q${pad2(q.index)}`, 'Identificação (opcional)', q.label);
      q.label = label === null ? q.label : label;
      saveDB(); render();
      break;
    }
    case 'delete-question': {
      const q = getQuestion(activity, id);
      if (await confirmBox('APAGAR QUESTÃO', `Apagar a questão <b>Q${pad2(q.index)}</b> e suas ${q.attempts.length} tentativa(s)?`)) {
        activity.questions = activity.questions.filter(x => x.id !== id);
        if (db.ui.questionId === id) db.ui.questionId = activity.questions[0] ? activity.questions[0].id : null;
        if (timer.questionId === id) timer.clear();
        saveDB(); render();
      }
      break;
    }
    case 'open-details': {
      const q = getQuestion(activity, id);
      if (!q) break;
      const result = await showModal({
        title: `DETALHES — Q${pad2(q.index)}`,
        html: `
          <div class="field" style="margin-top:6px">
            <label for="detCaption">LEGENDA</label>
            <textarea id="detCaption" class="field-textarea">${esc(q.caption)}</textarea>
          </div>
          <div class="field" style="margin-top:12px">
            <label for="detComment">COMENTÁRIO</label>
            <textarea id="detComment" class="field-textarea">${esc(q.comment)}</textarea>
          </div>
          <div class="field" style="margin-top:12px">
            <label for="detAnswer">RESPOSTA</label>
            <textarea id="detAnswer" class="field-textarea">${esc(q.answer)}</textarea>
          </div>
          <div class="field" style="margin-top:12px; flex-direction:row; align-items:center; gap:10px;">
            <label for="detColor">COR DO BLOCO</label>
            <input type="color" id="detColor" class="q-color-input" value="${q.color || '#808080'}">
            <label style="display:flex; align-items:center; gap:6px; margin:0; font-size:8px; font-family:var(--font-display); color:var(--ink-dim);">
              <input type="checkbox" id="detNoColor" ${q.color ? '' : 'checked'}>
              SEM COR
            </label>
          </div>`,
        buttons: [
          { label: 'SALVAR', primary: true, collect: layer => ({
              caption: layer.querySelector('#detCaption').value,
              comment: layer.querySelector('#detComment').value,
              answer: layer.querySelector('#detAnswer').value,
              color: layer.querySelector('#detNoColor').checked ? '' : layer.querySelector('#detColor').value
            }) },
          { label: 'CANCELAR', value: null }
        ]
      });
      if (!result) break;
      q.caption = result.caption.trim();
      q.comment = result.comment.trim();
      q.answer = result.answer.trim();
      q.color = result.color || '';
      saveDB(); render();
      break;
    }
    case 'delete-attempt': {
      const q = getQuestion(activity, id);
      const aid = el.dataset.aid;
      q.attempts = q.attempts.filter(a => a.id !== aid);
      saveDB(); render();
      break;
    }

    /* --- cronômetro --- */
    case 'play': timer.running ? timer.pause() : timer.start(db.ui.questionId); break;
    case 'stop': stopAndSave(); break;
    case 'reset': {
      if (!timer.active()) { toast('NADA PARA DESCARTAR'); break; }
      if (await confirmBox('DESCARTAR SESSÃO', `Descartar ${fmt(timer.seconds())} sem salvar?`, 'DESCARTAR')) {
        timer.clear(); render(); toast('SESSÃO DESCARTADA');
      }
      break;
    }
    case 'next-question': nextQuestion(1); break;
    case 'add-manual': addManualTime(); break;
	case 'toggle-answer': {
		const field = el.closest('.detail-field');
		const p = field.querySelector('.answer-text');
		const hidden = p.classList.toggle('is-hidden');
		el.textContent = hidden ? 'MOSTRAR' : 'OCULTAR';
		break;
	}

    /* --- temas --- */
    case 'open-themes': openThemes(); break;
    case 'pick-theme':
      if (THEMES.some(t => t.id === id)) {
        db.theme = id;
        applyTheme();                       // aplica na hora
        saveDB();                           // e guarda para a próxima abertura
        document.querySelectorAll('.theme-card').forEach(c =>
          c.classList.toggle('is-active', c.dataset.id === id));
      }
      break;

    /* --- ferramentas --- */
    case 'toggle-sound': db.sound = !db.sound; saveDB(); render(); if (db.sound) beep(520, 60); break;
    case 'export': exportJSON(); break;
    case 'import': importJSON(); break;
  }
});

/** Diálogo TEMAS: grade de cartões com prévia; clicar aplica na hora. */
function openThemes() {
  const cards = THEMES.map(t => `
    <button type="button" class="theme-card${t.id === db.theme ? ' is-active' : ''}"
            data-theme="${t.id}" data-act="pick-theme" data-id="${t.id}" aria-label="Tema ${esc(t.name)}">
      <span class="theme-flag">ATIVO</span>
      <span class="theme-prev">
        <span class="tp-bar"></span>
        <span class="tp-line"></span>
        <span class="tp-line short"></span>
        <span class="tp-time">04:37</span>
      </span>
      <span class="theme-name">${esc(t.name)}</span>
    </button>`).join('');
  showModal({
    title: 'TEMAS',
    html: `<div class="theme-grid">${cards}</div>`,
    buttons: [{ label: 'FECHAR', value: null, primary: true }]
  });
}

/* ------------------------------------------------------------
   BACKUP: lembrete + compartilhar (menu do Android → Proton Drive)
   ------------------------------------------------------------ */
const BACKUP_REMINDER_HOURS = 24;   // depois de quantas horas o aviso aparece
let backupSnoozed = false;          // "DEPOIS" esconde o aviso só até fechar o app

function markBackup() {
  db.lastBackup = Date.now();
  saveDB();
  paintBackupBanner();
}

/** Última vez (até 7 dias atrás) em que algum lembrete deveria ter disparado; 0 se não há. */
function lastReminderTime(now = Date.now()) {
  let best = 0;
  db.reminders.forEach(r => {
    const [h, m] = r.time.split(':').map(Number);
    for (let back = 0; back <= 7; back++) {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      if (!r.days.includes(d.getDay())) continue;
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= now) { best = Math.max(best, d.getTime()); break; }
    }
  });
  return best;
}

let lastBannerHTML = '';
function paintBackupBanner() {
  const el = document.getElementById('backupBanner');
  if (!el) return;
  const hasData = db.studies.some(s => s.activities.some(a => a.questions.some(q => q.attempts.length)));
  const now = Date.now();
  let msg = '';

  if (hasData) {
    if (db.reminders.length) {
      // há lembretes agendados: avisa se um horário passou sem backup depois dele
      const due = lastReminderTime(now);
      if (due > Math.max(db.lastBackup, db.reminderSeen)) {
        const quando = new Date(due).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        msg = `Lembrete de backup (${quando}).`;
      }
    } else if (!backupSnoozed && now - db.lastBackup >= BACKUP_REMINDER_HOURS * 3600 * 1000) {
      // sem lembretes: regra simples de "X horas sem backup"
      msg = db.lastBackup
        ? `Último backup há ${Math.floor((now - db.lastBackup) / 86400000)} dia(s).`
        : 'Você ainda não fez backup.';
    }
  }

  const html = msg ? `<span>${msg}</span>
    <button class="btn btn-sm" data-act="share-backup">COMPARTILHAR</button>
    <button class="btn btn-sm btn-ghost" data-act="snooze-backup">DISPENSAR</button>` : '';
  if (html === lastBannerHTML) return;      // não mexe na tela sem necessidade
  lastBannerHTML = html;
  el.hidden = !msg;
  el.innerHTML = html;
}

// Confere a cada 30 s (e ao voltar para a aba) se chegou a hora de avisar.
setInterval(paintBackupBanner, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) paintBackupBanner(); });

const DAY_NAMES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** Diálogo LEMBRETES: lista os agendados e permite adicionar/remover. */
function openReminders() {
  const list = db.reminders.length
    ? `<ul class="list">${db.reminders.map(r => `<li class="row">
        <span class="row-main">
          <span class="row-title">${esc(r.time)}</span>
          <span class="row-sub">${r.days.length === 7 ? 'Todos os dias' : r.days.map(d => DAY_NAMES[d]).join(' ')}</span>
        </span>
        <button class="btn btn-sm btn-ghost" data-act="del-reminder" data-id="${r.id}">REMOVER</button>
      </li>`).join('')}</ul>`
    : '<p>Nenhum lembrete. Sem lembretes, o aviso aparece depois de 24 horas sem backup.</p>';

  showModal({
    title: 'LEMBRETES DE BACKUP',
    html: `${list}
      <div class="field" style="margin-top:14px">
        <label for="remTime">NOVO LEMBRETE — HORÁRIO</label>
        <input type="time" id="remTime" value="21:00">
      </div>
      <div class="day-picks">
        ${DAY_NAMES.map((n, i) => `<label class="day-pick"><input type="checkbox" class="remDay" value="${i}"> ${n}</label>`).join('')}
      </div>
      <button class="btn btn-sm" data-act="add-reminder" style="margin-top:12px">+ ADICIONAR LEMBRETE</button>`,
    buttons: [{ label: 'FECHAR', value: null, primary: true }]
  });
}

/** Abre o menu de compartilhar do sistema com o JSON como arquivo.
    Se o navegador não suportar, baixa o arquivo (como o EXPORTAR). */
async function shareBackup() {
  const text = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), studies: db.studies }, null, 2);
  const name = `study-timer-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup Study Timer' });
      markBackup();
      toast('BACKUP COMPARTILHADO');
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // você fechou o menu: não conta como backup
  }
  download(text);                                   // sem suporte: baixa o arquivo
  toast('SEM COMPARTILHAR AQUI — ARQUIVO BAIXADO');
}

/** Cria a próxima questão, preservando a numeração existente. */
function createQuestion(activity) {
  const nextIndex = activity.questions.reduce((m, q) => Math.max(m, q.index), 0) + 1;
  const q = { id: uid(), index: nextIndex, label: '', caption: '', comment: '', answer: '', color: '', attempts: [] };
  activity.questions.push(q);
  return q;
}

/* ------------------------------------------------------------
   9. ATALHOS DE TECLADO
   Só valem fora de campos de texto e fora dos diálogos.
   ------------------------------------------------------------ */

document.addEventListener('keydown', ev => {
  // Diálogo aberto: Enter confirma o primeiro botão, Esc cancela.
  if (modalOpen()) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeModal(null); }
    if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
      ev.preventDefault();
      const btn = modalLayer.querySelector('[data-mb="0"]');
      if (btn) btn.click();
    }
    return;
  }

  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;

  // Dentro dos campos de minuto/segundo, Enter adiciona o tempo manual.
  if (typing) {
    if (ev.key === 'Enter' && (ev.target.id === 'manualMin' || ev.target.id === 'manualSec')) {
      ev.preventDefault(); addManualTime();
    }
    if (ev.key === 'Escape') ev.target.blur();
    return;
  }

  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

  if (ev.key === 'Escape') {
    ev.preventDefault();
    if (db.ui.view === 'activity') db.ui.view = 'study';
    else if (db.ui.view === 'study') db.ui.view = 'home';
    saveDB(); render();
    return;
  }

  if (db.ui.view !== 'activity') return;
  const { question } = current();

  switch (ev.key) {
    case ' ':
      ev.preventDefault();
      if (!question && !timer.active()) { toast('SELECIONE UMA QUESTÃO'); break; }
      timer.running ? timer.pause() : timer.start(db.ui.questionId);
      break;
    case 'Enter':
      ev.preventDefault();
      if (timer.active()) stopAndSave();
      else if (question) timer.start(db.ui.questionId);
      break;
    case 'r': case 'R':
      ev.preventDefault();
      if (timer.active()) { timer.clear(); render(); toast('SESSÃO DESCARTADA'); }
      break;
    case 'n': case 'N':
      ev.preventDefault();
      nextQuestion(1);
      break;
  }
});

/* Evita perder uma sessão em andamento ao fechar a aba sem querer. */
window.addEventListener('beforeunload', ev => {
  if (timer.active()) { ev.preventDefault(); ev.returnValue = ''; }
});

/* Mantém a contagem correta ao voltar de uma aba em segundo plano. */
document.addEventListener('visibilitychange', () => { if (!document.hidden) paintTimer(); });

/* ------------------------------------------------------------
   10. INÍCIO
   ------------------------------------------------------------ */
render();
