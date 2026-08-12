// ─── PKCE helpers ────────────────────────────────────────────────────────────
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const values = crypto.getRandomValues(new Uint8Array(length));
  values.forEach(v => result += chars[v % chars.length]);
  return result;
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function startAuth(clientId) {
  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);
  await chrome.storage.local.set({ pkce_verifier: verifier });

  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'user-read-currently-playing user-read-playback-state',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'Auth cancelled'));
          return;
        }
        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');
        if (!code) { reject(new Error('No code returned')); return; }

        const { pkce_verifier } = await chrome.storage.local.get('pkce_verifier');
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: pkce_verifier,
          }),
        });

        const token = await tokenRes.json();
        if (token.error) { reject(new Error(token.error_description)); return; }

        const expiresAt = Date.now() + token.expires_in * 1000;
        await chrome.storage.local.set({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: expiresAt,
        });
        resolve(token.access_token);
      }
    );
  });
}

async function refreshToken(clientId, refreshTk) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTk,
      client_id: clientId,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description);
  const expiresAt = Date.now() + data.expires_in * 1000;
  await chrome.storage.local.set({
    access_token: data.access_token,
    expires_at: expiresAt,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
  });
  return data.access_token;
}

async function getValidToken() {
  const { client_id, access_token, refresh_token, expires_at } =
    await chrome.storage.local.get(['client_id', 'access_token', 'refresh_token', 'expires_at']);
  if (!access_token) return null;
  if (Date.now() < expires_at - 60000) return access_token;
  if (refresh_token) return await refreshToken(client_id, refresh_token);
  return null;
}

// ─── Spotify ──────────────────────────────────────────────────────────────────
async function getCurrentTrack() {
  const token = await getValidToken();
  if (!token) return { error: 'not_logged_in' };

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) return { track: null };
  if (!res.ok) return { error: 'spotify_error' };

  const data = await res.json();
  const t = data.item;
  if (!t) return { track: null };
  return {
    track: {
      id: t.id,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      artistId: t.artists[0]?.id,
      album: t.album.name,
      image: t.album.images[1]?.url || t.album.images[0]?.url,
      isPlaying: data.is_playing,
    }
  };
}

// ─── Greek detection ──────────────────────────────────────────────────────────
const GREEK_GENRE_RE = /greek|laiko|laïko|entehno|éntekhno|rebetiko|rembetiko|skiladiko|kapsouriko|kritika|nisiotika|zeibekiko/i;

