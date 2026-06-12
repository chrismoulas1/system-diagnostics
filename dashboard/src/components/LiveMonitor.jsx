import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

const REFRESH_INTERVAL = 30; // seconds
const MAX_POINTS = 20;       // rolling window size

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMb(kb) {
  if (kb == null) return '—';
  return (kb / 1024).toFixed(0) + ' MB';
}

function shortTime(iso) {
  if (!iso) return '';
  return iso.slice(11, 19); // HH:MM:SS
}

function fmtCountdown(secs) {
  if (secs <= 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function LiveTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">🕐 {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          {p.name}:{' '}
          <strong>
            {p.value != null ? p.value.toFixed(1) + (unit || '') : '—'}
          </strong>
        </div>
      ))}
    </div>
  );
}

// ── Connection form ───────────────────────────────────────────────────────────

function ConnectionForm({ onStart, testing, testError, testOk }) {
  const [host, setHost]         = useState('');
  const [port, setPort]         = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const valid = host.trim() && username.trim() && password.trim();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (valid) onStart({ host: host.trim(), port, username: username.trim(), password });
  };

  return (
    <div className="live-monitor-connect-card">
      <div className="live-monitor-connect-header">
        <span className="live-monitor-header-icon">🔴</span>
        <div>
          <h3>Live System Monitor</h3>
          <p>
            Connect via SSH to monitor server performance in real-time.
            Metrics refresh every {REFRESH_INTERVAL} seconds.
          </p>
        </div>
      </div>

      <form className="live-monitor-form" onSubmit={handleSubmit}>
        <div className="sftp-row">
          <div className="sftp-field sftp-field-grow">
            <label>Server IP / Hostname</label>
            <input
              type="text"
              placeholder="192.168.1.100"
              value={host}
              onChange={e => setHost(e.target.value)}
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
              onChange={e => setPort(e.target.value)}
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
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="sftp-field sftp-field-half">
            <label>Password</label>
            <div className="sftp-password-wrap">
              <input
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
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

        {testError && (
          <div className="sftp-status sftp-status-err">❌ {testError}</div>
        )}
        {testOk && (
          <div className="sftp-status sftp-status-ok">✅ {testOk}</div>
        )}

        <button
          type="submit"
          className="btn btn-primary live-start-btn"
          disabled={!valid || testing}
        >
          {testing ? '⏳ Connecting…' : '▶ Start Live Monitor'}
        </button>
      </form>

      <div className="live-monitor-info-panel">
        <div className="live-info-item">
          <span className="live-info-icon">📊</span>
          <span>Memory: VmRSS, VmSize, Anonymous</span>
        </div>
        <div className="live-info-item">
          <span className="live-info-icon">🖥️</span>
          <span>CPU: user%, system%, idle%</span>
        </div>
        <div className="live-info-item">
          <span className="live-info-icon">🔀</span>
          <span>Threads &amp; network connections</span>
        </div>
        <div className="live-info-item">
          <span className="live-info-icon">📋</span>
          <span>Live <code>top</code> process view</span>
        </div>
      </div>
    </div>
  );
}

// ── Live stat card ────────────────────────────────────────────────────────────

