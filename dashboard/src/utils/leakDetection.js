/**
 * Analyses a series of diagnostic runs for signs of a memory leak.
 *
 * Criteria (any one triggers the warning):
 *  - 3 or more CONSECUTIVE snapshots where VmRSS is strictly increasing
 *  - Total VmRSS growth across all snapshots exceeds 10 %
 *
 * Returns a result object consumed by <LeakAlert> and the charts.
 */
export function detectMemoryLeak(runs) {
  const indexed = runs
    .map((r, i) => ({ i, rssKb: r.metrics?.vmRssKb, run: r }))
    .filter(x => x.rssKb !== undefined && x.rssKb !== null && !isNaN(x.rssKb));

  if (indexed.length < 2) {
    return { isLeaking: false };
  }

  const rssValues = indexed.map(x => x.rssKb);
  const first = rssValues[0];
  const last  = rssValues[rssValues.length - 1];
  const growthKb  = last - first;
  const growthPct = (growthKb / first) * 100;

  // Find longest streak of consecutive increases and the run indices it covers
  let maxStreak = 0;
  let streakStart = 0;
  let streakEnd   = 0;
  let cur = 0;
  let curStart = 0;

  for (let i = 1; i < rssValues.length; i++) {
    if (rssValues[i] > rssValues[i - 1]) {
      if (cur === 0) curStart = i - 1;
      cur++;
      if (cur > maxStreak) {
        maxStreak  = cur;
        streakStart = curStart;
        streakEnd   = i;
      }
    } else {
      cur = 0;
    }
  }

  const byStreak = maxStreak >= 3;
  const byGrowth = growthPct > 10;
  const isLeaking = byStreak || byGrowth;

  // Indices into the ORIGINAL runs array for the streak
  const streakRunIndices = isLeaking
    ? indexed.slice(streakStart, streakEnd + 1).map(x => x.i)
    : [];

  // Severity
  let severity = 'low';
  if (growthPct > 30 || maxStreak >= 5) severity = 'high';
  else if (growthPct > 15 || maxStreak >= 4) severity = 'medium';

  return {
    isLeaking,
    severity,
    byStreak,
    byGrowth,
    growthKb,
    growthMb:  +(growthKb  / 1024).toFixed(1),
    growthPct: +growthPct.toFixed(1),
    maxStreak,
    firstRssMb: +(first / 1024).toFixed(1),
    lastRssMb:  +(last  / 1024).toFixed(1),
    streakRunIndices,
    streakStartTime: indexed[streakStart]?.run?.timestamp,
    streakEndTime:   indexed[streakEnd]?.run?.timestamp,
  };
}
