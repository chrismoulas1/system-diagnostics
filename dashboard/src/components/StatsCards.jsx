function fmt(kb) {
  if (kb === undefined || kb === null || isNaN(kb)) return '—';
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(0) + ' MB';
  return kb + ' kB';
}

function avg(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function max(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  if (!v.length) return null;
  return Math.max(...v);
}

export default function StatsCards({ reports }) {
  const allRuns = reports.flatMap(r => r.runs);
  const totalRuns = allRuns.length;
  const dateRange = reports.length === 1
    ? reports[0].date
    : `${reports[0].date} → ${reports[reports.length - 1].date}`;

  const rssValues = allRuns.map(r => r.metrics?.vmRssKb).filter(Boolean);
  const vmSizeValues = allRuns.map(r => r.metrics?.vmSizeKb).filter(Boolean);
  const anonValues = allRuns.map(r => r.metrics?.anonMemoryMb).filter(Boolean);
  const threadValues = allRuns.map(r => r.metrics?.jsseNioThreads).filter(v => v !== undefined);
  const connValues = allRuns.map(r => r.metrics?.networkConnections).filter(v => v !== undefined);

  const latestRun = allRuns[allRuns.length - 1];
  const latestRss = latestRun?.metrics?.vmRssKb;
  const peakRss = max(rssValues);
  const avgAnon = avg(anonValues);
  const avgThreads = avg(threadValues);
  const maxConns = max(connValues);

  const pids = [...new Set(allRuns.map(r => r.serverPid).filter(Boolean))];

  return (
    <div className="stats-grid">
      <div className="stat-card blue">
        <div className="stat-label">📅 Date Range</div>
        <div className="stat-value" style={{ fontSize: '1.1rem' }}>{dateRange}</div>
        <div className="stat-sub">{reports.length} day{reports.length !== 1 ? 's' : ''} · {totalRuns} snapshots</div>
      </div>

      <div className="stat-card teal">
        <div className="stat-label">💾 Latest VmRSS</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {latestRss ? (latestRss / 1024).toFixed(0) : '—'}
          <span className="stat-unit">MB</span>
        </div>
        <div className="stat-sub">Peak: {peakRss ? (peakRss / 1024).toFixed(0) + ' MB' : '—'}</div>
      </div>

      <div className="stat-card purple">
        <div className="stat-label">📦 Anon Memory</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {avgAnon !== null ? avgAnon.toFixed(1) : '—'}
          <span className="stat-unit">MB avg</span>
        </div>
        <div className="stat-sub">Peak: {anonValues.length ? Math.max(...anonValues).toFixed(1) + ' MB' : '—'}</div>
      </div>

      <div className="stat-card orange">
        <div className="stat-label">🔀 JSSE NIO Threads</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {avgThreads !== null ? avgThreads.toFixed(0) : '—'}
          <span className="stat-unit">avg</span>
        </div>
        <div className="stat-sub">Max: {threadValues.length ? Math.max(...threadValues) : '—'}</div>
      </div>

      <div className="stat-card green">
        <div className="stat-label">🌐 Network Connections</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {maxConns !== null ? maxConns : '—'}
          <span className="stat-unit">max</span>
        </div>
        <div className="stat-sub">Avg: {connValues.length ? avg(connValues).toFixed(0) : '—'}</div>
      </div>

      <div className="stat-card red">
        <div className="stat-label">🆔 Server PID</div>
        <div className="stat-value" style={{ fontSize: pids.length > 1 ? '1rem' : '1.6rem' }}>
          {pids.length ? pids.join(', ') : '—'}
        </div>
        <div className="stat-sub">{pids.length > 1 ? 'Process restarted' : 'Stable process'}</div>
      </div>
    </div>
  );
}
