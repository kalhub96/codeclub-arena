// CodeClub Arena Mini App. No build step: plain ES modules, DOM built with textContent only (no innerHTML on user data).
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  document.documentElement.dataset.scheme = tg.colorScheme || '';
}
const root = document.getElementById('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ATTEMPT_MULT = [1, 0.6, 0.3];
const HINT_PEN = [0, 0.1, 0.2, 0.4];

// ---------- tiny DOM helper ----------
const h = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>',
  play: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  ranks: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
};
const icon = (name, size = 22) => {
  const s = h('span', { class: 'ico' });
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return s;
};

// ---------- state ----------
const S = {
  me: null,
  tab: 'home',
  view: 'tab', // tab | question | result
  catalog: null,
  learnTrack: null,
  q: null,
  qLang: null,
  qEmpty: null,
  selected: null,
  wrong: [],
  tip: null,
  result: null,
  overlay: false,
  board: null,
  behind: null,
  rankMode: 'top',
  busy: false,
  gate: null,
  friends: null,
  sugg: null,
  sent: new Set(),
};

// ---------- api ----------
async function api(path, body) {
  const res = await fetch('/api/v1' + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'tma ' + ((tg && tg.initData) || ''), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || 'request_failed');
    e.status = res.status;
    e.code = data.error;
    throw e;
  }
  return data;
}

// ---------- helpers ----------
const tierOfXp = (xp) => {
  let t = S.me.badges[0].name;
  for (const b of S.me.badges) if (xp >= b.minXp) t = b.name;
  return t;
};
const bandFrac = (xp) => {
  const bs = S.me.badges;
  let i = 0;
  bs.forEach((b, n) => { if (xp >= b.minXp) i = n; });
  const next = bs[i + 1];
  return next ? (xp - bs[i].minXp) / (next.minXp - bs[i].minXp) : 1;
};
const potentialXp = (q) => {
  const attempt = Math.min(3, 3 - q.attemptsLeft + 1);
  return Math.max(1, Math.round(q.xpReward * ATTEMPT_MULT[attempt - 1] * (1 - HINT_PEN[Math.min(q.hintsUsed, 3)])));
};
const haptic = (kind) => {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (kind === 'ok' || kind === 'error') tg.HapticFeedback.notificationOccurred(kind === 'ok' ? 'success' : 'error');
    else tg.HapticFeedback.impactOccurred('light');
  } catch { /* optional */ }
};
const toast = (msg) => {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
};
const msgFor = (e) =>
  e.code === 'slow_down' ? 'Slow down a little.' : e.status === 401 ? 'Session expired. Close the app and open it again.' : 'Something went wrong. Try again.';

