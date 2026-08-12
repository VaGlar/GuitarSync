// ─── State ────────────────────────────────────────────────────────────────────
let currentTrack = null;
let selectedType = 'Chords'; // 'Chords' or 'Tab'
let lastResultUrl = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screenSetup = document.getElementById('screen-setup');
const screenMain  = document.getElementById('screen-main');

const clientIdInput = document.getElementById('client-id-input');
const btnLogin      = document.getElementById('btn-login');

const trackCard   = document.getElementById('track-card');
const noTrack     = document.getElementById('no-track');
const trackImage  = document.getElementById('track-image');
const trackName   = document.getElementById('track-name');
const trackArtist = document.getElementById('track-artist');
const trackStatus = document.getElementById('track-status');

const btnChords  = document.getElementById('btn-chords');
const btnTabs    = document.getElementById('btn-tabs');
const btnFind    = document.getElementById('btn-find');
const btnRefresh = document.getElementById('btn-refresh');
const btnLogout  = document.getElementById('btn-logout');
const btnOpen    = document.getElementById('btn-open');
const autoToggle = document.getElementById('auto-toggle');

const sourceBadge = document.getElementById('source-badge');
const resultDiv   = document.getElementById('result');
const resultInfo  = document.getElementById('result-info');
const errorMsg    = document.getElementById('error-msg');

const historyDiv     = document.getElementById('history');
const historyList    = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');

const badgeKnob      = document.getElementById('badge-knob');
const badgeKnobDial  = badgeKnob.querySelector('.knob');
const badgeKnobLabel = document.getElementById('badge-knob-label');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function msg(type, payload = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ ...payload, type }, resolve)
  );
}

function showError(text) {
  errorMsg.textContent = text;
  errorMsg.classList.remove('hidden');
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
}

function clearError() {
  errorMsg.classList.add('hidden');
}


// ─── Init ─────────────────────────────────────────────────────────────────────
function applyTabTypeUI(type) {
  selectedType = type;
  btnChords.classList.toggle('active', type === 'Chords');
  btnTabs.classList.toggle('active', type === 'Tab');
}

// Auto mode handles finding chords/tabs on its own, so the manual "Find"
// button is redundant (and the rocker switch can take the full row) while
// it's on.
function applyAutoUI(enabled) {
  autoToggle.checked = enabled;
  btnFind.classList.toggle('hidden', enabled);
}

async function init() {
  const { client_id, access_token } = await chrome.storage.local.get(['client_id', 'access_token']);

  if (!client_id || !access_token) {
    screenSetup.classList.remove('hidden');
    screenMain.classList.add('hidden');
    if (client_id) clientIdInput.value = client_id;
  } else {
    screenSetup.classList.add('hidden');
    screenMain.classList.remove('hidden');
    const autoRes = await msg('GET_AUTO');
    applyAutoUI(!!autoRes?.enabled);
    // Reflect whatever tab type is actually in effect (set manually last time,
    // or by auto mode) instead of always showing "Chords" on reopen.
    applyTabTypeUI(autoRes?.tabType === 'Tab' ? 'Tab' : 'Chords');
    await loadTrack();
    await loadHistory();
    await loadBadgeLabel();
  }
}

// ─── Badge label knob ──────────────────────────────────────────────────────────
// A rotary control (click to advance) rather than a dropdown — spans a
// potentiometer-style 270° sweep across however many options there are.
const KNOB_MIN_DEG = -135;
const KNOB_MAX_DEG = 135;

let badgeOptions = ['LIVE'];
let badgeIndex = 0;

function knobAngle(index, total) {
  if (total <= 1) return 0;
  const step = (KNOB_MAX_DEG - KNOB_MIN_DEG) / (total - 1);
  return KNOB_MIN_DEG + index * step;
}

function applyBadgeKnob() {
  badgeKnobLabel.textContent = badgeOptions[badgeIndex];
  badgeKnobDial.style.transform = `rotate(${knobAngle(badgeIndex, badgeOptions.length)}deg)`;
}

async function loadBadgeLabel() {
  const res = await msg('GET_BADGE_LABEL');
  if (!res?.ok) return;
  badgeOptions = res.options;
  badgeIndex = Math.max(0, badgeOptions.indexOf(res.label));
  applyBadgeKnob();
}

badgeKnob.addEventListener('click', () => {
  badgeIndex = (badgeIndex + 1) % badgeOptions.length;
  applyBadgeKnob();
  msg('SET_BADGE_LABEL', { label: badgeOptions[badgeIndex] });
});

// ─── Load current track ───────────────────────────────────────────────────────
async function loadTrack() {
  clearError();
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  btnFind.disabled = true;

  const res = await msg('GET_CURRENT_TRACK');

  if (!res?.ok) {
    if (res?.error === 'not_logged_in') {
      showError('Session expired. Log out and log back in.');
    } else {
      showError('Could not reach Spotify.');
    }
    trackCard.classList.add('hidden');
    noTrack.classList.remove('hidden');
    return;
  }

  if (!res.track) {
    trackCard.classList.add('hidden');
    noTrack.classList.remove('hidden');
    return;
  }

  currentTrack = res.track;

  trackCard.classList.remove('hidden');
  noTrack.classList.add('hidden');

  trackImage.src = currentTrack.image || '';
  trackName.textContent = currentTrack.name;
  trackArtist.textContent = currentTrack.artist;
  trackStatus.textContent = currentTrack.isPlaying ? '▶ Now Playing' : '⏸ Paused';

  btnFind.disabled = false;
}

