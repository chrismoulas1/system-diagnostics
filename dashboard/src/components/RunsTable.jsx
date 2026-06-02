function fmtKb(kb, prevKb, inStreak) {
  if (kb === undefined || kb === null || isNaN(kb))
    return <span className="no-data">—</span>;

  const mb = (kb / 1024).toFixed(0);
  let arrow = null;
  if (prevKb !== undefined && prevKb !== null) {
    if (kb > prevKb) arrow = <span style={{ color: '#ef4444', marginLeft: 4 }}>↑</span>;
    else if (kb < prevKb) arrow = <span style={{ color: '#10b981', marginLeft: 4 }}>↓</span>;
    else arrow = <span style={{ color: '#94a3b8', marginLeft: 4 }}>→</span>;
  }

  return (
    <span style={{ fontWeight: 600, color: inStreak ? '#ef4444' : 'inherit' }}>
      {mb} MB{arrow}
    </span>
  );
}

function fmtMb(mb) {
  if (mb === undefined || mb === null || isNaN(mb))
    return <span className="no-data">—</span>;
  return mb.toFixed(1) + ' MB';
}

function fmtNum(n) {
  if (n === undefined || n === null || isNaN(n))
    return <span className="no-data">—</span>;
  return n;
}

export default function RunsTable({ runs, showDate, leakResult }) {
  if (!runs.length) {
    return (
      <div className="table-card">
        <div className="empty-state">
          <div className="icon">📭</div>
          <p>No run data available</p>
        </div>
      </div>
    );
  }

  const streakSet = new Set(leakResult?.streakRunIndices || []);

  return (
    <div className="table-card">
      <div className="table-header">
        <h3>📋 Diagnostic Snapshots</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {leakResult?.isLeaking && (
            <span
              style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                borderRadius: 99,
                padding: '0.2rem 0.6rem',
                fontSize: '0.72rem',
                fontWeight: 600,
              }}
            >
              ⚠ {leakResult.streakRunIndices?.length || 0} rows flagged
            </span>
          )}
          <span className="badge badge-teal">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {showDate && <th>Date</th>}
              <th>Time</th>
              <th>Server PID</th>
              <th>VmRSS</th>
              <th>VmSize</th>
              <th>Anon Memory</th>
              <th>JSSE Threads</th>
              <th>Net Connections</th>
              <th>Socket Entries</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, i) => {
              const ts = run.timestamp || '';
              const [datePart, timePart] = ts.split(' ');
              const prevRun = i > 0 ? runs[i - 1] : null;
              const vmRssKb = run.metrics?.vmRssKb;
              const vmSizeKb = run.metrics?.vmSizeKb;
              const anonMb   = run.metrics?.anonMemoryMb;
              const threads  = run.metrics?.jsseNioThreads;
              const conns    = run.metrics?.networkConnections;
              const socks    = run.metrics?.socketMemoryEntries;
              const inStreak = streakSet.has(i);

              return (
                <tr
                  key={i}
                  style={inStreak ? { background: '#fff5f5' } : {}}
                >
                  {showDate && <td>{datePart || '—'}</td>}
                  <td>
                    <span className="badge badge-blue">{timePart || ts}</span>
                    {inStreak && (
                      <span
                        title="RSS growing in this snapshot"
                        style={{
                          marginLeft: 6,
                          fontSize: '0.7rem',
                          background: '#ef4444',
                          color: 'white',
                          borderRadius: 99,
                          padding: '0.1rem 0.4rem',
                          fontWeight: 700,
                        }}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td><code style={{ fontSize: '0.8rem' }}>{run.serverPid || '—'}</code></td>
                  <td>{fmtKb(vmRssKb, prevRun?.metrics?.vmRssKb, inStreak)}</td>
                  <td>{fmtKb(vmSizeKb, prevRun?.metrics?.vmSizeKb, false)}</td>
                  <td><span className="badge badge-orange">{fmtMb(anonMb)}</span></td>
                  <td>{fmtNum(threads)}</td>
                  <td>{fmtNum(conns)}</td>
                  <td>{fmtNum(socks)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {leakResult?.isLeaking && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderTop: '1px solid #fecaca',
            background: '#fff5f5',
            fontSize: '0.78rem',
            color: '#7f1d1d',
          }}
        >
          ↑ Red rows = VmRSS growing · ↑↓ arrows show change vs. previous snapshot
        </div>
      )}
    </div>
  );
}
