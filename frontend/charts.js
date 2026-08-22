/**
 * myFinance Charts — Chart.js wrappers
 * Performance chart: % return (left axis) + Market Value in currency (right axis)
 * Allocation: donut chart
 */

let perfChart = null;
let allocChart = null;

const PALETTE = ['#00d68f','#4c8dff','#a78bfa','#fbbf24','#fb7185','#22d3ee','#f97316','#84cc16'];

function theme() {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        dark,
        text:    dark ? '#8b9bbf' : '#445070',
        grid:    dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
        tooltip: {
            bg:     dark ? '#1a2540' : '#ffffff',
            title:  dark ? '#f0f4ff' : '#0d1526',
            body:   dark ? '#8b9bbf' : '#445070',
            border: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
        }
    };
}

/**
 * Renders the performance chart — shows portfolio market value in currency.
 * @param {string[]} labels
 * @param {number[]} valueSeries  — absolute market value (₹ / $ / €)
 * @param {string}   currencySymbol
 */
function renderPerfChart(labels, valueSeries, currencySymbol) {
    const canvas = document.getElementById('perf-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const t   = theme();
    const cs  = currencySymbol || '₹';

    if (perfChart) { perfChart.destroy(); perfChart = null; }

    // Blue gradient fill under the value curve
    const grad = ctx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, t.dark ? 'rgba(76,141,255,0.28)' : 'rgba(37,99,235,0.14)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    perfChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `Portfolio Value (${cs})`,
                data:  valueSeries,
                borderColor:       t.dark ? '#4c8dff' : '#2563eb',
                backgroundColor:   grad,
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: labels.length > 60 ? 0 : 3,
                pointHoverRadius: 6,
                pointBackgroundColor: t.dark ? '#4c8dff' : '#2563eb',
                pointBorderColor: t.dark ? '#0f1623' : '#fff',
                pointBorderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: t.text,
                        font: { family: 'Inter', size: 11, weight: '600' },
                        boxWidth: 12,
                        usePointStyle: true,
                    }
                },
                tooltip: {
                    backgroundColor: t.tooltip.bg,
                    titleColor:      t.tooltip.title,
                    bodyColor:       t.tooltip.body,
                    borderColor:     t.tooltip.border,
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            return ` ${cs}${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: t.grid },
                    ticks: {
                        color: t.text,
                        font: { family: 'Inter', size: 10 },
                        maxTicksLimit: 9
                    }
                },
                y: {
                    position: 'left',
                    grid: { color: t.grid },
                    ticks: {
                        color: t.dark ? '#4c8dff' : '#2563eb',
                        font: { family: 'JetBrains Mono', size: 10 },
                        callback: v => {
                            if (v >= 10000000) return cs + (v / 10000000).toFixed(1) + 'Cr';
                            if (v >= 100000)   return cs + (v / 100000).toFixed(1) + 'L';
                            if (v >= 1000)     return cs + (v / 1000).toFixed(1) + 'K';
                            return cs + v.toFixed(0);
                        }
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
                    bodyColor:  t.tooltip.body,
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
