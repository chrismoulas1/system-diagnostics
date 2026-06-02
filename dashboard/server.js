const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { parsePdfBuffer } = require('./api/pdfParser');

const app = express();
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

app.listen(PORT, 'localhost', () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
