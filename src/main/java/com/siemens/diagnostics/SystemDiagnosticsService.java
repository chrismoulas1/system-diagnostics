package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Orchestrates all 12 diagnostic commands for a single run.
 *
 * <p>Command sequence (per requirements):
 * <ol>
 *   <li>ps -aux</li>
 *   <li>ps -aux | grep -i server   &rarr; extracts server PID</li>
 *   <li>ps -o pid,vsz,rss,cmd -p &lt;pid&gt;</li>
 *   <li>cat /proc/&lt;pid&gt;/status | grep -E "VmRSS|VmSize"</li>
 *   <li>ps -Lp &lt;pid&gt; | grep -i jsse-nio  (count only in PDF)</li>
 *   <li>cat /proc/&lt;pid&gt;/smaps | grep -A 15 stack</li>
 *   <li>cat /proc/&lt;pid&gt;/smaps | grep -i anon | awk '{sum+=$2} END {print sum/1024 " MB"}'</li>
 *   <li>pmap -x &lt;pid&gt; | grep stack</li>
 *   <li>cat /proc/&lt;pid&gt;/smaps | grep -i stack -A 5</li>
 *   <li>ss -antp | grep &lt;pid&gt;   (count only in PDF)</li>
 *   <li>ss -m | grep &lt;pid&gt;      (count only in PDF)</li>
 *   <li>kill -3 &lt;pid&gt;           (sends SIGQUIT; captures thread dump via jstack to /var/siemens/common/logs/dumps)</li>
 * </ol>
 */
public class SystemDiagnosticsService {

    private static final Logger logger = LoggerFactory.getLogger(SystemDiagnosticsService.class);

    static final String DUMPS_DIR = "/var/siemens/common/logs/dumps";
    private static final DateTimeFormatter DUMP_TS_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd_HHmmssSSS");

    private final CommandExecutor executor;

    public SystemDiagnosticsService(CommandExecutor executor) {
        this.executor = executor;
    }

