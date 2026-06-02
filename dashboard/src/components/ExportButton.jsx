import { useState } from 'react';

// ── PDF helpers ──────────────────────────────────────────────────────────────

async function captureElement(id) {
  const { default: html2canvas } = await import('html2canvas');
  const el = document.getElementById(id);
  if (!el) return null;
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });
  return canvas.toDataURL('image/png');
}

function imgDimensions(dataUrl, maxW) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const aspect = img.width / img.height;
      const w = maxW;
      const h = w / aspect;
      res({ w, h });
    };
    img.src = dataUrl;
  });
}

function pageHeader(doc, title, pageNum) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(0, 61, 92);
  doc.rect(0, 0, W, 18, 'F');
  doc.setFillColor(0, 168, 132);
  doc.rect(0, 16, W, 2, 'F');
  doc.setFillColor(0, 168, 132);
  doc.circle(12, 9, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('System Diagnostics', 20, 7.5);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Siemens Server Performance Analytics', 20, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(title, W - 14, 8, { align: 'right' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`Page ${pageNum}`, W - 14, 14, { align: 'right' });
}

function pageFooter(doc, generatedAt) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(15, H - 11, W - 15, H - 11);
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text('System Diagnostics Dashboard  ·  Confidential', 15, H - 6);
  doc.text(`Generated: ${generatedAt}`, W - 15, H - 6, { align: 'right' });
}

function statBox(doc, x, y, w, h, label, value, unit, rgb) {
  doc.setFillColor(...rgb);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.text(label.toUpperCase(), x + w / 2, y + 5.5, { align: 'center' });
  doc.setFontSize(13);
  doc.text(String(value), x + w / 2, y + h - 6, { align: 'center' });
  if (unit) {
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text(unit, x + w / 2, y + h - 1.5, { align: 'center' });
  }
}

