import { useEffect, useState } from 'react';

const INTERVALS = [
  { label: '15 min', seconds: 900 },
  { label: '30 min', seconds: 1800 },
  { label: '1 hr',   seconds: 3600 },
];

function formatCountdown(secs) {
  if (secs <= 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatAgo(date) {
  if (!date) return '—';
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10)  return 'just now';
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
}

export default function AutoRefreshBar({
  host,
  lastFetched,
  secondsToNext,
  paused,
  refreshing,
  interval,
  onIntervalChange,
  onTogglePause,
  onRefreshNow,
}) {
  const [agoText, setAgoText] = useState(() => formatAgo(lastFetched));

  useEffect(() => {
    setAgoText(formatAgo(lastFetched));
    const t = setInterval(() => setAgoText(formatAgo(lastFetched)), 5000);
    return () => clearInterval(t);
  }, [lastFetched]);

  return (
    <div className={`auto-refresh-bar ${paused ? 'paused' : 'active'} ${refreshing ? 'refreshing' : ''}`}>
      <div className="arb-left">
        <span className={`arb-dot ${paused ? '' : 'arb-dot-live'}`} />
        <span className="arb-host">🖥️ {host}</span>
        <span className="arb-sep">·</span>
        <span className="arb-ago">
          {refreshing ? '⏳ Refreshing…' : `Updated ${agoText}`}
        </span>
      </div>

      <div className="arb-right">
        {!paused && !refreshing && (
          <span className="arb-countdown">
            Next in <strong>{formatCountdown(secondsToNext)}</strong>
          </span>
        )}
        {paused && <span className="arb-paused-label">Auto-refresh paused</span>}

        <div className="arb-intervals">
          {INTERVALS.map(opt => (
            <button
              key={opt.seconds}
              className={`arb-interval-btn ${interval === opt.seconds ? 'active' : ''}`}
              onClick={() => onIntervalChange(opt.seconds)}
              disabled={refreshing}
              title={`Refresh every ${opt.label}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          className="arb-btn arb-btn-refresh"
          onClick={onRefreshNow}
          disabled={refreshing}
          title="Fetch latest reports now"
        >
          {refreshing ? '⏳' : '🔄'} Refresh now
        </button>

        <button
          className={`arb-btn ${paused ? 'arb-btn-resume' : 'arb-btn-pause'}`}
          onClick={onTogglePause}
          disabled={refreshing}
          title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>
    </div>
  );
}