const bar = (frac, thin) =>
  h('div', { class: 'bar' + (thin ? ' thin' : ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(frac * 100) },
    h('i', { style: `width:${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%` }));
const chip = (tier) => h('span', { class: 'chip', 'data-tier': tier }, tier);

// ---------- syntax highlight (small, safe: builds text nodes) ----------
const KEYWORDS = 'const|let|var|function|return|if|else|for|while|import|from|export|def|class|in|of|new|async|await|print|None|True|False|try|catch|except|with|as|throw|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|ORDER|BY|GROUP|AND|OR|NOT|NULL';
function highlight(code, lang) {
  const hash = /^(python|py|bash|sh|shell|yaml)$/i.test(lang);
  const comment = hash ? '#[^\\n]*' : '\\/\\/[^\\n]*|<!--[\\s\\S]*?-->|\\/\\*[\\s\\S]*?\\*\\/';
  const re = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(<\\/?[A-Za-z][\\w-]*)|\\b(${KEYWORDS})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, 'g');
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > last) frag.append(code.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 't' : m[4] ? 'k' : 'n';
    frag.append(h('span', { class: cls }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < code.length) frag.append(code.slice(last));
  return frag;
}

// ---------- screens ----------
function gateScreen(title, text) {
  return h('main', { class: 'gate' }, h('h1', null, title), h('p', { class: 'muted' }, text));
}

function homeScreen() {
  const m = S.me;
  const a = m.active;
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'avatar' }, m.name.trim().charAt(0).toUpperCase()),
      h('div', { class: 'who' }, h('h1', null, m.name), h('p', { class: 'muted' }, 'Batch ' + m.batchYear)),
      h('div', { class: 'streak', title: 'Daily streak' }, icon('flame', 16), m.streak ? `${m.streak} day${m.streak === 1 ? '' : 's'}` : 'No streak yet')),
    h('section', { class: 'plate', 'aria-label': 'Your badge' },
      h('div', null, h('div', { class: 'plate-tier' }, m.badge), h('div', { class: 'plate-level' }, 'Level ' + m.level)),
      h('div', { class: 'plate-xp' }, h('strong', null, m.xp.toLocaleString()), h('span', null, 'XP')),
      bar(m.band),
      h('p', { class: 'plate-next' }, m.next ? `${m.next.remaining.toLocaleString()} XP to ${m.next.next}` : 'You reached the top tier')),
    a
      ? h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', { class: 'sub' }, a.name), chip(tierOfXp(a.xp))),
          bar(bandFrac(a.xp), true),
          h('button', { class: 'btn primary block', onclick: () => startQuestion() }, 'Continue ' + a.name))
      : h('section', { class: 'card' },
          h('h3', { class: 'sub' }, 'Pick what to learn'),
          h('p', { class: 'muted' }, 'Choose a track and a language. You can switch any time and keep your progress.'),
          h('button', { class: 'btn primary block', onclick: () => go('learn') }, 'Choose a language')),
    m.languages.length
      ? h('section', { class: 'card' },
          h('h3', { class: 'sub' }, 'Your languages'),
          h('div', { class: 'list' }, m.languages.map((l) =>
            h('div', { class: 'row', 'data-tier': l.badge },
              h('div', { class: 'grow' }, h('span', { class: 'name' }, l.name), bar(bandFrac(l.xp), true)),
              chip(l.badge)))))
      : null);
}

const TRACK_BLURB = {
  'Full Stack': 'Build websites and web apps.',
  Cyber: 'Understand networks and defend systems.',
  AI: 'Work with data, models and machine learning.',
};

function learnScreen() {
  if (!S.catalog) return h('main', { class: 'screen' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }));
  if (!S.learnTrack) {
    return h('main', { class: 'screen' },
      h('h2', { class: 'title' }, 'What do you want to learn?'),
      h('div', { class: 'list' }, S.catalog.tracks.map((t) =>
        h('button', { class: 'card tap', onclick: () => { S.learnTrack = t.id; haptic(); render(); } },
          h('h3', { class: 'sub' }, t.name),
          h('p', { class: 'muted' }, TRACK_BLURB[t.name] || ''),
          h('p', { class: 'small muted' }, t.languages.map((l) => l.name).join(', '))))));
  }
  const t = S.catalog.tracks.find((x) => x.id === S.learnTrack);
  return h('main', { class: 'screen' },
    h('h2', { class: 'title' }, t.name),
    h('div', { class: 'list' }, t.languages.map((l) =>
      h('button', { class: 'row', 'data-tier': l.badge, disabled: l.questions === 0 || S.busy, onclick: () => chooseLanguage(l.id) },
        h('div', { class: 'grow' },
          h('span', { class: 'name' }, l.name),
          l.questions === 0 ? h('span', { class: 'small' }, 'No questions yet') : h('span', { class: 'small' }, l.xp ? `Level ${l.level}, ${l.xp} XP` : 'Not started'),
          l.xp ? bar(bandFrac(l.xp), true) : null),
        l.xp ? chip(l.badge) : null))));
}

