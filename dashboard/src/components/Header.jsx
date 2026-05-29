export default function Header({ hasData, onReset, exportSlot }) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="logo">📊</div>
        <div>
          <h1>System Diagnostics Dashboard</h1>
          <p>Siemens Server Performance Analytics</p>
        </div>
      </div>
      <div className="header-actions">
        {exportSlot}
        {hasData && (
          <button className="btn btn-outline" onClick={onReset}>
            ＋ Upload New PDFs
          </button>
        )}
      </div>
    </header>
  );
}
