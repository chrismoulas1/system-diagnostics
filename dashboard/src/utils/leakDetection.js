/**
 * Multi-signal physical memory leak detector.
 *
 * Physical memory in Linux is tracked by VmRSS (Resident Set Size) — the number
 * of physical RAM pages allocated to the process. This is the authoritative
 * source for "how much RAM does this process actually use right now."
 *
 * We correlate four signals to classify the leak type:
 *
 *  1. VmRSS       – primary trigger (physical RAM)
 *  2. Anon memory  – private heap + off-heap (not file-backed)
 *                    if Anon ↑ with RSS → heap/native leak confirmed
 *  3. JSSE threads – each thread stack is 256 kB – 1 MB of physical RAM
 *                    if Threads ↑ with RSS → thread-stack leak
 *  4. Connections  – socket buffers are attributed to the process
 *                    if Connections ↑ with RSS → socket-buffer accumulation
 *
 * Leak types emitted:
 *   heap-native   – RSS↑ + Anon↑  (most common JVM leak)
 *   thread-stack  – RSS↑ + Threads↑
 *   socket-buffer – RSS↑ + Connections↑
 *   compound      – RSS↑ + 2+ secondary signals
 *   rss-only      – RSS↑ alone (JIT code cache, mmap, kernel page cache)
 */

/**
 * Analyse a raw value array for an upward trend.
 * Nulls / undefined are skipped transparently.
 *
 * @param {Array<number|null>} rawValues – one entry per run (parallel to runs[])
 * @returns trend descriptor
 */
function analyzeTrend(rawValues) {
  const indexed = rawValues
    .map((v, i) => ({ i, v }))
    .filter(x => x.v !== null && x.v !== undefined && !isNaN(x.v) && x.v >= 0);

  if (indexed.length < 2) return { hasData: false, isFlagged: false };

  const vals = indexed.map(x => x.v);
  const first = vals[0];
  const last  = vals[vals.length - 1];
  const growth    = last - first;
  const growthPct = first > 0 ? (growth / first) * 100 : 0;

  // Longest strictly-increasing consecutive run (on non-null values)
  let maxStreak = 0, streakStart = 0, streakEnd = 0;
  let cur = 0, curStart = 0;

  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i - 1]) {
      if (cur === 0) curStart = i - 1;
      cur++;
      if (cur > maxStreak) {
        maxStreak = cur;
        streakStart = curStart;
        streakEnd = i;
      }
    } else {
      cur = 0;
    }
  }

  // Primary flag criteria: 3+ consecutive increases OR >10% total growth in RSS
  const isFlagged = maxStreak >= 3 || growthPct > 10;

  // Map streak positions back to original run indices
  const streakSlice = isFlagged ? indexed.slice(streakStart, streakEnd + 1) : [];
  const streakOriginalIndices = streakSlice.map(x => x.i);

  return {
    hasData: true,
    isFlagged,
    first, last,
    growth,
    growthPct: +growthPct.toFixed(1),
    maxStreak,
    streakOriginalIndices,
  };
}

/**
 * Main entry-point. Call with the runs array for a single day or across days.
 */
