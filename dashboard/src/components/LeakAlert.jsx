const SEVERITY_CONFIG = {
  high: {
    bg: '#fef2f2',
    border: '#fca5a5',
    text: '#7f1d1d',
    accent: '#ef4444',
    label: '🔴 High Risk',
    icon: '🚨',
  },
  medium: {
    bg: '#fff7ed',
    border: '#fdba74',
    text: '#7c2d12',
    accent: '#f97316',
    label: '🟠 Medium Risk',
    icon: '⚠️',
  },
  low: {
    bg: '#fefce8',
    border: '#fde047',
    text: '#713f12',
    accent: '#eab308',
    label: '🟡 Low Risk',
    icon: '⚠️',
  },
};

export default function LeakAlert({ result }) {
  if (!result?.isLeaking) return null;

  const cfg = SEVERITY_CONFIG[result.severity] || SEVERITY_CONFIG.low;

  return (
    <div
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderLeft: `4px solid ${cfg.accent}`,
        borderRadius: 10,
        padding: '1rem 1.25rem',
        marginBottom: '1.25rem',
        display: 'flex',
        gap: '1rem',
        alignItems: 'flex-start',
      }}
    >
      <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{cfg.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
          <strong style={{ color: cfg.text, fontSize: '0.95rem' }}>
            Potential Memory Leak Detected
          </strong>
          <span
            style={{
              background: cfg.accent,
              color: 'white',
              borderRadius: 99,
              padding: '0.15rem 0.6rem',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            {cfg.label}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            fontSize: '0.85rem',
            color: cfg.text,
            marginBottom: '0.6rem',
          }}
        >
          <span>
            📈 VmRSS grew <strong>{result.growthMb > 0 ? '+' : ''}{result.growthMb} MB</strong>
            {' '}({result.growthPct > 0 ? '+' : ''}{result.growthPct}%)
            {' '}from {result.firstRssMb} MB → {result.lastRssMb} MB
          </span>
          {result.byStreak && (
            <span>
              🔁 <strong>{result.maxStreak} consecutive</strong> snapshot{result.maxStreak !== 1 ? 's' : ''} with rising RSS
            </span>
          )}
        </div>

        {result.streakStartTime && (
          <div style={{ fontSize: '0.8rem', color: cfg.text, opacity: 0.8, marginBottom: '0.5rem' }}>
            ⏱ Growth window: <strong>{result.streakStartTime}</strong> → <strong>{result.streakEndTime}</strong>
          </div>
        )}

        <div
          style={{
            background: 'rgba(0,0,0,0.04)',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            fontSize: '0.8rem',
            color: cfg.text,
          }}
        >
          <strong>Recommendation:</strong> Check JVM heap settings, thread pool size, and whether a JVM thread dump
          (COMMAND_12) was captured during this period. Rising anonymous memory alongside RSS may indicate an off-heap leak.
        </div>
      </div>
    </div>
  );
}
