function fmtKb(kb) {
  if (kb === undefined || kb === null || isNaN(kb)) return <span className="no-data">—</span>;
  return (kb / 1024).toFixed(0) + ' MB';
}

function fmtMb(mb) {
  if (mb === undefined || mb === null || isNaN(mb)) return <span className="no-data">—</span>;
  return mb.toFixed(1) + ' MB';
}

function fmtNum(n) {
  if (n === undefined || n === null || isNaN(n)) return <span className="no-data">—</span>;
  return n;
}

export default function RunsTable({ runs, showDate }) {
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

  return (
    <div className="table-card">
      <div className="table-header">
        <h3>📋 Diagnostic Snapshots</h3>
        <span className="badge badge-teal">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
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
              const vmRssKb = run.metrics?.vmRssKb;
              const vmSizeKb = run.metrics?.vmSizeKb;
              const anonMb = run.metrics?.anonMemoryMb;
              const threads = run.metrics?.jsseNioThreads;
              const conns = run.metrics?.networkConnections;
              const socks = run.metrics?.socketMemoryEntries;

              return (
                <tr key={i}>
                  {showDate && <td>{datePart || '—'}</td>}
                  <td><span className="badge badge-blue">{timePart || ts}</span></td>
                  <td><code style={{ fontSize: '0.8rem' }}>{run.serverPid || '—'}</code></td>
                  <td style={{ fontWeight: 600 }}>{fmtKb(vmRssKb)}</td>
                  <td>{fmtKb(vmSizeKb)}</td>
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
    </div>
  );
}
