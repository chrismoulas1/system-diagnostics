/**
 * StatsCards — key physical-memory metrics at a glance.
 *
 * Cards ordered by relevance to physical memory leak investigation:
 *  1. VmRSS (physical RAM) — primary leak indicator; shows delta first→last
 *  2. Anon Memory + Anon/RSS % — distinguishes heap/native vs. file-backed growth
 *  3. JSSE NIO Threads + delta — thread stacks consume physical RAM
 *  4. Network Connections      — socket buffers contribute to RSS
 *  5. VmSize (virtual)        — context only; alone does NOT indicate a leak
 *  6. Server PID              — process restart detection
 */

function fmtKb(kb) {
  if (kb === undefined || kb === null || isNaN(kb)) return '—';
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(0) + ' MB';
  return kb + ' kB';
}

function avg(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function first(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  return v.length ? v[0] : null;
}

function last(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  return v.length ? v[v.length - 1] : null;
}

function max(arr) {
  const v = arr.filter(x => x !== undefined && x !== null && !isNaN(x));
  return v.length ? Math.max(...v) : null;
}

function deltaLabel(firstVal, lastVal, unit = '') {
  if (firstVal == null || lastVal == null) return null;
  const d = lastVal - firstVal;
  if (d === 0) return '→ stable';
  const sign = d > 0 ? '+' : '';
  const abs = Math.abs(d);
  return `${sign}${unit === 'MB' ? abs.toFixed(0) : abs} ${unit} since first snapshot`;
}

export default function StatsCards({ reports }) {
  const allRuns   = reports.flatMap(r => r.runs);
  const dateRange = reports.length === 1
    ? reports[0].date
    : `${reports[0].date} → ${reports[reports.length - 1].date}`;

  const rssArr    = allRuns.map(r => r.metrics?.vmRssKb);
  const vmSizeArr = allRuns.map(r => r.metrics?.vmSizeKb);
  const anonArr   = allRuns.map(r => r.metrics?.anonMemoryMb);
  const threadArr = allRuns.map(r => r.metrics?.jsseNioThreads);
  const connArr   = allRuns.map(r => r.metrics?.networkConnections);

  const latestRss   = last(rssArr.filter(Boolean));
  const firstRss    = first(rssArr.filter(Boolean));
  const peakRss     = max(rssArr.filter(Boolean));
  const rssDeltaMb  = latestRss != null && firstRss != null ? ((latestRss - firstRss) / 1024) : null;
  const rssDeltaPct = firstRss  > 0 ? ((latestRss - firstRss) / firstRss * 100) : null;

  const latestAnon  = last(anonArr.filter(v => v != null));
  const firstAnon   = first(anonArr.filter(v => v != null));
  const anonDelta   = latestAnon != null && firstAnon != null ? latestAnon - firstAnon : null;

  // Anon/RSS ratio for the latest snapshot
  const latestAnonPct = latestRss && latestAnon
    ? +((latestAnon * 1024 / latestRss) * 100).toFixed(0)
    : null;

  const latestThreads  = last(threadArr.filter(v => v != null));
  const firstThreads   = first(threadArr.filter(v => v != null));
  const threadDelta    = latestThreads != null && firstThreads != null ? latestThreads - firstThreads : null;

  const maxConns = max(connArr.filter(v => v != null));
  const avgConns = avg(connArr.filter(v => v != null));

  const latestVmSize = last(vmSizeArr.filter(Boolean));

  const pids  = [...new Set(allRuns.map(r => r.serverPid).filter(Boolean))];
  const pidOk = pids.length <= 1;

  return (
    <div className="stats-grid">

      {/* 1. VmRSS — PHYSICAL RAM (primary leak indicator) */}
      <div className="stat-card teal">
        <div className="stat-label">💾 VmRSS — Physical RAM Used</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {latestRss ? (latestRss / 1024).toFixed(0) : '—'}
          <span className="stat-unit">MB</span>
        </div>
        {rssDeltaMb != null && (
          <div className="stat-sub" style={{ color: rssDeltaMb > 0 ? '#ef4444' : '#10b981', fontWeight: rssDeltaMb > 0 ? 700 : 400 }}>
            {rssDeltaMb >= 0 ? '↑ +' : '↓ '}{Math.abs(rssDeltaMb).toFixed(0)} MB
            {rssDeltaPct != null && ` (${rssDeltaPct >= 0 ? '+' : ''}${rssDeltaPct.toFixed(1)}%)`}
            {' '}since first snapshot
          </div>
        )}
        {peakRss && <div className="stat-sub">Peak: {(peakRss / 1024).toFixed(0)} MB</div>}
      </div>

      {/* 2. Anonymous memory + Anon/RSS ratio */}
      <div className="stat-card purple">
        <div className="stat-label">📦 Anon Memory (Heap + Off-heap)</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {latestAnon != null ? latestAnon.toFixed(1) : '—'}
          <span className="stat-unit">MB</span>
        </div>
        {latestAnonPct != null && (
          <div className="stat-sub" style={{ color: latestAnonPct > 65 ? '#ef4444' : '#64748b', fontWeight: latestAnonPct > 65 ? 700 : 400 }}>
            {latestAnonPct}% of physical RAM
            {latestAnonPct > 65 ? ' — high (heap/native dominant)' : ''}
          </div>
        )}
        {anonDelta != null && anonDelta !== 0 && (
          <div className="stat-sub" style={{ color: anonDelta > 0 ? '#ef4444' : '#10b981' }}>
            {anonDelta >= 0 ? '↑ +' : '↓ '}{Math.abs(anonDelta).toFixed(1)} MB since first snapshot
          </div>
        )}
      </div>

      {/* 3. JSSE NIO threads */}
      <div className="stat-card orange">
        <div className="stat-label">🔁 JSSE NIO Threads</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {latestThreads != null ? latestThreads : '—'}
          <span className="stat-unit">current</span>
        </div>
        {threadDelta != null && (
          <div className="stat-sub" style={{ color: threadDelta > 0 ? '#ef4444' : threadDelta < 0 ? '#10b981' : '#64748b', fontWeight: threadDelta !== 0 ? 700 : 400 }}>
            {threadDelta > 0 ? `↑ +${threadDelta}` : threadDelta < 0 ? `↓ ${threadDelta}` : '→ stable'}
            {' '}since first snapshot
          </div>
        )}
        <div className="stat-sub">Each thread ≈ 256 kB–1 MB physical RAM</div>
      </div>

      {/* 4. Network connections */}
      <div className="stat-card green">
        <div className="stat-label">🌐 Network Connections</div>
        <div className="stat-value" style={{ fontSize: '1.6rem' }}>
          {maxConns != null ? maxConns : '—'}
          <span className="stat-unit">peak</span>
        </div>
        <div className="stat-sub">Avg: {avgConns != null ? avgConns.toFixed(0) : '—'}</div>
        <div className="stat-sub">Socket buffers ≈ 4–128 kB per connection</div>
      </div>

      {/* 5. VmSize — virtual memory (context; large values are normal for JVMs) */}
      <div className="stat-card blue">
        <div className="stat-label">📐 VmSize — Virtual Address Space</div>
        <div className="stat-value" style={{ fontSize: '1.3rem' }}>
          {latestVmSize ? fmtKb(latestVmSize) : '—'}
        </div>
        <div className="stat-sub" style={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
          Virtual ≫ physical is normal for JVMs.
          Only VmRSS reflects actual RAM usage.
        </div>
        <div className="stat-sub">{dateRange} · {allRuns.length} snapshots</div>
      </div>

      {/* 6. Server PID — process restart detection */}
      <div className={`stat-card ${pidOk ? 'red' : 'red'}`} style={!pidOk ? { outline: '2px solid #ef4444' } : {}}>
        <div className="stat-label">🆔 Server PID</div>
        <div className="stat-value" style={{ fontSize: pids.length > 1 ? '1rem' : '1.6rem' }}>
          {pids.length ? pids.join(', ') : '—'}
        </div>
        <div className="stat-sub" style={{ color: !pidOk ? '#ef4444' : undefined, fontWeight: !pidOk ? 700 : 400 }}>
          {pids.length > 1
            ? `⚠ ${pids.length} PIDs — process restarted; reset leak baseline`
            : '✓ Stable process — leak comparison is valid'}
        </div>
      </div>

    </div>
  );
}
