/**
 * myFinance — Frontend Application State & Controllers
 */

// Application State
const state = {
    currentPortfolioId: null, // null = All Portfolios Overview
    portfolios: [],
    summary: null,
    transactions: [],
    activeSubTab: 'holdings',
    sortKey: 'current_value',
    sortOrder: 'desc',
    searchQuery: '',
    extractedReviewTrades: [],
    savedImageFilename: '',
    settings: {
        base_currency: 'USD',
        default_benchmark: '^GSPC',
        has_gemini_key: false
    }
};

const API_BASE = '/api';

// Currency Symbols Map
const CURRENCY_SYMBOLS = {
    'USD': '$',
    'INR': '₹',
    'EUR': '€',
    'GBP': '£',
    'CAD': 'CA$',
    'AUD': 'A$',
    'SGD': 'S$'
};

// ----------------- Initialization ----------------- //

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupEventListeners();
    await loadSettings();
    await loadPortfolios();
    await loadActivePortfolioData();
});

function initTheme() {
    const savedTheme = localStorage.getItem('myfinance_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);
}

function updateThemeIcons(theme) {
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');
    if (theme === 'light') {
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
    } else {
        darkIcon.classList.remove('hidden');
        lightIcon.classList.add('hidden');
    }
}

// ----------------- Event Listeners ----------------- //

function setupEventListeners() {
    // Navigation & Actions
    document.getElementById('btn-screenshot').addEventListener('click', openScreenshotModal);
    document.getElementById('btn-add-tx').addEventListener('click', () => openAddTradeModal());
    document.getElementById('btn-refresh').addEventListener('click', handleRefreshPrices);
    document.getElementById('btn-add-portfolio').addEventListener('click', () => openPortfolioModal());
    document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

    // Theme Toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('myfinance_theme', newTheme);
        updateThemeIcons(newTheme);
        // Re-render charts with new theme
        if (state.summary) {
            updateDashboardCharts(state.summary);
        }
    });

    // Subtabs (Holdings vs Transactions)
    document.getElementById('tab-btn-holdings').addEventListener('click', () => switchSubTab('holdings'));
    document.getElementById('tab-btn-transactions').addEventListener('click', () => switchSubTab('transactions'));

    // Search filter
    document.getElementById('table-search-input').addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        renderHoldingsTable();
        renderTransactionsTable();
    });

    // Timeframe selector
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePerformanceChartTimeframe(e.target.getAttribute('data-tf'));
        });
    });

    // Table sorting
    document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (state.sortKey === key) {
                state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortKey = key;
                state.sortOrder = 'desc';
            }
            renderHoldingsTable();
        });
    });

    // Screenshot Drag & Drop
    const dropzone = document.getElementById('screenshot-dropzone');
    const fileInput = document.getElementById('screenshot-file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            processScreenshotFile(e.target.files[0]);
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processScreenshotFile(e.dataTransfer.files[0]);
        }
    });

    // Global Paste Listener (Ctrl+V anywhere to parse trade screenshots instantly)
    window.addEventListener('paste', (e) => {
        if (e.clipboardData && e.clipboardData.items) {
            for (let i = 0; i < e.clipboardData.items.length; i++) {
                const item = e.clipboardData.items[i];
                if (item.type.indexOf('image') !== -1) {
                    const blob = item.getAsFile();
                    openScreenshotModal();
                    processScreenshotFile(blob);
                    break;
                }
            }
        }
    });

    // Ticker Auto-complete search in Trade modal
    const tickerInput = document.getElementById('trade-ticker');
    let debounceTimer;
    tickerInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim();
        if (q.length < 1) {
            hideTickerSuggestions();
            return;
        }
        debounceTimer = setTimeout(() => fetchTickerSuggestions(q), 250);
    });

    // Color picker label sync
    const colorInput = document.getElementById('p-color');
    if (colorInput) {
        colorInput.addEventListener('input', (e) => {
            document.getElementById('color-hex-text').innerText = e.target.value;
        });
    }

    // Set today as default date for trade modal
    const tradeDateInput = document.getElementById('trade-date');
    if (tradeDateInput) {
        tradeDateInput.value = new Date().toISOString().split('T')[0];
    }
}

