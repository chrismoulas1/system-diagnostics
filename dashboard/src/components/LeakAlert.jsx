/**
 * LeakAlert — multi-signal physical memory leak summary.
 *
 * Shows:
 *  - Leak type and what it means physically
 *  - Per-signal breakdown (RSS, Anon, Threads, Connections)
 *  - Anon/RSS ratio interpretation
 *  - Type-specific actionable recommendation
 */

const SEVERITY = {
  high:   { bg: '#fef2f2', border: '#fca5a5', accent: '#ef4444', text: '#7f1d1d', badge: '🔴 High Risk'   },
  medium: { bg: '#fff7ed', border: '#fdba74', accent: '#f97316', text: '#7c2d12', badge: '🟠 Medium Risk' },
  low:    { bg: '#fefce8', border: '#fde047', accent: '#eab308', text: '#713f12', badge: '🟡 Low Risk'    },
};

const LEAK_TYPE_META = {
  'heap-native': {
    icon: '🧠',
    label: 'Heap / Off-heap Native Memory Leak',
    explanation:
      'Anonymous memory (heap, JVM Metaspace, direct ByteBuffers, JNI) is growing in step with physical RAM. ' +
      'Anonymous pages are not file-backed, so their growth cannot be explained by disk caching or mmap — ' +
      'this is almost certainly retained heap or native off-heap memory.',
    recommendation:
      'Capture a heap dump: jmap -dump:format=b,file=heap.hprof <pid>. ' +
      'Analyse with Eclipse MAT or VisualVM. ' +
      'Also check COMMAND_12 (JVM thread dump) for threads parked in I/O or waiting on a leaked resource. ' +
      'Review direct ByteBuffer allocations and any growing in-memory caches.',
  },
  'thread-stack': {
    icon: '🔁',
    label: 'Thread Stack Accumulation',
    explanation:
      'JSSE NIO thread count is rising alongside VmRSS. Each JVM thread reserves a native stack ' +
      '(typically 256 kB – 1 MB of physical RAM). Unchecked thread-pool growth or leaked executor ' +
      'services will cause VmRSS to climb even if the heap is healthy.',
    recommendation:
      'Check thread-pool configuration (maxThreads, corePoolSize). ' +
      'Inspect COMMAND_12 (JVM thread dump) to find threads stuck in WAITING or BLOCKED states — ' +
      'a blocked queue may be preventing pool threads from terminating. ' +
      'Verify that ExecutorService instances are being shut down when no longer needed.',
  },
  'socket-buffer': {
    icon: '🌐',
    label: 'Socket Buffer Accumulation',
    explanation:
      'Network connection count is growing with VmRSS. Open socket file descriptors cause the kernel to ' +
      'maintain per-socket send/receive buffers (typically 4–128 kB each) that are attributed to the process. ' +
      'Large numbers of unclosed connections can produce measurable physical RAM growth.',
    recommendation:
      'Check COMMAND_10 and COMMAND_11 trends. ' +
      'Verify that all HTTP clients, database connections, and JSSE sessions are closed after use. ' +
      'Review connection-pool limits and idle-timeout settings. ' +
      'Use ss -antp | grep <pid> to identify connection states (CLOSE_WAIT = server-side leak).',
  },
  'compound': {
    icon: '⚡',
    label: 'Multiple Leak Vectors',
    explanation:
      'Two or more secondary signals (anonymous memory, thread count, connection count) are rising alongside ' +
      'VmRSS. This suggests a compound issue — likely a primary heap/native leak compounded by thread or ' +
      'socket accumulation, or multiple independent leaks active simultaneously.',
    recommendation:
      'Start with a heap dump (jmap -dump) and COMMAND_12 JVM thread dump taken while the leak is active. ' +
      'Address the largest RSS contributor first. ' +
      'Cross-reference anonymous memory growth against thread stack totals: ' +
      'if anon >> threads × stack_size then the primary leak is heap/native, not thread stacks.',
  },
  'rss-only': {
    icon: '❓',
    label: 'Physical RAM Growing — Source Unclear',
    explanation:
      'VmRSS is climbing but anonymous memory, thread count, and connection count are not clearly correlated. ' +
      'Possible sources: JIT compiled-code cache (CodeCache), memory-mapped files, kernel page-cache pages ' +
      'mapped into the process, or a very slow heap leak not yet visible in the anon signal.',
    recommendation:
      'Enable GC logging (-Xlog:gc*) and check for growing OldGen or Metaspace. ' +
      'Review JVM CodeCache usage (-XX:+PrintCodeCache or JMX). ' +
      'If the server uses mmap-backed files (memory-mapped logs, large JARs), ' +
      'those will appear in VmRSS but not in anonymous memory — this is normal.',
  },
};

