const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const { parsePdfBuffer } = require('./api/pdfParser');

const app  = express();
const PORT = 3001;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

app.use(cors());
app.use(express.json());

app.post('/api/parse', upload.array('pdfs', 30), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const parsed = await parsePdfBuffer(file.buffer, file.originalname);
        results.push(parsed);
      } catch (err) {
        console.error(`Failed to parse ${file.originalname}:`, err.message);
        results.push({
          filename: file.originalname,
          error: err.message,
          date: null,
          totalRuns: 0,
          runs: [],
        });
      }
    }

    results.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    res.json(results);
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Remote SFTP endpoints ────────────────────────────────────────────────────

const REMOTE_LOG_DIR = '/var/siemens/common/log';
const PDF_PATTERN    = /^daily_report_\d{8}\.pdf$/;

function buildSftpConfig(body) {
  const { host, port, username, password, privateKey } = body;
  if (!host)     throw new Error('host is required');
  if (!username) throw new Error('username is required');
  const cfg = {
    host,
    port: parseInt(port, 10) || 22,
    username,
    readyTimeout: 20000,
    algorithms: {
      serverHostKey: [
        'ssh-ed25519','ecdsa-sha2-nistp256','ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521','rsa-sha2-512','rsa-sha2-256','ssh-rsa',
      ],
    },
  };
  if (privateKey) {
    cfg.privateKey = privateKey;
  } else if (password) {
    cfg.password = password;
  } else {
    throw new Error('Either password or privateKey is required');
  }
  return cfg;
}

/**
 * POST /api/remote/test
 * Body: { host, port, username, password|privateKey }
 * Tests the SFTP connection and lists available report files.
 */
