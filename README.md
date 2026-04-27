# system-diagnostics

Collects and analyzes system performance data from Siemens Frontend / Backend / Media servers.

## Overview

The application connects to the local Linux system, executes a fixed set of diagnostic
commands to inspect the running **webclient server** process, saves structured text reports
to `/var/siemens/common/log/`, and generates daily PDF summary reports.

### Scheduled runs

The diagnostics job runs **four times per day**:

| Time  | Description        |
|-------|--------------------|
| 00:00 | Midnight snapshot  |
| 09:00 | Morning snapshot   |
| 15:00 | Afternoon snapshot |
| 18:00 | Evening snapshot   |

A PDF summary for the previous day is generated automatically at **00:05**.

### Diagnostic commands executed per run

| # | Command | Notes |
|---|---------|-------|
| 1 | `ps -aux` | Full process list |
| 2 | `ps -aux \| grep -i server \| grep -v grep` | Locate server PID |
| 3 | `ps -o pid,vsz,rss,cmd -p <pid>` | Memory / RSS for server process |
| 4 | `cat /proc/<pid>/status \| grep -E "VmRSS\|VmSize"` | Virtual/resident memory |
| 5 | `ps -Lp <pid> \| grep -i jsse-nio` | JSSE NIO threads (count-only in PDF) |
| 6 | `cat /proc/<pid>/smaps \| grep -A 15 stack` | Stack segments (smaps) |
| 7 | `cat /proc/<pid>/smaps \| grep -i anon \| awk '…'` | Anonymous memory total in MB |
| 8 | `pmap -x <pid> \| grep stack` | Stack segments (pmap) |
| 9 | `cat /proc/<pid>/smaps \| grep -i stack -A 5` | Stack sections with context |
| 10 | `ss -antp \| grep <pid>` | Network connections (count-only in PDF) |
| 11 | `ss -m \| grep <pid>` | Socket memory (count-only in PDF) |
| 12 | `kill -3 <pid>` | JVM thread dump (SIGQUIT → process stderr/journal) |

### Report files

| Type | Path | Format |
|------|------|--------|
| Text report | `/var/siemens/common/log/report_YYYYMMdd_HHmmss.txt` | Structured text with section markers |
| PDF summary | `/var/siemens/common/log/daily_report_YYYYMMdd.pdf` | Aggregates all runs for a day |
| Application log | `/var/siemens/common/log/system-diagnostics.log` | Rolling daily log (30-day retention) |

---

## Building

**Requirements:** Maven 3.x, Java 8+

```bash
mvn package
# Produces: target/system-diagnostics-1.0.0.jar  (fat/uber JAR, ~5 MB)
```

---

## Running

### Scheduler mode (normal operation)

```bash
/opt/siemens/share/ibm-java-x86_64-80/jre/bin/java \
    -jar target/system-diagnostics-1.0.0.jar --run
```

### Generate PDF for a specific date

```bash
/opt/siemens/share/ibm-java-x86_64-80/jre/bin/java \
    -jar target/system-diagnostics-1.0.0.jar --report 2026-04-27
```

---

## RPM Packaging (SUSE SLES 15 SP7)

The `packaging/` directory contains all files needed to build the RPM:

| File | Purpose |
|------|---------|
| `system-diagnostics.spec` | RPM spec (installs JAR, service, startup script; enables service on first install) |
| `system-diagnostics.sh` | Startup wrapper using IBM JRE at `/opt/siemens/share/ibm-java-x86_64-80/jre` |
| `system-diagnostics.service` | systemd unit (Type=simple, auto-restart on failure) |

### Building the RPM

```bash
# Build the fat JAR first
mvn package

# Stage sources for rpmbuild
mkdir -p ~/rpmbuild/SOURCES ~/rpmbuild/SPECS
cp target/system-diagnostics-1.0.0.jar ~/rpmbuild/SOURCES/
cp packaging/system-diagnostics.sh     ~/rpmbuild/SOURCES/
cp packaging/system-diagnostics.service ~/rpmbuild/SOURCES/
cp packaging/system-diagnostics.spec   ~/rpmbuild/SPECS/

# Build the RPM
rpmbuild -bb ~/rpmbuild/SPECS/system-diagnostics.spec
# Result: ~/rpmbuild/RPMS/x86_64/system-diagnostics-1.0.0-1.x86_64.rpm
```

### Installing the RPM

```bash
rpm -ivh system-diagnostics-1.0.0-1.x86_64.rpm
# The %post scriptlet automatically runs:
#   systemctl daemon-reload
#   systemctl enable system-diagnostics.service
#   systemctl start  system-diagnostics.service
```

---

## Project structure

```
system-diagnostics/
├── pom.xml
├── packaging/
│   ├── system-diagnostics.service   # systemd unit
│   ├── system-diagnostics.sh        # startup wrapper (IBM JRE)
│   └── system-diagnostics.spec      # RPM spec
└── src/main/
    ├── java/com/siemens/diagnostics/
    │   ├── Main.java                 # Entry point (--run / --report)
    │   ├── CommandExecutor.java      # Runs shell commands via bash
    │   ├── DiagnosticsReport.java    # Model for one run's results
    │   ├── SystemDiagnosticsService.java  # Executes all 12 commands
    │   ├── ReportWriter.java         # Writes text report to log dir
    │   ├── PdfReportAnalyzer.java    # Parses text reports -> PDF
    │   └── DiagnosticsScheduler.java # Schedules 4x daily runs
    └── resources/
        └── logback.xml              # Logging config (console + rolling file)
```