async function isGreekTrack(track) {
  // 1. Unicode check — fastest
  if (isGreek(track.name) || isGreek(track.artist) || isGreek(track.album)) return true;

  // 2. Spotify artist genres
  if (!track.artistId) return false;
  try {
    const { genre_cache } = await chrome.storage.local.get('genre_cache');
    const cache = genre_cache || {};
    if (track.artistId in cache) return cache[track.artistId];

    const token = await getValidToken();
    if (!token) return false;

    const res = await fetch(`https://api.spotify.com/v1/artists/${track.artistId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;

    const artist = await res.json();
    const greek = (artist.genres || []).some(g => GREEK_GENRE_RE.test(g));
    console.log('[GuitarSync] Artist genres:', artist.genres, '→ greek:', greek);

    cache[track.artistId] = greek;
    await chrome.storage.local.set({ genre_cache: cache });
    return greek;
  } catch (e) {
    console.error('[GuitarSync] Genre lookup failed:', e);
    return false;
  }
}

// ─── Search helpers ───────────────────────────────────────────────────────────
function isGreek(text) {
  return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(text);
}

function kitharaUrl(query) {
  // kithara.to's search is a Google Custom Search widget: the visible query
  // box reads "query", the results themselves render from the "gsc.q" hash
  // param (client-side, Google CSE convention).
  const q = encodeURIComponent(query);
  return `https://kithara.to/fi?query=${q}#gsc.tab=0&gsc.q=${q}&gsc.page=1`;
}

function cleanTitle(name) {
  return name
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')        // (feat. X), [Live], (Remastered)
    .replace(/\s*-\s*(remaster(ed)?|live|acoustic|radio edit|single version|mono|stereo|deluxe|bonus track).*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function artistMatches(spotifyArtist, ugArtist) {
  const a = normalize(spotifyArtist);
  const b = normalize(ugArtist);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

async function searchUG(track, tabType) {
  const title = cleanTitle(track.name);
  const ugType = tabType === 'Tab' ? 'Tabs' : 'Chords';
  const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(title)}&type=${ugType}`;
  console.log('[GuitarSync] UG search:', searchUrl);

  const res = await fetch(searchUrl);
  console.log('[GuitarSync] UG response status:', res.status);
  const html = await res.text();

  const match = html.match(/class="js-store"\s+data-content="([^"]+)"/);
  if (!match) {
    console.log('[GuitarSync] js-store not found in HTML');
    return null;
  }

  const json = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const results = json?.store?.page?.data?.results || [];

  // Score: rating weighted by votes, big bonus for correct artist
  const scored = results
    .filter(r => r.type && r.type.toLowerCase().includes(tabType.toLowerCase()) && r.tab_url)
    .map(r => {
      const votes = r.votes || 0;
      const rating = r.rating || 0;
      const base = rating * Math.log10(votes + 2);
      const artistOk = artistMatches(track.artist, r.artist_name);
      return { r, score: artistOk ? base + 100 : base, artistOk };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  // If nothing matches the artist at all, treat as not found (let fallback handle it)
  if (!scored[0].artistOk) {
    console.log('[GuitarSync] No artist match for', track.artist);
    return null;
  }

  const top = scored[0].r;
  return {
    url: top.tab_url,
    title: top.song_name,
    artist: top.artist_name,
    rating: top.rating,
    votes: top.votes,
  };
}

// Find the actual kithara.to song page via DuckDuckGo (bridges Greeklish ↔ Greek)
async function findKitharaSongPage(query) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent('site:kithara.to ' + query)}`;
  console.log('[GuitarSync] DDG search:', ddgUrl);

  const res = await fetch(ddgUrl);
  if (!res.ok) return null;
  const html = await res.text();

  // Result links: <a class="result__a" href="...">
  const linkRe = /class="result__a"[^>]*href="([^"]+)"/g;
  let m;
  const candidates = [];
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1];

    // DDG redirect format: //duckduckgo.com/l/?uddg=<encoded-url>&...
    if (href.includes('uddg=')) {
      const uddg = new URL('https:' + href.replace(/^https?:/, '')).searchParams.get('uddg');
      if (uddg) href = decodeURIComponent(uddg);
    }

    if (href.includes('kithara.to')) candidates.push(href);
  }

  // DDG's cached link can be stale (page renamed/removed on kithara.to since
  // it was last crawled) — verify it actually loads before trusting it, and
  // fall through to the next candidate rather than sending the user to a 404.
  for (const href of candidates) {
    try {
      const check = await fetch(href);
      if (check.ok) {
        console.log('[GuitarSync] kithara page found:', href);
        return href;
      }
      console.log('[GuitarSync] kithara candidate is dead, trying next:', href, check.status);
    } catch (e) {
      console.log('[GuitarSync] kithara candidate unreachable, trying next:', href);
    }
  }
  return null;
}

async function resolveChordUrl(track, tabType) {
  const title = cleanTitle(track.name);
  const query = `${title} ${track.artist}`;
  // Extra collaborators add noise to a kithara/DDG search (and are often
  // absent from the page's Greek text entirely) — search on the primary
  // artist only, keep the full credit for the Google fallback.
  const kitharaQuery = `${title} ${track.artist.split(',')[0].trim()}`;

  if (await isGreekTrack(track)) {
    try {
      const page = await findKitharaSongPage(kitharaQuery);
      if (page) return { url: page, source: 'kithara' };
    } catch (e) {
      console.error('[GuitarSync] kithara resolution failed:', e);
    }
    // Fallback: kithara's own search page
    return { url: kitharaUrl(kitharaQuery), source: 'kithara-search' };
  }

  try {
    const ug = await searchUG(track, tabType);
    if (ug?.url) return { url: ug.url, source: 'ug', meta: ug };
  } catch (e) {
    console.error('[GuitarSync] UG search failed:', e);
  }

  // UG turning up nothing is itself a signal: Greek songs almost never have UG
  // entries, and isGreekTrack() under-detects whenever a Greek song has a
  // Latin-script (Greeklish) title/artist and Spotify has no genre tags for
  // the artist (both common). Try kithara before giving up on Google — first
  // the exact page (works when the DDG query matches kithara's Greek text),
  // then kithara's own search (its search box handles Greeklish input that a
  // DDG site: search can't bridge to the Greek-script page content).
  try {
    const page = await findKitharaSongPage(kitharaQuery);
    if (page) return { url: page, source: 'kithara' };
  } catch (e) {
    console.error('[GuitarSync] kithara fallback failed:', e);
  }
  // Same last resort as the Greek branch above, rather than jumping to Google:
  // kithara's own search box copes with Greeklish input in a way a DDG
  // site: search — which matches against the page's Greek-script text — can't.
  return { url: kitharaUrl(kitharaQuery), source: 'kithara-search' };
}

// ─── Auto mode: managed tab ───────────────────────────────────────────────────
async function getOrCreateManagedTab(url) {
  const { auto_tab_id } = await chrome.storage.local.get('auto_tab_id');

  if (auto_tab_id != null) {
    try {
      const tab = await chrome.tabs.get(auto_tab_id);
      if (tab.url !== url) {
        await chrome.tabs.update(auto_tab_id, { url });
      }
      return auto_tab_id;
    } catch {
      // tab was closed — create a new one
    }
  }

  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.local.set({ auto_tab_id: tab.id });
  return tab.id;
}

