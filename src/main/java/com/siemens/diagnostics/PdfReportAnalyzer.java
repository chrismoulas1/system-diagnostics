package com.siemens.diagnostics;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads all text report files for a given day, produces a summary PDF in
 * {@value ReportWriter#LOG_DIR}.
 *
 * <p>Commands 5, 10 and 11 are represented by line-count only in the PDF.
 * All other commands show the full output (truncated to
 * {@value #MAX_OUTPUT_CHARS} characters when very large).
 */
public class PdfReportAnalyzer {

    private static final Logger logger = LoggerFactory.getLogger(PdfReportAnalyzer.class);

    /** Columns that show count-only in the PDF summary */
    private static final java.util.Set<String> COUNT_ONLY_COMMANDS = new java.util.HashSet<>(
            java.util.Arrays.asList(
                    DiagnosticsReport.CMD_5,
                    DiagnosticsReport.CMD_10,
                    DiagnosticsReport.CMD_11));

    private static final int MAX_OUTPUT_CHARS = 2000;
    private static final float MARGIN = 50f;
    private static final float LINE_HEIGHT = 14f;
    private static final float PAGE_WIDTH = PDRectangle.A4.getWidth();
    private static final float PAGE_HEIGHT = PDRectangle.A4.getHeight();
    private static final float CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

    /** Timestamp format embedded in report file names: {@code yyyyMMdd_HHmmss} */
    private static final DateTimeFormatter FILE_DATE_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd");

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Generates a PDF daily report for the given date.
     *
     * @param date the day to report on
     * @return path to the produced PDF file
     * @throws IOException if report files cannot be read or PDF cannot be written
     */
    public Path generateDailyReport(LocalDate date) throws IOException {
        List<ParsedReport> reports = parseReportsForDate(date);

        if (reports.isEmpty()) {
            logger.warn("No report files found for date {}", date);
        }

        Path pdfPath = Paths.get(ReportWriter.LOG_DIR,
                "daily_report_" + date.format(DateTimeFormatter.BASIC_ISO_DATE) + ".pdf");

        // Ensure the log directory exists before writing the PDF
        Files.createDirectories(pdfPath.getParent());

        writePdf(date, reports, pdfPath);
        logger.info("PDF daily report written: {}", pdfPath);
        return pdfPath;
    }

    // -------------------------------------------------------------------------
    // Report parsing
    // -------------------------------------------------------------------------

    private List<ParsedReport> parseReportsForDate(LocalDate date) throws IOException {
        List<ParsedReport> reports = new ArrayList<>();
        Path logDir = Paths.get(ReportWriter.LOG_DIR);
        if (!Files.exists(logDir)) {
            return reports;
        }

        String datePrefix = "report_" + date.format(FILE_DATE_FMT);

        try (DirectoryStream<Path> stream =
                     Files.newDirectoryStream(logDir, datePrefix + "*.txt")) {
            List<Path> files = new ArrayList<>();
            for (Path p : stream) {
                files.add(p);
            }
            // Sort by file name (which sorts chronologically given yyyyMMdd_HHmmss naming)
            java.util.Collections.sort(files);
            for (Path file : files) {
                ParsedReport pr = parseFile(file);
                if (pr != null) {
                    reports.add(pr);
                }
            }
        }

        return reports;
    }

    /**
     * Parses a single text report file into a {@link ParsedReport}.
     */
    private ParsedReport parseFile(Path file) {
        logger.debug("Parsing report file: {}", file);
        ParsedReport pr = new ParsedReport(file.getFileName().toString());

        try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String currentKey = null;
            StringBuilder currentOutput = new StringBuilder();
            String line;

            while ((line = reader.readLine()) != null) {
                if (line.startsWith("Timestamp: ")) {
                    pr.timestamp = line.substring("Timestamp: ".length()).trim();
                } else if (line.startsWith("Server PID: ")) {
                    pr.serverPid = line.substring("Server PID: ".length()).trim();
                } else if (line.startsWith("### COMMAND_") && line.endsWith(" ###")
                        && !line.startsWith("### END_")) {
                    // e.g. "### COMMAND_5: ps -Lp 1234 | grep -i jsse-nio ###"
                    currentKey = extractCommandKey(line);
                    currentOutput = new StringBuilder();
                    pr.commandLines.put(currentKey, extractCommandText(line));
                } else if (line.startsWith("### END_COMMAND_") && line.endsWith(" ###")) {
                    if (currentKey != null) {
                        pr.outputs.put(currentKey, currentOutput.toString());
                        currentKey = null;
                    }
                } else if (currentKey != null) {
                    currentOutput.append(line).append(System.lineSeparator());
                }
            }

        } catch (IOException e) {
            logger.error("Failed to parse report file {}: {}", file, e.getMessage());
            return null;
        }

        return pr;
    }

    /** Extracts "COMMAND_5" from "### COMMAND_5: ps -Lp 1234 | grep -i jsse-nio ###" */
    private String extractCommandKey(String headerLine) {
        // headerLine: "### COMMAND_N: <cmd> ###"
        String inner = headerLine.substring(4, headerLine.length() - 4).trim(); // "COMMAND_N: <cmd>"
        int colon = inner.indexOf(':');
        return colon >= 0 ? inner.substring(0, colon).trim() : inner;
    }

    /** Extracts the actual shell command from the section header line */
    private String extractCommandText(String headerLine) {
        String inner = headerLine.substring(4, headerLine.length() - 4).trim();
        int colon = inner.indexOf(':');
        return colon >= 0 ? inner.substring(colon + 1).trim() : inner;
    }

    // -------------------------------------------------------------------------
    // PDF generation
    // -------------------------------------------------------------------------

    private void writePdf(LocalDate date, List<ParsedReport> reports, Path pdfPath)
            throws IOException {
        try (PDDocument doc = new PDDocument()) {

            PdfWriter pw = new PdfWriter(doc);

            // Title page
            pw.newPage();
            pw.drawCenteredTitle("SYSTEM DIAGNOSTICS DAILY REPORT", 18, PDType1Font.HELVETICA_BOLD);
            pw.drawCenteredTitle(date.toString(), 14, PDType1Font.HELVETICA_BOLD);
            pw.skip(6);
            pw.drawCenteredTitle("Total runs found: " + reports.size(), 11, PDType1Font.HELVETICA);
            pw.skip(20);

            if (reports.isEmpty()) {
                pw.drawText("No report files were found for " + date + " in " + ReportWriter.LOG_DIR,
                        10, PDType1Font.HELVETICA_OBLIQUE);
            }

            // One section per report (time slot)
            for (ParsedReport pr : reports) {
                pw.skip(10);
                pw.drawSeparator();
                pw.drawBold("Run: " + pr.timestamp + "   Server PID: " + pr.serverPid, 11);
                pw.drawSeparator();
                pw.skip(4);

                writeReportSection(pw, pr);
            }

            // Summary table for count-only commands
            if (!reports.isEmpty()) {
                pw.newPage();
                pw.drawCenteredTitle("SUMMARY – Count-Only Commands", 14, PDType1Font.HELVETICA_BOLD);
                pw.skip(10);
                writeSummaryTable(pw, reports);
            }

            // Close the last open page content stream before saving
            pw.closePage();

            doc.save(pdfPath.toFile());
        }
    }

    private void writeReportSection(PdfWriter pw, ParsedReport pr) throws IOException {
        String[] orderedKeys = {
            DiagnosticsReport.CMD_1, DiagnosticsReport.CMD_2, DiagnosticsReport.CMD_3,
            DiagnosticsReport.CMD_4, DiagnosticsReport.CMD_5, DiagnosticsReport.CMD_6,
            DiagnosticsReport.CMD_7, DiagnosticsReport.CMD_8, DiagnosticsReport.CMD_9,
            DiagnosticsReport.CMD_10, DiagnosticsReport.CMD_11, DiagnosticsReport.CMD_12
        };

        for (String key : orderedKeys) {
            String cmdLine = pr.commandLines.getOrDefault(key, key);
            String output  = pr.outputs.getOrDefault(key, "(no output)");

            pw.drawBold(key + ": " + cmdLine, 10);

            if (COUNT_ONLY_COMMANDS.contains(key)) {
                int count = countLines(output);
                pw.drawText("  Count: " + count + " line(s)", 10, PDType1Font.HELVETICA_OBLIQUE);
            } else {
                String display = truncate(output);
                for (String line : display.split("\\r?\\n", -1)) {
                    pw.drawText("  " + line, 9, PDType1Font.COURIER);
                }
            }
            pw.skip(4);
        }
    }

    private void writeSummaryTable(PdfWriter pw, List<ParsedReport> reports) throws IOException {
        String[] countKeys = {
            DiagnosticsReport.CMD_5, DiagnosticsReport.CMD_10, DiagnosticsReport.CMD_11
        };

        // Header
        pw.drawBold(padRight("Time", 22) + padRight("CMD_5 (jsse-nio)", 20)
                + padRight("CMD_10 (ss -antp)", 20) + "CMD_11 (ss -m)", 10);
        pw.drawSeparator();

        for (ParsedReport pr : reports) {
            StringBuilder row = new StringBuilder();
            row.append(padRight(pr.timestamp, 22));
            for (String key : countKeys) {
                String output = pr.outputs.getOrDefault(key, "");
                row.append(padRight(String.valueOf(countLines(output)), 20));
            }
            pw.drawText(row.toString(), 9, PDType1Font.COURIER);
        }
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    private int countLines(String text) {
        if (text == null || text.trim().isEmpty()) {
            return 0;
        }
        int count = 0;
        for (String line : text.split("\\r?\\n", -1)) {
            if (!line.trim().isEmpty()) {
                count++;
            }
        }
        return count;
    }

    private String truncate(String text) {
        if (text == null) {
            return "";
        }
        if (text.length() <= MAX_OUTPUT_CHARS) {
            return text;
        }
        return text.substring(0, MAX_OUTPUT_CHARS) + "\n... [truncated]";
    }

    private static String padRight(String s, int n) {
        if (s == null) {
            s = "";
        }
        if (s.length() >= n) {
            return s.substring(0, n);
        }
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < n) {
            sb.append(' ');
        }
        return sb.toString();
    }

    // -------------------------------------------------------------------------
    // Inner model class
    // -------------------------------------------------------------------------

    private static class ParsedReport {
        final String fileName;
        String timestamp = "";
        String serverPid = "";
        final Map<String, String> commandLines = new LinkedHashMap<>();
        final Map<String, String> outputs      = new LinkedHashMap<>();

        ParsedReport(String fileName) {
            this.fileName = fileName;
        }
    }

    // -------------------------------------------------------------------------
    // Inner PDF helper (tracks current Y position and creates new pages)
    // -------------------------------------------------------------------------

    private static class PdfWriter {
        private final PDDocument doc;
        private PDPage currentPage;
        private PDPageContentStream cs;
        private float y;

        PdfWriter(PDDocument doc) throws IOException {
            this.doc = doc;
        }

        void newPage() throws IOException {
            closePage();
            currentPage = new PDPage(PDRectangle.A4);
            doc.addPage(currentPage);
            cs = new PDPageContentStream(doc, currentPage);
            y = PAGE_HEIGHT - MARGIN;
        }

        private void ensureSpace(float needed) throws IOException {
            if (y - needed < MARGIN) {
                newPage();
            }
        }

        void drawCenteredTitle(String text, int fontSize, PDFont font) throws IOException {
            ensureSpace(LINE_HEIGHT * 2);
            float textWidth = font.getStringWidth(sanitize(text)) / 1000 * fontSize;
            float x = (PAGE_WIDTH - textWidth) / 2;
            cs.beginText();
            cs.setFont(font, fontSize);
            cs.newLineAtOffset(x, y);
            cs.showText(sanitize(text));
            cs.endText();
            y -= LINE_HEIGHT + fontSize * 0.3f;
        }

        void drawBold(String text, int fontSize) throws IOException {
            drawText(text, fontSize, PDType1Font.HELVETICA_BOLD);
        }

        void drawText(String text, int fontSize, PDFont font) throws IOException {
            // Split the text so very long lines wrap
            List<String> wrapped = wrapText(sanitize(text), font, fontSize, CONTENT_WIDTH);
            for (String line : wrapped) {
                ensureSpace(LINE_HEIGHT);
                cs.beginText();
                cs.setFont(font, fontSize);
                cs.newLineAtOffset(MARGIN, y);
                cs.showText(line);
                cs.endText();
                y -= LINE_HEIGHT;
            }
        }

        void drawSeparator() throws IOException {
            ensureSpace(LINE_HEIGHT);
            cs.setLineWidth(0.5f);
            cs.moveTo(MARGIN, y);
            cs.lineTo(PAGE_WIDTH - MARGIN, y);
            cs.stroke();
            y -= LINE_HEIGHT * 0.5f;
        }

        void skip(float pts) {
            y -= pts;
        }

        void closePage() throws IOException {
            if (cs != null) {
                cs.close();
                cs = null;
            }
        }

        /** Wraps text to fit within {@code maxWidth} points. */
        private List<String> wrapText(String text, PDFont font, int fontSize, float maxWidth)
                throws IOException {
            List<String> lines = new ArrayList<>();
            if (text == null || text.isEmpty()) {
                lines.add("");
                return lines;
            }
            String[] words = text.split(" ");
            StringBuilder currentLine = new StringBuilder();
            for (String word : words) {
                String candidate = currentLine.length() == 0
                        ? word
                        : currentLine + " " + word;
                float w = font.getStringWidth(candidate) / 1000 * fontSize;
                if (w > maxWidth && currentLine.length() > 0) {
                    lines.add(currentLine.toString());
                    currentLine = new StringBuilder(word);
                } else {
                    currentLine = new StringBuilder(candidate);
                }
            }
            if (currentLine.length() > 0) {
                lines.add(currentLine.toString());
            }
            return lines;
        }

        /**
         * Replaces characters outside the PDFBox built-in font range
         * (WinAnsiEncoding) to avoid encoding errors.
         */
        private String sanitize(String text) {
            if (text == null) {
                return "";
            }
            // Replace non-printable / non-Latin-1 characters with '?'
            StringBuilder sb = new StringBuilder(text.length());
            for (char c : text.toCharArray()) {
                if (c >= 0x20 && c <= 0x7E) {
                    sb.append(c);
                } else if (c == '\t') {
                    sb.append("    ");
                } else if (c > 0x7E && c <= 0xFF) {
                    sb.append(c);
                } else {
                    sb.append('?');
                }
            }
            return sb.toString();
        }
    }
}
