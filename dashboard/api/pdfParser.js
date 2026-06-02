let pdfParse;
try {
  pdfParse = require('pdf-parse/lib/pdf-parse.js');
} catch (e) {
  pdfParse = require('pdf-parse');
}

async function parsePdfBuffer(buffer, filename) {
  const data = await pdfParse(buffer);
  const text = data.text;
  return parseReportText(text, filename);
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
      if (dateMatch) {
        date = dateMatch[1];
        continue;
      }
    }

    const totalMatch = line.match(/Total runs found[:\s]+(\d+)/i);
    if (totalMatch) {
      totalRuns = parseInt(totalMatch[1]);
      continue;
    }

    if (line.startsWith('SUMMARY') || line.includes('Count-Only Commands')) {
      flushRun();
      continue;
    }

    const runMatch = line.match(/^Run:\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+Server PID:\s+(\S+)/);
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
    const dateFromFilename = filename.match(/(\d{4})(\d{2})(\d{2})/);
    if (dateFromFilename) {
      date = `${dateFromFilename[1]}-${dateFromFilename[2]}-${dateFromFilename[3]}`;
    }
  }

  return {
    filename: filename || 'unknown.pdf',
    date,
    totalRuns: totalRuns || runs.length,
    runs,
  };
}

function extractMetrics(outputs) {
  const metrics = {};

  const cmd4 = outputs['COMMAND_4'] || '';
  const vmSizeMatch = cmd4.match(/VmSize[:\s]+(\d+)\s*kB/i);
  const vmRssMatch = cmd4.match(/VmRSS[:\s]+(\d+)\s*kB/i);
  if (vmSizeMatch) metrics.vmSizeKb = parseInt(vmSizeMatch[1]);
  if (vmRssMatch) metrics.vmRssKb = parseInt(vmRssMatch[1]);

  const cmd3 = outputs['COMMAND_3'] || '';
  const cmd3Lines = cmd3.split('\n').filter(l => l.trim() && !/^\s*PID/i.test(l));
  if (cmd3Lines.length > 0) {
    const parts = cmd3Lines[0].trim().split(/\s+/);
    if (parts.length >= 3) {
      const vsz = parseInt(parts[1]);
      const rss = parseInt(parts[2]);
      if (!isNaN(vsz)) metrics.vszKb = vsz;
      if (!isNaN(rss)) metrics.rssKb = rss;
    }
  }

  if (metrics.vmSizeKb === undefined && metrics.vszKb !== undefined) {
    metrics.vmSizeKb = metrics.vszKb;
  }
  if (metrics.vmRssKb === undefined && metrics.rssKb !== undefined) {
    metrics.vmRssKb = metrics.rssKb;
  }

  const cmd5 = outputs['COMMAND_5'] || '';
  const count5 = cmd5.match(/Count[:\s]+(\d+)/i);
  if (count5) metrics.jsseNioThreads = parseInt(count5[1]);

  const cmd7 = outputs['COMMAND_7'] || '';
  const mbMatch = cmd7.match(/([\d.]+)\s*MB/i);
  if (mbMatch) {
    metrics.anonMemoryMb = parseFloat(mbMatch[1]);
  } else {
    const numMatch = cmd7.match(/^\s*([\d.]+)\s*$/m);
    if (numMatch) metrics.anonMemoryMb = parseFloat(numMatch[1]);
  }

  const cmd10 = outputs['COMMAND_10'] || '';
  const count10 = cmd10.match(/Count[:\s]+(\d+)/i);
  if (count10) metrics.networkConnections = parseInt(count10[1]);

  const cmd11 = outputs['COMMAND_11'] || '';
  const count11 = cmd11.match(/Count[:\s]+(\d+)/i);
  if (count11) metrics.socketMemoryEntries = parseInt(count11[1]);

  return metrics;
}

module.exports = { parsePdfBuffer };
