package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * Writes a structured text report to {@code /var/siemens/common/log/}.
 *
 * <p>File name format: {@code report_YYYYMMdd_HHmmss.txt}
 *
 * <p>The file uses section markers that {@link PdfReportAnalyzer} can parse:
 * <pre>
 * ### COMMAND_1: &lt;shell command&gt; ###
 * &lt;output&gt;
 * ### END_COMMAND_1 ###
 * </pre>
 */
public class ReportWriter {

    private static final Logger logger = LoggerFactory.getLogger(ReportWriter.class);

    static final String LOG_DIR = "/var/siemens/common/log";
    private static final DateTimeFormatter FILE_TS_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss");
    private static final DateTimeFormatter DISPLAY_TS_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String SEP =
            "==================================================";

    /**
     * Writes the given report to disk and returns the path of the created file.
     *
     * @param report populated diagnostics report
     * @return path to the written file
     * @throws IOException if the file cannot be created or written
     */
    public Path writeReport(DiagnosticsReport report) throws IOException {
        Path logDir = Paths.get(LOG_DIR);
        if (!Files.exists(logDir)) {
            Files.createDirectories(logDir);
            logger.info("Created log directory: {}", logDir);
        }

        String fileName = "report_" + report.getTimestamp().format(FILE_TS_FMT) + ".txt";
        Path reportPath = logDir.resolve(fileName);

        try (BufferedWriter writer = Files.newBufferedWriter(reportPath, StandardCharsets.UTF_8)) {
            writeHeader(writer, report);
            writeCommandSections(writer, report);
            writeFooter(writer);
        }

        logger.info("Report written: {}", reportPath);
        return reportPath;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private void writeHeader(BufferedWriter w, DiagnosticsReport report) throws IOException {
        w.write(SEP); w.newLine();
        w.write("SYSTEM DIAGNOSTICS REPORT"); w.newLine();
        w.write("Timestamp: " + report.getTimestamp().format(DISPLAY_TS_FMT)); w.newLine();
        if (report.getServerPid() != null) {
            w.write("Server PID: " + report.getServerPid()); w.newLine();
        }
        w.write(SEP); w.newLine();
        w.newLine();
    }

    private void writeCommandSections(BufferedWriter w, DiagnosticsReport report)
            throws IOException {
        for (Map.Entry<String, String> entry : report.getResults().entrySet()) {
            String key = entry.getKey();
            String commandLine = report.getCommandLine(key);
            String output = entry.getValue();

            w.write("### " + key + ": " + commandLine + " ###"); w.newLine();
            w.write(output == null ? "" : output);
            // Ensure output ends with a newline
            if (output != null && !output.isEmpty() && !output.endsWith(System.lineSeparator())) {
                w.newLine();
            }
            w.write("### END_" + key + " ###"); w.newLine();
            w.newLine();
        }
    }

    private void writeFooter(BufferedWriter w) throws IOException {
        w.write(SEP); w.newLine();
        w.write("END OF REPORT"); w.newLine();
        w.write(SEP); w.newLine();
    }
}