export function detectMemoryLeak(runs) {
  if (!runs || runs.length < 2) return { isLeaking: false };

  const rssTrend    = analyzeTrend(runs.map(r => r.metrics?.vmRssKb ?? null));
  const anonTrend   = analyzeTrend(runs.map(r =>
    r.metrics?.anonMemoryMb != null ? r.metrics.anonMemoryMb * 1024 : null
  ));
  const threadTrend = analyzeTrend(runs.map(r => r.metrics?.jsseNioThreads ?? null));
  const connTrend   = analyzeTrend(runs.map(r => r.metrics?.networkConnections ?? null));

  // VmRSS must be the primary trigger — no RSS signal, no leak flag
  if (!rssTrend.hasData || !rssTrend.isFlagged) {
    return { isLeaking: false, rssTrend, anonTrend, threadTrend, connTrend };
  }

  // ── Secondary signal correlation (relaxed thresholds) ────────────────────
  // We use lower bars here because these secondary signals corroborate RSS,
  // we don't need them to independently reach the primary threshold.
  const anonCorr   = anonTrend.hasData   && (anonTrend.maxStreak   >= 2 || anonTrend.growthPct   > 5);
  const threadCorr = threadTrend.hasData && (threadTrend.maxStreak >= 2 || threadTrend.growth     > 0);
  const connCorr   = connTrend.hasData   && (connTrend.maxStreak   >= 2 || connTrend.growth       > 0);
  const secondaryCount = [anonCorr, threadCorr, connCorr].filter(Boolean).length;

  // ── Leak type classification ──────────────────────────────────────────────
  let leakType;
  if (secondaryCount >= 2)  leakType = 'compound';
  else if (anonCorr)        leakType = 'heap-native';
  else if (threadCorr)      leakType = 'thread-stack';
  else if (connCorr)        leakType = 'socket-buffer';
  else                      leakType = 'rss-only';

  // ── Severity ──────────────────────────────────────────────────────────────
  // Based primarily on RSS growth rate; compound leaks are bumped one level.
  const rssPct = rssTrend.growthPct;
  let severity = 'low';
  if      (rssPct > 30 || rssTrend.maxStreak >= 5) severity = 'high';
  else if (rssPct > 15 || rssTrend.maxStreak >= 4) severity = 'medium';
  if (leakType === 'compound') {
    if      (severity === 'low')    severity = 'medium';
    else if (severity === 'medium') severity = 'high';
  }

  // ── Anon / RSS ratio ──────────────────────────────────────────────────────
  // Tells us what fraction of physical RAM is anonymous (heap / native).
  // High ratio (>65%) → growth almost certainly in heap or off-heap buffers.
  // Low ratio          → JIT code cache, memory-mapped files, or kernel pages.
  const anonRssRatios = runs
    .map(r => {
      const rssKb  = r.metrics?.vmRssKb;
      const anonKb = r.metrics?.anonMemoryMb != null ? r.metrics.anonMemoryMb * 1024 : null;
      if (!rssKb || !anonKb) return null;
      return (anonKb / rssKb) * 100;
    })
    .filter(x => x !== null);
  const avgAnonPct = anonRssRatios.length
    ? +(anonRssRatios.reduce((a, b) => a + b, 0) / anonRssRatios.length).toFixed(1)
    : null;

  const streakRunIndices = rssTrend.streakOriginalIndices;

  return {
    // Core
    isLeaking: true,
    leakType,
    severity,

    // RSS (primary physical-memory signal)
    growthMb:    +(rssTrend.growth / 1024).toFixed(1),
    growthPct:   rssTrend.growthPct,
    firstRssMb:  +(rssTrend.first  / 1024).toFixed(1),
    lastRssMb:   +(rssTrend.last   / 1024).toFixed(1),
    maxStreak:   rssTrend.maxStreak,
    byStreak:    rssTrend.maxStreak >= 3,
    byGrowth:    rssTrend.growthPct > 10,

    // Streak window (for chart highlighting)
    streakRunIndices,
    streakStartTime: runs[streakRunIndices[0]]?.timestamp,
    streakEndTime:   runs[streakRunIndices[streakRunIndices.length - 1]]?.timestamp,

    // Secondary signal details
    anonCorr,
    threadCorr,
    connCorr,
    secondaryCount,
    avgAnonPct,

    anonGrowthMb:  anonTrend.hasData  ? +(anonTrend.growth  / 1024).toFixed(1) : null,
    anonGrowthPct: anonTrend.hasData  ? anonTrend.growthPct              : null,
    threadGrowth:  threadTrend.hasData ? +(threadTrend.last - threadTrend.first).toFixed(0) : null,
    connGrowth:    connTrend.hasData   ? +(connTrend.last   - connTrend.first).toFixed(0)   : null,

    // Raw trend objects for charts / table
    rssTrend, anonTrend, threadTrend, connTrend,
  };
}
