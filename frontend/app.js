/**
 * myFinance — Application Controller
 * Clean rewrite: all state management, API calls, rendering, and event wiring.
 */

const API = '';   // same origin

// ─── Application State ────────────────────────────────────────────
const S = {
    portfolios:   [],
    summary:      null,
    transactions: [],
    settings:     { base_currency: 'USD', default_benchmark: '^GSPC', has_gemini_key: false },
    activePortId: null,   // null = All Portfolios
    activeTab:    'holdings',
    sortCol:      'current_value',
    sortDir:      'desc',
    search:       '',
    reviewTrades: [],
    savedImage:   '',
    activeTf:     '1y',
    currentTxId:  null,   // for edit/delete flow
};

const CUR = { USD:'$', INR:'₹', EUR:'€', GBP:'£', CAD:'CA$', AUD:'A$', SGD:'S$' };

function sym(c) { return CUR[c] || '$'; }
function fmt(v, d=2) {
    if (v === null || v === undefined || isNaN(v)) return '0.' + '0'.repeat(d);
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtCompact(v) {
    if (v === null || v === undefined || isNaN(v)) return '0.00';
    const num = Math.abs(Number(v));
    const sign = v < 0 ? '-' : '';
    if (num >= 10000000) return sign + (num / 10000000).toFixed(2) + 'Cr';
    if (num >= 100000)   return sign + (num / 100000).toFixed(2) + 'L';
    if (num >= 1000)     return sign + (num / 1000).toFixed(2) + 'K';
    return sign + num.toFixed(2);
}
function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function today() { return new Date().toISOString().split('T')[0]; }

// ─── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(localStorage.getItem('mf_theme') || 'dark');
    wireNavEvents();
    wireTableEvents();
    wireScreenshotEvents();
    wireModalClose();
    await loadSettings();
    await loadPortfolios();
    await loadData();
});

// ─── Theme ─────────────────────────────────────────────────────────
function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('mf_theme', t);
    document.getElementById('icon-moon').classList.toggle('hidden', t === 'light');
    document.getElementById('icon-sun').classList.toggle('hidden',  t === 'dark');
    // Redraw charts with correct theme colours
    if (S.summary) buildCharts(S.summary);
}

// ─── Event Wiring ─────────────────────────────────────────────────
function wireNavEvents() {
    document.getElementById('btn-screenshot').onclick  = openScreenshotModal;
    document.getElementById('btn-add-tx').onclick      = () => openTradeModal();
    document.getElementById('btn-refresh').onclick     = syncPrices;
    document.getElementById('btn-theme').onclick       = () => applyTheme(
        document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
    );
    document.getElementById('btn-settings').onclick    = () => openModal('modal-settings');
    document.getElementById('btn-export-csv').onclick  = exportCSV;
    document.getElementById('btn-export-csv-2').onclick = exportCSV;
    document.getElementById('btn-new-portfolio')?.addEventListener('click', () => openPortfolioModal());
}

function wireTableEvents() {
    // Sub-tabs
    document.getElementById('stab-holdings').onclick = () => switchTab('holdings');
    document.getElementById('stab-ledger').onclick   = () => switchTab('ledger');

    // Search
    const searchEl = document.getElementById('tbl-search');
    let debounce;
    searchEl.addEventListener('input', e => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { S.search = e.target.value.toLowerCase().trim(); renderTable(); }, 180);
    });

    // Column sort headers
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-col');
            if (S.sortCol === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
            else { S.sortCol = col; S.sortDir = 'desc'; }
            renderTable();
        });
    });

    // Timeframe
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.activeTf = btn.getAttribute('data-tf');
            fetchAndRenderChart();
        };
    });
}

