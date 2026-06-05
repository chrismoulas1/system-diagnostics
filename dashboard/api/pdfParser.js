let pdfParse;
try {
  pdfParse = require('pdf-parse/lib/pdf-parse.js');
} catch (e) {
  pdfParse = require('pdf-parse');
}

async function parsePdfBuffer(buffer, filename) {
  const data = await pdfParse(buffer);
  return parseReportText(data.text, filename);
}

function parseReportText(text, filename) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let date = null;
  let totalRuns = 0;
  const runs = [];

  let currentRun = null;
  let currentCommandKey = null;
  let currentOutputLines = [];

  const flushCommand = () => {
    if (currentRun && currentCommandKey) {
      currentRun.commandOutputs[currentCommandKey] = currentOutputLines.join('\n');
    }
    currentCommandKey = null;
    currentOutputLines = [];
  };

  const flushRun = () => {
    if (currentRun) {
      flushCommand();
      currentRun.metrics = extractMetrics(currentRun.commandOutputs);
      runs.push(currentRun);
      currentRun = null;
    }
  };

  for (const line of lines) {
    if (!date) {
      const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (dateMatch) { date = dateMatch[1]; continue; }
    }

    const totalMatch = line.match(/Total runs found[:\s]+(\d+)/i);
    if (totalMatch) { totalRuns = parseInt(totalMatch[1]); continue; }

    if (line.startsWith('SUMMARY') || line.includes('Count-Only Commands')) {
      flushRun(); continue;
    }

    const runMatch = line.match(
      /^Run:\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+Server PID:\s+(\S+)/
    );
    if (runMatch) {
      flushRun();
      currentRun = {
        timestamp: runMatch[1],
        serverPid: runMatch[2],
        commandOutputs: {},
        metrics: {},
      };
      continue;
    }

    const cmdMatch = line.match(/^(COMMAND_\d+):\s+(.*)/);
    if (cmdMatch) {
      if (currentRun) {
        flushCommand();
        currentCommandKey = cmdMatch[1];
        currentOutputLines = [];
      }
      continue;
    }

    if (currentRun && currentCommandKey) {
      if (!line.startsWith('SYSTEM DIAGNOSTICS') && !line.startsWith('Total runs')) {
        currentOutputLines.push(line);
      }
    }
  }

  flushRun();

  if (!date && filename) {
    const m = filename.match(/(\d{4})(\d{2})(\d{2})/);
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
  }

  return { filename: filename || 'unknown.pdf', date, totalRuns: totalRuns || runs.length, runs };
}

