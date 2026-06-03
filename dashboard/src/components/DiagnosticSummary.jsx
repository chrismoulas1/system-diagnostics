/**
 * DiagnosticSummary — plain-language outline of every graph shown on the dashboard.
 *
 * Renders a collapsible card with three sections:
 *  1. What the graphs show  – one paragraph per chart, in the same order they appear
 *  2. Leak candidates       – bullet list of signals that triggered, with clear language
 *  3. What to do next       – actionable recommendation derived from the leak type
 *
 * Props
 *  runs        – array of run objects currently displayed (single day or all days)
 *  reports     – array of daily report objects (for multi-day context)
 *  leakResult  – output of detectMemoryLeak() for the displayed runs
 *  isMultiDay  – boolean
 *  activeTab   – current tab index (0 = overview for multi-day)
 */

import { useState } from 'react';

/* ── helpers ──────────────────────────────────────────────────────────── */

function mb(kb) {
  return kb != null ? (kb / 1024).toFixed(0) : null;
}

function sign(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function pct(val, ref) {
  if (!ref || ref === 0) return null;
  return (((val - ref) / ref) * 100).toFixed(1);
}

function avg(arr) {
  const v = arr.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* ── sub-components ───────────────────────────────────────────────────── */

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.07em', color: '#64748b', marginBottom: '0.45rem',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Bullet({ icon, text, color = '#1e293b' }) {
  return (
    <div style={{
      display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
      marginBottom: '0.35rem', fontSize: '0.84rem', lineHeight: 1.55, color,
    }}>
      <span style={{ flexShrink: 0, marginTop: '0.05rem' }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function LeakCandidate({ result }) {
  if (!result?.isLeaking) return null;

  const items = [];

  // RSS growth
  items.push({
    icon: '💾',
    text: (
      <>
        <strong>Physical RAM (VmRSS)</strong> grew from{' '}
        <strong>{result.firstRssMb} MB</strong> to{' '}
        <strong>{result.lastRssMb} MB</strong>
        {' '}— a rise of <strong>+{result.growthMb} MB ({sign(result.growthPct)}%)</strong>
        {result.maxStreak >= 3 && (
          <> across <strong>{result.maxStreak} consecutive snapshots</strong></>
        )}
        . This is the primary leak signal.
      </>
    ),
    color: '#7f1d1d',
  });

  // Anonymous memory
  if (result.anonCorr && result.anonGrowthMb != null) {
    items.push({
      icon: '📦',
      text: (
        <>
          <strong>Anonymous (heap / off-heap) memory</strong> also increased by{' '}
          <strong>+{result.anonGrowthMb} MB ({sign(result.anonGrowthPct)}%)</strong>
          , moving in step with RAM. This points to <strong>retained Java heap objects,
          JVM Metaspace, or direct ByteBuffer allocations</strong> that are not being
          garbage-collected.
        </>
      ),
      color: '#6b21a8',
    });
  }

  // Thread growth
  if (result.threadCorr && result.threadGrowth != null && result.threadGrowth !== 0) {
    items.push({
      icon: '🔁',
      text: (
        <>
          <strong>JSSE NIO thread count</strong> grew by{' '}
          <strong>{sign(result.threadGrowth)} threads</strong>. Each JVM thread
          consumes roughly <strong>256 kB–1 MB of physical RAM</strong> for its native
          stack, which directly contributes to the VmRSS increase.
        </>
      ),
      color: '#92400e',
    });
  }

  // Connection growth
  if (result.connCorr && result.connGrowth != null && result.connGrowth !== 0) {
    items.push({
      icon: '🌐',
      text: (
        <>
          <strong>Network connection count</strong> rose by{' '}
          <strong>{sign(result.connGrowth)} connections</strong>. Every open socket
          causes the kernel to hold <strong>send/receive buffers (4–128 kB each)</strong>{' '}
          that are charged to the process, increasing physical RAM usage.
        </>
      ),
      color: '#065f46',
    });
  }

  // Anon/RSS ratio
  if (result.avgAnonPct != null) {
    const high = result.avgAnonPct > 65;
    items.push({
      icon: '📊',
      text: (
        <>
          <strong>{result.avgAnonPct}% of physical RAM is anonymous</strong> on average.{' '}
          {high
            ? <>This is <strong>high (above 65%)</strong>, which strongly confirms the growth
               originates in heap or native off-heap memory rather than the JIT code cache or
               memory-mapped files.</>
            : <>This is a mixed picture — some of the RAM growth may come from the JIT compiled-code
               cache or memory-mapped JARs, which is normal for JVMs.</>}
        </>
      ),
      color: high ? '#7f1d1d' : '#1e293b',
    });
  }

  return (
    <div>
      {items.map((item, i) => (
        <Bullet key={i} icon={item.icon} text={item.text} color={item.color} />
      ))}
    </div>
  );
}

/* ── build the "what the graphs show" narrative ───────────────────────── */

function buildGraphNarrative(runs, leakResult, isMultiDay, activeTab, reports) {
  const paragraphs = [];

  /* ── Memory chart ─────────────────────────────────────── */
  if (runs.length > 0) {
    const rssVals = runs.map(r => r.metrics?.vmRssKb).filter(Boolean);
    const anonVals = runs.map(r => r.metrics?.anonMemoryMb).filter(Boolean);
    const firstRss = rssVals[0];
    const lastRss  = rssVals[rssVals.length - 1];

    if (firstRss && lastRss) {
      const delta = lastRss - firstRss;
      const deltaPct = pct(lastRss, firstRss);
      const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'remained stable';
      const anonNote = anonVals.length
        ? ` Anonymous (heap/off-heap) memory moved from ${anonVals[0].toFixed(1)} MB to ${anonVals[anonVals.length - 1].toFixed(1)} MB over the same period.`
        : '';

      paragraphs.push({
        icon: '💾',
        title: 'Memory Usage Over Time',
        text: `The memory chart tracks three lines: VmRSS (how much physical RAM the process actually uses), ` +
          `VmSize (total virtual address space, which is always much larger than RAM and is normal), and ` +
          `anonymous memory (heap plus native off-heap). Over this period, physical RAM ${direction} from ` +
          `${mb(firstRss)} MB to ${mb(lastRss)} MB` +
          (deltaPct ? ` (${sign(parseFloat(deltaPct))}%)` : '') +
          `.${anonNote}` +
          (leakResult?.isLeaking
            ? ` A shaded red region marks the window where consecutive rises were detected.`
            : ' No sustained upward trend was detected.'),
      });
    }
  }

  /* ── Thread & Connection counts chart ────────────────── */
  if (runs.length > 0) {
    const threadVals = runs.map(r => r.metrics?.jsseNioThreads).filter(v => v != null);
    const connVals   = runs.map(r => r.metrics?.networkConnections).filter(v => v != null);

    if (threadVals.length || connVals.length) {
      const threadDesc = threadVals.length
        ? `JSSE NIO threads ranged from ${Math.min(...threadVals)} to ${Math.max(...threadVals)}`
        : null;
      const connDesc = connVals.length
        ? `network connections peaked at ${Math.max(...connVals)} (avg ${avg(connVals)?.toFixed(0)})`
        : null;
      const parts = [threadDesc, connDesc].filter(Boolean).join('; ');

      paragraphs.push({
        icon: '🔀',
        title: 'Thread & Connection Counts',
        text: `This chart combines two types of resources that consume physical RAM indirectly. ` +
          `${parts ? `In the current view, ${parts}.` : ''} ` +
          `Each NIO thread reserves a native stack (256 kB–1 MB), and each open socket causes the kernel ` +
          `to hold small send/receive buffers. When either metric trends upward alongside VmRSS, ` +
          `it corroborates a memory leak.`,
      });
    }
  }

  /* ── Multi-day charts (overview tab) ─────────────────── */
  if (isMultiDay && activeTab === 0 && reports?.length > 1) {
    const dailyRss = reports.map(rep => {
      const rss = rep.runs.map(r => r.metrics?.vmRssKb).filter(Boolean);
      return rss.length ? rss[rss.length - 1] / 1024 : null;
    }).filter(Boolean);

    if (dailyRss.length >= 2) {
      const trend = dailyRss[dailyRss.length - 1] - dailyRss[0];
      paragraphs.push({
        icon: '📅',
        title: 'Daily Memory Comparison',
        text: `The daily comparison chart shows how average and peak VmRSS changed across ${reports.length} days. ` +
          `The bars represent the daily average RAM and the red line marks the daily peak. ` +
          (trend > 0
            ? `RAM at the end of the last day (${dailyRss[dailyRss.length - 1].toFixed(0)} MB) is ` +
              `${trend.toFixed(0)} MB higher than at the end of the first day (${dailyRss[0].toFixed(0)} MB), ` +
              `indicating a day-over-day upward trend.`
            : `RAM usage appears stable or declining across days.`),
      });

      paragraphs.push({
        icon: '📦',
        title: 'Daily Anonymous Memory Trend',
        text: `The anonymous memory trend chart shows how much of RAM is privately allocated (heap objects, ` +
          `JVM Metaspace, direct ByteBuffers) on each day on average. A rising line here alongside rising ` +
          `VmRSS is one of the strongest indicators of a Java heap or off-heap native memory leak.`,
      });
    }
  }

  return paragraphs;
}

/* ── SEVERITY colours ─────────────────────────────────────────────────── */

const SEV = {
  high:   { bg: '#fef2f2', border: '#fca5a5', accent: '#ef4444', label: '🔴 High Risk' },
  medium: { bg: '#fff7ed', border: '#fdba74', accent: '#f97316', label: '🟠 Medium Risk' },
  low:    { bg: '#fefce8', border: '#fde047', accent: '#eab308', label: '🟡 Low Risk' },
};

const TYPE_RECOMMENDATION = {
  'heap-native':
    'Take a heap dump while the leak is active (jmap -dump:format=b,file=heap.hprof <pid>) and ' +
    'analyse it with Eclipse MAT or VisualVM to find objects that are accumulating. Also review ' +
    'direct ByteBuffer allocations and any in-memory caches that may not be evicting entries.',
  'thread-stack':
    'Inspect thread-pool configuration (maxThreads, corePoolSize) and take a JVM thread dump ' +
    '(COMMAND_12) to look for threads stuck in WAITING or BLOCKED states. Verify that ' +
    'ExecutorService instances are shut down when no longer needed.',
  'socket-buffer':
    'Check that HTTP clients, database connections, and JSSE sessions are closed after use. ' +
    'Review connection-pool idle-timeout settings. Run: ss -antp | grep <pid> to identify ' +
    'CLOSE_WAIT sockets, which indicate the server is not closing connections it should.',
  'compound':
    'Start with a heap dump (jmap -dump) and a JVM thread dump taken while the leak is active. ' +
    'Address the largest contributor first: compare anonymous memory growth against thread × ' +
    'stack-size; whichever is bigger is the primary source. Then work through the secondary signals.',
  'rss-only':
    'Enable GC logging (-Xlog:gc*) and check for growing OldGen or Metaspace. Review JIT ' +
    'CodeCache usage (-XX:+PrintCodeCache or JMX). If the server uses memory-mapped files ' +
    '(JARs, log files), those appear in VmRSS but not in anonymous memory — this is normal.',
};

/* ── main component ───────────────────────────────────────────────────── */

export default function DiagnosticSummary({ runs, reports, leakResult, isMultiDay, activeTab }) {
  const [open, setOpen] = useState(true);

  if (!runs?.length) return null;

  const paragraphs = buildGraphNarrative(runs, leakResult, isMultiDay, activeTab, reports);
  const isLeaking  = leakResult?.isLeaking;
  const sev        = isLeaking ? (SEV[leakResult.severity] || SEV.low) : null;
  const recommendation = isLeaking ? TYPE_RECOMMENDATION[leakResult.leakType] || TYPE_RECOMMENDATION['rss-only'] : null;

  const headerBg     = isLeaking ? sev.bg : '#f8fafc';
  const headerBorder = isLeaking ? sev.accent : '#cbd5e1';
  const headerText   = isLeaking ? sev.accent : '#475569';

  return (
    <div
      className="diagnostic-summary"
      style={{
        background: '#ffffff',
        border: `1px solid ${isLeaking ? sev.border : '#e2e8f0'}`,
        borderLeft: `4px solid ${isLeaking ? sev.accent : '#00a884'}`,
        borderRadius: 12,
        marginBottom: '1.25rem',
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {/* ── Toggle header ──────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.25rem',
          background: headerBg,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1rem' }}>📋</span>
          <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>Diagnostic Summary</strong>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            — plain-language overview of all charts
          </span>
          {isLeaking && (
            <span style={{
              background: sev.accent, color: 'white', borderRadius: 99,
              padding: '0.1rem 0.55rem', fontSize: '0.68rem', fontWeight: 700,
            }}>
              {sev.label}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.8rem', color: headerText, flexShrink: 0 }}>
          {open ? '▲ collapse' : '▼ expand'}
        </span>
      </button>

      {/* ── Body ───────────────────────────────────────────── */}
      {open && (
        <div style={{ padding: '1rem 1.25rem' }}>

          {/* 1. What each graph shows */}
          <Section title="What the graphs show">
            {paragraphs.length > 0 ? paragraphs.map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                  marginBottom: i < paragraphs.length - 1 ? '0.65rem' : 0,
                  paddingBottom: i < paragraphs.length - 1 ? '0.65rem' : 0,
                  borderBottom: i < paragraphs.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}
              >
                <span style={{ fontSize: '1.05rem', flexShrink: 0, marginTop: '0.05rem' }}>{p.icon}</span>
                <div>
                  <strong style={{ fontSize: '0.83rem', color: '#1e293b' }}>{p.title}: </strong>
                  <span style={{ fontSize: '0.83rem', color: '#334155', lineHeight: 1.6 }}>{p.text}</span>
                </div>
              </div>
            )) : (
              <p style={{ fontSize: '0.83rem', color: '#64748b' }}>Not enough data to describe the graphs.</p>
            )}
          </Section>

          {/* 2. Leak candidates */}
          <Section title={isLeaking ? '⚠ Leak candidates — what triggered the alert' : '✓ No leak candidates detected'}>
            {isLeaking ? (
              <LeakCandidate result={leakResult} />
            ) : (
              <p style={{ fontSize: '0.83rem', color: '#166534', lineHeight: 1.55 }}>
                None of the monitored signals (VmRSS, anonymous memory, thread count, connection count) showed
                the sustained upward pattern required to flag a memory leak. The process appears healthy
                for this time window. Continue monitoring to catch gradual trends.
              </p>
            )}
          </Section>

          {/* 3. Recommendation */}
          {isLeaking && recommendation && (
            <Section title="What to do next">
              <div style={{
                background: '#f8fafc', borderRadius: 8,
                padding: '0.65rem 0.9rem',
                fontSize: '0.83rem', color: '#1e293b', lineHeight: 1.6,
              }}>
                <strong style={{ color: sev.accent }}>Recommended action: </strong>
                {recommendation}
              </div>
            </Section>
          )}

        </div>
      )}
    </div>
  );
}