function SignalRow({ icon, label, value, pct, isFlagged, noData }) {
  const color  = noData ? '#94a3b8' : isFlagged ? '#ef4444' : '#10b981';
  const symbol = noData ? '—' : isFlagged ? '↑ rising' : '✓ stable';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.82rem', flexWrap: 'wrap' }}>
      <span style={{ width: 20, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 160, fontWeight: 500 }}>{label}</span>
      {value != null && <span style={{ fontWeight: 700, color }}>{value}</span>}
      {pct  != null && <span style={{ color, opacity: 0.85 }}>({pct > 0 ? '+' : ''}{pct}%)</span>}
      <span style={{
        marginLeft: 'auto', padding: '0.1rem 0.5rem', borderRadius: 99,
        background: noData ? '#f1f5f9' : isFlagged ? '#fee2e2' : '#d1fae5',
        color, fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap',
      }}>
        {symbol}
      </span>
    </div>
  );
}

export default function LeakAlert({ result }) {
  if (!result?.isLeaking) return null;

  const sev  = SEVERITY[result.severity]  || SEVERITY.low;
  const meta = LEAK_TYPE_META[result.leakType] || LEAK_TYPE_META['rss-only'];

  const anonPctLabel = result.avgAnonPct != null
    ? `${result.avgAnonPct}% of physical RAM is anonymous (heap/native)`
    : null;

  return (
    <div style={{
      background: sev.bg,
      border: `1px solid ${sev.border}`,
      borderLeft: `4px solid ${sev.accent}`,
      borderRadius: 10,
      padding: '1rem 1.25rem',
      marginBottom: '1.25rem',
    }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
            <strong style={{ color: sev.text, fontSize: '0.95rem' }}>
              Potential Physical Memory Leak — {meta.label}
            </strong>
            <span style={{
              background: sev.accent, color: 'white', borderRadius: 99,
              padding: '0.15rem 0.6rem', fontSize: '0.7rem', fontWeight: 700,
            }}>
              {sev.badge}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: sev.text, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
            {meta.explanation}
          </p>
        </div>
      </div>

      {/* ── Signal breakdown ────────────────────────────────── */}
      <div style={{
        background: 'rgba(0,0,0,0.03)', borderRadius: 8,
        padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: sev.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
          Signal breakdown
        </div>

        <SignalRow
          icon="💾" label="VmRSS (physical RAM)"
          value={`${result.growthMb >= 0 ? '+' : ''}${result.growthMb} MB`}
          pct={result.growthPct}
          isFlagged={true}
        />
        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0.1rem 0' }} />

        <SignalRow
          icon="📦" label="Anonymous memory (heap / off-heap)"
          value={result.anonGrowthMb != null ? `${result.anonGrowthMb >= 0 ? '+' : ''}${result.anonGrowthMb} MB` : null}
          pct={result.anonGrowthPct}
          isFlagged={result.anonCorr}
          noData={result.anonGrowthMb == null}
        />
        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0.1rem 0' }} />

        <SignalRow
          icon="🔁" label="JSSE NIO threads"
          value={result.threadGrowth != null ? `${result.threadGrowth >= 0 ? '+' : ''}${result.threadGrowth} threads` : null}
          isFlagged={result.threadCorr}
          noData={result.threadGrowth == null}
        />
        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0.1rem 0' }} />

        <SignalRow
          icon="🌐" label="Network connections"
          value={result.connGrowth != null ? `${result.connGrowth >= 0 ? '+' : ''}${result.connGrowth} connections` : null}
          isFlagged={result.connCorr}
          noData={result.connGrowth == null}
        />

        {/* Anon/RSS ratio context */}
        {anonPctLabel && (
          <div style={{
            marginTop: '0.5rem', padding: '0.35rem 0.5rem',
            background: result.avgAnonPct > 65 ? '#fee2e2' : '#f0fdf4',
            borderRadius: 6, fontSize: '0.77rem',
            color: result.avgAnonPct > 65 ? '#991b1b' : '#166534',
            fontWeight: 500,
          }}>
            📊 {anonPctLabel}
            {result.avgAnonPct > 65
              ? ' — very high; confirms heap / native origin'
              : ' — mixed; some growth may be JIT cache or file mappings'}
          </div>
        )}
      </div>

      {/* ── VmRSS growth window ─────────────────────────────── */}
      <div style={{ fontSize: '0.78rem', color: sev.text, opacity: 0.8, marginBottom: '0.6rem' }}>
        💾 VmRSS: <strong>{result.firstRssMb} MB → {result.lastRssMb} MB</strong>
        {' '}({result.growthMb >= 0 ? '+' : ''}{result.growthMb} MB, {result.growthPct >= 0 ? '+' : ''}{result.growthPct}%)
        {result.maxStreak >= 3 && (
          <> · <strong>{result.maxStreak} consecutive</strong> snapshots rising</>
        )}
        {result.streakStartTime && (
          <> · window: <strong>{result.streakStartTime}</strong> → <strong>{result.streakEndTime}</strong></>
        )}
      </div>

      {/* ── Recommendation ──────────────────────────────────── */}
      <div style={{
        background: 'rgba(0,0,0,0.05)', borderRadius: 7,
        padding: '0.55rem 0.8rem', fontSize: '0.8rem', color: sev.text, lineHeight: 1.55,
      }}>
        <strong>Recommended action:</strong> {meta.recommendation}
      </div>
    </div>
  );
}
