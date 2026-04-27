package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * Entry point for the System Diagnostics application.
 *
 * <p>Usage:
 * <pre>
 *   java -jar system-diagnostics-1.0.0.jar [--run]
 *       Starts the long-running scheduler (default mode).
 *
 *   java -jar system-diagnostics-1.0.0.jar --report [yyyy-MM-dd]
 *       Generates the PDF daily report for the given date
 *       (defaults to today when no date is specified).
 * </pre>
 */
public class Main {

    private static final Logger logger = LoggerFactory.getLogger(Main.class);

    public static void main(String[] args) {
        if (args.length > 0 && "--report".equals(args[0])) {
            // PDF report generation mode
            LocalDate date = LocalDate.now();
            if (args.length > 1) {
                try {
                    date = LocalDate.parse(args[1], DateTimeFormatter.ISO_DATE);
                } catch (DateTimeParseException e) {
                    System.err.println("Invalid date format '" + args[1]
                            + "'. Expected yyyy-MM-dd. Using today's date.");
                    logger.warn("Invalid date argument '{}', defaulting to today", args[1]);
                }
            }

            logger.info("PDF report generation requested for date: {}", date);
            PdfReportAnalyzer analyzer = new PdfReportAnalyzer();
            try {
                java.nio.file.Path pdfPath = analyzer.generateDailyReport(date);
                System.out.println("PDF report written to: " + pdfPath);
            } catch (IOException e) {
                logger.error("Failed to generate PDF report: {}", e.getMessage(), e);
                System.err.println("ERROR: Failed to generate PDF report – " + e.getMessage());
                System.exit(1);
            }

        } else {
            // Default: long-running scheduler mode
            logger.info("System Diagnostics starting in scheduler mode.");
            logger.info("Scheduled run times: 00:00, 09:00, 15:00, 18:00");
            logger.info("Reports will be written to: " + ReportWriter.LOG_DIR);

            DiagnosticsScheduler sched = new DiagnosticsScheduler();
            sched.start();

            // Register shutdown hook so the scheduler is gracefully stopped
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                logger.info("Shutdown signal received – stopping scheduler.");
                sched.stop();
            }, "shutdown-hook"));

            logger.info("Scheduler running. Press Ctrl-C or send SIGTERM to stop.");

            // Block the main thread (the scheduler threads keep the JVM alive)
            try {
                Thread.currentThread().join();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                logger.info("Main thread interrupted – exiting.");
            }
        }
    }
}