function questionScreen() {
  if (S.qEmpty) {
    const e = S.qEmpty;
    return h('main', { class: 'screen' },
      h('div', { class: 'empty' },
        h('h2', { class: 'title' }, e.reason === 'no_context' ? 'Pick a language first' : 'No new questions here right now'),
        h('p', null, e.reason === 'no_context' ? 'Choose what you want to learn to get a question.' : `You have seen every question in ${e.language ? e.language.name : 'this language'}. New ones are added regularly. Try another language meanwhile.`),
        h('button', { class: 'btn primary', onclick: () => { S.view = 'tab'; go('learn'); } }, 'Choose a language')));
  }
  const q = S.q;
  const nextPen = q.hintsUsed < q.hintsTotal ? Math.round(HINT_PEN[Math.min(q.hintsUsed + 1, 3)] * 100) : null;
  return h('main', { class: 'screen flow', 'data-tier': q.tier },
    h('div', { class: 'qhead' },
      h('div', { class: 'qmeta' }, h('span', { class: 'chip' }, q.tier), h('span', { class: 'muted' }, S.qLang || '')),
      h('div', { class: 'qmeta' },
        h('span', { class: 'pips', role: 'img', 'aria-label': `${q.attemptsLeft} attempts left` }, [1, 2, 3].map((n) => h('b', { class: n <= q.attemptsLeft ? '' : 'off' }))),
        h('span', { class: 'stake', title: 'XP you earn if you are right now' }, `+${potentialXp(q)} XP`))),
    h('p', { class: 'prompt' }, q.prompt),
    q.hintsShown.length || S.tip
      ? h('div', { class: 'list' },
          S.tip ? h('div', { class: 'note' }, h('b', null, 'Concept'), h('span', null, S.tip)) : null,
          q.hintsShown.map((t, i) => h('div', { class: 'note' }, h('b', null, `Hint ${i + 1}`), h('span', null, t))))
      : null,
    h('div', { class: 'opts', role: 'group', 'aria-label': 'Answers' }, q.options.map((o, i) => {
      const wrong = S.wrong.includes(o.idx);
      return h('button', { class: 'opt' + (wrong ? ' wrong' : ''), 'aria-pressed': S.selected === o.idx, disabled: wrong || S.busy,
        onclick: () => { S.selected = o.idx; haptic(); render(); } },
        h('span', { class: 'letter' }, 'ABCDEF'[i]), h('span', { class: 'text' }, o.text));
    })),
    h('div', { class: 'helpers' },
      q.hasTip && !S.tip ? h('button', { class: 'btn ghost small', onclick: showTip }, 'Concept tip (free)') : null,
      nextPen !== null ? h('button', { class: 'btn ghost small', disabled: S.busy, onclick: takeHint }, `Hint (−${nextPen}% XP)`) : null),
    h('div', { class: 'actionbar' },
      h('button', { class: 'btn primary', disabled: S.selected === null || S.busy, onclick: submitAnswer }, 'Check answer')));
}

function resultScreen() {
  const r = S.result;
  const q = S.q;
  const xpEl = h('div', { class: 'gain' }, r.correct ? `+${r.xpGain} XP` : '+0 XP');
  if (r.correct && !reduced) countUp(xpEl, r.xpGain);
  return h('main', { class: 'screen flow', 'data-tier': r.badge },
    h('div', { class: 'verdict ' + (r.correct ? 'ok' : 'no') },
      h('h2', null, r.correct ? 'Correct' : 'Not this time'),
      !r.correct ? h('p', null, 'The answer was ', h('strong', { style: 'font-family:var(--mono)' }, r.answer)) : null,
      xpEl),
    h('section', { class: 'plate', style: 'grid-template-columns:1fr auto' },
      h('div', null, h('div', { class: 'plate-tier', style: 'font-size:26px' }, r.badge), h('div', { class: 'plate-level' }, 'Level ' + r.level)),
      h('div', { class: 'plate-xp' }, h('strong', null, r.xp.toLocaleString()), h('span', null, 'XP')),
      bar(r.band),
      h('p', { class: 'plate-next' }, r.next ? `${r.next.remaining.toLocaleString()} XP to ${r.next.next}` : 'Top tier')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('strong', null, r.behind), h('span', null, `behind you in ${r.language}`)),
      h('div', { class: 'stat' }, h('strong', null, r.ahead), h('span', null, 'ahead of you')),
      h('div', { class: 'stat' }, h('strong', null, r.solved), h('span', null, 'solved this'))),
    r.friendPrompt && r.friendPrompt.length ? friendCard(r.friendPrompt) : null,
    r.snippet
      ? h('section', { class: 'card' },
          h('div', { class: 'card-head' },
            h('h3', { class: 'sub' }, 'See it in code'),
            h('button', { class: 'btn ghost small', onclick: () => copyCode(r.snippet.code), 'aria-label': 'Copy code' }, icon('copy', 16), ' Copy')),
          h('pre', { class: 'code' }, h('code', null, highlight(r.snippet.code, r.snippet.lang))),
          r.snippet.note ? h('div', { class: 'note' }, h('b', null, 'How it fits'), h('span', null, r.snippet.note)) : null)
      : null,
    h('div', { class: 'actionbar' },
      h('button', { class: 'btn primary', onclick: () => startQuestion() }, 'Next question'),
      h('button', { class: 'btn ghost', onclick: () => { S.view = 'tab'; S.tab = 'home'; render(); } }, 'Back to home')));
}

