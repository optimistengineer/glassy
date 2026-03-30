const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'installs.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'assets', 'installs-chart.svg');

function generateSVG(history) {
  if (history.length === 0) return generateEmptySVG();

  const W = 720, H = 240;
  const pad = { top: 32, right: 24, bottom: 48, left: 56 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const maxTotal = Math.max(...history.map(d => d.total), 1);
  const yMax = Math.ceil(maxTotal / 10) * 10 || 10; // round up to nearest 10

  const toX = (i) => pad.left + (history.length === 1 ? chartW / 2 : (i / (history.length - 1)) * chartW);
  const toY = (v) => pad.top + chartH - (v / yMax) * chartH;

  // Colors
  const bg = '#0d1117';
  const gridColor = '#21262d';
  const textColor = '#8b949e';
  const vscodeLine = '#58a6ff';   // blue
  const openvsxLine = '#3fb950';  // green
  const totalLine = '#f0f6fc';    // white-ish
  const dotColor = '#f0f6fc';

  // Build line paths
  const makePath = (key) => history.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d[key]).toFixed(1)}`).join(' ');

  // Y-axis grid lines (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((yMax / 4) * i));
  const yGrid = yTicks.map(v => `
    <line x1="${pad.left}" y1="${toY(v)}" x2="${W - pad.right}" y2="${toY(v)}" stroke="${gridColor}" stroke-width="1"/>
    <text x="${pad.left - 8}" y="${toY(v) + 4}" fill="${textColor}" font-size="11" text-anchor="end" font-family="monospace">${v}</text>
  `).join('');

  // X-axis labels (show ~6 evenly spaced dates)
  const labelCount = Math.min(history.length, 6);
  const step = Math.max(1, Math.floor((history.length - 1) / (labelCount - 1)));
  const xLabels = [];
  for (let i = 0; i < history.length; i += step) {
    const d = history[i];
    const label = d.date.slice(5); // MM-DD
    xLabels.push(`<text x="${toX(i)}" y="${H - 8}" fill="${textColor}" font-size="10" text-anchor="middle" font-family="monospace">${label}</text>`);
  }
  // Always include the last point (if not already added)
  if (history.length > 1) {
    const last = history.length - 1;
    const lastAlreadyAdded = (last % step === 0);
    if (!lastAlreadyAdded) {
      xLabels.push(`<text x="${toX(last)}" y="${H - 8}" fill="${textColor}" font-size="10" text-anchor="middle" font-family="monospace">${history[last].date.slice(5)}</text>`);
    }
  }

  // Latest value labels at end of lines
  const latest = history[history.length - 1];
  const lastX = toX(history.length - 1);

  const endLabels = `
    <circle cx="${lastX}" cy="${toY(latest.total)}" r="3" fill="${totalLine}"/>
    <text x="${lastX + 6}" y="${toY(latest.total) + 4}" fill="${totalLine}" font-size="11" font-family="monospace" font-weight="bold">${latest.total}</text>
    <circle cx="${lastX}" cy="${toY(latest.vscode)}" r="2.5" fill="${vscodeLine}"/>
    <circle cx="${lastX}" cy="${toY(latest.openvsx)}" r="2.5" fill="${openvsxLine}"/>
  `;

  // Legend
  const legend = `
    <rect x="${pad.left}" y="8" width="10" height="3" rx="1" fill="${totalLine}"/>
    <text x="${pad.left + 14}" y="13" fill="${textColor}" font-size="10" font-family="monospace">Total</text>
    <rect x="${pad.left + 58}" y="8" width="10" height="3" rx="1" fill="${vscodeLine}"/>
    <text x="${pad.left + 72}" y="13" fill="${textColor}" font-size="10" font-family="monospace">VS Code</text>
    <rect x="${pad.left + 130}" y="8" width="10" height="3" rx="1" fill="${openvsxLine}"/>
    <text x="${pad.left + 144}" y="13" fill="${textColor}" font-size="10" font-family="monospace">OpenVSX</text>
  `;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" rx="8" fill="${bg}"/>
  ${yGrid}
  ${xLabels.join('\n  ')}
  ${legend}
  <path d="${makePath('total')}" fill="none" stroke="${totalLine}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${makePath('vscode')}" fill="none" stroke="${vscodeLine}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2"/>
  <path d="${makePath('openvsx')}" fill="none" stroke="${openvsxLine}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2"/>
  ${endLabels}
</svg>`;

  return svg;
}

function generateEmptySVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 240" width="720" height="240">
  <rect width="720" height="240" rx="8" fill="#0d1117"/>
  <text x="360" y="125" fill="#8b949e" font-size="14" text-anchor="middle" font-family="monospace">No data yet — tracking starts after first cron run</text>
</svg>`;
}

function main() {
  let history = [];
  if (fs.existsSync(DATA_FILE)) {
    history = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }

  const svg = generateSVG(history);

  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, svg);
  console.log(`Chart written to ${OUTPUT_FILE} (${history.length} data points)`);
}

main();