function LiveStatCard({ label, value, unit, color, sub }) {
  return (
    <div className={`stat-card ${color || ''} live-stat-card`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value ?? '—'}
        {value != null && unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Main LiveMonitor component ────────────────────────────────────────────────

export default function LiveMonitor() {
  const [config, setConfig]         = useState(null); // SSH credentials
  const [running, setRunning]       = useState(false);
  const [starting, setStarting]     = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown, setCountdown]   = useState(REFRESH_INTERVAL);
  const [paused, setPaused]         = useState(false);

  // Rolling data points
  const [dataPoints, setDataPoints] = useState([]);

  // Latest raw reading (for stat cards + top output)
  const [latest, setLatest] = useState(null);

  const fetchTimerRef    = useRef(null);
  const countdownTimerRef = useRef(null);

  // ── Fetch one snapshot ──────────────────────────────────────────────────────

  const fetchSnapshot = useCallback(async (cfg) => {
    try {
      const resp = await fetch('/api/live/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      setFetchError(null);
      setLastUpdated(data.timestamp); // server-local time string, used by shortTime()
      setLatest(data);

      const point = {
        time:        shortTime(data.timestamp),
        vmRssMb:     data.vmRssKb  != null ? +(data.vmRssKb  / 1024).toFixed(1) : null,
        vmSizeMb:    data.vmSizeKb != null ? +(data.vmSizeKb / 1024).toFixed(1) : null,
        anonMb:      data.anonMemoryMb != null ? +data.anonMemoryMb.toFixed(1)   : null,
        threads:     data.threads  ?? null,
        connections: data.connections ?? null,
        cpuUsed:     data.cpu?.used   ?? null,
        cpuUser:     data.cpu?.user   ?? null,
        cpuSystem:   data.cpu?.system ?? null,
        cpuIdle:     data.cpu?.idle   ?? null,
        loadAvg1:    data.loadAvg1    ?? null,
      };

      setDataPoints(prev => [...prev.slice(-(MAX_POINTS - 1)), point]);
    } catch (e) {
      setFetchError(e.message);
    }
  }, []);

  // ── Start monitoring ────────────────────────────────────────────────────────

  const handleStart = async (creds) => {
    setStarting(true);
    setConnectError(null);
    try {
      // Test connection first
      const resp = await fetch('/api/live/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    } catch (e) {
      setConnectError(e.message);
      setStarting(false);
      return;
    }

    setConfig(creds);
    setRunning(true);
    setStarting(false);
    setDataPoints([]);
    setLatest(null);
    setFetchError(null);
    setCountdown(REFRESH_INTERVAL);
    setPaused(false);
  };

  // ── Stop monitoring ─────────────────────────────────────────────────────────

  const handleStop = () => {
    clearTimeout(fetchTimerRef.current);
    clearInterval(countdownTimerRef.current);
    setRunning(false);
    setConfig(null);
    setDataPoints([]);
    setLatest(null);
    setFetchError(null);
    setCountdown(REFRESH_INTERVAL);
  };

  // ── Refresh now ─────────────────────────────────────────────────────────────

  const handleRefreshNow = useCallback(() => {
    if (!config || paused) return;
    clearTimeout(fetchTimerRef.current);
    clearInterval(countdownTimerRef.current);
    setCountdown(REFRESH_INTERVAL);

    fetchSnapshot(config);

    // Restart countdown
    countdownTimerRef.current = setInterval(() => {
      setCountdown(s => (s <= 1 ? REFRESH_INTERVAL : s - 1));
    }, 1000);

    // Restart fetch loop
    fetchTimerRef.current = setTimeout(function fire() {
      fetchSnapshot(config);
      setCountdown(REFRESH_INTERVAL);
      fetchTimerRef.current = setTimeout(fire, REFRESH_INTERVAL * 1000);
    }, REFRESH_INTERVAL * 1000);
  }, [config, paused, fetchSnapshot]);

  // ── Auto-fetch loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!running || !config || paused) {
      clearTimeout(fetchTimerRef.current);
      clearInterval(countdownTimerRef.current);
      return;
    }

    // Immediate first fetch
    fetchSnapshot(config);
    setCountdown(REFRESH_INTERVAL);

    countdownTimerRef.current = setInterval(() => {
      setCountdown(s => (s <= 1 ? REFRESH_INTERVAL : s - 1));
    }, 1000);

    fetchTimerRef.current = setTimeout(function fire() {
      fetchSnapshot(config);
      setCountdown(REFRESH_INTERVAL);
      fetchTimerRef.current = setTimeout(fire, REFRESH_INTERVAL * 1000);
    }, REFRESH_INTERVAL * 1000);

    return () => {
      clearTimeout(fetchTimerRef.current);
      clearInterval(countdownTimerRef.current);
    };
  }, [running, config, paused, fetchSnapshot]);

  // ── If not running, show connection form ────────────────────────────────────

  if (!running) {
    return (
      <div className="live-monitor-page">
        <ConnectionForm
          onStart={handleStart}
          testing={starting}
          testError={connectError}
        />
      </div>
    );
  }

  // ── Live dashboard ──────────────────────────────────────────────────────────

  const cpuAvailable = dataPoints.some(p => p.cpuUsed != null);
  const memAvailable = dataPoints.some(p => p.vmRssMb != null);
  const connAvailable = dataPoints.some(p => p.connections != null);

  return (
    <div className="live-monitor-dashboard">
      {/* ── Status bar ── */}
      <div className={`live-status-bar ${paused ? 'paused' : 'active'}`}>
        <div className="arb-left">
          <span className={`arb-dot ${paused ? '' : 'arb-dot-live'}`} />
          <span className="live-monitor-badge">🔴 LIVE</span>
          <span className="arb-host">🖥️ {config.host}</span>
          <span className="arb-sep">·</span>
          <span className="arb-ago">
            {lastUpdated
              ? `Updated ${shortTime(lastUpdated)}`
              : 'Connecting…'}
          </span>
          {latest?.pid && (
            <>
              <span className="arb-sep">·</span>
              <span className="arb-ago">PID {latest.pid}</span>
            </>
          )}
        </div>
        <div className="arb-right">
          {!paused && (
            <span className="arb-countdown">
              Next in <strong>{fmtCountdown(countdown)}</strong>
            </span>
          )}
          {paused && <span className="arb-paused-label">Paused</span>}

          <button
            className="arb-btn arb-btn-refresh"
            onClick={handleRefreshNow}
            disabled={paused}
            title="Fetch metrics now"
          >
            🔄 Refresh
          </button>

          <button
            className={`arb-btn ${paused ? 'arb-btn-resume' : 'arb-btn-pause'}`}
            onClick={() => setPaused(p => !p)}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>

          <button
            className="arb-btn live-stop-btn"
            onClick={handleStop}
            title="Stop live monitor"
          >
            ⏹ Stop
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="error-banner">⚠️ {fetchError}</div>
      )}

      {/* ── Stat cards ── */}
      <div className="stats-grid live-stats-grid">
        <LiveStatCard
          label="CPU Used"
          value={latest?.cpu?.used ?? (dataPoints.length === 0 ? null : '…')}
          unit="%"
          color="orange"
          sub={latest?.cpu
            ? `usr ${latest.cpu.user}% · sys ${latest.cpu.system}%`
            : (dataPoints.length === 0 ? 'Collecting first sample…' : 'Calculating…')}
        />
        <LiveStatCard
          label="Load Avg (1m)"
          value={latest?.loadAvg1?.toFixed(2) ?? null}
          color="blue"
          sub={latest ? `5m ${latest.loadAvg5?.toFixed(2)}  15m ${latest.loadAvg15?.toFixed(2)}` : null}
        />
        <LiveStatCard
          label="VmRSS (Physical)"
          value={latest?.vmRssKb != null ? (latest.vmRssKb / 1024).toFixed(0) : null}
          unit=" MB"
          color="teal"
          sub={latest?.memTotalMb ? `of ${latest.memTotalMb} MB total RAM` : null}
        />
        <LiveStatCard
          label="VmSize (Virtual)"
          value={latest?.vmSizeKb != null ? (latest.vmSizeKb / 1024).toFixed(0) : null}
          unit=" MB"
          color="purple"
        />
        <LiveStatCard
          label="Anon Memory"
          value={latest?.anonMemoryMb?.toFixed(0) ?? null}
          unit=" MB"
          color="green"
        />
        <LiveStatCard
          label="Threads"
          value={latest?.threads ?? null}
          color="blue"
        />
        <LiveStatCard
          label="Connections"
          value={latest?.connections ?? null}
          color="teal"
          sub="established TCP"
        />
        <LiveStatCard
          label="Mem Available"
          value={latest?.memAvailMb ?? null}
          unit=" MB"
          color="green"
          sub="system free memory"
        />
      </div>

      {/* ── No data yet ── */}
      {dataPoints.length === 0 && (
        <div className="live-waiting">
          <div className="spinner" />
          <p>Fetching first snapshot from {config.host}…</p>
        </div>
      )}

      {/* ── Charts ── */}
      {dataPoints.length > 0 && (
        <>
          {/* CPU chart */}
          <div className="chart-card live-chart-card">
            <div className="chart-header">
              <h3>🖥️ CPU Utilization</h3>
              <p>
                {cpuAvailable
                  ? 'Live CPU breakdown — sampled every 30 seconds'
                  : 'CPU data will appear after the second sample (delta required)'}
              </p>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot" style={{ background: '#ef4444' }} />CPU Used %</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#f59e0b' }} />User %</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }} />System %</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#10b981' }} />Load avg 1m</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dataPoints} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit="%" yAxisId="pct" domain={[0, 100]} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} yAxisId="load" orientation="right" />
                <Tooltip content={<LiveTooltip unit="%" />} />
                <Line yAxisId="pct" type="monotone" dataKey="cpuUsed"   name="CPU Used"  stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="pct" type="monotone" dataKey="cpuUser"   name="User"      stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
                <Line yAxisId="pct" type="monotone" dataKey="cpuSystem" name="System"    stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
                <Line yAxisId="load" type="monotone" dataKey="loadAvg1" name="Load 1m"   stroke="#10b981" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Memory chart */}
          <div className="chart-card live-chart-card">
            <div className="chart-header">
              <h3>💾 Memory Usage (Live)</h3>
              <p>Process memory — sampled every 30 seconds</p>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot" style={{ background: '#00a884' }} />VmRSS (physical)</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }} />VmSize (virtual)</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#8b5cf6' }} />Anon Memory</span>
              </div>
            </div>
            {memAvailable ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dataPoints} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" MB" width={65} />
                  <Tooltip content={<LiveTooltip unit=" MB" />} />
                  <Line type="monotone" dataKey="vmRssMb"  name="VmRSS"       stroke="#00a884" strokeWidth={2.5} dot={{ r: 3, fill: '#00a884' }} connectNulls />
                  <Line type="monotone" dataKey="vmSizeMb" name="VmSize"       stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 3, fill: '#3b82f6' }} connectNulls />
                  <Line type="monotone" dataKey="anonMb"   name="Anon Memory"  stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="icon">📭</div><p>No memory data available for this process</p></div>
            )}
          </div>

          {/* Threads & Connections chart */}
          <div className="chart-card live-chart-card">
            <div className="chart-header">
              <h3>🔀 Threads &amp; Connections (Live)</h3>
              <p>Process thread count and established network connections</p>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot" style={{ background: '#f59e0b' }} />Threads</span>
                <span className="legend-item"><span className="legend-dot" style={{ background: '#10b981' }} />Connections</span>
              </div>
            </div>
            {connAvailable ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dataPoints} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip content={<LiveTooltip unit="" />} />
                  <Line yAxisId="left"  type="monotone" dataKey="threads"     name="Threads"     stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="connections" name="Connections"  stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="icon">📭</div><p>No connection data available</p></div>
            )}
          </div>
        </>
      )}

      {/* ── top output panel ── */}
      {latest?.topOutput && (
        <div className="live-top-panel">
          <div className="live-top-header">
            <h3>📋 top — CPU process view</h3>
            <span className="live-top-ts">
              Snapshot at {shortTime(latest.timestamp)}
            </span>
          </div>
          <pre className="live-top-output">{latest.topOutput}</pre>
        </div>
      )}
    </div>
  );
}