async function autoCheck() {
  const { auto_enabled, tab_type, last_track_id } =
    await chrome.storage.local.get(['auto_enabled', 'tab_type', 'last_track_id']);
  if (!auto_enabled) return;

  console.log('[GuitarSync] Auto check…');
  const result = await getCurrentTrack();
  if (result.error) {
    // Surface failures (e.g. expired session) instead of silently going stale with an "ON" badge
    console.error('[GuitarSync] Auto check failed:', result.error);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e05252' });
    return;
  }
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#1db954' });

  if (!result.track) return;

  const track = result.track;
  if (track.id === last_track_id) return; // same song, nothing to do

  console.log('[GuitarSync] New track detected:', track.name, '-', track.artist);
  await chrome.storage.local.set({ last_track_id: track.id });

  const { url } = await resolveChordUrl(track, tab_type || 'Chords');
  await getOrCreateManagedTab(url);
}

// Staggered checks within each poll window (~10s granularity), driven entirely by
// chrome.alarms rather than setTimeout — MV3 service workers can be terminated
// between events, which silently drops pending setTimeout callbacks.
const POLL_ALARMS = ['guitarsync-poll', 'guitarsync-poll-b', 'guitarsync-poll-c'];

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!POLL_ALARMS.includes(alarm.name)) return;
  autoCheck();
  if (alarm.name === 'guitarsync-poll') {
    chrome.alarms.create('guitarsync-poll-b', { delayInMinutes: 10 / 60 });
    chrome.alarms.create('guitarsync-poll-c', { delayInMinutes: 20 / 60 });
  }
});

async function setAutoMode(enabled) {
  await chrome.storage.local.set({ auto_enabled: enabled });
  if (enabled) {
    await chrome.storage.local.set({ last_track_id: null });
    chrome.alarms.create('guitarsync-poll', { periodInMinutes: 0.5 });
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#1db954' });
    autoCheck(); // immediate first check
  } else {
    for (const name of POLL_ALARMS) chrome.alarms.clear(name);
    chrome.action.setBadgeText({ text: '' });
  }
}

// Restore badge/alarm after browser restart
chrome.runtime.onStartup?.addListener(async () => {
  const { auto_enabled } = await chrome.storage.local.get('auto_enabled');
  if (auto_enabled) setAutoMode(true);
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    console.log('[GuitarSync] Message received:', msg.type);

    if (msg.type === 'LOGIN') {
      await chrome.storage.local.set({ client_id: msg.clientId });
      const token = await startAuth(msg.clientId);
      sendResponse({ ok: true, token });
      return;
    }

    if (msg.type === 'GET_CURRENT_TRACK') {
      const result = await getCurrentTrack();
      if (result.error) { sendResponse({ ok: false, error: result.error }); return; }
      sendResponse({ ok: true, track: result.track });
      return;
    }

    if (msg.type === 'LOGOUT') {
      await setAutoMode(false);
      const { client_id } = await chrome.storage.local.get('client_id');
      await chrome.storage.local.clear();
      if (client_id) await chrome.storage.local.set({ client_id }); // keep it prefilled for next login
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'RESOLVE_URL') {
      const result = await resolveChordUrl(msg.track, msg.tabType);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (msg.type === 'SEARCH_UG') {
      const ug = await searchUG({ name: msg.name, artist: msg.artist }, msg.tabType);
      if (!ug) { sendResponse({ ok: false, error: 'no_results' }); return; }
      sendResponse({ ok: true, ...ug });
      return;
    }

    if (msg.type === 'SEARCH_KITHARA') {
      sendResponse({ ok: true, url: kitharaUrl(msg.query) });
      return;
    }

    if (msg.type === 'SET_AUTO') {
      await chrome.storage.local.set({ tab_type: msg.tabType || 'Chords' });
      await setAutoMode(msg.enabled);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'GET_AUTO') {
      const { auto_enabled } = await chrome.storage.local.get('auto_enabled');
      sendResponse({ ok: true, enabled: !!auto_enabled });
      return;
    }

    if (msg.type === 'SET_TAB_TYPE') {
      await chrome.storage.local.set({ tab_type: msg.tabType, last_track_id: null });
      const { auto_enabled } = await chrome.storage.local.get('auto_enabled');
      if (auto_enabled) autoCheck(); // re-resolve current song with new type
      sendResponse({ ok: true });
      return;
    }
  })().catch(err => {
    console.error('[GuitarSync] Unhandled error:', err);
    sendResponse({ ok: false, error: err.message || 'unexpected_error' });
  });
  return true; // async
});