function overlayEl() {
  const r = S.result;
  return h('div', { class: 'overlay', 'data-tier': r.badge, role: 'dialog', 'aria-label': 'New badge' },
    h('section', { class: 'plate' }, h('div', { class: 'plate-tier' }, r.badge), h('div', { class: 'plate-level' }, 'Level ' + r.level)),
    h('h2', null, `You reached ${r.badge}`),
    r.unlocked.length ? h('p', { class: 'muted' }, r.unlocked.join(', ') + (r.unlocked.length > 1 ? ' are unlocked.' : ' is unlocked.')) : null,
    h('button', { class: 'btn primary', onclick: () => { S.overlay = false; render(); } }, 'Keep going'));
}

function playScreen() {
  const m = S.me;
  return h('main', { class: 'screen' },
    h('h2', { class: 'title' }, 'Play'),
    h('div', { class: 'list' },
      h('div', { class: 'lockcard', 'data-tier': 'Bronze' },
        h('div', { class: 'grow' }, h('strong', null, 'Solo quiz'), h('span', { class: 'small muted' }, 'Answer questions at your own pace.')),
        h('button', { class: 'btn primary small', onclick: () => (m.active ? startQuestion() : go('learn')) }, 'Start')),
      m.features.map((f) =>
        h('div', { class: 'lockcard' + (f.unlocked ? '' : ' locked'), 'data-tier': f.minBadge },
          h('div', { class: 'grow' },
            h('strong', null, f.label),
            h('span', { class: 'small muted' }, f.unlocked ? 'Unlocked. Launching soon.' : `Reach ${f.minBadge} to unlock. ${f.xpToUnlock.toLocaleString()} XP to go.`)),
          f.unlocked ? h('span', { class: 'tag' }, 'Soon') : icon('lock', 20)))));
}

function ranksScreen() {
  const top = S.rankMode === 'top';
  const data = top ? S.board : S.behind;
  const list = !data
    ? [h('div', { class: 'skel' }), h('div', { class: 'skel' })]
    : data.rows.length === 0
      ? [h('div', { class: 'empty' }, h('p', null, top ? 'Nobody here yet.' : data.reason === 'no_context' ? 'Pick a language to see who is behind you.' : 'Nobody in your group is behind you in this language yet.'))]
      : data.rows.map((r) =>
          h('div', { class: 'row' + (r.me ? ' me' : ''), 'data-tier': r.badge },
            top ? h('span', { class: 'rank' }, r.rank) : null,
            h('div', { class: 'grow' }, h('span', { class: 'name' }, r.name + (r.me ? ' (you)' : '')), h('span', { class: 'small' }, 'Batch ' + r.batchYear)),
            chip(r.badge), h('span', { class: 'xpnum' }, r.xp.toLocaleString())));
  return h('main', { class: 'screen' },
    h('h2', { class: 'title' }, 'Ranks'),
    h('div', { class: 'seg', role: 'group' },
      h('button', { 'aria-pressed': top, onclick: () => setRankMode('top') }, 'Top 20'),
      h('button', { 'aria-pressed': !top, onclick: () => setRankMode('behind') }, 'Behind me')),
    top && S.board ? h('p', { class: 'muted' }, `You are ${S.board.rank} of ${S.board.size} in your group.`) : null,
    h('div', { class: 'list' }, list));
}