function dataTable(doc, headers, rows, leakIndices, x, y0, colW) {
  const rowH = 6.5;
  const tW = colW.reduce((a, b) => a + b, 0);
  const leakSet = new Set(leakIndices || []);

  doc.setFillColor(0, 61, 92);
  doc.rect(x, y0, tW, rowH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  let cx = x;
  headers.forEach((h, i) => { doc.text(h, cx + 1.5, y0 + rowH - 1.8); cx += colW[i]; });

  let y = y0 + rowH;
  rows.forEach((row, ri) => {
    if (leakSet.has(ri)) {
      doc.setFillColor(255, 243, 243);
    } else if (ri % 2 === 0) {
      doc.setFillColor(248, 250, 252);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(x, y, tW, rowH, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.1);
    doc.rect(x, y, tW, rowH);

    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    cx = x;
    row.forEach((cell, ci) => {
      const isRss = ci === 2;
      doc.setTextColor(leakSet.has(ri) && isRss ? 185 : 30, leakSet.has(ri) && isRss ? 28 : 41, leakSet.has(ri) && isRss ? 28 : 59);
      doc.text(String(cell ?? '—'), cx + 1.5, y + rowH - 1.8);
      cx += colW[ci];
    });
    y += rowH;
  });
  return y;
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generatePDF({ reports, allRuns, leakResult, perReportLeak }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, MX = 15, CW = 180;
  const gen = new Date().toLocaleString();

  const isMultiDay = reports.length > 1;
  const dateRange = isMultiDay
    ? `${reports[0].date} → ${reports[reports.length - 1].date}`
    : reports[0].date;

  const allVmRss   = allRuns.map(r => r.metrics?.vmRssKb).filter(Boolean);
  const allThreads = allRuns.map(r => r.metrics?.jsseNioThreads).filter(v => v != null);
  const allConns   = allRuns.map(r => r.metrics?.networkConnections).filter(v => v != null);
  const allAnon    = allRuns.map(r => r.metrics?.anonMemoryMb).filter(Boolean);
  const latestRss  = allVmRss.length ? (allVmRss[allVmRss.length - 1] / 1024).toFixed(0) : '—';
  const peakRss    = allVmRss.length ? (Math.max(...allVmRss) / 1024).toFixed(0) : '—';
  const avgThreads = allThreads.length ? (allThreads.reduce((a,b)=>a+b,0)/allThreads.length).toFixed(0) : '—';
  const maxConns   = allConns.length ? Math.max(...allConns) : '—';
  const avgAnon    = allAnon.length ? (allAnon.reduce((a,b)=>a+b,0)/allAnon.length).toFixed(1) : '—';

  // ── PAGE 1: COVER ─────────────────────────────────────────
  doc.setFillColor(0, 61, 92);
  doc.rect(0, 0, W, 52, 'F');
  doc.setFillColor(0, 168, 132);
  doc.rect(0, 48, W, 5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('System Diagnostics', W / 2, 17, { align: 'center' });
  doc.setFontSize(15);
  doc.text('Analysis Report', W / 2, 27, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(170, 220, 215);
  doc.text('Siemens Server Performance Analytics', W / 2, 37, { align: 'center' });
  doc.text(`Report Period: ${dateRange}`, W / 2, 44, { align: 'center' });

  // Meta
  let y = 62;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${gen}`, MX, y);
  doc.text(`Source: ${reports.map(r => r.filename).join('   ·   ')}`, MX, y + 5);

  y += 14;

  // Stats boxes — 2 rows × 3 cols
  const bW = 56, bH = 22, bG = 6;
  const boxes = [
    { label: 'Days Analysed',       value: reports.length, unit: 'days',        rgb: [0, 102, 138]  },
    { label: 'Total Snapshots',     value: allRuns.length, unit: 'runs',        rgb: [59, 130, 246] },
    { label: 'Latest VmRSS',        value: latestRss,      unit: 'MB',          rgb: [0, 168, 132]  },
    { label: 'Peak VmRSS',          value: peakRss,        unit: 'MB',          rgb: [139, 92, 246] },
    { label: 'Avg JSSE Threads',    value: avgThreads,     unit: 'threads',     rgb: [245, 158, 11] },
    { label: 'Max Net Connections', value: maxConns,       unit: 'connections', rgb: [16, 185, 129] },
  ];
  boxes.forEach((b, i) => {
    statBox(doc, MX + (i % 3) * (bW + bG), y + Math.floor(i / 3) * (bH + bG), bW, bH, b.label, b.value, b.unit, b.rgb);
  });
  y += 2 * (bH + bG) + 8;

  // Leak / health status
  const anyLeak = leakResult?.isLeaking || perReportLeak?.some(r => r.isLeaking);
  const lr = anyLeak ? (leakResult?.isLeaking ? leakResult : perReportLeak.find(r => r.isLeaking)) : null;

  if (anyLeak && lr) {
    const sevRgb = { high: [239,68,68], medium: [249,115,22], low: [234,179,8] };
    const col = sevRgb[lr.severity] || sevRgb.low;
    const sevLabel = (lr.severity || 'low')[0].toUpperCase() + (lr.severity || 'low').slice(1);

    doc.setFillColor(255, 245, 245);
    doc.roundedRect(MX, y, CW, 50, 2, 2, 'F');
    doc.setFillColor(...col);
    doc.rect(MX, y, 3, 50, 'F');

    doc.setTextColor(...col);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('⚠  Potential Memory Leak Detected', MX + 7, y + 8);

    // Severity badge
    doc.setFillColor(...col);
    doc.roundedRect(W - 46, y + 3, 26, 7, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6.5);
    doc.text(`${sevLabel} Risk`, W - 46 + 13, y + 8, { align: 'center' });

    doc.setTextColor(127, 29, 29);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`VmRSS grew ${lr.growthMb >= 0 ? '+':''}${lr.growthMb} MB  (${lr.growthPct >= 0 ? '+':''}${lr.growthPct}%)  ·  ${lr.firstRssMb} MB → ${lr.lastRssMb} MB`, MX + 7, y + 18);
    if (lr.byStreak) doc.text(`${lr.maxStreak} consecutive snapshots with strictly rising Resident Set Size`, MX + 7, y + 26);
    if (lr.streakStartTime) doc.text(`Growth window:  ${lr.streakStartTime}   →   ${lr.streakEndTime}`, MX + 7, y + 34);

    doc.setFont('helvetica', 'bold');
    doc.text('Recommendation:', MX + 7, y + 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const rec = doc.splitTextToSize('Review JVM heap limits, thread pool sizing, and COMMAND_12 JVM thread dumps. Consistently rising anonymous memory alongside RSS often indicates an off-heap or native memory leak.', CW - 12);
    doc.text(rec, MX + 7, y + 47.5);
    y += 58;
  } else {
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(MX, y, CW, 16, 2, 2, 'F');
    doc.setFillColor(16, 185, 129);
    doc.rect(MX, y, 3, 16, 'F');
    doc.setTextColor(21, 128, 61);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('✓  No Memory Leak Detected', MX + 7, y + 7);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text('VmRSS growth is within acceptable bounds across all analysed snapshots.', MX + 7, y + 13);
    y += 22;
  }

  pageFooter(doc, gen);

  // ── PAGE 2: CHARTS ────────────────────────────────────────
  doc.addPage();
  pageHeader(doc, 'Charts & Trends', 2);
  pageFooter(doc, gen);
  y = 24;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Memory Usage Over Time', MX, y);
  y += 5;

  const memImg = await captureElement('pdf-chart-memory');
  if (memImg) {
    const { w: iW, h: iH } = await imgDimensions(memImg, CW);
    const finalH = Math.min(iH, 82);
    doc.addImage(memImg, 'PNG', MX, y, CW, finalH);
    y += finalH + 8;
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Thread & Connection Counts', MX, y);
  y += 5;

  const cntImg = await captureElement('pdf-chart-counts');
  if (cntImg) {
    const { w: iW2, h: iH2 } = await imgDimensions(cntImg, CW);
    const finalH2 = Math.min(iH2, 82);
    doc.addImage(cntImg, 'PNG', MX, y, CW, finalH2);
  }

  // ── PAGE 3: DATA TABLE ────────────────────────────────────
  doc.addPage();
  pageHeader(doc, 'Diagnostic Snapshots', 3);
  pageFooter(doc, gen);
  y = 24;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(`All Diagnostic Runs  (${allRuns.length} snapshots)`, MX, y);
  y += 6;

  const headers = ['Timestamp', 'PID', 'VmRSS MB', 'VmSize MB', 'Anon MB', 'Threads', 'Net Conn', 'Sockets'];
  const colW    = [40, 18, 20, 20, 18, 16, 18, 14];
  const rows = allRuns.map(r => {
    const m = r.metrics || {};
    return [
      r.timestamp || '—',
      r.serverPid || '—',
      m.vmRssKb  ? (m.vmRssKb  / 1024).toFixed(0) : '—',
      m.vmSizeKb ? (m.vmSizeKb / 1024).toFixed(0) : '—',
      m.anonMemoryMb ? m.anonMemoryMb.toFixed(1) : '—',
      m.jsseNioThreads    ?? '—',
      m.networkConnections ?? '—',
      m.socketMemoryEntries ?? '—',
    ];
  });

  dataTable(doc, headers, rows, leakResult?.streakRunIndices || [], MX, y, colW);

  // ── SAVE ──────────────────────────────────────────────────
  const tag = (reports[0].date || 'report').replace(/-/g, '');
  const suffix = isMultiDay ? `${tag}-multiday` : tag;
  doc.save(`diagnostics-analysis-${suffix}.pdf`);
}

// ── React component ───────────────────────────────────────────────────────────
export default function ExportButton({ reports, allRuns, leakResult, perReportLeak }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await generatePDF({ reports, allRuns, leakResult, perReportLeak });
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button className="btn btn-outline" onClick={handleExport} disabled={exporting}>
      {exporting ? '⏳ Generating…' : '📥 Export PDF'}
    </button>
  );
}