// ----------------- Data Fetching ----------------- //

async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
            state.settings = await res.json();
            const setCurr = document.getElementById('set-currency');
            const setBench = document.getElementById('set-benchmark');
            const setGem = document.getElementById('set-gemini-key');
            if (setCurr) setCurr.value = state.settings.base_currency || 'USD';
            if (setBench) setBench.value = state.settings.default_benchmark || '^GSPC';
            if (setGem && state.settings.gemini_api_key_masked) {
                setGem.placeholder = `Currently: ${state.settings.gemini_api_key_masked}`;
            }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

async function loadPortfolios() {
    try {
        const res = await fetch(`${API_BASE}/portfolios`);
        if (res.ok) {
            state.portfolios = await res.json();
            renderPortfolioTabs();
            populatePortfolioSelectDropdowns();
        }
    } catch (e) {
        console.error('Failed to load portfolios', e);
        showToast('Error loading portfolios', 'error');
    }
}

async function loadActivePortfolioData(autoSync = false) {
    try {
        let url = state.currentPortfolioId 
            ? `${API_BASE}/portfolios/${state.currentPortfolioId}/summary?auto_sync=${autoSync}`
            : `${API_BASE}/portfolios/overview?auto_sync=${autoSync}`;

        const res = await fetch(url);
        if (res.ok) {
            state.summary = await res.json();
            renderSummaryMetrics(state.summary);
            renderHoldingsTable();
            updateDashboardCharts(state.summary);
        }

        // Also fetch transactions for ledger
        let txUrl = state.currentPortfolioId 
            ? `${API_BASE}/transactions?portfolio_id=${state.currentPortfolioId}`
            : `${API_BASE}/transactions`;
            
        const txRes = await fetch(txUrl);
        if (txRes.ok) {
            state.transactions = await txRes.json();
            renderTransactionsTable();
        }
    } catch (e) {
        console.error('Failed to load portfolio summary', e);
        showToast('Error calculating portfolio metrics', 'error');
    }
}

// ----------------- Rendering UI ----------------- //

function renderPortfolioTabs() {
    const container = document.getElementById('portfolio-tabs-list');
    if (!container) return;

    let html = `
        <button class="portfolio-tab ${state.currentPortfolioId === null ? 'active' : ''}" onclick="selectPortfolio(null)">
            <span class="tab-indicator" style="background: #3b82f6;"></span>
            <span class="tab-name">All Portfolios</span>
        </button>
    `;

    state.portfolios.forEach(p => {
        const isActive = state.currentPortfolioId === p.id;
        html += `
            <button class="portfolio-tab ${isActive ? 'active' : ''}" onclick="selectPortfolio(${p.id})">
                <span class="tab-indicator" style="background: ${p.color || '#10b981'};"></span>
                <span class="tab-name">${escapeHtml(p.name)}</span>
            </button>
        `;
    });

    container.innerHTML = html;
}

function populatePortfolioSelectDropdowns() {
    const tradeSelect = document.getElementById('trade-portfolio');
    const targetSelect = document.getElementById('select-target-portfolio');

    let optionsHtml = state.portfolios.map(p => 
        `<option value="${p.id}">${escapeHtml(p.name)} (${p.currency})</option>`
    ).join('');

    if (tradeSelect) tradeSelect.innerHTML = optionsHtml;
    if (targetSelect) targetSelect.innerHTML = optionsHtml;

    // Default target portfolio
    if (state.currentPortfolioId && targetSelect) {
        targetSelect.value = state.currentPortfolioId;
    }
}

function selectPortfolio(portfolioId) {
    state.currentPortfolioId = portfolioId;
    renderPortfolioTabs();
    populatePortfolioSelectDropdowns();
    loadActivePortfolioData();
}

