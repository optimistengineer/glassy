const fs = require('fs');
const path = require('path');

const EXTENSION_ID = 'optimistengineer.glassy';
const DATA_FILE = path.join(__dirname, '..', 'data', 'installs.json');

async function fetchVSCodeMarketplace() {
  const body = {
    filters: [{
      criteria: [
        { filterType: 7, value: EXTENSION_ID }
      ]
    }],
    assetTypes: [],
    flags: 914 // includes statistics
  };

  try {
    const res = await fetch(
      'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json;api-version=6.0-preview.1'
        },
        body: JSON.stringify(body)
      }
    );

    const data = await res.json();
    const ext = data?.results?.[0]?.extensions?.[0];
    if (!ext) return 0;

    const installStat = ext.statistics?.find(s => s.statisticName === 'install');
    return installStat ? Math.round(installStat.value) : 0;
  } catch (err) {
    console.error('VS Code Marketplace fetch failed:', err.message);
    return null;
  }
}

async function fetchOpenVSX() {
  try {
    const res = await fetch('https://open-vsx.org/api/optimistengineer/glassy');
    const data = await res.json();
    return data.downloadCount ?? 0;
  } catch (err) {
    console.error('OpenVSX fetch failed:', err.message);
    return null;
  }
}

async function main() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const [vscode, openvsx] = await Promise.all([
    fetchVSCodeMarketplace(),
    fetchOpenVSX()
  ]);

  console.log(`[${today}] VS Code Marketplace: ${vscode}, OpenVSX: ${openvsx}`);

  // Load existing data
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let history = [];
  if (fs.existsSync(DATA_FILE)) {
    history = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }

  // Skip if both failed
  if (vscode === null && openvsx === null) {
    console.error('Both sources failed. Skipping.');
    process.exit(1);
  }

  // Deduplicate: overwrite if same date already exists
  const existing = history.findIndex(e => e.date === today);
  const entry = {
    date: today,
    vscode: vscode ?? 0,
    openvsx: openvsx ?? 0,
    total: (vscode ?? 0) + (openvsx ?? 0)
  };

  if (existing >= 0) {
    history[existing] = entry;
  } else {
    history.push(entry);
  }

  // Sort by date
  history.sort((a, b) => a.date.localeCompare(b.date));

  fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2) + '\n');
  console.log(`Saved ${history.length} data points to ${DATA_FILE}`);
}

main();