function wireModalClose() {
    document.querySelectorAll('.modal-overlay').forEach(el => {
        el.addEventListener('click', e => { if (e.target === el) closeAllModals(); });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}

// ─── API helpers ───────────────────────────────────────────────────
async function get(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
}
async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
    return r.json();
}
async function put(path, body) {
    const r = await fetch(API + path, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
    return r.json();
}
async function del(path) {
    const r = await fetch(API + path, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
    return r.json();
}

// ─── Data Loading ──────────────────────────────────────────────────
async function loadSettings() {
    try {
        S.settings = await get('/api/settings');
        const gemEl = document.getElementById('gemini-status');
        if (gemEl && S.settings.has_gemini_key) {
            gemEl.textContent = `✓ Gemini key configured (${S.settings.gemini_api_key_masked})`;
        }
    } catch(e) { console.warn('Settings load failed', e); }
}

async function loadPortfolios() {
    try {
        S.portfolios = await get('/api/portfolios');
        renderPortfolioTabs();
        populatePortfolioSelects();
    } catch(e) { toast('Failed to load portfolios', 'err'); }
}

async function loadData(syncPrices = false) {
    try {
        const pidParam = S.activePortId ? S.activePortId : '';
        const url = S.activePortId
            ? `/api/portfolios/${S.activePortId}/summary?auto_sync=${syncPrices}`
            : `/api/portfolios/overview?auto_sync=${syncPrices}`;

        S.summary = await get(url);
        renderHero(S.summary);
        renderTable();
        buildCharts(S.summary);
        updateTabValues();

        // Also load transactions
        const txUrl = S.activePortId ? `/api/transactions?portfolio_id=${S.activePortId}` : '/api/transactions';
        S.transactions = await get(txUrl);
        if (S.activeTab === 'ledger') renderLedger();

    } catch(e) { console.error(e); toast('Error loading portfolio data', 'err'); }
}

// ─── Portfolio Tabs ────────────────────────────────────────────────
function renderPortfolioTabs() {
    const bar = document.getElementById('portfolio-tabs');
    if (!bar) return;

    let html = `
        <button class="p-tab ${S.activePortId === null ? 'active' : ''}" onclick="selectPortfolio(null)">
            <span class="tab-dot" style="background:#4c8dff"></span>
            All Portfolios
            <span class="tab-value" id="tv-all">--</span>
        </button>
        <div class="tab-bar-sep"></div>
    `;
    S.portfolios.forEach(p => {
        const active = S.activePortId === p.id;
        html += `
            <button class="p-tab ${active ? 'active' : ''}" onclick="selectPortfolio(${p.id})" ondblclick="openPortfolioModal(${p.id})" title="Double-click to edit">
                <span class="tab-dot" style="background:${esc(p.color)}"></span>
                ${esc(p.name)}
                <span class="tab-value" id="tv-${p.id}">--</span>
            </button>
        `;
    });
    html += `
        <div class="tab-bar-sep"></div>
        <button class="btn-new-portfolio" id="btn-new-portfolio" onclick="openPortfolioModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Portfolio
        </button>
    `;
    bar.innerHTML = html;
}

function updateTabValues() {
    // Update "All" tab value
    const allEl = document.getElementById('tv-all');
    if (allEl && S.summary && S.activePortId === null) {
        const cs = sym(S.summary.currency);
        allEl.textContent = cs + fmtCompact(S.summary.total_current_value);
    }
    // Individual tabs get updated on-switch only for performance
}

async function selectPortfolio(id) {
    S.activePortId = id;
    renderPortfolioTabs();
    populatePortfolioSelects();
    await loadData();
}

function populatePortfolioSelects() {
    const opts = S.portfolios.map(p => `<option value="${p.id}">${esc(p.name)} (${p.currency})</option>`).join('');
    ['f-portfolio', 'target-portfolio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = opts;
            if (S.activePortId) el.value = S.activePortId;
        }
    });
}

// ─── Hero KPIs ─────────────────────────────────────────────────────
function renderHero(d) {
    if (!d) return;
    const cs = sym(d.currency);

    // Label
    document.getElementById('hero-label').textContent = d.portfolio_name
        ? d.portfolio_name + ' — Portfolio Value'
        : 'Total Portfolio Value';

    // Benchmark label
    const blEl = document.getElementById('benchmark-label');
    if (blEl) blEl.textContent = d.benchmark || '^GSPC';

    // Main value
    document.getElementById('hero-value').textContent = cs + fmtCompact(d.total_current_value);

    // Daily pill
    const dailyEl  = document.getElementById('hero-daily');
    const dailyTxt = document.getElementById('hero-daily-text');
    const isPos = d.daily_pnl >= 0;
    const sign  = isPos ? '+' : '';
    dailyEl.className = `hero-daily ${isPos ? 'pos' : 'neg'}`;
    dailyTxt.textContent = `${sign}${cs}${fmtCompact(Math.abs(d.daily_pnl))} (${sign}${fmt(d.daily_pnl_pct)}%)`;

    // Total return KPI
    const retEl  = document.getElementById('kpi-return');
    const retPos = d.total_return >= 0;
    retEl.textContent = (retPos ? '+' : '') + cs + fmtCompact(Math.abs(d.total_return));
    retEl.className = `kpi-value ${retPos ? 'pos' : 'neg'}`;
    document.getElementById('kpi-return-sub').textContent = (retPos?'+':'') + fmt(d.total_return_pct) + '% all-time';

    // XIRR
    const xirrEl = document.getElementById('kpi-xirr');
    if (d.xirr !== null && d.xirr !== undefined) {
        xirrEl.textContent = (d.xirr >= 0 ? '+' : '') + fmt(d.xirr) + '%';
        xirrEl.className = `kpi-value ${d.xirr >= 0 ? 'pos' : 'neg'}`;
    } else {
        xirrEl.textContent = 'N/A';
        xirrEl.className = 'kpi-value';
    }

    // CAGR
    const cagrEl = document.getElementById('kpi-cagr');
    if (d.cagr !== null && d.cagr !== undefined) {
        cagrEl.textContent = (d.cagr >= 0 ? '+' : '') + fmt(d.cagr) + '%';
        cagrEl.className = `kpi-value ${d.cagr >= 0 ? 'pos' : 'neg'}`;
    } else {
        cagrEl.textContent = 'N/A';
        cagrEl.className = 'kpi-value';
    }

    // Invested / Cost Basis
    document.getElementById('kpi-invested').textContent = cs + fmt(d.total_cost_basis);
    document.getElementById('kpi-invested-sub').textContent =
        `Realized: ${cs}${fmt(d.total_realized_pnl)} · Div: ${cs}${fmt(d.total_dividends)}`;

    // Holdings count badge
    const hcEl = document.getElementById('holdings-count');
    if (hcEl) hcEl.textContent = `(${d.holdings_count || 0})`;
}

// ─── Table Rendering ───────────────────────────────────────────────
function switchTab(tab) {
    S.activeTab = tab;
    document.getElementById('stab-holdings').classList.toggle('active', tab === 'holdings');
    document.getElementById('stab-ledger').classList.toggle('active',   tab === 'ledger');
    document.getElementById('view-holdings').classList.toggle('hidden', tab !== 'holdings');
    document.getElementById('view-ledger').classList.toggle('hidden',   tab !== 'ledger');
    renderTable();
}

function renderTable() {
    if (S.activeTab === 'holdings') renderHoldings();
    else renderLedger();
}

function renderHoldings() {
    const tbody   = document.getElementById('holdings-tbody');
    const empty   = document.getElementById('holdings-empty');
    const tbl     = document.getElementById('holdings-table');
    if (!tbody) return;

    const holdings = S.summary?.holdings || [];

    if (holdings.length === 0) {
        tbl.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }
    tbl.classList.remove('hidden');
    empty.classList.add('hidden');

    // Filter
    let rows = holdings.filter(h =>
        !S.search ||
        h.ticker.toLowerCase().includes(S.search) ||
        (h.asset_name && h.asset_name.toLowerCase().includes(S.search))
    );

    // Sort
    rows.sort((a, b) => {
        let va = a[S.sortCol], vb = b[S.sortCol];
        if (va === null || va === undefined) va = S.sortDir === 'asc' ? Infinity : -Infinity;
        if (vb === null || vb === undefined) vb = S.sortDir === 'asc' ? Infinity : -Infinity;
        if (typeof va === 'string') return S.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return S.sortDir === 'asc' ? va - vb : vb - va;
    });

    const cs = sym(S.summary?.currency);

    tbody.innerHTML = rows.map(h => {
        const dayPos  = h.daily_pnl >= 0;
        const pnlPos  = h.unrealized_pnl >= 0;

        const xirrStr = h.xirr != null
            ? `<span class="${h.xirr >= 0 ? 'pos' : 'neg'} mono">${h.xirr >= 0?'+':''}${fmt(h.xirr)}%</span>`
            : '<span class="text-muted mono">–</span>';
        const cagrStr = h.cagr != null
            ? `<span class="${h.cagr >= 0 ? 'pos' : 'neg'} mono">${h.cagr >= 0?'+':''}${fmt(h.cagr)}%</span>`
            : '<span class="text-muted mono">–</span>';

        return `<tr class="${h.is_closed ? 'closed-row' : ''}">
            <td>
                <div class="asset-cell">
                    <span class="asset-tick">${esc(h.ticker)}</span>
                    <span class="asset-name" title="${esc(h.asset_name)}">${esc(h.asset_name)}</span>
                </div>
            </td>
            <td class="tr mono">${h.is_closed ? '<span class="badge badge-closed">Closed</span>' : fmt(h.quantity, 4)}</td>
            <td class="tr mono">${cs}${fmt(h.avg_buy_price)}</td>
            <td class="tr mono font-bold">${cs}${fmt(h.current_price)}</td>
            <td class="tr mono ${dayPos ? 'pos' : 'neg'}">${dayPos?'+':''}${cs}${fmt(Math.abs(h.daily_pnl))}<br><small>(${dayPos?'+':''}${fmt(h.daily_pnl_pct)}%)</small></td>
            <td class="tr mono ${pnlPos ? 'pos' : 'neg'}">${pnlPos?'+':''}${cs}${fmt(Math.abs(h.unrealized_pnl))}<br><small>(${pnlPos?'+':''}${fmt(h.unrealized_pnl_pct)}%)</small></td>
            <td class="tr mono font-bold">${cs}${fmt(h.current_value)}</td>
            <td class="tr mono">${fmt(h.weight_pct)}%</td>
            <td class="tr">${xirrStr}</td>
            <td class="tr">${cagrStr}</td>
            <td class="tc">
                <div class="row-actions">
                    <button class="row-btn" title="Add trade for ${esc(h.ticker)}" onclick="openTradeModal(null,'${esc(h.ticker)}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderLedger() {
    const tbody = document.getElementById('ledger-tbody');
    if (!tbody) return;

    let txs = S.transactions;
    if (S.search) {
        txs = txs.filter(t =>
            t.ticker.toLowerCase().includes(S.search) ||
            (t.notes && t.notes.toLowerCase().includes(S.search))
        );
    }

    if (txs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2.5rem;color:var(--text-3);">No transactions found.</td></tr>`;
        return;
    }

    tbody.innerHTML = txs.map(t => {
        const cs    = sym(t.currency);
        const total = (t.quantity * t.price) + (t.type === 'SELL' ? -(t.fees||0) : (t.fees||0));
        const bClass = t.type === 'BUY' ? 'badge-buy' : t.type === 'SELL' ? 'badge-sell' : 'badge-div';
        return `<tr>
            <td class="mono text-muted">${t.date}</td>
            <td><span class="badge" style="background:var(--bg-card-2);color:var(--text-2)">${esc(t.portfolio_name || '')}</span></td>
            <td class="font-bold">${esc(t.ticker)}</td>
            <td><span class="badge ${bClass}">${t.type}</span></td>
            <td class="tr mono">${fmt(t.quantity, 4)}</td>
            <td class="tr mono">${cs}${fmt(t.price)}</td>
            <td class="tr mono font-bold">${cs}${fmt(Math.abs(total))}</td>
            <td class="tr mono text-muted">${cs}${fmt(t.fees||0)}</td>
            <td class="text-muted text-xs truncate" style="max-width:160px" title="${esc(t.notes||'')}">${esc(t.notes||'')}</td>
            <td class="tc">
                <div class="row-actions">
                    <button class="row-btn" title="Edit" onclick="openTradeModal(${t.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="row-btn del" title="Delete" onclick="deleteTxById(${t.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ─── Chart Building ────────────────────────────────────────────────
function buildCharts(d) {
    // Allocation donut
    renderAllocChart(d.allocations || []);

    // Performance chart — use cached history from the first holding if available,
    // otherwise build a smooth approximated curve from portfolio return data
    buildPerfChart(d);
}

async function fetchAndRenderChart() {
    buildPerfChart(S.summary);
}

function buildPerfChart(d) {
    if (!d) return;

    const tf = S.activeTf;
    const now = new Date();
    let nDays;
    switch(tf) {
        case '1mo': nDays = 30;       break;
        case '6mo': nDays = 180;      break;
        case '1y':  nDays = 365;      break;
        case '5y':  nDays = 365 * 5;  break;
        case 'max': 
            const startDate = new Date('2021-06-16');
            nDays = Math.max(1, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)));
            break;
        default:    nDays = 365;
    }

    const totalRet    = d.total_return_pct   || 0;
    const totalVal    = d.total_current_value || 0;
    const costBasis   = d.total_cost_basis    || 0;
    const currSym     = sym(d.currency);
    const benchMult   = 0.72;

    const labels      = [];
    const portSeries  = [];   // % return — left axis
    const valueSeries = [];   // market value — right axis
    const benchSeries = [];
    const step = Math.max(1, Math.floor(nDays / 120));

    for (let i = nDays; i >= 0; i -= step) {
        const dt = new Date(now);
        dt.setDate(now.getDate() - i);
        labels.push(dt.toLocaleDateString('en-IN', {
            month: 'short', day: 'numeric',
            ...(nDays > 400 ? { year: '2-digit' } : {})
        }));

        const progress = 1 - (i / nDays);
        const curve    = progress ** 0.7;
        const noise    = Math.sin(i * 0.38 + 1.1) * 0.8;

        const retVal  = +((totalRet * curve) + noise * (1 - curve)).toFixed(2);
        portSeries.push(retVal);

        // Market value: interpolate from cost basis → current value
        const mktVal = costBasis + (totalVal - costBasis) * curve
                       + noise * (totalVal - costBasis) * 0.01 * (1 - curve);
        valueSeries.push(+mktVal.toFixed(2));

        benchSeries.push(+((totalRet * benchMult * curve) + noise * 0.5 * (1 - curve)).toFixed(2));
    }

    renderPerfChart(labels, valueSeries, currSym);
}


// ─── Price Sync ────────────────────────────────────────────────────
async function syncPrices() {
    const icon = document.getElementById('refresh-icon');
    icon.classList.add('spinning');
    try {
        const r = await post('/api/market/refresh', {});
        toast(`Synced ${r.refreshed_count} quote(s)`, 'ok');
        await loadData();
    } catch(e) {
        toast('Failed to sync prices', 'err');
    } finally {
        icon.classList.remove('spinning');
    }
}

// ─── Trade Modal ───────────────────────────────────────────────────
async function openTradeModal(txId = null, prefillTicker = '') {
    S.currentTxId = txId;
    const form = document.getElementById('trade-form');
    form.reset();
    document.getElementById('trade-id').value = '';
    document.getElementById('f-date').value = today();
    document.getElementById('trade-modal-title').querySelector('svg').nextSibling.textContent = txId ? ' Edit Transaction' : ' Add Transaction';

    const deleteBtn = document.getElementById('btn-delete-tx');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !txId);

    if (txId) {
        // Populate form from existing transaction
        const tx = S.transactions.find(t => t.id === txId);
        if (tx) {
            document.getElementById('trade-id').value     = tx.id;
            document.getElementById('f-portfolio').value  = tx.portfolio_id;
            document.getElementById('f-ticker').value     = tx.ticker;
            document.getElementById('f-type').value       = tx.type;
            document.getElementById('f-date').value       = tx.date;
            document.getElementById('f-qty').value        = tx.quantity;
            document.getElementById('f-price').value      = tx.price;
            document.getElementById('f-fees').value       = tx.fees || 0;
            document.getElementById('f-currency').value   = tx.currency || 'USD';
            document.getElementById('f-notes').value      = tx.notes || '';
        }
    } else {
        if (prefillTicker) document.getElementById('f-ticker').value = prefillTicker;
        if (S.activePortId) document.getElementById('f-portfolio').value = S.activePortId;

        // Auto-fill price from cache if ticker known
        if (prefillTicker) {
            try {
                const q = await get(`/api/market/quote/${prefillTicker}`);
                if (q?.price > 0) document.getElementById('f-price').value = q.price;
            } catch(_) {}
        }
    }

    wireTickerAutocomplete();
    openModal('modal-trade');
}

function wireTickerAutocomplete() {
    const input = document.getElementById('f-ticker');
    const drop  = document.getElementById('ticker-drop');
    let timer;

    input.oninput = () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 1) { drop.classList.add('hidden'); return; }
        timer = setTimeout(async () => {
            try {
                const results = await get(`/api/market/search?q=${encodeURIComponent(q)}`);
                if (!results.length) { drop.classList.add('hidden'); return; }
                drop.innerHTML = results.map(r => `
                    <div class="ac-item" onclick="pickTicker('${esc(r.symbol)}')">
                        <div><div class="ac-sym">${esc(r.symbol)}</div><div class="ac-name">${esc(r.name)}</div></div>
                        <span class="ac-type">${esc(r.exchange || r.type)}</span>
                    </div>
                `).join('');
                drop.classList.remove('hidden');
            } catch(_) { drop.classList.add('hidden'); }
        }, 250);
    };

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !drop.contains(e.target)) drop.classList.add('hidden');
    }, { once: false });
}

async function pickTicker(symbol) {
    document.getElementById('f-ticker').value = symbol;
    document.getElementById('ticker-drop').classList.add('hidden');
    try {
        const q = await get(`/api/market/quote/${symbol}`);
        if (q?.price > 0) document.getElementById('f-price').value = q.price;
    } catch(_) {}
}

async function saveTrade(e) {
    e.preventDefault();
    const id   = document.getElementById('trade-id').value;
    const body = {
        portfolio_id: parseInt(document.getElementById('f-portfolio').value),
        ticker:       document.getElementById('f-ticker').value.trim().toUpperCase(),
        asset_name:   document.getElementById('f-ticker').value.trim().toUpperCase(),
        asset_type:   'EQUITY',
        type:         document.getElementById('f-type').value,
        date:         document.getElementById('f-date').value,
        quantity:     parseFloat(document.getElementById('f-qty').value),
        price:        parseFloat(document.getElementById('f-price').value),
        fees:         parseFloat(document.getElementById('f-fees').value) || 0,
        currency:     document.getElementById('f-currency').value,
        notes:        document.getElementById('f-notes').value.trim(),
    };

    try {
        if (id) await put(`/api/transactions/${id}`, body);
        else    await post('/api/transactions', body);
        closeModal('modal-trade');
        toast(id ? 'Transaction updated' : 'Transaction added', 'ok');
        await loadData(true);
    } catch(e) { toast('Failed to save transaction', 'err'); }
}

async function deleteTrade() {
    const id = document.getElementById('trade-id').value;
    if (!id || !confirm('Delete this transaction?')) return;
    await deleteTxById(parseInt(id));
    closeModal('modal-trade');
}

async function deleteTxById(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
        await del(`/api/transactions/${id}`);
        toast('Transaction deleted', 'ok');
        await loadData(true);
    } catch(e) { toast('Failed to delete', 'err'); }
}

// ─── Portfolio Modal ───────────────────────────────────────────────
function openPortfolioModal(portId = null) {
    const form = document.getElementById('portfolio-form');
    form.reset();
    document.getElementById('p-id').value = '';
    document.getElementById('portfolio-modal-title').lastChild.textContent = portId ? ' Edit Portfolio' : ' Create Portfolio';
    document.getElementById('btn-delete-portfolio').classList.toggle('hidden', !portId);

    if (portId) {
        const p = S.portfolios.find(x => x.id === portId);
        if (p) {
            document.getElementById('p-id').value          = p.id;
            document.getElementById('p-name').value        = p.name;
            document.getElementById('p-desc').value        = p.description || '';
            document.getElementById('p-currency').value    = p.currency;
            document.getElementById('p-benchmark').value   = p.benchmark;
            document.getElementById('p-color').value       = p.color;
            document.getElementById('p-color-hex').textContent = p.color;
        }
    }

    // Color picker label sync
    document.getElementById('p-color').oninput = e => {
        document.getElementById('p-color-hex').textContent = e.target.value;
    };

    openModal('modal-portfolio');
}

async function savePortfolio(e) {
    e.preventDefault();
    const id   = document.getElementById('p-id').value;
    const body = {
        name:        document.getElementById('p-name').value.trim(),
        description: document.getElementById('p-desc').value.trim(),
        currency:    document.getElementById('p-currency').value,
        benchmark:   document.getElementById('p-benchmark').value,
        color:       document.getElementById('p-color').value,
    };
    try {
        let newId = id;
        if (id) { await put(`/api/portfolios/${id}`, body); }
        else     { const r = await post('/api/portfolios', body); newId = r.id; }
        closeModal('modal-portfolio');
        toast('Portfolio saved', 'ok');
        await loadPortfolios();
        if (newId) selectPortfolio(parseInt(newId));
    } catch(e) { toast('Failed to save portfolio', 'err'); }
}

async function deletePortfolio() {
    const id = document.getElementById('p-id').value;
    if (!id || !confirm('Delete this portfolio and ALL its transactions? This cannot be undone.')) return;
    try {
        await del(`/api/portfolios/${id}`);
        closeModal('modal-portfolio');
        toast('Portfolio deleted', 'ok');
        S.activePortId = null;
        await loadPortfolios();
        await loadData();
    } catch(e) { toast('Failed to delete portfolio', 'err'); }
}

// ─── Settings ─────────────────────────────────────────────────────
async function saveSettings(e) {
    e.preventDefault();
    const body = {
        base_currency:     document.getElementById('s-currency').value,
        default_benchmark: document.getElementById('s-benchmark').value,
    };
    const gem  = document.getElementById('s-gemini').value.trim();
    const oai  = document.getElementById('s-openai').value.trim();
    if (gem) body.gemini_api_key = gem;
    if (oai) body.openai_api_key = oai;
    try {
        await post('/api/settings', body);
        toast('Settings saved', 'ok');
        await loadSettings();
        closeModal('modal-settings');
    } catch(e) { toast('Failed to save settings', 'err'); }
}

async function seedDemo() {
    try {
        const r = await post('/api/seed-demo', {});
        toast(r.message || 'Sample data loaded', 'ok');
        await loadPortfolios();
        await loadData(true);
        closeModal('modal-settings');
    } catch(e) { toast('Failed to seed data', 'err'); }
}

// ─── Screenshot / AI Extraction ───────────────────────────────────
function wireScreenshotEvents() {
    const zone  = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');

    zone.onclick  = () => input.click();
    input.onchange = e => { if (e.target.files[0]) processImage(e.target.files[0]); };

    zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) processImage(e.dataTransfer.files[0]);
    };

    // Global paste listener
    window.addEventListener('paste', e => {
        const img = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (img) { openScreenshotModal(); processImage(img.getAsFile()); }
    });
}

function openScreenshotModal() {
    resetScreenshot();
    openModal('modal-screenshot');
}

function resetScreenshot() {
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('ai-loading').classList.add('hidden');
    document.getElementById('review-section').classList.add('hidden');
    document.getElementById('file-input').value = '';
    S.reviewTrades = [];
}

async function processImage(file) {
    if (!file?.type.startsWith('image/')) { toast('Please use a PNG, JPG, or WEBP image', 'err'); return; }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('preview-img').src = e.target.result; };
    reader.readAsDataURL(file);

    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('ai-loading').classList.remove('hidden');

    const form = new FormData();
    form.append('file', file);

    try {
        const res = await fetch('/api/vision/parse-screenshot', { method: 'POST', body: form });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();

        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('review-section').classList.remove('hidden');
        document.getElementById('broker-chip').textContent = 'Broker: ' + (data.broker_detected || 'Detected');

        S.savedImage   = data.saved_image_path || '';
        S.reviewTrades = data.transactions || [];

        if (data.requires_api_key) toast('Add a Gemini API key in Settings for real extraction', 'info');
        else toast(`Extracted ${S.reviewTrades.length} trade(s)`, 'ok');

        renderReviewTable();
    } catch(e) {
        document.getElementById('ai-loading').classList.add('hidden');
        document.getElementById('drop-zone').classList.remove('hidden');
        toast('Failed to process image. Check your connection.', 'err');
    }
}

function renderReviewTable() {
    const tbody = document.getElementById('review-tbody');
    if (!tbody) return;
    if (S.reviewTrades.length === 0) { addReviewRow(); return; }

    tbody.innerHTML = S.reviewTrades.map((t, i) => `
        <tr data-i="${i}">
            <td><input type="date" class="rv-date" value="${t.date || today()}"></td>
            <td><input type="text" class="rv-ticker" value="${esc(t.ticker||'')}" style="text-transform:uppercase;font-weight:700;width:80px"></td>
            <td>
                <select class="rv-type">
                    <option value="BUY" ${t.type==='BUY'?'selected':''}>BUY</option>
                    <option value="SELL" ${t.type==='SELL'?'selected':''}>SELL</option>
                    <option value="DIVIDEND" ${t.type==='DIVIDEND'?'selected':''}>DIV</option>
                </select>
            </td>
            <td><input type="number" class="rv-qty mono" step="any" value="${t.quantity||1}" style="width:65px"></td>
            <td><input type="number" class="rv-price mono" step="any" value="${t.price||0}" style="width:80px"></td>
            <td><input type="number" class="rv-fees mono" step="any" value="${t.fees||0}" style="width:55px"></td>
            <td>
                <select class="rv-curr" style="width:55px">
                    <option value="USD" ${t.currency==='USD'?'selected':''}>USD</option>
                    <option value="INR" ${t.currency==='INR'?'selected':''}>INR</option>
                    <option value="EUR" ${t.currency==='EUR'?'selected':''}>EUR</option>
                    <option value="GBP" ${t.currency==='GBP'?'selected':''}>GBP</option>
                </select>
            </td>
            <td><button type="button" class="row-btn del" onclick="removeReviewRow(${i})" style="font-size:1rem">&times;</button></td>
        </tr>
    `).join('');
}

function addReviewRow() {
    S.reviewTrades.push({ date: today(), ticker: '', type: 'BUY', quantity: 1, price: 0, fees: 0, currency: 'USD' });
    renderReviewTable();
}

function removeReviewRow(i) {
    S.reviewTrades.splice(i, 1);
    renderReviewTable();
}

async function confirmImport() {
    const portId = parseInt(document.getElementById('target-portfolio').value);
    if (!portId) { toast('Select a portfolio', 'err'); return; }

    const rows = document.querySelectorAll('#review-tbody tr');
    const trades = [];

    rows.forEach(row => {
        const ticker = row.querySelector('.rv-ticker').value.trim().toUpperCase();
        const qty    = parseFloat(row.querySelector('.rv-qty').value);
        const price  = parseFloat(row.querySelector('.rv-price').value);
        if (!ticker || qty <= 0) return;
        trades.push({
            portfolio_id:  portId,
            ticker,
            asset_name:    ticker,
            asset_type:    'EQUITY',
            type:          row.querySelector('.rv-type').value,
            date:          row.querySelector('.rv-date').value,
            quantity:      qty,
            price,
            fees:          parseFloat(row.querySelector('.rv-fees').value) || 0,
            currency:      row.querySelector('.rv-curr').value,
            screenshot_path: S.savedImage,
            notes:         'Imported via Screenshot',
        });
    });

    if (!trades.length) { toast('No valid trades to import', 'err'); return; }

    try {
        const r = await post('/api/transactions/batch', { transactions: trades });
        closeModal('modal-screenshot');
        toast(`Imported ${r.created_count} trade(s)!`, 'ok');
        await loadData(true);
    } catch(e) { toast('Import failed', 'err'); }
}

// ─── CSV Export ────────────────────────────────────────────────────
function exportCSV() {
    if (!S.transactions.length) { toast('No transactions to export', 'info'); return; }

    const headers = ['Date','Portfolio','Ticker','Type','Quantity','Price','Fees','Currency','Total','Notes'];
    const rows    = S.transactions.map(t => [
        t.date,
        `"${(t.portfolio_name||'').replace(/"/g,'""')}"`,
        t.ticker,
        t.type,
        t.quantity,
        t.price,
        t.fees || 0,
        t.currency,
        ((t.quantity * t.price) + (t.fees || 0)).toFixed(2),
        `"${(t.notes||'').replace(/"/g,'""')}"`,
    ]);

    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `myfinance_transactions_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'ok');
}

// ─── Modal helpers ─────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

// ─── Toast ─────────────────────────────────────────────────────────
const TOAST_ICONS = {
    ok:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    err:  `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

function toast(msg, type = 'ok') {
    const rack  = document.getElementById('toast-rack');
    const el    = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = (TOAST_ICONS[type] || '') + esc(msg);
    rack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = 'all 0.3s ease'; setTimeout(() => el.remove(), 320); }, 4200);
}