function profileScreen() {
  const m = S.me;
  const reached = (b) => m.xp >= b.minXp;
  const toggle = (label, key) =>
    h('div', { class: 'toggle' }, h('span', null, label),
      h('button', { class: 'switch', role: 'switch', 'aria-checked': m.privacy[key], 'aria-label': label, onclick: () => savePrivacy(key) }));
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'avatar' }, m.name.trim().charAt(0).toUpperCase()),
      h('div', { class: 'who' }, h('h1', null, m.name), h('p', { class: 'muted' }, 'Batch ' + m.batchYear)),
      chip(m.badge)),
    h('section', { class: 'card' },
      h('h3', { class: 'sub' }, 'Badge path'),
      h('div', { class: 'path' }, m.badges.map((b) =>
        h('div', { class: 'step' + (reached(b) ? ' done' : ''), 'data-tier': b.name }, h('span', { class: 'dot' }), h('span', null, b.name), h('span', { class: 'small muted', style: 'margin-left:auto' }, b.minXp.toLocaleString() + ' XP'))))),
    friendsSection(),
    h('section', { class: 'card' },
      h('h3', { class: 'sub' }, 'Privacy'),
      toggle('Show my name to other members', 'showName'),
      toggle('Allow members to contact me', 'allowDm')),
    h('section', { class: 'card' },
      h('h3', { class: 'sub' }, 'How it works'),
      h('div', { class: 'list' },
        faq('How do I earn XP?', 'Each correct answer gives XP. You get full XP on the first try, 60% on the second and 30% on the third.'),
        faq('What do hints cost?', 'Hint 1 costs 10% of the XP, hint 2 costs 20% and hint 3 costs 40%. The concept tip is always free.'),
        faq('What unlocks multiplayer?', 'Your badge. Check the Play tab to see what each tier unlocks.'),
        faq('Who can see me?', 'Names, rankings and help lists only show members of your own group. Other members only ever see anonymous counts.'))));
}
const grow = (name, batch) => h('div', { class: 'grow' }, h('span', { class: 'name' }, name), h('span', { class: 'small' }, 'Batch ' + batch));

const personRow = (p) =>
  h('div', { class: 'row', 'data-tier': p.badge },
    grow(p.name, p.batchYear),
    chip(p.badge),
    S.sent.has(p.id) ? h('span', { class: 'tag' }, 'Sent') : h('button', { class: 'btn ghost small', onclick: () => addFriend(p.id) }, 'Add'));

function friendCard(people) {
  return h('section', { class: 'card' },
    h('h3', { class: 'sub' }, 'Meet people in your group'),
    h('p', { class: 'muted' }, 'Send a request. If they accept, you can see each other\u2019s contact when they allow it.'),
    h('div', { class: 'list' }, people.map(personRow)));
}

function friendsSection() {
  const f = S.friends;
  if (!f) return h('section', { class: 'card' }, h('h3', { class: 'sub' }, 'Friends'), h('div', { class: 'skel' }));
  return h('section', { class: 'card' },
    h('h3', { class: 'sub' }, 'Friends'),
    f.incoming.length
      ? h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Requests for you'),
          f.incoming.map((r) =>
            h('div', { class: 'row', 'data-tier': r.badge },
              grow(r.name, r.batchYear),
              h('div', { class: 'btns' },
                h('button', { class: 'btn primary small', onclick: () => respondFriend(r.requestId, true) }, 'Accept'),
                h('button', { class: 'btn ghost small', onclick: () => respondFriend(r.requestId, false) }, 'Decline')))))
      : null,
    f.friends.length
      ? h('div', { class: 'list' }, f.friends.map((fr) =>
          h('div', { class: 'row', 'data-tier': fr.badge },
            grow(fr.name, fr.batchYear),
            h('div', { class: 'btns' },
              fr.contact ? h('button', { class: 'btn ghost small', onclick: () => openContact(fr.contact) }, '@' + fr.contact) : h('span', { class: 'small' }, 'Contact private'),
              h('button', { class: 'btn ghost small', 'aria-label': 'Remove friend', onclick: () => removeFriendAsk(fr.friendshipId) }, 'Remove')))))
      : h('p', { class: 'muted' }, 'No friends yet. You will be offered people from your group as you play.'),
    h('button', { class: 'btn ghost block', onclick: findPeople }, 'Find people'),
    S.sugg ? h('div', { class: 'list' }, S.sugg.length ? S.sugg.map(personRow) : h('p', { class: 'muted' }, 'No one new to suggest right now.')) : null);
}