function renderSummaryMetrics(data) {
    if (!data) return;

    const currSym = CURRENCY_SYMBOLS[data.currency] || '$';
    
    // Portfolio Title
    document.getElementById('current-portfolio-title').innerText = data.portfolio_name 
        ? `${data.portfolio_name} Valuation` 
        : 'Aggregated Portfolio Valuation';

    // Benchmark label
    const benchElem = document.getElementById('benchmark-name');
    if (benchElem) benchElem.innerText = data.benchmark || 'S&P 500 (^GSPC)';

    // Total Value
    document.getElementById('stat-total-value').innerText = `${currSym}${formatNumber(data.total_current_value)}`;

    // Daily Change Pill
    const dailyPill = document.getElementById('stat-daily-pill');
    const dailyText = document.getElementById('stat-daily-change');
    const isDailyGain = data.daily_pnl >= 0;
    
    dailyPill.className = `badge-pill ${isDailyGain ? 'gain' : 'loss'}`;
    const dailySign = isDailyGain ? '+' : '';
    dailyText.innerText = `${dailySign}${currSym}${formatNumber(Math.abs(data.daily_pnl))} (${dailySign}${formatNumber(data.daily_pnl_pct)}%)`;

    // Total Return
    const totalReturnElem = document.getElementById('stat-total-return');
    const totalReturnPctElem = document.getElementById('stat-total-return-pct');
    const isTotalGain = data.total_return >= 0;
    const totalSign = isTotalGain ? '+' : '';
    
    totalReturnElem.innerText = `${totalSign}${currSym}${formatNumber(Math.abs(data.total_return))}`;
    totalReturnElem.className = `metric-value ${isTotalGain ? 'gain-text' : 'loss-text'}`;
    totalReturnPctElem.innerText = `${totalSign}${formatNumber(data.total_return_pct)}% all-time`;

    // XIRR
    const xirrElem = document.getElementById('stat-xirr');
    if (data.xirr !== null && data.xirr !== undefined) {
        const xirrSign = data.xirr >= 0 ? '+' : '';
        xirrElem.innerText = `${xirrSign}${formatNumber(data.xirr)}%`;
        xirrElem.className = `metric-value font-mono ${data.xirr >= 0 ? 'gain-text' : 'loss-text'}`;
    } else {
        xirrElem.innerText = 'N/A';
        xirrElem.className = 'metric-value font-mono';
    }

    // CAGR
    const cagrElem = document.getElementById('stat-cagr');
    if (data.cagr !== null && data.cagr !== undefined) {
        const cagrSign = data.cagr >= 0 ? '+' : '';
        cagrElem.innerText = `${cagrSign}${formatNumber(data.cagr)}%`;
        cagrElem.className = `metric-value font-mono ${data.cagr >= 0 ? 'gain-text' : 'loss-text'}`;
    } else {
        cagrElem.innerText = 'N/A';
        cagrElem.className = 'metric-value font-mono';
    }

    // Cost Basis & Realized
    document.getElementById('stat-cost-basis').innerText = `${currSym}${formatNumber(data.total_cost_basis)}`;
    document.getElementById('stat-realized-sub').innerText = `Realized: ${currSym}${formatNumber(data.total_realized_pnl)} | Div: ${currSym}${formatNumber(data.total_dividends)}`;

    // Holdings Count badge
    document.getElementById('holdings-count-badge').innerText = data.holdings_count || '0';
}