    /**
     * Runs all 12 commands and returns a populated {@link DiagnosticsReport}.
     *
     * @return report containing all command outputs and the resolved server PID
     */
    public DiagnosticsReport runDiagnostics() {
        LocalDateTime now = LocalDateTime.now();
        DiagnosticsReport report = new DiagnosticsReport(now);

        logger.info("Starting diagnostics run at {}", now);

        // Command 1: full process list
        String cmd1 = "ps -aux";
        report.addResult(DiagnosticsReport.CMD_1, cmd1, executor.execute(cmd1));

        // Command 2: find the webclient/server process and extract PID.
        // Using '[s]erver' bracket trick avoids matching the grep command itself.
        String cmd2 = "ps -aux | grep '[s]erver'";
        String cmd2Output = executor.execute(cmd2);
        report.addResult(DiagnosticsReport.CMD_2, cmd2, cmd2Output);

        String pid = extractFirstPid(cmd2Output);
        report.setServerPid(pid);

        if (pid == null || pid.isEmpty()) {
            logger.warn("Server process PID not found – commands 3-12 will be skipped");
            addSkippedCommands(report);
            return report;
        }

        logger.info("Identified server PID: {}", pid);

        // Command 3: memory/RSS details for the specific PID
        String cmd3 = "ps -o pid,vsz,rss,cmd -p " + pid;
        report.addResult(DiagnosticsReport.CMD_3, cmd3, executor.execute(cmd3));

        // Command 4: VmRSS and VmSize from /proc/pid/status
        String cmd4 = "cat /proc/" + pid + "/status | grep -E \"VmRSS|VmSize\"";
        report.addResult(DiagnosticsReport.CMD_4, cmd4, executor.execute(cmd4));

        // Command 5: JSSE NIO threads (count only in PDF report)
        String cmd5 = "ps -Lp " + pid + " | grep -i jsse-nio";
        report.addResult(DiagnosticsReport.CMD_5, cmd5, executor.execute(cmd5));

        // Command 6: stack entries from smaps (first 15 lines after each match)
        String cmd6 = "cat /proc/" + pid + "/smaps | grep -A 15 stack";
        report.addResult(DiagnosticsReport.CMD_6, cmd6, executor.execute(cmd6));

        // Command 7: anonymous memory total in MB from smaps
        String cmd7 = "cat /proc/" + pid + "/smaps | grep -i anon | awk '{sum+=$2} END {print sum/1024 \" MB\"}'";
        report.addResult(DiagnosticsReport.CMD_7, cmd7, executor.execute(cmd7));

        // Command 8: stack segments via pmap
        String cmd8 = "pmap -x " + pid + " | grep stack";
        report.addResult(DiagnosticsReport.CMD_8, cmd8, executor.execute(cmd8));

        // Command 9: stack sections from smaps with 5 context lines
        String cmd9 = "cat /proc/" + pid + "/smaps | grep -i stack -A 5";
        report.addResult(DiagnosticsReport.CMD_9, cmd9, executor.execute(cmd9));

        // Command 10: socket/network connections for PID (count only in PDF report)
        String cmd10 = "ss -antp | grep " + pid;
        report.addResult(DiagnosticsReport.CMD_10, cmd10, executor.execute(cmd10));

        // Command 11: socket memory usage (count only in PDF report)
        String cmd11 = "ss -m | grep " + pid;
        report.addResult(DiagnosticsReport.CMD_11, cmd11, executor.execute(cmd11));

        // Command 12: send SIGQUIT to trigger a JVM thread dump and save it to the dumps directory.
        // kill -3 writes to the target process's stderr (systemd journal); jstack captures the
        // same information directly to a file so it is persisted in DUMPS_DIR.
        // pid is guaranteed numeric here (validated by extractFirstPid) to prevent injection.
        String cmd12 = "kill -3 " + pid;
        String dumpFile = DUMPS_DIR + "/threaddump_" + now.format(DUMP_TS_FMT) + ".txt";
        String numericPid = pid.replaceAll("[^0-9]", "");
        String captureCmd = "mkdir -p " + DUMPS_DIR
                + " && kill -3 " + numericPid
                + " && (jstack " + numericPid + " > " + dumpFile + " 2>&1"
                + "  && echo 'Thread dump saved to: " + dumpFile + "'"
                + "  || echo 'jstack not available; SIGQUIT sent but dump written to systemd journal only')";
        String captureOutput = executor.execute(captureCmd);
        report.addResult(DiagnosticsReport.CMD_12, cmd12, captureOutput);

        logger.info("Diagnostics run completed at {}", LocalDateTime.now());
        return report;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Extracts the PID (second field) from the first non-empty line of
     * {@code ps -aux} output.
     *
     * @param psOutput stdout of "ps -aux | grep -i server | grep -v grep"
     * @return PID string, or {@code null} if not found
     */
    private String extractFirstPid(String psOutput) {
        if (psOutput == null || psOutput.trim().isEmpty()) {
            return null;
        }
        for (String line : psOutput.split("\\r?\\n")) {
            line = line.trim();
            if (line.isEmpty()) {
                continue;
            }
            // ps -aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
            String[] parts = line.split("\\s+");
            if (parts.length >= 2) {
                String pid = parts[1];
                if (pid.matches("\\d+")) {
                    return pid;
                }
            }
        }
        return null;
    }

    /**
     * Records N/A entries for commands 3-12 when the server PID cannot be found.
     */
    private void addSkippedCommands(DiagnosticsReport report) {
        String na = "N/A – server PID not found";
        String[] keys = {
            DiagnosticsReport.CMD_3, DiagnosticsReport.CMD_4, DiagnosticsReport.CMD_5,
            DiagnosticsReport.CMD_6, DiagnosticsReport.CMD_7, DiagnosticsReport.CMD_8,
            DiagnosticsReport.CMD_9, DiagnosticsReport.CMD_10, DiagnosticsReport.CMD_11,
            DiagnosticsReport.CMD_12
        };
        for (String key : keys) {
            report.addResult(key, key, na);
        }
    }
}