const faq = (q, a) => h('details', null, h('summary', null, q), h('p', null, a));

// ---------- actions ----------
function countUp(el, to) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 700);
    el.textContent = `+${Math.round(to * (1 - Math.pow(1 - p, 3)))} XP`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function copyCode(code) {
  try { await navigator.clipboard.writeText(code); toast('Copied'); } catch { toast('Press and hold the code to copy it'); }
}

async function loadFriends() {
  try { S.friends = await api('/friends'); } catch (e) { toast(msgFor(e)); }
  render();
}
async function findPeople() {
  try { S.sugg = (await api('/friends/suggestions')).rows; } catch (e) { toast(msgFor(e)); }
  render();
}
async function addFriend(id) {
  try {
    const r = await api('/friends/request', { studentId: id });
    S.sent.add(id); haptic('ok'); toast(r.message);
    if (r.status === 'accepted') loadFriends();
  } catch (e) { toast(e.status === 404 ? 'That person is not available.' : msgFor(e)); }
  render();
}
async function respondFriend(requestId, accept) {
  try {
    await api('/friends/respond', { requestId, accept });
    toast(accept ? 'Connected' : 'Declined');
    await refreshMe(); await loadFriends();
  } catch (e) { toast(e.status === 404 ? 'That request is no longer available.' : msgFor(e)); await loadFriends(); }
}
function removeFriendAsk(friendshipId) {
  const go = async () => { try { await api('/friends/remove', { friendshipId }); } catch (e) { toast(msgFor(e)); } await loadFriends(); };
  if (tg && tg.showConfirm) tg.showConfirm('Remove this friend?', (ok) => ok && go());
  else if (confirm('Remove this friend?')) go();
}
function openContact(username) {
  const url = 'https://t.me/' + encodeURIComponent(username);
  if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
}

async function refreshMe() { try { S.me = await api('/me'); } catch { /* keep old */ } }

function go(tab) {
  S.view = 'tab';
  S.tab = tab;
  if (tab === 'learn') { S.learnTrack = null; loadCatalog(); }
  if (tab === 'ranks') loadRanks();
  if (tab === 'profile') { S.sugg = null; loadFriends(); }
  if (tab === 'home' || tab === 'play' || tab === 'profile') refreshMe().then(render);
  haptic();
  render();
}

async function loadCatalog() {
  try { S.catalog = await api('/catalog'); } catch (e) { toast(msgFor(e)); }
  render();
}
async function loadRanks() {
  S.board = null; S.behind = null;
  try {
    S.board = await api('/leaderboard');
    S.behind = await api('/behind');
  } catch (e) { toast(msgFor(e)); }
  render();
}
function setRankMode(m) { S.rankMode = m; haptic(); render(); }

async function chooseLanguage(id) {
  S.busy = true; render();
  try {
    await api('/context', { languageId: id });
    await refreshMe();
    await startQuestion();
  } catch (e) { toast(msgFor(e)); }
  S.busy = false; render();
}

async function startQuestion() {
  S.busy = true;
  try {
    const d = await api('/question');
    S.selected = null; S.wrong = []; S.tip = null; S.result = null; S.overlay = false;
    S.view = 'question';
    if (!d.question) { S.q = null; S.qEmpty = { reason: d.reason, language: d.language }; }
    else { S.q = d.question; S.qLang = d.language && d.language.name; S.qEmpty = null; }
  } catch (e) { toast(msgFor(e)); }
  S.busy = false;
  window.scrollTo(0, 0);
  render();
}

async function showTip() {
  try { S.tip = (await api('/question/' + S.q.id + '/tip')).tip; haptic(); render(); } catch (e) { toast(msgFor(e)); }
}

async function takeHint() {
  S.busy = true; render();
  try {
    const r = await api('/hint', { questionId: S.q.id });
    if (r.ok) { S.q.hintsUsed = r.number; S.q.hintsShown.push(r.text); haptic(); }
    else toast('No more hints for this one.');
  } catch (e) { toast(msgFor(e)); }
  S.busy = false; render();
}

