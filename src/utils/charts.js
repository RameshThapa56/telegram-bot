// Builds chart IMAGE URLs via QuickChart (https://quickchart.io) — a free,
// keyless charting API: you GET a URL with a Chart.js config baked into the
// query string and it returns a PNG. No signup, no API key, no approval
// wait, and Telegram fetches the image itself when we hand it a URL (see
// ctx.replyWithPhoto below), so the bot never has to render or store images.
//
// Colors follow the shared categorical/sequential palette below (see the
// dataviz skill's references/palette.md) — fixed hue order for identity,
// one hue light→dark for magnitude, never a rainbow.

const QUICKCHART_BASE = 'https://quickchart.io/chart';

// Categorical slots 1–3 (blue, orange, aqua) — the only ordering of this
// palette that clears CVD/normal-vision separation for *every* pair at once,
// not just neighbors, so it's safe even though a pie chart puts every slice
// next to every other slice.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a'];
// Default sequential hue (single-series magnitude — e.g. units sold).
const SEQUENTIAL_BLUE = '#2a78d6';

const CHART_FONT = { family: "'Segoe UI', system-ui, -apple-system, sans-serif" };
const INK = '#0b0b0b';
const MUTED_INK = '#52514e';
const GRIDLINE = '#e1e0d9';

function buildChartUrl(chartJsConfig, { width = 500, height = 300 } = {}) {
  const params = new URLSearchParams({
    c: JSON.stringify(chartJsConfig),
    width: String(width),
    height: String(height),
    backgroundColor: 'white', // avoids a transparent PNG looking broken on dark-theme chat clients
    version: '3', // Chart.js 3 — nicer defaults (rounded bars, better doughnut spacing)
    format: 'png',
  });
  return `${QUICKCHART_BASE}?${params.toString()}`;
}

/**
 * Orders-by-status breakdown. A donut (not a full pie) reads as "share of a
 * whole" just as well and leaves room in the middle for the total; counts
 * are baked directly into the legend labels since color alone is never
 * enough to carry identity for 3 slices sitting side by side.
 */
function pieChartUrl(title, labels, data) {
  const labelsWithCounts = labels.map((label, i) => `${label} (${data[i]})`);

  return buildChartUrl({
    type: 'doughnut',
    data: {
      labels: labelsWithCounts,
      datasets: [
        {
          data,
          backgroundColor: CATEGORICAL.slice(0, labels.length),
          borderColor: '#ffffff',
          borderWidth: 2, // surface gap between adjacent slices
        },
      ],
    },
    options: {
      cutout: '55%',
      plugins: {
        title: { display: true, text: title, color: INK, font: { ...CHART_FONT, size: 16, weight: 'bold' } },
        legend: { position: 'right', labels: { color: MUTED_INK, font: CHART_FONT, padding: 14 } },
        // QuickChart's `c=` config is serialized JSON, so a JS formatter
        // function can't survive the trip — this deliberately leaves
        // datalabels at its default (the raw count), which is enough since
        // the legend already carries the same count per slice.
        datalabels: {
          color: '#ffffff',
          font: { ...CHART_FONT, weight: 'bold' },
        },
      },
    },
  });
}

/**
 * Top items by units sold. A single-series magnitude comparison — one hue,
 * sorted descending (callers already sort), with the value written directly
 * on each bar so the reader isn't stuck estimating against gridlines.
 */
function barChartUrl(title, labels, data, axisLabel) {
  return buildChartUrl(
    {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: axisLabel,
            data,
            backgroundColor: SEQUENTIAL_BLUE,
            borderRadius: 4,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: {
          title: { display: true, text: title, color: INK, font: { ...CHART_FONT, size: 16, weight: 'bold' } },
          legend: { display: false },
          datalabels: {
            color: MUTED_INK,
            anchor: 'end',
            align: 'right',
            font: CHART_FONT,
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: GRIDLINE },
            ticks: { color: MUTED_INK, font: CHART_FONT, precision: 0 },
          },
          y: {
            grid: { display: false },
            ticks: { color: MUTED_INK, font: CHART_FONT },
          },
        },
      },
    },
    { height: Math.max(220, 70 + labels.length * 45) }
  );
}

module.exports = { pieChartUrl, barChartUrl };