function extractMetrics(outputs) {
  const metrics = {};

  // ── COMMAND_4: /proc/<pid>/status  (authoritative physical memory) ──────────
  // VmRSS = physical RAM pages actually used by the process
  // VmSize = total virtual address space (always >> physical)
  const cmd4 = outputs['COMMAND_4'] || '';
  const vmSizeMatch = cmd4.match(/VmSize[:\s]+(\d+)\s*kB/i);
  const vmRssMatch  = cmd4.match(/VmRSS[:\s]+(\d+)\s*kB/i);
  if (vmSizeMatch) metrics.vmSizeKb = parseInt(vmSizeMatch[1]);
  if (vmRssMatch)  metrics.vmRssKb  = parseInt(vmRssMatch[1]);

  // ── COMMAND_2: ps -aux | grep server  → %MEM = physical memory % ────────────
  // ps -aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
  // %MEM is the process VmRSS as a percentage of total system physical memory
  const cmd2 = outputs['COMMAND_2'] || '';
  const cmd2Lines = cmd2.split('\n').filter(l => l.trim() && !/^\s*USER/i.test(l));
  if (cmd2Lines.length > 0) {
    const parts = cmd2Lines[0].trim().split(/\s+/);
    if (parts.length >= 4) {
      const memPct = parseFloat(parts[3]);
      if (!isNaN(memPct)) metrics.physMemPct = memPct;
    }
  }

  // ── COMMAND_3: ps -o pid,vsz,rss,cmd  (secondary – cross-check RSS) ────────
  const cmd3 = outputs['COMMAND_3'] || '';
  const cmd3Lines = cmd3.split('\n').filter(l => l.trim() && !/^\s*PID/i.test(l));
  if (cmd3Lines.length > 0) {
    const parts = cmd3Lines[0].trim().split(/\s+/);
    if (parts.length >= 3) {
      const vsz = parseInt(parts[1]);
      const rss = parseInt(parts[2]);
      if (!isNaN(vsz)) metrics.vszKb  = vsz;
      if (!isNaN(rss)) metrics.rssKb  = rss;
    }
  }
  // Fall back to cmd3 values if cmd4 not present
  if (metrics.vmSizeKb === undefined && metrics.vszKb !== undefined) metrics.vmSizeKb = metrics.vszKb;
  if (metrics.vmRssKb  === undefined && metrics.rssKb  !== undefined) metrics.vmRssKb  = metrics.rssKb;

  // ── COMMAND_7: anonymous memory from /proc/<pid>/smaps ──────────────────────
  // Anonymous pages = private heap + JVM internals + off-heap buffers (NOT file-backed)
  // If anon tracks VmRSS growth → the leak is in heap/native memory, not mmap files
  const cmd7 = outputs['COMMAND_7'] || '';
  const mbMatch  = cmd7.match(/([\d.]+)\s*MB/i);
  const numMatch = cmd7.match(/^\s*([\d.]+)\s*$/m);
  if (mbMatch)       metrics.anonMemoryMb = parseFloat(mbMatch[1]);
  else if (numMatch) metrics.anonMemoryMb = parseFloat(numMatch[1]);

  // ── COMMAND_5: JSSE NIO thread count ───────────────────────────────────────
  // Each thread consumes ~256 kB–1 MB of stack in physical RAM
  // Growing thread count → physical RAM grows even without a heap leak
  const cmd5 = outputs['COMMAND_5'] || '';
  const count5 = cmd5.match(/Count[:\s]+(\d+)/i);
  if (count5) metrics.jsseNioThreads = parseInt(count5[1]);

  // ── COMMAND_6: /proc/<pid>/smaps stack segments ─────────────────────────────
  // Number of [stack] mappings ≈ number of live threads
  // Sum of RSS across stacks = how much physical RAM threads consume
  const cmd6 = outputs['COMMAND_6'] || '';
  if (cmd6.trim()) {
    // Each thread stack shows as a VMA line ending with [stack] or [stack:tid]
    const stackHeaders = cmd6.match(/\[stack[:\]]/g);
    if (stackHeaders) metrics.stackSegmentCount = stackHeaders.length;

    // Sum Rss: N kB values within those sections
    const rssLines = [...cmd6.matchAll(/^Rss:\s+(\d+)\s*kB/gim)];
    if (rssLines.length > 0) {
      metrics.totalStackRssKb = rssLines.reduce((s, m) => s + parseInt(m[1]), 0);
    }
  }

  // ── COMMAND_8: pmap -x stack entries (fallback if COMMAND_6 not available) ──
  const cmd8 = outputs['COMMAND_8'] || '';
  if (cmd8.trim() && metrics.stackSegmentCount === undefined) {
    // pmap lines look like: "7f...  8192   24   24 rwx--  [ stack ]"
    const pmapStackLines = cmd8.split('\n').filter(
      l => /\[\s*stack\s*\]/i.test(l) && /^\s*[0-9a-f]/i.test(l)
    );
    if (pmapStackLines.length > 0) {
      metrics.stackSegmentCount = pmapStackLines.length;
      const rssSum = pmapStackLines.reduce((s, l) => {
        const cols = l.trim().split(/\s+/);
        const rss = cols.length >= 3 ? parseInt(cols[2]) : 0;
        return s + (isNaN(rss) ? 0 : rss);
      }, 0);
      if (rssSum > 0) metrics.totalStackRssKb = rssSum;
    }
  }

  // ── COMMAND_10: network connections count ────────────────────────────────────
  const cmd10 = outputs['COMMAND_10'] || '';
  const count10 = cmd10.match(/Count[:\s]+(\d+)/i);
  if (count10) metrics.networkConnections = parseInt(count10[1]);

  // ── COMMAND_11: socket memory entries ────────────────────────────────────────
  const cmd11 = outputs['COMMAND_11'] || '';
  const count11 = cmd11.match(/Count[:\s]+(\d+)/i);
  if (count11) metrics.socketMemoryEntries = parseInt(count11[1]);

  // ── Derived: Anon/RSS ratio ──────────────────────────────────────────────────
  // High ratio (>70%) → most physical RAM is heap/native; any growth is almost certainly a heap leak
  // Low ratio          → significant file-backed or JIT mappings; growth source is less clear
  if (metrics.vmRssKb && metrics.anonMemoryMb) {
    const anonKb = metrics.anonMemoryMb * 1024;
    metrics.anonRssPct = +((anonKb / metrics.vmRssKb) * 100).toFixed(1);
  }

  return metrics;
}

module.exports = { parsePdfBuffer };
