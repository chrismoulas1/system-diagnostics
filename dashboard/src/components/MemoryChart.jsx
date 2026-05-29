import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';

const COLORS = {
  vmRss: '#00a884',
  vmSize: '#3b82f6',
  anonMem: '#8b5cf6',
};

function shortTime(ts) {
  if (!ts) return '';
  const parts = ts.split(' ');
  return parts.length > 1 ? parts[1].slice(0, 5) : ts.slice(-8, -3);
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">🕐 {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: p.color }} />
          {p.name}: <strong>{p.value !== null && p.value !== undefined ? p.value.toFixed(1) + ' MB' : '—'}</strong>
        </div>
      ))}
    </div>
  );
}

export default function MemoryChart({ runs }) {
  const data = runs.map(r => ({
    time: shortTime(r.timestamp),
    fullTime: r.timestamp,
    vmRssMb: r.metrics?.vmRssKb ? +(r.metrics.vmRssKb / 1024).toFixed(1) : null,
    vmSizeMb: r.metrics?.vmSizeKb ? +(r.metrics.vmSizeKb / 1024).toFixed(1) : null,
    anonMb: r.metrics?.anonMemoryMb ? +r.metrics.anonMemoryMb.toFixed(1) : null,
  }));

  const hasData = data.some(d => d.vmRssMb !== null || d.vmSizeMb !== null);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>💾 Memory Usage Over Time</h3>
        <p>Resident Set Size (VmRSS), Virtual Memory (VmSize) and Anonymous Memory</p>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.vmRss }} />VmRSS</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.vmSize }} />VmSize</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLORS.anonMem }} />Anon Memory</span>
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" MB" width={65} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="vmRssMb"
              name="VmRSS"
              stroke={COLORS.vmRss}
              strokeWidth={2.5}
              dot={{ r: 4, fill: COLORS.vmRss }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="vmSizeMb"
              name="VmSize"
              stroke={COLORS.vmSize}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={{ r: 4, fill: COLORS.vmSize }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="anonMb"
              name="Anon Memory"
              stroke={COLORS.anonMem}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS.anonMem }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-state">
          <div className="icon">📭</div>
          <p>No memory data found in this report</p>
        </div>
      )}
    </div>
  );
}