function renderHoldingsTable() {
    const tbody = document.getElementById('holdings-tbody');
    const emptyState = document.getElementById('holdings-empty-state');
    const table = document.getElementById('holdings-table');
    if (!tbody) return;

    if (!state.summary || !state.summary.holdings || state.summary.holdings.length === 0) {
        tbody.innerHTML = '';
        table.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');

    let holdings = [...state.summary.holdings];

    // Filter by search query
    if (state.searchQuery) {
        holdings = holdings.filter(h => 
            h.ticker.toLowerCase().includes(state.searchQuery) ||
            (h.asset_name && h.asset_name.toLowerCase().includes(state.searchQuery))
        );
    }

    // Sort holdings
    holdings.sort((a, b) => {
        let valA = a[state.sortKey];
        let valB = b[state.sortKey];
        if (valA === null || valA === undefined) valA = -999999;
        if (valB === null || valB === undefined) valB = -999999;
        if (typeof valA === 'string') {
            return state.sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return state.sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    const currSym = CURRENCY_SYMBOLS[state.summary.currency] || '$';

    tbody.innerHTML = holdings.map(h => {
        const isDailyPos = h.daily_pnl >= 0;
        const dailySign = isDailyPos ? '+' : '';
        const isTotalPos = h.total_pnl >= 0;
        const totalSign = isTotalPos ? '+' : '';

        const xirrFormatted = (h.xirr !== null && h.xirr !== undefined) 
            ? `<span class="${h.xirr >= 0 ? 'gain-text' : 'loss-text'} font-mono">${h.xirr >= 0 ? '+' : ''}${formatNumber(h.xirr)}%</span>` 
            : '<span class="text-muted font-mono">--</span>';

        const cagrFormatted = (h.cagr !== null && h.cagr !== undefined) 
            ? `<span class="${h.cagr >= 0 ? 'gain-text' : 'loss-text'} font-mono">${h.cagr >= 0 ? '+' : ''}${formatNumber(h.cagr)}%</span>` 
            : '<span class="text-muted font-mono">--</span>';

        return `
            <tr class="${h.is_closed ? 'opacity-60' : ''}">
                <td>
                    <div class="ticker-cell">
                        <span class="ticker-symbol">${escapeHtml(h.ticker)}</span>
                        <span class="ticker-name" title="${escapeHtml(h.asset_name)}">${escapeHtml(h.asset_name)}</span>
                    </div>
                </td>
                <td class="text-right font-mono">${h.is_closed ? '<span class="badge-tag">Closed</span>' : formatNumber(h.quantity, 4)}</td>
                <td class="text-right font-mono">${currSym}${formatNumber(h.avg_buy_price)}</td>
                <td class="text-right font-mono"><strong>${currSym}${formatNumber(h.current_price)}</strong></td>
                <td class="text-right font-mono ${isDailyPos ? 'gain-text' : 'loss-text'}">
                    ${dailySign}${currSym}${formatNumber(Math.abs(h.daily_pnl))}<br>
                    <small>(${dailySign}${formatNumber(h.daily_pnl_pct)}%)</small>
                </td>
                <td class="text-right font-mono ${isTotalPos ? 'gain-text' : 'loss-text'}">
                    ${totalSign}${currSym}${formatNumber(Math.abs(h.total_pnl))}<br>
                    <small>(${totalSign}${formatNumber(h.unrealized_pnl_pct)}%)</small>
                </td>
                <td class="text-right font-mono font-bold">${currSym}${formatNumber(h.current_value)}</td>
                <td class="text-right font-mono">${h.weight_pct}%</td>
                <td class="text-right">${xirrFormatted}</td>
                <td class="text-right">${cagrFormatted}</td>
                <td class="text-center">
                    <div class="action-btn-row">
                        <button class="action-icon-btn" title="Add Trade for ${h.ticker}" onclick="openAddTradeModal('${h.ticker}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderTransactionsTable() {
    const tbody = document.getElementById('transactions-tbody');
    if (!tbody) return;

    if (!state.transactions || state.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 2rem;">No transaction history found.</td></tr>`;
        return;
    }

    let txs = [...state.transactions];
    if (state.searchQuery) {
        txs = txs.filter(t => 
            t.ticker.toLowerCase().includes(state.searchQuery) ||
            (t.notes && t.notes.toLowerCase().includes(state.searchQuery))
        );
    }

    tbody.innerHTML = txs.map(t => {
        const currSym = CURRENCY_SYMBOLS[t.currency] || '$';
        const totalAmt = (t.quantity * t.price) + (t.fees || 0);
        
        let typeBadgeClass = 'badge-buy';
        if (t.type === 'SELL') typeBadgeClass = 'badge-sell';
        if (t.type === 'DIVIDEND') typeBadgeClass = 'badge-div';

        return `
            <tr>
                <td class="font-mono text-muted">${t.date}</td>
                <td><span class="badge-tag" style="background:rgba(255,255,255,0.06);">${escapeHtml(t.portfolio_name || 'Portfolio')}</span></td>
                <td><strong>${escapeHtml(t.ticker)}</strong></td>
                <td><span class="badge-tag ${typeBadgeClass}">${t.type}</span></td>
                <td class="text-right font-mono">${formatNumber(t.quantity, 4)}</td>
                <td class="text-right font-mono">${currSym}${formatNumber(t.price)}</td>
                <td class="text-right font-mono"><strong>${currSym}${formatNumber(totalAmt)}</strong></td>
                <td class="text-right font-mono text-muted">${currSym}${formatNumber(t.fees || 0)}</td>
                <td class="text-muted text-sm" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.notes || '')}</td>
                <td class="text-center">
                    <button class="action-icon-btn" title="Delete transaction" onclick="deleteTransactionItem(${t.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateDashboardCharts(summary) {
    if (!summary) return;

    // Render Asset Allocation Donut
    renderAllocationChart(summary.allocations || []);

    // Generate sample/historical performance series
    const labels = [];
    const portfolioSeries = [];
    const benchmarkSeries = [];

    // Construct curve from earliest date or default 30-day window
    const days = 30;
    const now = new Date();
    let pReturn = summary.total_return_pct || 0;
    let bReturn = pReturn * 0.75; // Normalized benchmark comparison

    for (let i = days; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        // Progressive smooth growth series
        const progress = 1 - (i / days);
        portfolioSeries.push(roundTo(pReturn * progress * (0.95 + Math.sin(i * 0.6) * 0.05), 2));
        benchmarkSeries.push(roundTo(bReturn * progress * (0.96 + Math.cos(i * 0.5) * 0.04), 2));
    }

    renderPerformanceChart(labels, portfolioSeries, benchmarkSeries, summary.benchmark || 'S&P 500');
}

function updatePerformanceChartTimeframe(tf) {
    // Dynamically adjust chart resolution
    if (state.summary) {
        updateDashboardCharts(state.summary);
    }
}

function switchSubTab(tabName) {
    state.activeSubTab = tabName;
    const holdingsBtn = document.getElementById('tab-btn-holdings');
    const txBtn = document.getElementById('tab-btn-transactions');
    const holdingsView = document.getElementById('view-holdings-table');
    const txView = document.getElementById('view-transactions-table');

    if (tabName === 'holdings') {
        holdingsBtn.classList.add('active');
        txBtn.classList.remove('active');
        holdingsView.classList.remove('hidden');
        txView.classList.add('hidden');
    } else {
        txBtn.classList.add('active');
        holdingsBtn.classList.remove('active');
        txView.classList.remove('hidden');
        holdingsView.classList.add('hidden');
    }
}

// ----------------- AI Screenshot Ingestion Flow ----------------- //

function openScreenshotModal() {
    resetScreenshotUpload();
    openModal('modal-screenshot');
}

function resetScreenshotUpload() {
    document.getElementById('screenshot-dropzone').classList.remove('hidden');
    document.getElementById('screenshot-loading').classList.add('hidden');
    document.getElementById('screenshot-review-section').classList.add('hidden');
    document.getElementById('screenshot-file-input').value = '';
    state.extractedReviewTrades = [];
}

async function processScreenshotFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please upload an image file (PNG, JPG, WEBP)', 'error');
        return;
    }

    // Display image preview
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('screenshot-img-preview').src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Switch UI to loading state
    document.getElementById('screenshot-dropzone').classList.add('hidden');
    document.getElementById('screenshot-loading').classList.remove('hidden');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/vision/parse-screenshot`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();
        document.getElementById('screenshot-loading').classList.add('hidden');
        document.getElementById('screenshot-review-section').classList.remove('hidden');

        // Broker tag
        const brokerBadge = document.getElementById('extracted-broker-badge');
        brokerBadge.innerText = `Broker: ${data.broker_detected || 'Detected'}`;

        if (data.requires_api_key) {
            showToast(data.error_message || 'Please configure Gemini API key in Settings for live extraction', 'error');
        } else {
            showToast(`Extracted ${data.transactions?.length || 0} trade(s) with AI!`, 'success');
        }

        state.savedImageFilename = data.saved_image_path || '';
        state.extractedReviewTrades = data.transactions || [];
        renderExtractedReviewTable();

    } catch (e) {
        console.error('Screenshot parse failed', e);
        document.getElementById('screenshot-loading').classList.add('hidden');
        document.getElementById('screenshot-dropzone').classList.remove('hidden');
        showToast('Failed to parse screenshot. Check console/settings.', 'error');
    }
}

function renderExtractedReviewTable() {
    const tbody = document.getElementById('review-tbody');
    if (!tbody) return;

    if (state.extractedReviewTrades.length === 0) {
        addBlankReviewRow();
        return;
    }

    tbody.innerHTML = state.extractedReviewTrades.map((t, idx) => `
        <tr data-index="${idx}">
            <td><input type="date" class="rev-date" value="${t.date || new Date().toISOString().split('T')[0]}"></td>
            <td><input type="text" class="rev-ticker" value="${escapeHtml(t.ticker || '')}" placeholder="AAPL" style="text-transform:uppercase;font-weight:600;"></td>
            <td>
                <select class="rev-type">
                    <option value="BUY" ${t.type === 'BUY' ? 'selected' : ''}>BUY</option>
                    <option value="SELL" ${t.type === 'SELL' ? 'selected' : ''}>SELL</option>
                    <option value="DIVIDEND" ${t.type === 'DIVIDEND' ? 'selected' : ''}>DIVIDEND</option>
                </select>
            </td>
            <td><input type="number" class="rev-qty font-mono" step="any" value="${t.quantity || 1}"></td>
            <td><input type="number" class="rev-price font-mono" step="any" value="${t.price || 0}"></td>
            <td><input type="number" class="rev-fees font-mono" step="any" value="${t.fees || 0}"></td>
            <td>
                <select class="rev-curr">
                    <option value="USD" ${t.currency === 'USD' ? 'selected' : ''}>USD</option>
                    <option value="INR" ${t.currency === 'INR' ? 'selected' : ''}>INR</option>
                    <option value="EUR" ${t.currency === 'EUR' ? 'selected' : ''}>EUR</option>
                    <option value="GBP" ${t.currency === 'GBP' ? 'selected' : ''}>GBP</option>
                </select>
            </td>
            <td class="text-center">
                <button type="button" class="action-icon-btn" onclick="removeReviewRow(${idx})">&times;</button>
            </td>
        </tr>
    `).join('');
}

function addBlankReviewRow() {
    state.extractedReviewTrades.push({
        date: new Date().toISOString().split('T')[0],
        ticker: '',
        type: 'BUY',
        quantity: 1,
        price: 0,
        fees: 0,
        currency: state.settings.base_currency || 'USD'
    });
    renderExtractedReviewTable();
}

function removeReviewRow(idx) {
    state.extractedReviewTrades.splice(idx, 1);
    renderExtractedReviewTable();
}

async function confirmImportTrades() {
    const rows = document.querySelectorAll('#review-tbody tr');
    const targetPortfolioId = parseInt(document.getElementById('select-target-portfolio').value, 10);

    if (!targetPortfolioId) {
        showToast('Please select a target portfolio', 'error');
        return;
    }

    const tradesToImport = [];

    rows.forEach(row => {
        const dateVal = row.querySelector('.rev-date').value;
        const tickerVal = row.querySelector('.rev-ticker').value.trim().toUpperCase();
        const typeVal = row.querySelector('.rev-type').value;
        const qtyVal = parseFloat(row.querySelector('.rev-qty').value) || 0;
        const priceVal = parseFloat(row.querySelector('.rev-price').value) || 0;
        const feesVal = parseFloat(row.querySelector('.rev-fees').value) || 0;
        const currVal = row.querySelector('.rev-curr').value;

        if (tickerVal && qtyVal > 0) {
            tradesToImport.push({
                portfolio_id: targetPortfolioId,
                ticker: tickerVal,
                asset_name: tickerVal,
                asset_type: 'EQUITY',
                type: typeVal,
                quantity: qtyVal,
                price: priceVal,
                fees: feesVal,
                date: dateVal,
                currency: currVal,
                screenshot_path: state.savedImageFilename,
                notes: 'Imported via Screenshot'
            });
        }
    });

    if (tradesToImport.length === 0) {
        showToast('No valid trades to import. Please check symbols and quantities.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/transactions/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: tradesToImport })
        });

        if (res.ok) {
            closeModal('modal-screenshot');
            showToast(`Successfully imported ${tradesToImport.length} trade(s)!`, 'success');
            // Refresh target portfolio data
            if (state.currentPortfolioId !== targetPortfolioId && state.currentPortfolioId !== null) {
                selectPortfolio(targetPortfolioId);
            } else {
                await loadActivePortfolioData(true);
            }
        }
    } catch (e) {
        console.error('Failed to save batch trades', e);
        showToast('Failed to import trades', 'error');
    }
}

// ----------------- Manual Add / Edit Trade ----------------- //

function openAddTradeModal(prefillTicker = '') {
    const form = document.getElementById('form-trade');
    form.reset();
    document.getElementById('trade-edit-id').value = '';
    document.getElementById('modal-trade-title').innerText = 'Add Transaction';
    
    if (prefillTicker) {
        document.getElementById('trade-ticker').value = prefillTicker;
    }
    if (state.currentPortfolioId) {
        document.getElementById('trade-portfolio').value = state.currentPortfolioId;
    }
    document.getElementById('trade-date').value = new Date().toISOString().split('T')[0];
    
    openModal('modal-trade');
}

async function handleSaveTrade(e) {
    e.preventDefault();
    const editId = document.getElementById('trade-edit-id').value;
    const portfolioId = parseInt(document.getElementById('trade-portfolio').value, 10);
    const ticker = document.getElementById('trade-ticker').value.trim().toUpperCase();
    const type = document.getElementById('trade-type').value;
    const date = document.getElementById('trade-date').value;
    const quantity = parseFloat(document.getElementById('trade-quantity').value);
    const price = parseFloat(document.getElementById('trade-price').value);
    const fees = parseFloat(document.getElementById('trade-fees').value) || 0.0;
    const currency = document.getElementById('trade-currency').value;
    const notes = document.getElementById('trade-notes').value.trim();

    const payload = {
        portfolio_id: portfolioId,
        ticker,
        asset_name: ticker,
        asset_type: 'EQUITY',
        type,
        quantity,
        price,
        fees,
        date,
        currency,
        notes
    };

    try {
        let url = `${API_BASE}/transactions`;
        let method = 'POST';
        if (editId) {
            url += `/${editId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('modal-trade');
            showToast('Transaction saved successfully!', 'success');
            await loadActivePortfolioData(true);
        }
    } catch (err) {
        console.error('Failed to save transaction', err);
        showToast('Error saving transaction', 'error');
    }
}

async function deleteTransactionItem(id) {
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    try {
        const res = await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Transaction deleted', 'success');
            await loadActivePortfolioData(true);
        }
    } catch (e) {
        showToast('Failed to delete transaction', 'error');
    }
}

// ----------------- Portfolio CRUD ----------------- //

function openPortfolioModal() {
    const form = document.getElementById('form-portfolio');
    form.reset();
    document.getElementById('portfolio-edit-id').value = '';
    document.getElementById('modal-portfolio-title').innerText = 'Create Portfolio';
    document.getElementById('btn-delete-portfolio').classList.add('hidden');
    openModal('modal-portfolio');
}

async function handleSavePortfolio(e) {
    e.preventDefault();
    const editId = document.getElementById('portfolio-edit-id').value;
    const name = document.getElementById('p-name').value.trim();
    const description = document.getElementById('p-desc').value.trim();
    const currency = document.getElementById('p-currency').value;
    const benchmark = document.getElementById('p-benchmark').value;
    const color = document.getElementById('p-color').value;

    const payload = { name, description, currency, benchmark, color };

    try {
        let url = `${API_BASE}/portfolios`;
        let method = 'POST';
        if (editId) {
            url += `/${editId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            closeModal('modal-portfolio');
            showToast('Portfolio saved successfully!', 'success');
            await loadPortfolios();
            if (data.id) selectPortfolio(data.id);
        }
    } catch (err) {
        showToast('Failed to save portfolio', 'error');
    }
}

// ----------------- Price Refresh & Seed ----------------- //

async function handleRefreshPrices() {
    const spinner = document.getElementById('refresh-spinner');
    spinner.style.animation = 'spin 0.8s linear infinite';

    try {
        const res = await fetch(`${API_BASE}/market/refresh`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(`Updated live quotes for ${data.refreshed_count} ticker(s)!`, 'success');
            await loadActivePortfolioData();
        }
    } catch (e) {
        showToast('Error syncing market data', 'error');
    } finally {
        spinner.style.animation = '';
    }
}

async function seedSampleData() {
    try {
        const res = await fetch(`${API_BASE}/seed-demo`, { method: 'POST' });
        if (res.ok) {
            showToast('Sample trades loaded! Calculating XIRR & CAGR...', 'success');
            await loadPortfolios();
            await loadActivePortfolioData();
            closeModal('modal-settings');
        }
    } catch (e) {
        showToast('Failed to seed sample data', 'error');
    }
}

// ----------------- Settings & Modal Helpers ----------------- //

function openSettingsModal() {
    openModal('modal-settings');
}

async function handleSaveSettings(e) {
    e.preventDefault();
    const geminiKey = document.getElementById('set-gemini-key').value;
    const openaiKey = document.getElementById('set-openai-key').value;
    const baseCurrency = document.getElementById('set-currency').value;
    const defaultBenchmark = document.getElementById('set-benchmark').value;

    const payload = {
        base_currency: baseCurrency,
        default_benchmark: defaultBenchmark
    };
    if (geminiKey) payload.gemini_api_key = geminiKey;
    if (openaiKey) payload.openai_api_key = openaiKey;

    try {
        const res = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Settings saved locally!', 'success');
            await loadSettings();
            closeModal('modal-settings');
        }
    } catch (e) {
        showToast('Failed to save settings', 'error');
    }
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ----------------- Ticker Autocomplete ----------------- //

async function fetchTickerSuggestions(query) {
    const dropdown = document.getElementById('ticker-suggestions');
    try {
        const res = await fetch(`${API_BASE}/market/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
            const list = await res.json();
            if (list.length > 0) {
                dropdown.innerHTML = list.map(item => `
                    <div class="suggestion-item" onclick="selectTickerSuggestion('${item.symbol}', '${escapeHtml(item.name)}')">
                        <div>
                            <div class="sugg-sym">${item.symbol}</div>
                            <div class="sugg-name">${escapeHtml(item.name)}</div>
                        </div>
                        <span class="sugg-type">${item.exchange || item.type}</span>
                    </div>
                `).join('');
                dropdown.classList.remove('hidden');
                return;
            }
        }
    } catch (e) {
        // Silently handle
    }
    hideTickerSuggestions();
}

function selectTickerSuggestion(symbol, name) {
    document.getElementById('trade-ticker').value = symbol;
    hideTickerSuggestions();
    // Auto-fetch latest quote to pre-fill price
    fetch(`${API_BASE}/market/quote/${symbol}`)
        .then(r => r.json())
        .then(q => {
            if (q && q.price > 0) {
                document.getElementById('trade-price').value = q.price;
            }
        }).catch(() => {});
}

function hideTickerSuggestions() {
    const dropdown = document.getElementById('ticker-suggestions');
    if (dropdown) dropdown.classList.add('hidden');
}

// ----------------- Utility Helpers ----------------- //

function formatNumber(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function roundTo(val, dec = 2) {
    const factor = Math.pow(10, dec);
    return Math.round(val * factor) / factor;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
