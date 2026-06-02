import { useState, useEffect } from 'react';

const DEFAULT_PORT = '22';
const DEFAULT_PATH = '/var/siemens/common/log';
const STORAGE_KEY  = 'sftp_server_config';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePref(host, port, username) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, port, username }));
  } catch {}
}

function clearPref() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function formatDate(raw) {
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ServerFetch({ onFetch, loading }) {
  const saved = loadSaved();

  const [host, setHost]         = useState(saved?.host     || '');
  const [port, setPort]         = useState(saved?.port     || DEFAULT_PORT);
  const [username, setUsername] = useState(saved?.username || '');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [hasSaved, setHasSaved]           = useState(!!saved);
  const [justSaved, setJustSaved]         = useState(false);

  const [testStatus, setTestStatus]       = useState(null);
  const [testing, setTesting]             = useState(false);
  const [availableFiles, setAvailableFiles] = useState(null);
  const [selectedFiles, setSelectedFiles]   = useState(new Set());

  const [fetching, setFetching]   = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const credentials = () => ({ host, port, username, password });

  const valid = host.trim() && username.trim() && password.trim();

  const persistConfig = (h, p, u) => {
    savePref(h, p, u);
    setHasSaved(true);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleClearSaved = () => {
    clearPref();
    setHasSaved(false);
    setJustSaved(false);
    setHost('');
    setPort(DEFAULT_PORT);
    setUsername('');
    setPassword('');
    setTestStatus(null);
    setAvailableFiles(null);
    setSelectedFiles(new Set());
  };

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    setAvailableFiles(null);
    setSelectedFiles(new Set());
    setFetchError(null);
    try {
      const resp = await fetch('/api/remote/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials()),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTestStatus({ ok: false, message: data.error || `HTTP ${resp.status}` });
        return;
      }
      setTestStatus({
        ok: true,
        message: `Connected — found ${data.files.length} report${data.files.length !== 1 ? 's' : ''} in ${data.logDir}`,
      });
      setAvailableFiles(data.files);
      setSelectedFiles(new Set(data.files.map(f => f.name)));
      persistConfig(host, port, username);
    } catch (e) {
      setTestStatus({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const toggleFile = (name) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFiles.size === availableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(availableFiles.map(f => f.name)));
    }
  };

  const handleFetch = async () => {
    if (!selectedFiles.size) return;
    setFetching(true);
    setFetchError(null);
    try {
      const resp = await fetch('/api/remote/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials(), files: Array.from(selectedFiles) }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setFetchError(data.error || `HTTP ${resp.status}`);
        return;
      }
      const valid = data.filter(r => r.runs && r.runs.length > 0);
      if (!valid.length) {
        setFetchError('Reports were downloaded but no diagnostic data could be parsed from them.');
        return;
      }
      persistConfig(host, port, username);
      onFetch(valid, { host, port, username, password, files: Array.from(selectedFiles) });
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="server-fetch-card">
      <div className="server-fetch-header">
        <span className="server-fetch-icon">🖥️</span>
        <div>
          <h3>Fetch from Server</h3>
          <p>Connect via SSH to pull all daily PDF reports automatically from the server.</p>
        </div>
      </div>

      {hasSaved && (
        <div className="sftp-remembered-bar">
          <span>
            {justSaved
              ? '✅ Connection saved (password not stored)'
              : `🔒 Remembered: ${host} · ${username}`}
          </span>
          <button className="sftp-clear-btn" onClick={handleClearSaved} title="Clear saved connection">
            ✕ Clear
          </button>
        </div>
      )}

      <div className="server-fetch-form">
        <div className="sftp-row">
          <div className="sftp-field sftp-field-grow">
            <label>Server IP / Hostname</label>
            <input
              type="text"
              placeholder="192.168.1.100"
              value={host}
              onChange={e => { setHost(e.target.value); setTestStatus(null); setAvailableFiles(null); }}
              autoComplete="off"
            />
          </div>
          <div className="sftp-field sftp-field-port">
            <label>Port</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={e => { setPort(e.target.value); setTestStatus(null); }}
            />
          </div>
        </div>

        <div className="sftp-row">
          <div className="sftp-field sftp-field-half">
            <label>Username</label>
            <input
              type="text"
              placeholder="siemens"
              value={username}
              onChange={e => { setUsername(e.target.value); setTestStatus(null); }}
              autoComplete="username"
            />
          </div>
          <div className="sftp-field sftp-field-half">
            <label>
              Password
              <span className="sftp-pass-hint"> — not saved</span>
            </label>
            <div className="sftp-password-wrap">
              <input
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setTestStatus(null); }}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="sftp-toggle-pass"
                onClick={() => setShowPass(p => !p)}
                tabIndex={-1}
              >
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
        </div>

        <div className="sftp-path-hint">
          <span>📁</span>
          <span>Reports will be fetched from <code>{DEFAULT_PATH}</code> on the server</span>
        </div>

        <button
          className="btn btn-secondary sftp-test-btn"
          onClick={handleTest}
          disabled={!valid || testing || fetching}
        >
          {testing ? '⏳ Connecting…' : '🔌 Test Connection & List Reports'}
        </button>

        {testStatus && (
          <div className={`sftp-status ${testStatus.ok ? 'sftp-status-ok' : 'sftp-status-err'}`}>
            {testStatus.ok ? '✅' : '❌'} {testStatus.message}
          </div>
        )}
      </div>

      {availableFiles && availableFiles.length === 0 && (
        <div className="sftp-empty">
          No <code>daily_report_*.pdf</code> files found in <code>{DEFAULT_PATH}</code>.
          The scheduler generates one PDF per day at 00:05.
        </div>
      )}

      {availableFiles && availableFiles.length > 0 && (
        <div className="sftp-file-list">
          <div className="sftp-file-list-header">
            <label className="sftp-select-all">
              <input
                type="checkbox"
                checked={selectedFiles.size === availableFiles.length}
                onChange={toggleAll}
              />
              <strong>Available Reports</strong>
              <span className="sftp-count">{availableFiles.length} file{availableFiles.length !== 1 ? 's' : ''}</span>
            </label>
            <span className="sftp-selected-hint">
              {selectedFiles.size} selected
            </span>
          </div>

          <div className="sftp-file-scroll">
            {availableFiles.map(f => (
              <label key={f.name} className={`sftp-file-row ${selectedFiles.has(f.name) ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(f.name)}
                  onChange={() => toggleFile(f.name)}
                />
                <span className="sftp-file-icon">📄</span>
                <span className="sftp-file-name">{f.name}</span>
                <span className="sftp-file-date">{formatDate(f.date)}</span>
                <span className="sftp-file-size">{formatSize(f.size)}</span>
              </label>
            ))}
          </div>

          {fetchError && (
            <div className="sftp-status sftp-status-err" style={{ marginTop: '0.75rem' }}>
              ❌ {fetchError}
            </div>
          )}

          <button
            className="btn btn-primary sftp-fetch-btn"
            onClick={handleFetch}
            disabled={!selectedFiles.size || fetching || loading}
          >
            {fetching
              ? `⏳ Downloading ${selectedFiles.size} report${selectedFiles.size !== 1 ? 's' : ''}…`
              : `📥 Fetch & Analyse ${selectedFiles.size} Report${selectedFiles.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