app.post('/api/remote/test', async (req, res) => {
  let SftpClient;
  try {
    SftpClient = require('ssh2-sftp-client');
  } catch {
    return res.status(500).json({ error: 'ssh2-sftp-client is not installed' });
  }

  const sftp = new SftpClient();
  try {
    const cfg = buildSftpConfig(req.body);
    await sftp.connect(cfg);

    const entries = await sftp.list(REMOTE_LOG_DIR);
    const files = entries
      .filter(e => e.type === '-' && PDF_PATTERN.test(e.name))
      .map(e => ({
        name: e.name,
        size: e.size,
        modifyTime: e.modifyTime,
        date: e.name.replace('daily_report_', '').replace('.pdf', ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    await sftp.end();
    res.json({ ok: true, files, logDir: REMOTE_LOG_DIR });
  } catch (err) {
    try { await sftp.end(); } catch {}
    const msg = err.message || String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED')) {
      return res.status(400).json({ error: `Connection refused — is the server reachable at ${req.body.host}:${req.body.port || 22}?` });
    }
    if (msg.includes('authentication') || msg.includes('All configured') || msg.includes('USERAUTH')) {
      return res.status(400).json({ error: 'Authentication failed — check username and password/key.' });
    }
    if (msg.includes('No such file') || msg.includes('ENOENT')) {
      return res.status(400).json({ error: `Connected successfully but ${REMOTE_LOG_DIR} does not exist on the server.` });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/remote/fetch
 * Body: { host, port, username, password|privateKey, files?: string[] }
 * Downloads and parses the requested (or all) daily_report PDF files.
 */
app.post('/api/remote/fetch', async (req, res) => {
  let SftpClient;
  try {
    SftpClient = require('ssh2-sftp-client');
  } catch {
    return res.status(500).json({ error: 'ssh2-sftp-client is not installed' });
  }

  const sftp = new SftpClient();
  try {
    const cfg = buildSftpConfig(req.body);
    await sftp.connect(cfg);

    let filesToFetch;
    if (req.body.files && Array.isArray(req.body.files) && req.body.files.length > 0) {
      filesToFetch = req.body.files.filter(n => PDF_PATTERN.test(n));
    } else {
      const entries = await sftp.list(REMOTE_LOG_DIR);
      filesToFetch = entries
        .filter(e => e.type === '-' && PDF_PATTERN.test(e.name))
        .map(e => e.name)
        .sort();
    }

    if (filesToFetch.length === 0) {
      await sftp.end();
      return res.status(404).json({ error: `No daily_report_*.pdf files found in ${REMOTE_LOG_DIR}` });
    }

    const results = [];
    for (const name of filesToFetch) {
      const remotePath = `${REMOTE_LOG_DIR}/${name}`;
      try {
        const buf = await sftp.get(remotePath);
        const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        const parsed = await parsePdfBuffer(buffer, name);
        results.push(parsed);
      } catch (err) {
        console.error(`Failed to fetch/parse ${name}:`, err.message);
        results.push({
          filename: name,
          error: err.message,
          date: null,
          totalRuns: 0,
          runs: [],
        });
      }
    }

    await sftp.end();

    results.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    res.json(results);
  } catch (err) {
    try { await sftp.end(); } catch {}
    const msg = err.message || String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Live Monitor endpoints ────────────────────────────────────────────────────

// In-memory cache of previous /proc/stat readings per host session (for CPU delta)
const cpuStatCache = new Map();

/**
 * Execute a shell command over SSH and return its stdout.
 */
function runSshCommand(cfg, command) {
  return new Promise((resolve, reject) => {
    let Client;
    try { Client = require('ssh2').Client; } catch (e) {
      return reject(new Error('ssh2 module not available'));
    }
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH command timed out after 15 seconds'));
    }, 15000);

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(stdout); });
        stream.on('data', d => { stdout += d.toString(); });
        stream.stderr.on('data', d => { stderr += d.toString(); });
      });
    });
    conn.on('error', err => { clearTimeout(timer); reject(err); });
    conn.connect(cfg);
  });
}

/**
 * Parse /proc/stat CPU line into an object of numeric counters.
 * Format: cpu user nice system idle iowait irq softirq steal ...
 */
function parseCpuStat(line) {
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  if (!parts[0].startsWith('cpu')) return null;
  const [, user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts.map(Number);
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { user, nice, system, idle: idle + iowait, irq: irq + softirq, steal, total };
}

/**
 * Compute CPU percentages from two /proc/stat snapshots.
 */
function calcCpuPct(prev, curr) {
  if (!prev || !curr) return null;
  const dTotal = curr.total - prev.total;
  if (dTotal <= 0) return null;
  const dIdle  = curr.idle  - prev.idle;
  const dUser  = (curr.user + curr.nice) - (prev.user + prev.nice);
  const dSys   = curr.system - prev.system;
  return {
    used:   +((dTotal - dIdle) / dTotal * 100).toFixed(1),
    user:   +(dUser  / dTotal * 100).toFixed(1),
    system: +(dSys   / dTotal * 100).toFixed(1),
    idle:   +(dIdle  / dTotal * 100).toFixed(1),
  };
}

/**
 * Parse the structured output returned by the live-metrics shell script.
 */
function parseLiveOutput(raw) {
  const metrics = {};

  // PID
  const pidMatch = raw.match(/<<<PID>>>(\d*)/);
  metrics.pid = pidMatch ? pidMatch[1] : null;

  // /proc/stat CPU line
  const cpuStatMatch = raw.match(/<<<CPU_STAT>>>(cpu\s+[\d ]+)/);
  metrics.cpuStat = cpuStatMatch ? parseCpuStat(cpuStatMatch[1]) : null;

  // /proc/PID/status block
  const statusMatch = raw.match(/<<<STATUS_START>>>([\s\S]*?)<<<STATUS_END>>>/);
  if (statusMatch) {
    const block = statusMatch[1];
    const vmSizeM = block.match(/VmSize[:\s]+(\d+)\s*kB/i);
    const vmRssM  = block.match(/VmRSS[:\s]+(\d+)\s*kB/i);
    if (vmSizeM) metrics.vmSizeKb = parseInt(vmSizeM[1]);
    if (vmRssM)  metrics.vmRssKb  = parseInt(vmRssM[1]);
  }

  // Anonymous memory (MB)
  const anonMatch = raw.match(/<<<ANON_START>>>([\s\S]*?)<<<ANON_END>>>/);
  if (anonMatch) {
    const val = parseFloat(anonMatch[1].trim());
    if (!isNaN(val)) metrics.anonMemoryMb = val;
  }

  // Thread count
  const thrMatch = raw.match(/<<<THREADS>>>(\d+)/);
  if (thrMatch) metrics.threads = parseInt(thrMatch[1]);

  // Network connections
  const connMatch = raw.match(/<<<CONNECTIONS>>>(\d+)/);
  if (connMatch) metrics.connections = parseInt(connMatch[1]);

  // /proc/meminfo
  const memInfoMatch = raw.match(/<<<MEMINFO_START>>>([\s\S]*?)<<<MEMINFO_END>>>/);
  if (memInfoMatch) {
    const block = memInfoMatch[1];
    const totalM = block.match(/MemTotal[:\s]+(\d+)\s*kB/i);
    const freeM  = block.match(/MemAvailable[:\s]+(\d+)\s*kB/i) || block.match(/MemFree[:\s]+(\d+)\s*kB/i);
    if (totalM) metrics.memTotalMb = +(parseInt(totalM[1]) / 1024).toFixed(0);
    if (freeM)  metrics.memAvailMb = +(parseInt(freeM[1])  / 1024).toFixed(0);
  }

  // Load average
  const loadMatch = raw.match(/<<<LOADAVG>>>([\d. ]+)/);
  if (loadMatch) {
    const parts = loadMatch[1].trim().split(/\s+/);
    metrics.loadAvg1  = parseFloat(parts[0]) || 0;
    metrics.loadAvg5  = parseFloat(parts[1]) || 0;
    metrics.loadAvg15 = parseFloat(parts[2]) || 0;
  }

  // top output
  const topMatch = raw.match(/<<<TOP_START>>>([\s\S]*?)<<<TOP_END>>>/);
  metrics.topOutput = topMatch ? topMatch[1].trim() : '';

  return metrics;
}

const LIVE_SHELL_CMD = [
  // Find server process PID
  'PID=$(cat /var/siemens/common/pid 2>/dev/null | tr -d "[:space:]" | head -c 10)',
  '[ -z "$PID" ] && PID=$(pgrep -f java 2>/dev/null | head -1)',
  '[ -z "$PID" ] && PID=$(ps -eo pid,cmd --no-headers 2>/dev/null | grep -iE "java|server" | grep -v grep | head -1 | awk \'{print $1}\')',
  'printf "<<<PID>>>%s\\n" "$PID"',
  // CPU stat
  'printf "<<<CPU_STAT>>>%s\\n" "$(awk \'NR==1\' /proc/stat)"',
  // Process memory
  'if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then',
  '  echo "<<<STATUS_START>>>"',
  '  cat /proc/$PID/status 2>/dev/null',
  '  echo "<<<STATUS_END>>>"',
  '  echo "<<<ANON_START>>>"',
  '  awk \'BEGIN{s=0} /^AnonHugePages:/{s+=$2} /^Private_Dirty:/{s+=$2} END{printf "%.2f\\n", s/1024}\' /proc/$PID/smaps 2>/dev/null || echo "0"',
  '  echo "<<<ANON_END>>>"',
  '  printf "<<<THREADS>>>%s\\n" "$(ls /proc/$PID/task 2>/dev/null | wc -l)"',
  'fi',
  // Network connections
  'printf "<<<CONNECTIONS>>>%s\\n" "$(ss -tn state established 2>/dev/null | tail -n +2 | wc -l || netstat -tn 2>/dev/null | grep -c ESTABLISHED || echo 0)"',
  // System memory
  'echo "<<<MEMINFO_START>>>"',
  'cat /proc/meminfo 2>/dev/null | head -8',
  'echo "<<<MEMINFO_END>>>"',
  // Load average
  'printf "<<<LOADAVG>>>%s\\n" "$(cat /proc/loadavg 2>/dev/null)"',
  // top output (full process list for CPU monitoring)
  'echo "<<<TOP_START>>>"',
  'top -bn1 -w 120 2>/dev/null | head -25 || top -bn1 2>/dev/null | head -25',
  'echo "<<<TOP_END>>>"',
].join('; ');

/**
 * POST /api/live/metrics
 * Body: { host, port, username, password|privateKey }
 * Runs diagnostic commands on the remote server via SSH and returns live metrics.
 * CPU percentages are calculated as a delta from the previous call (same host/user).
 */
app.post('/api/live/metrics', async (req, res) => {
  try {
    const cfg = buildSftpConfig(req.body);
    const raw = await runSshCommand(cfg, LIVE_SHELL_CMD);
    const parsed = parseLiveOutput(raw);

    // CPU delta calculation
    const cacheKey = `${cfg.host}:${cfg.port}:${cfg.username}`;
    const prevCpu  = cpuStatCache.get(cacheKey) || null;
    const currCpu  = parsed.cpuStat;
    const cpuPct   = calcCpuPct(prevCpu, currCpu);
    if (currCpu) cpuStatCache.set(cacheKey, currCpu);

    res.json({
      timestamp: new Date().toISOString(),
      pid: parsed.pid || null,
      vmSizeKb: parsed.vmSizeKb ?? null,
      vmRssKb:  parsed.vmRssKb  ?? null,
      anonMemoryMb: parsed.anonMemoryMb ?? null,
      threads:  parsed.threads  ?? null,
      connections: parsed.connections ?? null,
      memTotalMb:  parsed.memTotalMb  ?? null,
      memAvailMb:  parsed.memAvailMb  ?? null,
      loadAvg1:    parsed.loadAvg1    ?? null,
      loadAvg5:    parsed.loadAvg5    ?? null,
      loadAvg15:   parsed.loadAvg15   ?? null,
      cpu: cpuPct,   // null on first call (no prev sample yet)
      topOutput: parsed.topOutput || '',
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('ECONNREFUSED')) {
      return res.status(400).json({ error: `Connection refused — check host/port.` });
    }
    if (msg.includes('authentication') || msg.includes('USERAUTH')) {
      return res.status(400).json({ error: 'Authentication failed — check username and password.' });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/live/test
 * Body: { host, port, username, password|privateKey }
 * Tests SSH connectivity for the live monitor (runs a simple echo command).
 */
app.post('/api/live/test', async (req, res) => {
  try {
    const cfg = buildSftpConfig(req.body);
    const out = await runSshCommand(cfg, 'echo OK && uname -r && cat /proc/loadavg');
    res.json({ ok: true, info: out.trim() });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('ECONNREFUSED')) {
      return res.status(400).json({ error: `Connection refused — check host/port.` });
    }
    if (msg.includes('authentication') || msg.includes('USERAUTH')) {
      return res.status(400).json({ error: 'Authentication failed — check username and password.' });
    }
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, 'localhost', () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
