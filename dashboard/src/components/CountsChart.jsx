import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  ComposedChart,
  Legend,
} from 'recharts';

const COLORS = {
  threads: '#f59e0b',
  connections: '#10b981',
  sockets: '#ef4444',
};

function shortTime(ts) {
  if (!ts) return '';
  const parts = ts.split(' ');
  return parts.length > 1 ? parts[1].slice(0, 5) : ts;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">🕐 {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          {p.name}: <strong>{p.value !== null && p.value !== undefined ? p.value : '—'}</strong>
        </div>
      ))}
    </div>
  );
}

export default function CountsChart({ runs }) {
  const data = runs.map(r => ({
    time: shortTime(r.timestamp),
    threads: r.metrics?.jsseNioThreads ?? null,
    connections: r.metrics?.networkConnections ?? null,
    sockets: r.metrics?.socketMemoryEntries ?? null,
  }));

  const hasThreads = data.some(d => d.threads !== null);
  const hasConns = data.some(d => d.connections !== null);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>🔀 Thread &amp; Connection Counts</h3>
        <p>JSSE NIO threads, active network connections and socket memory entries</p>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.threads }} />JSSE NIO Threads</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.connections }} />Network Connections</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.sockets }} />Socket Entries</span>
        </div>
      </div>
      {(hasThreads || hasConns) ? (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="connections" name="Network Connections" fill={COLORS.connections} opacity={0.8} radius={[3, 3, 0, 0]} />
            <Bar dataKey="sockets" name="Socket Entries" fill={COLORS.sockets} opacity={0.8} radius={[3, 3, 0, 0]} />
            <Line
              type="monotone"
              dataKey="threads"
              name="JSSE NIO Threads"
              stroke={COLORS.threads}
              strokeWidth={2.5}
              dot={{ r: 4, fill: COLORS.threads }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-state">
          <div className="icon">📭</div>
          <p>No thread/connection data found</p>
        </div>
      )}
    </div>
  );
}
