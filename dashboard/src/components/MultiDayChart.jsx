import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Area,
} from 'recharts';

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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">📅 {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          {p.name}: <strong>
            {p.value !== null && p.value !== undefined
              ? (p.name.includes('Threads') || p.name.includes('Conn') || p.name.includes('Socket')
                ? p.value.toFixed(0)
                : p.value.toFixed(1) + ' MB')
              : '—'}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default function MultiDayChart({ reports }) {
  const data = reports.map(report => {
    const runs = report.runs;
    const rssArr = runs.map(r => r.metrics?.vmRssKb ? r.metrics.vmRssKb / 1024 : null).filter(Boolean);
    const sizeArr = runs.map(r => r.metrics?.vmSizeKb ? r.metrics.vmSizeKb / 1024 : null).filter(Boolean);
    const anonArr = runs.map(r => r.metrics?.anonMemoryMb).filter(Boolean);
    const threadArr = runs.map(r => r.metrics?.jsseNioThreads).filter(v => v !== undefined && v !== null);
    const connArr = runs.map(r => r.metrics?.networkConnections).filter(v => v !== undefined && v !== null);

    return {
      date: report.date || report.filename,
      avgRssMb: avg(rssArr) ? +avg(rssArr).toFixed(1) : null,
      peakRssMb: max(rssArr) ? +max(rssArr).toFixed(1) : null,
      avgAnonMb: avg(anonArr) ? +avg(anonArr).toFixed(1) : null,
      avgThreads: avg(threadArr) ? +avg(threadArr).toFixed(1) : null,
      maxConns: max(connArr),
      runs: runs.length,
    };
  });

  return (
    <div className="comparison-section">
      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-header">
            <h3>📅 Daily Memory Comparison</h3>
            <p>Average and peak VmRSS per day across all snapshots</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" MB" width={65} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="avgRssMb" name="Avg VmRSS" fill="#00a884" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line
                type="monotone"
                dataKey="peakRssMb"
                name="Peak VmRSS"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 5, fill: '#ef4444' }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3>🔀 Daily Thread &amp; Connection Trends</h3>
            <p>Average JSSE NIO threads and max connections per day</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="maxConns" name="Max Connections" fill="#10b981" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line
                type="monotone"
                dataKey="avgThreads"
                name="Avg Threads"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#f59e0b' }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-grid single">
        <div className="chart-card">
          <div className="chart-header">
            <h3>📦 Daily Anonymous Memory Trend</h3>
            <p>Average anonymous memory allocation per day</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" MB" width={65} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="avgAnonMb"
                name="Avg Anon Memory"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#8b5cf6' }}
                fill="#8b5cf6"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
