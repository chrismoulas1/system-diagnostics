package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Schedules the diagnostics run to execute at configurable hours each day (local system time).
 *
 * <p>The scheduled hours are loaded from
 * {@value ScheduleConfig#CONFIG_FILE} at startup.  If that file is absent
 * or contains no valid entries the built-in defaults (00:00, 09:00, 15:00, 18:00) are used.
 *
 * <p>Each scheduled job:
 * <ol>
 *   <li>Runs all 12 diagnostic commands via {@link SystemDiagnosticsService}</li>
 *   <li>Writes the structured text report via {@link ReportWriter}</li>
 * </ol>
 *
 * <p>A separate optional job can be triggered to generate the PDF summary
 * for the previous day (at 00:05 daily).
 */
public class DiagnosticsScheduler {

    private static final Logger logger = LoggerFactory.getLogger(DiagnosticsScheduler.class);

    /** Hours at which the diagnostics run is triggered (24-hour clock), loaded from config. */
    private final int[] scheduledHours;

    /** Seconds in a full day */
    private static final long DAY_SECONDS = 24L * 60 * 60;

    private final ScheduledExecutorService scheduler =
            Executors.newScheduledThreadPool(2, r -> {
                Thread t = new Thread(r, "diagnostics-scheduler");
                t.setDaemon(false); // keep JVM alive
                return t;
            });

    private final SystemDiagnosticsService diagnosticsService;
    private final ReportWriter reportWriter;
    private final PdfReportAnalyzer pdfAnalyzer;

    public DiagnosticsScheduler() {
        this.scheduledHours = ScheduleConfig.loadScheduledHours();
        CommandExecutor executor = new CommandExecutor();
        this.diagnosticsService = new SystemDiagnosticsService(executor);
        this.reportWriter       = new ReportWriter();
        this.pdfAnalyzer        = new PdfReportAnalyzer();
    }

    /**
     * Starts all scheduled jobs.
     * The method returns immediately; jobs execute on background threads.
     */
    public void start() {
        logger.info("Starting diagnostics scheduler. Scheduled hours: {}",
                ScheduleConfig.formatHours(scheduledHours));

        for (int hour : scheduledHours) {
            long initialDelaySeconds = secondsUntilNextOccurrence(hour, 0);
            logger.info("First run at {}:00 in {} seconds (~{} minutes)",
                    String.format("%02d", hour), initialDelaySeconds, initialDelaySeconds / 60);

            final int scheduledHour = hour;
            scheduler.scheduleAtFixedRate(
                    () -> runDiagnostics(scheduledHour),
                    initialDelaySeconds,
                    DAY_SECONDS,
                    TimeUnit.SECONDS);
        }

        // Generate the previous day's PDF report at 00:05 every day
        long pdfInitialDelay = secondsUntilNextOccurrence(0, 5);
        scheduler.scheduleAtFixedRate(
                this::generatePreviousDayPdf,
                pdfInitialDelay,
                DAY_SECONDS,
                TimeUnit.SECONDS);

        logger.info("Scheduler started. {} periodic jobs registered.", scheduledHours.length + 1);
    }

    /** Gracefully shuts down the scheduler, waiting up to 30 seconds. */
    public void stop() {
        logger.info("Stopping scheduler...");
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(30, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            scheduler.shutdownNow();
        }
        logger.info("Scheduler stopped.");
    }

    // -------------------------------------------------------------------------
    // Private job implementations
    // -------------------------------------------------------------------------

    private void runDiagnostics(int hour) {
        logger.info("--- Diagnostics job starting (scheduled {:02d}:00) ---", hour);
        try {
            DiagnosticsReport report = diagnosticsService.runDiagnostics();
            reportWriter.writeReport(report);
        } catch (IOException e) {
            logger.error("Failed to write diagnostics report: {}", e.getMessage(), e);
        } catch (Exception e) {
            logger.error("Unexpected error during diagnostics run: {}", e.getMessage(), e);
        }
        logger.info("--- Diagnostics job finished (scheduled {:02d}:00) ---", hour);
    }

    private void generatePreviousDayPdf() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        logger.info("Generating PDF report for {}", yesterday);
        try {
            pdfAnalyzer.generateDailyReport(yesterday);
        } catch (IOException e) {
            logger.error("Failed to generate PDF for {}: {}", yesterday, e.getMessage(), e);
        } catch (Exception e) {
            logger.error("Unexpected error generating PDF for {}: {}", yesterday, e.getMessage(), e);
        }
    }

    // -------------------------------------------------------------------------
    // Time calculation utility
    // -------------------------------------------------------------------------

    /**
     * Computes the number of seconds from now until the next occurrence of
     * {@code hour:minute} in the system's default time zone.
     *
     * @param hour   target hour (0-23)
     * @param minute target minute (0-59)
     * @return delay in seconds (always &ge; 0)
     */
    static long secondsUntilNextOccurrence(int hour, int minute) {
        ZonedDateTime now = ZonedDateTime.now(ZoneId.systemDefault());
        ZonedDateTime next = now.toLocalDate().atTime(LocalTime.of(hour, minute))
                .atZone(ZoneId.systemDefault());

        if (!next.isAfter(now)) {
            next = next.plusDays(1);
        }

        long delay = next.toEpochSecond() - now.toEpochSecond();
        return Math.max(delay, 0L);
    }
}
