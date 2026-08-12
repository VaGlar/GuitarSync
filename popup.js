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

const sourceBadge = document.getElementById('source-badge');
const resultDiv   = document.getElementById('result');
const resultInfo  = document.getElementById('result-info');
const errorMsg    = document.getElementById('error-msg');

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
    document.getElementById('auto-toggle').checked = !!autoRes?.enabled;
    await loadTrack();
  }
}

// ─── Load current track ───────────────────────────────────────────────────────
async function loadTrack() {
  clearError();
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  btnFind.disabled = true;

  const res = await msg('GET_CURRENT_TRACK');

  if (!res?.ok) {
    if (res?.error === 'not_logged_in') {
      showError('Η σύνδεση έληξε. Αποσυνδέσου και συνδέσου ξανά.');
    } else {
      showError('Αδύνατη η επικοινωνία με το Spotify.');
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
  trackStatus.textContent = currentTrack.isPlaying ? '▶ Παίζει τώρα' : '⏸ Paused';

  btnFind.disabled = false;
}

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
    showError('Κάτι πήγε στραβά: ' + (res?.error || 'unknown'));
  } else {
    lastResultUrl = res.url;

    const badges = {
      'kithara':        '🇬🇷 kithara.to',
      'kithara-search': '🇬🇷 kithara.to (αναζήτηση)',
      'ug':             res.meta?.rating
                          ? `🎸 Ultimate Guitar  ⭐ ${res.meta.rating.toFixed(1)} (${res.meta.votes} votes)`
                          : '🎸 Ultimate Guitar',
      'google':         '🔍 Δεν βρέθηκε στο UG — Google fallback',
    };
    sourceBadge.textContent = badges[res.source] || '';
    sourceBadge.classList.remove('hidden');

    const display = res.meta
      ? `<strong>${res.meta.title}</strong><br>${res.meta.artist}`
      : `<strong>${currentTrack.name}</strong><br>${currentTrack.artist}`;
    resultInfo.innerHTML = display;
    resultDiv.classList.remove('hidden');
  }

  btnFind.textContent = 'Βρες →';
  btnFind.disabled = false;
}

// ─── Events ───────────────────────────────────────────────────────────────────
btnLogin.addEventListener('click', async () => {
  const cid = clientIdInput.value.trim();
  if (!cid) { alert('Βάλε το Client ID σου'); return; }

  btnLogin.textContent = 'Σύνδεση…';
  btnLogin.disabled = true;

  const res = await msg('LOGIN', { clientId: cid });
  if (res?.ok) {
    screenSetup.classList.add('hidden');
    screenMain.classList.remove('hidden');
    await loadTrack();
  } else {
    alert('Αποτυχία σύνδεσης: ' + (res?.error || 'unknown'));
    btnLogin.textContent = 'Σύνδεση με Spotify';
    btnLogin.disabled = false;
  }
});

btnChords.addEventListener('click', () => {
  selectedType = 'Chords';
  btnChords.classList.add('active');
  btnTabs.classList.remove('active');
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  msg('SET_TAB_TYPE', { tabType: 'Chords' });
});

btnTabs.addEventListener('click', () => {
  selectedType = 'Tab';
  btnTabs.classList.add('active');
  btnChords.classList.remove('active');
  resultDiv.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  msg('SET_TAB_TYPE', { tabType: 'Tab' });
});

document.getElementById('auto-toggle').addEventListener('change', (e) => {
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
});

btnLogout.addEventListener('click', async () => {
  await msg('LOGOUT');
  currentTrack = null;
  lastResultUrl = null;
  screenMain.classList.add('hidden');
  screenSetup.classList.remove('hidden');
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
