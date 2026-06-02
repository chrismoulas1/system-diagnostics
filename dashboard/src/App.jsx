import { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header.jsx';
import UploadZone from './components/UploadZone.jsx';
import ServerFetch from './components/ServerFetch.jsx';
import AutoRefreshBar from './components/AutoRefreshBar.jsx';
import StatsCards from './components/StatsCards.jsx';
import MemoryChart from './components/MemoryChart.jsx';
import CountsChart from './components/CountsChart.jsx';
import RunsTable from './components/RunsTable.jsx';
import MultiDayChart from './components/MultiDayChart.jsx';
import LeakAlert from './components/LeakAlert.jsx';
import ExportButton from './components/ExportButton.jsx';
import { detectMemoryLeak } from './utils/leakDetection.js';

const SAMPLE_DATA = [
  {
    filename: 'daily_report_20260527.pdf',
    date: '2026-05-27',
    totalRuns: 4,
    runs: [
      { timestamp: '2026-05-27 00:00:00', serverPid: '45231', metrics: { vmSizeKb: 7645632, vmRssKb: 492000, anonMemoryMb: 218.4, jsseNioThreads: 13, networkConnections: 35, socketMemoryEntries: 7 } },
      { timestamp: '2026-05-27 09:00:00', serverPid: '45231', metrics: { vmSizeKb: 7756788, vmRssKb: 505000, anonMemoryMb: 223.7, jsseNioThreads: 14, networkConnections: 40, socketMemoryEntries: 7 } },
      { timestamp: '2026-05-27 15:00:00', serverPid: '45231', metrics: { vmSizeKb: 7924160, vmRssKb: 529000, anonMemoryMb: 231.9, jsseNioThreads: 15, networkConnections: 43, socketMemoryEntries: 8 } },
      { timestamp: '2026-05-27 18:00:00', serverPid: '45231', metrics: { vmSizeKb: 7992000, vmRssKb: 541000, anonMemoryMb: 237.3, jsseNioThreads: 14, networkConnections: 38, socketMemoryEntries: 7 } },
    ],
  },
  {
    filename: 'daily_report_20260528.pdf',
    date: '2026-05-28',
    totalRuns: 4,
    runs: [
      { timestamp: '2026-05-28 00:00:00', serverPid: '45231', metrics: { vmSizeKb: 7845632, vmRssKb: 512000, anonMemoryMb: 230.5, jsseNioThreads: 14, networkConnections: 38, socketMemoryEntries: 7 } },
      { timestamp: '2026-05-28 09:00:00', serverPid: '45231', metrics: { vmSizeKb: 7956788, vmRssKb: 524288, anonMemoryMb: 235.2, jsseNioThreads: 15, networkConnections: 42, socketMemoryEntries: 8 } },
      { timestamp: '2026-05-28 15:00:00', serverPid: '45231', metrics: { vmSizeKb: 8124160, vmRssKb: 549000, anonMemoryMb: 242.1, jsseNioThreads: 16, networkConnections: 45, socketMemoryEntries: 8 } },
      { timestamp: '2026-05-28 18:00:00', serverPid: '45231', metrics: { vmSizeKb: 8192000, vmRssKb: 562000, anonMemoryMb: 248.7, jsseNioThreads: 15, networkConnections: 41, socketMemoryEntries: 8 } },
    ],
  },
  {
    filename: 'daily_report_20260529.pdf',
    date: '2026-05-29',
    totalRuns: 4,
    runs: [
      { timestamp: '2026-05-29 00:00:00', serverPid: '45231', metrics: { vmSizeKb: 8200000, vmRssKb: 568000, anonMemoryMb: 251.3, jsseNioThreads: 15, networkConnections: 39, socketMemoryEntries: 8 } },
      { timestamp: '2026-05-29 09:00:00', serverPid: '45231', metrics: { vmSizeKb: 8310000, vmRssKb: 580000, anonMemoryMb: 257.8, jsseNioThreads: 15, networkConnections: 44, socketMemoryEntries: 9 } },
      { timestamp: '2026-05-29 15:00:00', serverPid: '45231', metrics: { vmSizeKb: 8450000, vmRssKb: 596000, anonMemoryMb: 263.4, jsseNioThreads: 16, networkConnections: 48, socketMemoryEntries: 9 } },
      { timestamp: '2026-05-29 18:00:00', serverPid: '45231', metrics: { vmSizeKb: 8512000, vmRssKb: 605000, anonMemoryMb: 268.1, jsseNioThreads: 15, networkConnections: 43, socketMemoryEntries: 9 } },
    ],
  },
];

const DEFAULT_INTERVAL = 3600;

export default function App() {
  const [reports, setReports]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [sourceMode, setSourceMode] = useState('upload');

  const [serverConfig, setServerConfig]   = useState(null);
  const [lastFetched, setLastFetched]     = useState(null);
  const [paused, setPaused]               = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [interval, setIntervalSecs]       = useState(DEFAULT_INTERVAL);
  const [secondsToNext, setSecondsToNext] = useState(DEFAULT_INTERVAL);

  const countdownRef = useRef(null);
  const autoFireRef  = useRef(null);

  const doRemoteFetch = useCallback(async (config) => {
    if (!config) return;
    setRefreshing(true);
    try {
      const resp = await fetch('/api/remote/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const valid = data.filter(r => r.runs && r.runs.length > 0);
      if (valid.length) {
        valid.sort((a, b) => (!a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date)));
        setReports(valid);
        setLastFetched(new Date());
      }
    } catch (e) {
      console.error('Auto-refresh error:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!serverConfig || paused) {
      clearInterval(countdownRef.current);
      clearTimeout(autoFireRef.current);
      if (!paused) setSecondsToNext(interval);
      return;
    }

    setSecondsToNext(interval);

    countdownRef.current = setInterval(() => {
      setSecondsToNext(s => {
        if (s <= 1) return interval;
        return s - 1;
      });
    }, 1000);

    autoFireRef.current = setTimeout(function fire() {
      doRemoteFetch(serverConfig);
      autoFireRef.current = setTimeout(fire, interval * 1000);
    }, interval * 1000);

    return () => {
      clearInterval(countdownRef.current);
      clearTimeout(autoFireRef.current);
    };
  }, [serverConfig, paused, interval, doRemoteFetch]);

  const handleIntervalChange = (secs) => {
    setIntervalSecs(secs);
    setSecondsToNext(secs);
    clearInterval(countdownRef.current);
    clearTimeout(autoFireRef.current);
    if (!serverConfig || paused) return;

    countdownRef.current = setInterval(() => {
      setSecondsToNext(s => (s <= 1 ? secs : s - 1));
    }, 1000);

    autoFireRef.current = setTimeout(function fire() {
      doRemoteFetch(serverConfig);
      autoFireRef.current = setTimeout(fire, secs * 1000);
    }, secs * 1000);
  };

  const handleRefreshNow = () => {
    clearTimeout(autoFireRef.current);
    setSecondsToNext(interval);
    doRemoteFetch(serverConfig).then(() => {
      if (!paused) {
        autoFireRef.current = setTimeout(function fire() {
          doRemoteFetch(serverConfig);
          autoFireRef.current = setTimeout(fire, interval * 1000);
        }, interval * 1000);
      }
    });
  };

  const handleTogglePause = () => {
    setPaused(p => !p);
  };

  const handleUpload = async (files) => {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('pdfs', f));
      const resp = await fetch('/api/parse', { method: 'POST', body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.length) throw new Error('No reports could be parsed from the uploaded files');
      setReports(data);
      setActiveTab(0);
      setServerConfig(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoteFetch = (data, config) => {
    setReports(data);
    setActiveTab(0);
    setError(null);
    setServerConfig(config);
    setLastFetched(new Date());
    setPaused(false);
    setSecondsToNext(interval);
  };

  const handleSample = () => {
    setReports(SAMPLE_DATA);
    setActiveTab(0);
    setError(null);
    setServerConfig(null);
  };

  const handleReset = () => {
    setReports(null);
    setError(null);
    setActiveTab(0);
    setServerConfig(null);
    setLastFetched(null);
    clearInterval(countdownRef.current);
    clearTimeout(autoFireRef.current);
  };

  const isMultiDay   = reports && reports.length > 1;
  const allRuns      = reports ? reports.flatMap(r => r.runs) : [];
  const tabOptions   = reports ? [
    ...(isMultiDay ? [{ label: '📅 Overview' }] : []),
    ...reports.map(r => ({ label: r.date || r.filename })),
  ] : [];

  const activeReport  = isMultiDay ? (activeTab === 0 ? null : reports[activeTab - 1]) : reports?.[0];
  const displayedRuns = activeReport ? activeReport.runs : allRuns;
  const leakResult    = reports ? detectMemoryLeak(displayedRuns) : null;
  const allRunsLeak   = reports ? detectMemoryLeak(allRuns) : null;
  const perReportLeak = reports ? reports.map(r => detectMemoryLeak(r.runs)) : [];

  const Charts = ({ runs, leak }) => (
    <div className="chart-grid">
      <div id="pdf-chart-memory">
        <MemoryChart runs={runs} leakResult={leak} />
      </div>
      <div id="pdf-chart-counts">
        <CountsChart runs={runs} />
      </div>
    </div>
  );

  return (
    <div className="app">
      <Header
        hasData={!!reports}
        onReset={handleReset}
        exportSlot={reports && (
          <ExportButton
            reports={reports}
            allRuns={displayedRuns}
            leakResult={leakResult}
            perReportLeak={perReportLeak}
          />
        )}
      />

      {!reports ? (
        <div className="source-page">
          <div className="source-tabs">
            <button
              className={`source-tab ${sourceMode === 'upload' ? 'active' : ''}`}
              onClick={() => setSourceMode('upload')}
            >
              📂 Upload PDFs
            </button>
            <button
              className={`source-tab ${sourceMode === 'server' ? 'active' : ''}`}
              onClick={() => setSourceMode('server')}
            >
              🖥️ Fetch from Server
            </button>
          </div>

          {sourceMode === 'upload' ? (
            <UploadZone onUpload={handleUpload} onSample={handleSample} loading={loading} error={error} />
          ) : (
            <div className="server-fetch-page">
              <ServerFetch onFetch={handleRemoteFetch} loading={loading} error={error} />
              <div className="sftp-demo-divider">or</div>
              <button className="sample-btn sftp-sample-btn" onClick={handleSample} disabled={loading}>
                🎯 Load sample data (demo)
              </button>
            </div>
          )}
        </div>
      ) : (
        <main className="main">
          {(loading || refreshing) && (
            <div className="loading-overlay">
              <div className="spinner" />
              <p>{refreshing ? 'Refreshing reports from server…' : 'Analysing PDF reports…'}</p>
            </div>
          )}
          {error && <div className="error-banner">⚠️ {error}</div>}

          {serverConfig && (
            <AutoRefreshBar
              host={serverConfig.host}
              lastFetched={lastFetched}
              secondsToNext={secondsToNext}
              paused={paused}
              refreshing={refreshing}
              interval={interval}
              onIntervalChange={handleIntervalChange}
              onTogglePause={handleTogglePause}
              onRefreshNow={handleRefreshNow}
            />
          )}

          <div className="dashboard-toolbar">
            <div>
              <h2>
                {isMultiDay
                  ? `Analysis: ${reports[0].date} → ${reports[reports.length - 1].date}`
                  : `Daily Report: ${reports[0].date}`}
              </h2>
              <p>
                {reports.length} day{reports.length !== 1 ? 's' : ''} · {allRuns.length} diagnostic snapshots
                {perReportLeak.some(r => r.isLeaking) && (
                  <span style={{ marginLeft: '0.75rem', color: '#ef4444', fontWeight: 600 }}>
                    · ⚠ Memory leak detected
                  </span>
                )}
              </p>
            </div>
            <div className="file-list">
              {reports.map(r => (
                <span key={r.filename} className="file-badge">📄 {r.filename}</span>
              ))}
            </div>
          </div>

          {isMultiDay && (
            <div className="tabs">
              {tabOptions.map((t, i) => {
                const dayIdx = i - 1;
                const dayLeak = dayIdx >= 0 ? perReportLeak[dayIdx] : null;
                return (
                  <button
                    key={i}
                    className={`tab ${activeTab === i ? 'active' : ''}`}
                    onClick={() => setActiveTab(i)}
                  >
                    {t.label}
                    {dayLeak?.isLeaking && (
                      <span style={{
                        marginLeft: '0.4rem', background: activeTab === i ? 'rgba(255,255,255,0.3)' : '#ef4444',
                        color: 'white', borderRadius: 99, padding: '0.05rem 0.35rem',
                        fontSize: '0.65rem', fontWeight: 700,
                      }}>⚠</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <StatsCards reports={activeReport ? [activeReport] : reports} />
          <LeakAlert result={leakResult} />

          {isMultiDay && activeTab === 0 ? (
            <>
              <MultiDayChart reports={reports} leakResults={perReportLeak} />
              <Charts runs={allRuns} leak={allRunsLeak} />
              <RunsTable runs={allRuns} showDate={true} leakResult={allRunsLeak} />
            </>
          ) : (
            <>
              <Charts runs={displayedRuns} leak={leakResult} />
              <RunsTable runs={displayedRuns} showDate={isMultiDay} leakResult={leakResult} />
            </>
          )}
        </main>
      )}
    </div>
  );
}
