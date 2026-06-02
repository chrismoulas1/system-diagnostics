import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';

const COLOR_NORMAL  = '#00a884';
const COLOR_LEAK    = '#ef4444';
const COLOR_VMSIZE  = '#3b82f6';
const COLOR_ANON    = '#8b5cf6';

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
          {p.name}:{' '}
          <strong>
            {p.value !== null && p.value !== undefined
              ? p.value.toFixed(1) + ' MB'
              : '—'}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default function MemoryChart({ runs, leakResult }) {
  const data = runs.map(r => ({
    time:     shortTime(r.timestamp),
    fullTime: r.timestamp,
    vmRssMb:  r.metrics?.vmRssKb  ? +(r.metrics.vmRssKb  / 1024).toFixed(1) : null,
    vmSizeMb: r.metrics?.vmSizeKb ? +(r.metrics.vmSizeKb / 1024).toFixed(1) : null,
    anonMb:   r.metrics?.anonMemoryMb ? +r.metrics.anonMemoryMb.toFixed(1)  : null,
  }));

  const isLeaking = leakResult?.isLeaking;
  const rssColor  = isLeaking ? COLOR_LEAK : COLOR_NORMAL;

  // Build the ReferenceArea boundaries from the streak indices
  let streakAreaStart = null;
  let streakAreaEnd   = null;
  if (isLeaking && leakResult.streakRunIndices?.length >= 2) {
    const idxFirst = leakResult.streakRunIndices[0];
    const idxLast  = leakResult.streakRunIndices[leakResult.streakRunIndices.length - 1];
    streakAreaStart = data[idxFirst]?.time;
    streakAreaEnd   = data[idxLast]?.time;
  }

  const hasData = data.some(d => d.vmRssMb !== null || d.vmSizeMb !== null);

  return (
    <div className="chart-card" style={isLeaking ? { outline: '2px solid #fca5a5', outlineOffset: '-2px' } : {}}>
      <div className="chart-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h3>💾 Memory Usage Over Time</h3>
          {isLeaking && (
            <span style={{
              background: '#ef4444', color: 'white',
              borderRadius: 99, padding: '0.15rem 0.6rem',
              fontSize: '0.72rem', fontWeight: 700,
            }}>
              ⚠ Leak trend detected
            </span>
          )}
        </div>
        <p>Resident Set Size (VmRSS), Virtual Memory (VmSize) and Anonymous Memory</p>
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: rssColor }} />
            VmRSS {isLeaking ? '(growing ↑)' : ''}
          </span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLOR_VMSIZE }} />VmSize</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: COLOR_ANON }} />Anon Memory</span>
          {isLeaking && streakAreaStart && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#fee2e2', border: '1px solid #fca5a5' }} />
              Leak window
            </span>
          )}
        </div>
      </div>

      {hasData ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" MB" width={65} />
            <Tooltip content={<CustomTooltip />} />

            {/* Highlight the leak window */}
            {isLeaking && streakAreaStart && streakAreaEnd && (
              <ReferenceArea
                x1={streakAreaStart}
                x2={streakAreaEnd}
                fill="#fee2e2"
                fillOpacity={0.6}
                stroke="#fca5a5"
                strokeWidth={1}
                label={{ value: '⚠ growing', position: 'top', fontSize: 10, fill: '#ef4444' }}
              />
            )}

            <Line
              type="monotone"
              dataKey="vmRssMb"
              name="VmRSS"
              stroke={rssColor}
              strokeWidth={2.5}
              dot={(props) => {
                const idx = props.index;
                const inStreak = leakResult?.streakRunIndices?.includes(idx);
                return (
                  <circle
                    key={`dot-${idx}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={inStreak ? 6 : 4}
                    fill={inStreak ? '#ef4444' : rssColor}
                    stroke={inStreak ? '#b91c1c' : 'none'}
                    strokeWidth={inStreak ? 1.5 : 0}
                  />
                );
              }}
              activeDot={{ r: 7 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="vmSizeMb"
              name="VmSize"
              stroke={COLOR_VMSIZE}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={{ r: 4, fill: COLOR_VMSIZE }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="anonMb"
              name="Anon Memory"
              stroke={COLOR_ANON}
              strokeWidth={2}
              dot={{ r: 3, fill: COLOR_ANON }}
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
