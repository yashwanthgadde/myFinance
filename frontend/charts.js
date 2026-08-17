/**
 * myFinance Charts Engine (Powered by Chart.js)
 */

let performanceChartInstance = null;
let allocationChartInstance = null;

const CHART_COLORS = [
    '#10b981', // Emerald Green
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#f43f5e', // Rose
    '#84cc16'  // Lime
];

function getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        isDark,
        textColor: isDark ? '#94a3b8' : '#475569',
        gridColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)',
        lineColor: '#10b981',
        benchmarkColor: isDark ? '#64748b' : '#94a3b8',
        gradientStart: isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)',
        gradientEnd: 'rgba(16, 185, 129, 0.0)'
    };
}

/**
 * Initializes or updates the main Portfolio Performance line chart
 */
function renderPerformanceChart(labels, portfolioData, benchmarkData = [], benchmarkLabel = 'S&P 500') {
    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;

    const theme = getThemeColors();

    if (performanceChartInstance) {
        performanceChartInstance.destroy();
    }

    // Gradient background for portfolio line
    const chartCtx = ctx.getContext('2d');
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, theme.gradientStart);
    gradient.addColorStop(1, theme.gradientEnd);

    const datasets = [
        {
            label: 'Portfolio Return (%)',
            data: portfolioData,
            borderColor: theme.lineColor,
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: labels.length > 30 ? 0 : 3,
            pointHoverRadius: 5,
            pointBackgroundColor: theme.lineColor,
        }
    ];

    if (benchmarkData && benchmarkData.length > 0) {
        datasets.push({
            label: benchmarkLabel + ' (%)',
            data: benchmarkData,
            borderColor: theme.benchmarkColor,
            borderWidth: 1.8,
            borderDash: [4, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
        });
    }

    performanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: theme.textColor,
                        font: { family: 'Inter', size: 11, weight: '500' },
                        boxWidth: 12,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: theme.isDark ? '#1e293b' : '#ffffff',
                    titleColor: theme.isDark ? '#f8fafc' : '#0f172a',
                    bodyColor: theme.isDark ? '#cbd5e1' : '#334155',
                    borderColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            let val = context.parsed.y;
                            let sign = val >= 0 ? '+' : '';
                            return ` ${label}: ${sign}${val.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: theme.gridColor },
                    ticks: {
                        color: theme.textColor,
                        font: { family: 'Inter', size: 10 },
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: { color: theme.gridColor },
                    ticks: {
                        color: theme.textColor,
                        font: { family: 'JetBrains Mono', size: 10 },
                        callback: function(value) {
                            return (value >= 0 ? '+' : '') + value + '%';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Initializes or updates the Asset Allocation Donut chart
 */
function renderAllocationChart(allocations) {
    const ctx = document.getElementById('allocationChart');
    const legendContainer = document.getElementById('allocation-legend-list');
    if (!ctx) return;

    const theme = getThemeColors();

    if (allocationChartInstance) {
        allocationChartInstance.destroy();
    }

    if (!allocations || allocations.length === 0) {
        // Render empty dummy state
        allocations = [{ name: 'No Assets', value: 1, percentage: 100 }];
    }

    const labels = allocations.map(a => a.name);
    const dataValues = allocations.map(a => a.value);
    const bgColors = allocations.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    allocationChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: theme.isDark ? '#151d2f' : '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: theme.isDark ? '#1e293b' : '#ffffff',
                    titleColor: theme.isDark ? '#f8fafc' : '#0f172a',
                    bodyColor: theme.isDark ? '#cbd5e1' : '#334155',
                    callbacks: {
                        label: function(context) {
                            const item = allocations[context.dataIndex];
                            return ` ${item.name}: ${item.percentage}% ($${Number(item.value).toLocaleString()})`;
                        }
                    }
                }
            }
        }
    });

    // Populate custom HTML legend
    if (legendContainer) {
        legendContainer.innerHTML = allocations.map((item, idx) => `
            <div class="alloc-item">
                <div class="alloc-tag">
                    <span class="alloc-dot" style="background: ${bgColors[idx]}"></span>
                    <span>${item.name}</span>
                </div>
                <div class="alloc-pct">${item.percentage}%</div>
            </div>
        `).join('');
    }
}
