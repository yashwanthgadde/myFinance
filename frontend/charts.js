/**
 * myFinance Charts — Chart.js wrappers
 * Handles performance line chart and allocation donut.
 */

let perfChart = null;
let allocChart = null;

const PALETTE = ['#00d68f','#4c8dff','#a78bfa','#fbbf24','#fb7185','#22d3ee','#f97316','#84cc16'];

function theme() {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        dark,
        text:      dark ? '#8b9bbf' : '#445070',
        grid:      dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
        tooltip:   { bg: dark ? '#1a2540' : '#ffffff', title: dark ? '#f0f4ff' : '#0d1526', body: dark ? '#8b9bbf' : '#445070', border: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }
    };
}

/** Renders or refreshes the main performance chart */
function renderPerfChart(labels, portfolioSeries, benchSeries, benchLabel) {
    const canvas = document.getElementById('perf-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const t = theme();

    if (perfChart) { perfChart.destroy(); perfChart = null; }

    // Gradient fill under portfolio line
    const grad = ctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, t.dark ? 'rgba(0,214,143,0.22)' : 'rgba(0,163,114,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    const datasets = [
        {
            label: 'Portfolio (%)',
            data: portfolioSeries,
            borderColor: t.dark ? '#00d68f' : '#00a372',
            backgroundColor: grad,
            borderWidth: 2.2,
            fill: true,
            tension: 0.38,
            pointRadius: labels.length > 60 ? 0 : 3,
            pointHoverRadius: 5,
            pointBackgroundColor: t.dark ? '#00d68f' : '#00a372',
        }
    ];

    if (benchSeries && benchSeries.length > 0) {
        datasets.push({
            label: (benchLabel || 'Benchmark') + ' (%)',
            data: benchSeries,
            borderColor: t.dark ? '#4d5e80' : '#94a3b8',
            borderWidth: 1.6,
            borderDash: [5, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
        });
    }

    perfChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: t.text, font: { family: 'Inter', size: 11, weight: '500' }, boxWidth: 12, usePointStyle: true }
                },
                tooltip: {
                    backgroundColor: t.tooltip.bg,
                    titleColor: t.tooltip.title,
                    bodyColor: t.tooltip.body,
                    borderColor: t.tooltip.border,
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            const sign = v >= 0 ? '+' : '';
                            return ` ${ctx.dataset.label}: ${sign}${v.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: t.grid },
                    ticks: { color: t.text, font: { family: 'Inter', size: 10 }, maxTicksLimit: 9 }
                },
                y: {
                    grid: { color: t.grid },
                    ticks: {
                        color: t.text,
                        font: { family: 'JetBrains Mono', size: 10 },
                        callback: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
                    }
                }
            }
        }
    });
}

/** Renders or refreshes allocation donut */
function renderAllocChart(items) {
    const canvas = document.getElementById('alloc-chart');
    const legend = document.getElementById('alloc-legend');
    if (!canvas) return;
    const t = theme();

    if (allocChart) { allocChart.destroy(); allocChart = null; }

    if (!items || items.length === 0) {
        items = [{ name: 'No data', value: 1, percentage: 100 }];
    }

    const colors = items.map((_, i) => PALETTE[i % PALETTE.length]);

    allocChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: items.map(i => i.name),
            datasets: [{
                data: items.map(i => i.value),
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: t.dark ? '#141e30' : '#ffffff',
                hoverOffset: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: t.tooltip.bg,
                    titleColor: t.tooltip.title,
                    bodyColor: t.tooltip.body,
                    callbacks: {
                        label: ctx => {
                            const item = items[ctx.dataIndex];
                            return ` ${item.name}: ${item.percentage}%`;
                        }
                    }
                }
            }
        }
    });

    if (legend) {
        legend.innerHTML = items.map((item, i) => `
            <div class="alloc-row">
                <div class="alloc-left">
                    <span class="alloc-dot" style="background:${colors[i]}"></span>
                    <span>${item.name}</span>
                </div>
                <span class="alloc-pct">${item.percentage}%</span>
            </div>
        `).join('');
    }
}
