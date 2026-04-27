Name:           system-diagnostics
Version:        1.0.0
Release:        1%{?dist}
Summary:        System diagnostics tool for Siemens server process monitoring

License:        Proprietary
BuildArch:      x86_64
Vendor:         Siemens

# IBM JRE must be present at the standard Siemens path
Requires:       /opt/siemens/share/ibm-java-x86_64-80/jre/bin/java

%description
System Diagnostics monitors Siemens webclient/server processes by executing
a fixed set of Linux diagnostic commands (ps, pmap, ss, /proc inspection,
JVM thread dumps) four times a day (00:00, 09:00, 15:00, 18:00).

Results are stored in /var/siemens/common/log/report_<timestamp>.txt.
A daily PDF summary report is generated automatically at 00:05 for the
previous day's collected data.

%define install_dir /opt/siemens/diagnostics
%define log_dir     /var/siemens/common/log

# ---------------------------------------------------------------------------
# Prep / Build – the JAR is pre-built by Maven and copied to SOURCES
# ---------------------------------------------------------------------------
%prep
# Nothing to unpack – sources are pre-staged

%build
# Nothing to build – fat JAR already produced by 'mvn package'

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
%install
rm -rf %{buildroot}

# Application directories
mkdir -p %{buildroot}%{install_dir}/lib
mkdir -p %{buildroot}%{install_dir}/bin
mkdir -p %{buildroot}/etc/systemd/system
mkdir -p %{buildroot}%{log_dir}

# JAR (pre-built fat JAR placed in SOURCES)
install -m 0644 %{_sourcedir}/system-diagnostics-%{version}.jar \
    %{buildroot}%{install_dir}/lib/system-diagnostics-%{version}.jar

# Startup script
install -m 0755 %{_sourcedir}/system-diagnostics.sh \
    %{buildroot}%{install_dir}/bin/system-diagnostics.sh

# Systemd service unit
install -m 0644 %{_sourcedir}/system-diagnostics.service \
    %{buildroot}/etc/systemd/system/system-diagnostics.service

# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
%files
%defattr(-,root,root,-)
%{install_dir}/lib/system-diagnostics-%{version}.jar
%{install_dir}/bin/system-diagnostics.sh
/etc/systemd/system/system-diagnostics.service
%dir %{log_dir}

# ---------------------------------------------------------------------------
# Post-install: enable and start the service on first installation
# ---------------------------------------------------------------------------
%post
if [ $1 -eq 1 ]; then
    # First installation
    systemctl daemon-reload
    systemctl enable system-diagnostics.service
    systemctl start system-diagnostics.service
else
    # Package upgrade – reload unit and restart
    systemctl daemon-reload
    systemctl restart system-diagnostics.service
fi

# ---------------------------------------------------------------------------
# Pre-uninstall: stop and disable the service before package removal
# ---------------------------------------------------------------------------
%preun
if [ $1 -eq 0 ]; then
    # Final removal (not an upgrade)
    systemctl stop  system-diagnostics.service || true
    systemctl disable system-diagnostics.service || true
fi

# ---------------------------------------------------------------------------
# Post-uninstall: reload systemd after removal
# ---------------------------------------------------------------------------
%postun
if [ $1 -eq 0 ]; then
    systemctl daemon-reload || true
fi

# ---------------------------------------------------------------------------
# Changelog
# ---------------------------------------------------------------------------
%changelog
* Mon Apr 27 2026 Siemens Build System <build@siemens.com> - 1.0.0-1
- Initial release: 12-command diagnostics, text reports, PDF daily summary,
  scheduler at 00:00/09:00/15:00/18:00, systemd service auto-start on install
