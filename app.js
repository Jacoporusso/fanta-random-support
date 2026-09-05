(() => {
  'use strict';

  const STORAGE_KEY = 'fanta-random-v3';
  const ROLES = ['P', 'D', 'C', 'A'];
  const TIERS = ['S', 'A', 'B', 'C', 'D'];
  const ROLE_LABELS = { ALL: 'Tutti', P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
  const SOURCES = [
    './listone-data.js',
    'https://cdn.jsdelivr.net/gh/darioschioppi/fantacalcio-2026-27@master/excel_dario_data.js',
    'https://raw.githubusercontent.com/darioschioppi/fantacalcio-2026-27/master/excel_dario_data.js'
  ];
  const TIER_SIZES = {
    P: { S: 6, A: 8, B: 14, C: 18 },
    D: { S: 12, A: 24, B: 40, C: 50 },
    C: { S: 12, A: 24, B: 40, C: 50 },
    A: { S: 8, A: 14, B: 20, C: 24 }
  };
  const DEFAULT_STATE = {
    version: 3,
    settings: { teamName: 'La mia squadra', initialCredits: 500, minBid: 1, slots: { P: 3, D: 8, C: 8, A: 6 } },
    meta: { source: '', syncedAt: null, activeCount: 0 },
    players: [],
    history: []
  };

  let state;
  let activeRole = 'ALL';
  let targetRole = 'ALL';
  let query = '';
  let pendingBuyId = null;
  let syncing = false;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  function normalizeState(raw) {
    const next = clone(DEFAULT_STATE);
    if (!raw || typeof raw !== 'object') return next;
    next.settings = { ...next.settings, ...(raw.settings || {}) };
    next.settings.slots = { ...DEFAULT_STATE.settings.slots, ...(raw.settings?.slots || {}) };
    next.meta = { ...next.meta, ...(raw.meta || {}) };
    next.players = Array.isArray(raw.players) ? raw.players : [];
    next.history = Array.isArray(raw.history) ? raw.history.slice(-30) : [];
    return next;
  }

  function loadState() {
    for (const key of [STORAGE_KEY, 'fanta-random-mvp-v2', 'fanta-random-mvp-v1']) {
      try {
        const value = localStorage.getItem(key);
        if (value) return normalizeState(JSON.parse(value));
      } catch (error) {
        console.warn('Dati locali non leggibili', error);
      }
    }
    return clone(DEFAULT_STATE);
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2000);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Salvataggio non riuscito', error);
      toast('Impossibile salvare nel browser');
    }
  }

  function save() {
    persist();
    render();
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(',', '.').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function playerKey(player) {
    return `${String(player.name).toLowerCase()}|${player.role}`;
  }

  function pushHistory() {
    state.history.push({ players: clone(state.players) });
    if (state.history.length > 30) state.history.shift();
  }

  function currentCredits() {
    const spent = state.players.filter(player => player.status === 'mine')
      .reduce((total, player) => total + (Number(player.price) || 0), 0);
    return Math.max(0, Number(state.settings.initialCredits) - spent);
  }

  function myCount(role = null) {
    return state.players.filter(player => player.status === 'mine' && (!role || player.role === role)).length;
  }

  function totalSlots() {
    return ROLES.reduce((total, role) => total + (Number(state.settings.slots[role]) || 0), 0);
  }

  function slotsRemaining() {
    return Math.max(0, totalSlots() - myCount());
  }

  function roleSlotsRemaining(role) {
    return Math.max(0, (Number(state.settings.slots[role]) || 0) - myCount(role));
  }

  function maxBid() {
    const remaining = slotsRemaining();
    if (!remaining) return 0;
    return Math.max(0, currentCredits() - Math.max(0, remaining - 1) * Number(state.settings.minBid || 1));
  }

  function tierRank(tier) {
    const index = TIERS.indexOf(tier);
    return index < 0 ? 99 : index;
  }

  function assignTiers(players) {
    for (const role of ROLES) {
      const ranked = players.filter(player => player.role === role).sort((a, b) =>
        (b.fvm ?? -1) - (a.fvm ?? -1) || (b.qa ?? -1) - (a.qa ?? -1) || a.name.localeCompare(b.name, 'it')
      );
      const sizes = TIER_SIZES[role];
      const cuts = [sizes.S, sizes.S + sizes.A, sizes.S + sizes.A + sizes.B, sizes.S + sizes.A + sizes.B + sizes.C];
      ranked.forEach((player, index) => {
        player.tier = index < cuts[0] ? 'S' : index < cuts[1] ? 'A' : index < cuts[2] ? 'B' : index < cuts[3] ? 'C' : 'D';
      });
    }
    return players;
  }

  function jsonCompatibleRow(raw) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        if (escaped) {
          result += character;
          escaped = false;
        } else if (character === '\\') {
          result += character;
          escaped = true;
        } else if (character === '"') {
          result += character;
          inString = false;
        } else if (character === '\r' || character === '\n') {
          if (character === '\r' && raw[index + 1] === '\n') index += 1;
          result += '\\n';
        } else {
          result += character;
        }
      } else {
        if (character === '"') inString = true;
        result += character;
      }
    }
    return result;
  }

  function parseListSource(source) {
    const marker = source.indexOf('EXCEL_DARIO_DATA');
    const start = marker < 0 ? -1 : source.indexOf('[', marker);
    if (start < 0) throw new Error('Formato listone non riconosciuto');
    const rows = [];
    let depth = 0;
    let rowStart = -1;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '[') {
        depth += 1;
        if (depth === 2) rowStart = index;
      } else if (character === ']') {
        if (depth === 2 && rowStart >= 0) {
          try {
            rows.push(JSON.parse(jsonCompatibleRow(source.slice(rowStart, index + 1))));
          } catch (error) {
            console.warn('Riga listone ignorata', error);
          }
          rowStart = -1;
        }
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (rows.length < 400) throw new Error(`Listone incompleto: ${rows.length} righe valide`);
    return rows;
  }

  function rowsToPlayers(rows) {
    const oldPlayers = new Map(state.players.map(player => [playerKey(player), player]));
    const players = rows.filter(row => Array.isArray(row) && ROLES.includes(String(row[2]).toUpperCase()) && row[row.length - 1] !== true)
      .map(row => {
        const name = String(row[0] || '').trim();
        const role = String(row[2] || '').trim().toUpperCase();
        const old = oldPlayers.get(`${name.toLowerCase()}|${role}`);
        return {
          id: old?.id || `p-${hash(`${name}|${role}`)}`,
          name,
          club: String(row[1] || '').trim(),
          role,
          qa: parseNumber(row[5]),
          fvm: parseNumber(row[6]),
          tier: 'D',
          target: Boolean(old?.target),
          status: old?.status || 'available',
          price: old?.price ?? null
        };
      }).filter(player => player.name);
    return assignTiers(players);
  }

  async function fetchList() {
    let lastError;
    for (const url of SOURCES) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { text: await response.text(), url };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Sorgente non raggiungibile');
  }

  async function syncList(force = false) {
    if (syncing) return;
    if (force && state.players.some(player => player.status !== 'available') &&
        !confirm('Aggiornare il listone mantenendo acquisti e venduti riconosciuti per nome?')) return;
    syncing = true;
    renderSourceStatus('Sincronizzazione listone…');
    try {
      const { text, url } = await fetchList();
      const players = rowsToPlayers(parseListSource(text));
      if (players.length < 400) throw new Error(`Solo ${players.length} giocatori attivi`);
      state.players = players;
      state.meta = { source: url, syncedAt: new Date().toISOString(), activeCount: players.length };
      state.history = [];
      save();
      toast(`${players.length} giocatori caricati`);
    } catch (error) {
      console.error(error);
      renderSourceStatus(state.players.length ? 'Listone locale disponibile · aggiornamento fallito' : `Caricamento fallito: ${error.message}`, true);
      toast('Impossibile caricare il listone');
    } finally {
      syncing = false;
    }
  }

  function filteredAvailable() {
    const normalized = query.trim().toLocaleLowerCase('it');
    return state.players.filter(player => player.status === 'available')
      .filter(player => activeRole === 'ALL' || player.role === activeRole)
      .filter(player => !normalized || `${player.name} ${player.club}`.toLocaleLowerCase('it').includes(normalized))
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (b.fvm ?? -1) - (a.fvm ?? -1) || a.name.localeCompare(b.name, 'it'));
  }

  function playerHtml(player, mine = false) {
    return `<div class="player" data-id="${escapeHtml(player.id)}">
      <button type="button" class="star ${player.target ? 'active' : ''}" data-action="target" aria-label="Preferito">★</button>
      <div class="player-main"><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">
        <span class="badge role">${escapeHtml(player.role)}</span><span class="badge tier tier-${player.tier}">${player.tier}</span>
        <span>${escapeHtml(player.club)}</span>${player.qa !== null ? `<span>Q ${escapeHtml(player.qa)}</span>` : ''}
        ${mine ? `<span class="price">· ${escapeHtml(player.price)} cr</span>` : ''}</div></div>
      <div class="actions">${mine
        ? '<button type="button" class="small-action" data-action="release">Rimuovi</button>'
        : '<button type="button" class="small-action" data-action="sold">Venduto</button><button type="button" class="small-action mine" data-action="mine">Mio</button>'}</div>
    </div>`;
  }

  function renderMetrics() {
    $('#teamTitle').textContent = state.settings.teamName || 'Fanta Random';
    $('#creditsMetric').textContent = currentCredits();
    $('#slotsMetric').textContent = slotsRemaining();
    $('#maxBidMetric').textContent = maxBid();
    $('#slotsNeededTotal').textContent = slotsRemaining();
    $('#roleNeeds').innerHTML = ROLES.map(role => {
      const remaining = roleSlotsRemaining(role);
      return `<span class="role-need ${remaining === 0 ? 'complete' : ''}">${role} <strong>${remaining}</strong></span>`;
    }).join('');
    $('#undoBtn').disabled = !state.history.length;
  }

  function renderChips() {
    const available = state.players.filter(player => player.status === 'available');
    const chips = [['ALL', 'Tutti', available.length], ...ROLES.map(role => [role, role, available.filter(player => player.role === role).length])];
    $('#roleChips').innerHTML = chips.map(([role, label, count]) =>
      `<button type="button" class="chip ${activeRole === role ? 'active' : ''}" data-role="${role}">${label} <span>${count}</span></button>`
    ).join('');
  }

  function renderPlayers() {
    const players = filteredAvailable();
    const total = state.players.filter(player => player.status === 'available').length;
    $('#availableSubtitle').textContent = state.players.length ? `${players.length} mostrati · ${total} disponibili totali` : 'Il primo caricamento richiede internet';
    $('#playerList').innerHTML = players.length ? players.slice(0, 120).map(player => playerHtml(player)).join('') :
      `<div class="empty">${state.players.length ? 'Nessun giocatore trovato.' : 'Vai in Impostazioni e premi Aggiorna.'}</div>`;
  }

  function renderRadar() {
    $('#radarGrid').innerHTML = ROLES.map(role => {
      const available = state.players.filter(player => player.status === 'available' && player.role === role);
      const counts = TIERS.map(tier => available.filter(player => player.tier === tier).length);
      const maximum = Math.max(1, ...counts);
      return `<div class="radar-card"><div class="radar-title"><span>${role}</span><small>${available.length} rimasti</small></div>${TIERS.map((tier, index) =>
        `<div class="tier-row"><b class="tier-letter tier-${tier}">${tier}</b><div class="bar"><i style="width:${Math.round(counts[index] / maximum * 100)}%"></i></div><strong>${counts[index]}</strong></div>`
      ).join('')}</div>`;
    }).join('');
  }

  function renderTargetTabs() {
    const targets = state.players.filter(player => player.target && player.status === 'available');
    $('#targetRoleTabs').innerHTML = ['ALL', ...ROLES].map(role => {
      const count = role === 'ALL' ? targets.length : targets.filter(player => player.role === role).length;
      return `<button type="button" class="target-tab ${targetRole === role ? 'active' : ''}" data-target-role="${role}">${ROLE_LABELS[role]} <span>${count}</span></button>`;
    }).join('');
  }

  function renderTargets() {
    const allTargets = state.players.filter(player => player.target && player.status === 'available');
    const players = allTargets.filter(player => targetRole === 'ALL' || player.role === targetRole)
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (b.fvm ?? -1) - (a.fvm ?? -1));
    $('#targetsCount').textContent = allTargets.length;
    $('#targetsSubtitle').textContent = allTargets.length
      ? `${players.length} ${targetRole === 'ALL' ? 'priorità ancora disponibili' : ROLE_LABELS[targetRole].toLowerCase() + ' disponibili'}`
      : 'Segna con ★ i giocatori da seguire durante l’asta.';
    $('#targetsList').innerHTML = players.length
      ? players.map(player => playerHtml(player)).join('')
      : `<div class="empty">${allTargets.length ? `Nessun target tra i ${ROLE_LABELS[targetRole].toLowerCase()}.` : 'Non hai ancora aggiunto target.'}</div>`;
  }

  function renderMine() {
    const players = state.players.filter(player => player.status === 'mine')
      .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name, 'it'));
    $('#myTeamSubtitle').textContent = `${players.length} giocatori · ${Number(state.settings.initialCredits) - currentCredits()} crediti spesi`;
    $('#myPlayersList').innerHTML = players.length ? players.map(player => playerHtml(player, true)).join('') : '<div class="empty">Ancora nessun acquisto.</div>';
  }

  function renderSettings() {
    $('#teamName').value = state.settings.teamName;
    $('#initialCredits').value = state.settings.initialCredits;
    $('#minBid').value = state.settings.minBid;
    ROLES.forEach(role => { $(`#slots${role}`).value = state.settings.slots[role]; });
  }

  function renderSourceStatus(override = '', error = false) {
    const element = $('#sourceStatus');
    element.classList.toggle('source-error', error);
    if (override) element.textContent = override;
    else if (state.meta.syncedAt) element.textContent = `Classic 2026/27 · ${state.meta.activeCount || state.players.length} giocatori · sincronizzato ${new Date(state.meta.syncedAt).toLocaleString('it-IT')}`;
    else if (state.players.length) element.textContent = `Listone locale · ${state.players.length} giocatori`;
    else element.textContent = 'Caricamento del listone Classic 2026/27…';
  }

  function render() {
    renderMetrics();
    renderChips();
    renderPlayers();
    renderRadar();
    renderTargetTabs();
    renderTargets();
    renderMine();
    renderSettings();
    renderSourceStatus();
  }

  function switchTab(name) {
    $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
    $$('.tab').forEach(tab => tab.classList.toggle('active', tab.id === `tab-${name}`));
  }

  function openBuy(player) {
    if (!roleSlotsRemaining(player.role)) return toast(`Hai già completato gli slot ${player.role}`);
    if (maxBid() < Number(state.settings.minBid || 1)) return toast('Crediti insufficienti');
    pendingBuyId = player.id;
    $('#buyPlayerName').textContent = player.name;
    $('#buyPlayerMeta').textContent = `${player.role} · ${player.club} · fascia ${player.tier} · max bid ${maxBid()}`;
    $('#buyPrice').value = '';
    $('#buyPrice').min = state.settings.minBid;
    $('#buyPrice').max = maxBid();
    $('#buyDialog').showModal();
  }

  function playerAction(id, action) {
    const player = state.players.find(candidate => candidate.id === id);
    if (!player) return;
    if (action === 'target') player.target = !player.target;
    else if (action === 'sold') { pushHistory(); player.status = 'sold'; player.price = null; }
    else if (action === 'mine') return openBuy(player);
    else if (action === 'release') { pushHistory(); player.status = 'available'; player.price = null; }
    save();
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const nav = event.target.closest('.bottom-nav button[data-tab]');
      if (nav) return switchTab(nav.dataset.tab);
      const chip = event.target.closest('#roleChips [data-role]');
      if (chip) { activeRole = chip.dataset.role; renderChips(); renderPlayers(); return; }
      const targetTab = event.target.closest('#targetRoleTabs [data-target-role]');
      if (targetTab) { targetRole = targetTab.dataset.targetRole; renderTargetTabs(); renderTargets(); return; }
      const action = event.target.closest('.player [data-action]');
      if (action) playerAction(action.closest('.player').dataset.id, action.dataset.action);
    });
    $('#searchInput').addEventListener('input', event => { query = event.target.value; renderPlayers(); });
    $('#clearSearchBtn').addEventListener('click', () => { query = ''; activeRole = 'ALL'; $('#searchInput').value = ''; renderChips(); renderPlayers(); });
    $('#undoBtn').addEventListener('click', () => { const last = state.history.pop(); if (last) { state.players = last.players; save(); toast('Ultima azione annullata'); } });
    $('#refreshListBtn').addEventListener('click', () => syncList(true));
    $('#buyDialog').addEventListener('click', event => {
      const dialog = event.currentTarget;
      const bounds = dialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) dialog.close();
    });

    $('#buyForm').addEventListener('submit', event => {
      if (event.submitter?.value === 'cancel') return;
      event.preventDefault();
      const player = state.players.find(candidate => candidate.id === pendingBuyId);
      const price = Number($('#buyPrice').value);
      if (!player || !Number.isFinite(price) || price < Number(state.settings.minBid)) return toast('Prezzo non valido');
      if (price > maxBid()) return toast(`Max bid attuale: ${maxBid()}`);
      pushHistory();
      player.status = 'mine';
      player.price = price;
      $('#buyDialog').close();
      save();
      toast(`${player.name} acquistato a ${price}`);
    });

    $('#settingsForm').addEventListener('submit', event => {
      event.preventDefault();
      const spent = Number(state.settings.initialCredits) - currentCredits();
      const budget = Math.max(1, Number($('#initialCredits').value) || 500);
      if (budget < spent) return toast(`Budget inferiore ai ${spent} crediti già spesi`);
      state.settings.teamName = $('#teamName').value.trim() || 'La mia squadra';
      state.settings.initialCredits = budget;
      state.settings.minBid = Math.max(1, Number($('#minBid').value) || 1);
      ROLES.forEach(role => { state.settings.slots[role] = Math.max(0, Number($(`#slots${role}`).value) || 0); });
      save();
      toast('Configurazione salvata');
    });

    $('#exportBtn').addEventListener('click', () => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      link.download = `fanta-random-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });

    $('#backupFile').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try { state = normalizeState(JSON.parse(await file.text())); assignTiers(state.players); save(); toast('Backup ripristinato'); }
      catch (error) { toast('Backup non valido'); }
      event.target.value = '';
    });

    $('#resetAuctionBtn').addEventListener('click', () => {
      if (!state.players.length || !confirm('Resettare acquisti e giocatori venduti?')) return;
      state.players.forEach(player => { player.status = 'available'; player.price = null; });
      state.history = [];
      save();
      toast('Asta resettata');
    });
  }

  function setupMobileViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty('--visual-viewport-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--visual-viewport-center', `${viewport.offsetTop + viewport.height / 2}px`);
      document.body.classList.toggle('keyboard-open', viewport.height < window.innerHeight * 0.75);
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();

    document.addEventListener('focusin', event => {
      if (!event.target.matches('input, textarea')) return;
      setTimeout(() => event.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    });
  }

  function initialize() {
    try {
      state = loadState();
      bindEvents();
      setupMobileViewport();
      render();
      if (!state.players.length) syncList();
    } catch (error) {
      console.error(error);
      document.querySelector('main').innerHTML = `<section class="panel danger-zone"><h2>Errore di avvio</h2><p>${escapeHtml(error.message || error)}</p></section>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