// ─── History ──────────────────────────────────────────────────────────────────
const HISTORY_SOURCE_LABEL = {
  kithara: '🇬🇷',
  'kithara-search': '🇬🇷',
  ug: '🎸',
  google: '🔍',
};

async function loadHistory() {
  const res = await msg('GET_HISTORY');
  renderHistory(res?.history || []);
}

function renderHistory(items) {
  historyList.replaceChildren();

  if (!items.length) {
    historyDiv.classList.add('hidden');
    return;
  }
  historyDiv.classList.remove('hidden');

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const thumb = document.createElement('img');
    thumb.className = 'history-thumb';
    thumb.src = item.image || '';
    thumb.alt = '';

    const text = document.createElement('div');
    text.className = 'history-text';
    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = item.name;
    const artist = document.createElement('div');
    artist.className = 'history-artist';
    artist.textContent = item.artist;
    text.append(name, artist);

    const type = document.createElement('span');
    type.className = 'history-type';
    type.textContent = `${HISTORY_SOURCE_LABEL[item.source] || ''} ${item.tabType === 'Tab' ? 'Tabs' : 'Chords'}`;

    row.append(thumb, text, type);
    row.addEventListener('click', () => chrome.tabs.create({ url: item.url }));
    historyList.appendChild(row);
  }
}

btnClearHistory.addEventListener('click', async (e) => {
  e.stopPropagation();
  await msg('CLEAR_HISTORY');
  renderHistory([]);
});

// ─── Search ───────────────────────────────────────────────────────────────────
async function findChords() {
  if (!currentTrack) return;

  clearError();
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  btnFind.disabled = true;
  btnFind.textContent = '…';

  const res = await msg('RESOLVE_URL', { track: currentTrack, tabType: selectedType });

  if (!res?.ok) {
    showError('Something went wrong: ' + (res?.error || 'unknown'));
  } else {
    lastResultUrl = res.url;

    const badges = {
      'kithara':        '🇬🇷 kithara.to',
      'kithara-search': '🇬🇷 kithara.to (search)',
      'ug':             res.meta?.rating
                          ? `🎸 Ultimate Guitar  ⭐ ${res.meta.rating.toFixed(1)} (${res.meta.votes} votes)`
                          : '🎸 Ultimate Guitar',
      'google':         '🔍 Not found on UG — Google fallback',
    };
    sourceBadge.textContent = badges[res.source] || '';
    sourceBadge.classList.remove('hidden');

    const titleText = res.meta ? res.meta.title : currentTrack.name;
    const artistText = res.meta ? res.meta.artist : currentTrack.artist;
    resultInfo.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = titleText;
    resultInfo.append(strong, document.createElement('br'), artistText);
    resultDiv.classList.remove('hidden');
    await loadHistory();

    // Opening the tab shifts focus away and usually closes this popup — do
    // it last, after the result card above has actually painted, so a quick
    // glance still shows what was found before the popup disappears.
    chrome.tabs.create({ url: res.url });
  }

  btnFind.textContent = 'Find →';
  btnFind.disabled = false;
}

// ─── Events ───────────────────────────────────────────────────────────────────
btnLogin.addEventListener('click', async () => {
  const cid = clientIdInput.value.trim();
  if (!cid) { alert('Enter your Client ID'); return; }

  btnLogin.textContent = 'Connecting…';
  btnLogin.disabled = true;

  const res = await msg('LOGIN', { clientId: cid });
  if (res?.ok) {
    screenSetup.classList.add('hidden');
    screenMain.classList.remove('hidden');
    await loadTrack();
  } else {
    alert('Login failed: ' + (res?.error || 'unknown'));
    btnLogin.textContent = 'Connect with Spotify';
    btnLogin.disabled = false;
  }
});

btnChords.addEventListener('click', () => {
  applyTabTypeUI('Chords');
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  msg('SET_TAB_TYPE', { tabType: 'Chords' });
});

btnTabs.addEventListener('click', () => {
  applyTabTypeUI('Tab');
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  msg('SET_TAB_TYPE', { tabType: 'Tab' });
});

autoToggle.addEventListener('change', (e) => {
  applyAutoUI(e.target.checked);
  msg('SET_AUTO', { enabled: e.target.checked, tabType: selectedType });
});

btnFind.addEventListener('click', findChords);

btnOpen.addEventListener('click', () => {
  if (lastResultUrl) chrome.tabs.create({ url: lastResultUrl });
});

btnRefresh.addEventListener('click', async () => {
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  await loadTrack();
  await loadHistory();
});

btnLogout.addEventListener('click', async () => {
  await msg('LOGOUT');
  currentTrack = null;
  lastResultUrl = null;
  renderHistory([]);
  screenMain.classList.add('hidden');
  screenSetup.classList.remove('hidden');
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
