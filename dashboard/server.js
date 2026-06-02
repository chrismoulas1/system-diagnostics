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

app.listen(PORT, 'localhost', () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