async function submitAnswer() {
  if (S.selected === null || S.busy) return;
  S.busy = true; render();
  try {
    const r = await api('/answer', { questionId: S.q.id, choiceIdx: S.selected });
    if (r.status === 'retry') {
      S.wrong.push(S.selected); S.selected = null; S.q.attemptsLeft = r.attemptsLeft;
      haptic('error'); toast(`Not quite. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? '' : 's'} left.`);
    } else {
      S.result = r; S.view = 'result'; S.overlay = r.badgeUp;
      haptic(r.correct ? 'ok' : 'error');
      window.scrollTo(0, 0);
      refreshMe();
    }
  } catch (e) {
    if (e.status === 409) { toast('That question is already finished.'); await startQuestion(); }
    else toast(msgFor(e));
  }
  S.busy = false; render();
}

async function savePrivacy(key) {
  const p = { ...S.me.privacy, [key]: !S.me.privacy[key] };
  S.me.privacy = p; render();
  try { await api('/privacy', p); } catch (e) { S.me.privacy[key] = !p[key]; toast(msgFor(e)); render(); }
}

// ---------- render ----------
const TABS = [['home', 'Home', 'home'], ['learn', 'Learn', 'learn'], ['play', 'Play', 'play'], ['ranks', 'Ranks', 'ranks'], ['profile', 'Profile', 'user']];

function render() {
  if (S.gate) { root.replaceChildren(gateScreen(S.gate[0], S.gate[1])); return; }
  if (!S.me) { root.replaceChildren(h('main', { class: 'screen' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }))); return; }
  document.documentElement.dataset.tier = S.view === 'tab' || !S.result ? S.me.badge : S.result.badge;
  root.setAttribute('data-tier', document.documentElement.dataset.tier);

  let screen;
  if (S.view === 'question') screen = questionScreen();
  else if (S.view === 'result') screen = resultScreen();
  else screen = { home: homeScreen, learn: learnScreen, play: playScreen, ranks: ranksScreen, profile: profileScreen }[S.tab]();

  const kids = [screen];
  if (S.view === 'tab') {
    kids.push(h('nav', { class: 'tabbar', 'aria-label': 'Main' }, TABS.map(([key, label, ic]) =>
      h('button', { class: 'tab', 'aria-current': S.tab === key ? 'page' : null, onclick: () => go(key) }, icon(ic, 22), label,
        key === 'profile' && S.me.incomingFriends > 0 ? h('i', { class: 'dot', 'aria-label': 'New friend requests' }) : null))));
  }
  if (S.overlay && S.result) kids.push(overlayEl());
  root.replaceChildren(...kids);

  if (tg) {
    const back = S.view !== 'tab' || (S.tab === 'learn' && S.learnTrack !== null);
    try { back ? tg.BackButton.show() : tg.BackButton.hide(); } catch { /* optional */ }
  }
}

if (tg) {
  tg.BackButton.onClick(() => {
    if (S.view !== 'tab') { S.view = 'tab'; S.tab = 'home'; refreshMe().then(render); }
    else if (S.tab === 'learn' && S.learnTrack !== null) S.learnTrack = null;
    render();
  });
}

// ---------- boot ----------
(async function boot() {
  if (!tg || !tg.initData) {
    S.gate = ['Open this from Telegram', 'This app only works inside the CodeClub Arena bot. Open the bot and tap Open app.'];
    return render();
  }
  render();
  try {
    S.me = await api('/me');
  } catch (e) {
    S.gate =
      e.code === 'not_registered' ? ['Join the club first', 'Scan the club QR code in the bot and finish sign-up. Then open the app again.']
      : e.code === 'pending' ? ['Waiting for approval', 'An admin needs to approve your sign-up. You will get a message in the bot.']
      : e.code === 'banned' ? ['Access removed', 'Contact a club admin if you think this is a mistake.']
      : e.status === 401 ? ['Session expired', 'Close the app and open it again from the bot.']
      : ['Could not load', 'Check your connection and open the app again.'];
  }
  render();
})();
