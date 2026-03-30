const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'installs.json');
const DEFAULT_OUTPUT_FILE = path.join(__dirname, '..', 'assets', 'installs-chart.svg');
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  return (idx !== -1 && idx < process.argv.length - 1) ? process.argv[idx + 1] : undefined;
}

function formatNumber(v) {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
}

function formatDate(d) {
  const [, m, day] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}`;
}

function getNiceStep(max) {
  const rough = Math.max(max / 4, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm > 5) return 10 * mag;
  if (norm > 2) return 5 * mag;
  if (norm > 1) return 2 * mag;
  return mag;
}

function getTickValues(max) {
  const step = getNiceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= yMax + step / 2; v += step) ticks.push(v);
  return { ticks, yMax };
}

function pickLabelIndexes(len, maxLabels = 6) {
  if (len <= 1) return [0];
  const count = Math.min(len, maxLabels);
  const step = (len - 1) / Math.max(count - 1, 1);
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.round(i * step));
  return [...new Set(out)];
}

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function areaPath(pts, baseY) {
  if (pts.length < 2) return '';
  return `${smoothPath(pts)} L${pts[pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
}

const STYLE = `
  svg { color-scheme: light dark; }
  .title      { fill: #1a1a2e; font-size: 15px; font-weight: 600; }
  .subtitle   { fill: #6b7280; font-size: 11px; font-weight: 400; }
  .grid       { stroke: #e8e8ee; }
  .axis-label { fill: #8a8a9a; font-size: 10px; }
  .line-total   { stroke: #e8553d; }
  .line-vscode  { stroke: #5b7cfa; }
  .line-openvsx { stroke: #34c7a0; }
  .dot-total   { fill: transparent; stroke: #e8553d; }
  .dot-vscode  { fill: transparent; stroke: #5b7cfa; }
  .dot-openvsx { fill: transparent; stroke: #34c7a0; }
  .end-label       { fill: #1a1a2e; font-size: 11px; font-weight: 600; }
  .end-value       { fill: #6b7280; font-size: 11px; font-weight: 400; }
  .area-total-top    { stop-color: #e8553d; }
  .area-total-bottom { stop-color: #e8553d; }

  @media (prefers-color-scheme: dark) {
    .title      { fill: #e2e2e8; }
    .subtitle   { fill: #8b949e; }
    .grid       { stroke: #2d2d3d; }
    .axis-label { fill: #6e7681; }
    .line-total   { stroke: #ff9b85; }
    .line-vscode  { stroke: #8da4ff; }
    .line-openvsx { stroke: #5eead4; }
    .dot-total   { stroke: #ff9b85; }
    .dot-vscode  { stroke: #8da4ff; }
    .dot-openvsx { stroke: #5eead4; }
    .end-label       { fill: #e2e2e8; }
    .end-value       { fill: #8b949e; }
    .area-total-top    { stop-color: #ff9b85; }
    .area-total-bottom { stop-color: #ff9b85; }
  }
`;

function generateSVG(history) {
  if (!history.length) return generateEmptySVG();

  const W = 760, H = 260;
  const pad = { top: 48, right: 120, bottom: 40, left: 48 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const maxTotal = Math.max(...history.map((d) => d.total), 1);
  const { ticks, yMax } = getTickValues(maxTotal);

  const toX = (i) => pad.left + (history.length === 1 ? chartW / 2 : (i / (history.length - 1)) * chartW);
  const toY = (v) => pad.top + chartH - (v / yMax) * chartH;

  const pts = (key) => history.map((d, i) => ({ x: toX(i), y: toY(d[key]) }));
  const totalPts = pts('total');
  const vscodePts = pts('vscode');
  const openvsxPts = pts('openvsx');
  const baselineY = toY(0);

  const hGrid = ticks.map((v) =>
    `<line x1="${pad.left}" y1="${toY(v)}" x2="${W - pad.right}" y2="${toY(v)}" class="grid" stroke-width="0.7"/>`
    + `\n    <text x="${pad.left - 8}" y="${toY(v) + 3.5}" class="axis-label" text-anchor="end" font-family="${FONT}">${formatNumber(v)}</text>`
  ).join('\n    ');

  const xIdxs = pickLabelIndexes(history.length);
  const xLabels = xIdxs.map((i) =>
    `<text x="${toX(i)}" y="${H - 12}" class="axis-label" text-anchor="middle" font-family="${FONT}">${formatDate(history[i].date)}</text>`
  ).join('\n    ');

  const latest = history[history.length - 1];
  const lastX = totalPts[totalPts.length - 1].x;

  const series = [
    { pts: totalPts, cls: 'total', label: 'Total', value: latest.total, sw: 2.5, dotR: 4.5, dotSw: 2 },
    { pts: openvsxPts, cls: 'openvsx', label: 'Open VSX', value: latest.openvsx, sw: 1.8, dotR: 3.5, dotSw: 1.8 },
    { pts: vscodePts, cls: 'vscode', label: 'VS Code', value: latest.vscode, sw: 1.8, dotR: 3.5, dotSw: 1.8 },
  ];

  const endLabelX = lastX + 18;
  const sortedByY = [...series].sort((a, b) => {
    const ay = a.pts[a.pts.length - 1].y;
    const by = b.pts[b.pts.length - 1].y;
    return ay - by;
  });

  const minGap = 18;
  const resolvedY = [];
  sortedByY.forEach((s, i) => {
    let y = s.pts[s.pts.length - 1].y + 4;
    if (i > 0 && y - resolvedY[i - 1] < minGap) {
      y = resolvedY[i - 1] + minGap;
    }
    resolvedY.push(y);
  });

  const endLabels = sortedByY.map((s, i) => {
    const y = resolvedY[i];
    return `<circle cx="${lastX}" cy="${s.pts[s.pts.length - 1].y}" r="${s.dotR}" class="dot-${s.cls}" stroke-width="${s.dotSw}"/>
    <text x="${endLabelX}" y="${y}" class="end-label" font-family="${FONT}">${s.label}</text>
    <text x="${endLabelX + s.label.length * 6.6 + 6}" y="${y}" class="end-value" font-family="${FONT}">${formatNumber(s.value)}</text>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Glassy install history">
  <style>${STYLE}</style>
  <defs>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" class="area-total-top" stop-opacity="0.18"/>
      <stop offset="60%" class="area-total-bottom" stop-opacity="0.04"/>
      <stop offset="100%" class="area-total-bottom" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <text x="${pad.left}" y="22" class="title" font-family="${FONT}">Installs</text>
  <text x="${pad.left}" y="37" class="subtitle" font-family="${FONT}">Updated ${formatDate(latest.date)}</text>

  ${hGrid}
  ${xLabels}

  <path d="${areaPath(totalPts, baselineY)}" fill="url(#areaGrad)"/>
  <path d="${smoothPath(openvsxPts)}" fill="none" class="line-openvsx" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${smoothPath(vscodePts)}" fill="none" class="line-vscode" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${smoothPath(totalPts)}" fill="none" class="line-total" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

  ${endLabels}
</svg>`;
}

function generateEmptySVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 260" width="760" height="260" role="img" aria-label="No install data yet">
  <style>${STYLE}</style>
  <text x="380" y="120" class="title" text-anchor="middle" font-family="${FONT}">No data yet</text>
  <text x="380" y="142" class="subtitle" text-anchor="middle" font-family="${FONT}">Tracking starts after the first install sync</text>
</svg>`;
}

function main() {
  const dataFile = getArgValue('--input') || DEFAULT_DATA_FILE;
  const outputFile = getArgValue('--output') || DEFAULT_OUTPUT_FILE;
  let history = [];
  if (fs.existsSync(dataFile)) {
    history = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  }

  const svg = generateSVG(history);
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputFile, svg);
  console.log(`Chart written to ${outputFile} (${history.length} data points)`);
}

main();
