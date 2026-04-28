package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Properties;
import java.util.Set;

/**
 * Loads the diagnostic schedule configuration from an optional file on the installed system.
 *
 * <p>The config file is looked up at:
 * <pre>  /opt/siemens/diagnostics/conf/schedule.conf</pre>
 *
 * <p>If the file does not exist, cannot be read, or contains no valid {@code scheduled.hours}
 * entry, the built-in defaults ({@code 0, 9, 15, 18}) are used transparently.
 *
 * <p>Example config file content:
 * <pre>
 *   # Hours (0-23) at which the diagnostics run is triggered – comma-separated
 *   scheduled.hours=0,9,15,18
 * </pre>
 */
public class ScheduleConfig {

    private static final Logger logger = LoggerFactory.getLogger(ScheduleConfig.class);

    /** Absolute path of the optional on-system configuration file. */
    public static final String CONFIG_FILE = "/opt/siemens/diagnostics/conf/schedule.conf";

    /** Property key that holds the comma-separated list of hours. */
    static final String HOURS_KEY = "scheduled.hours";

    /** Default schedule hours used when no valid configuration is found. */
    static final int[] DEFAULT_HOURS = {0, 9, 15, 18};

    private ScheduleConfig() {
        // utility class
    }

    /**
     * Returns the array of hours at which diagnostics should run.
     *
     * <p>Reads {@value #CONFIG_FILE}. Falls back to {@link #DEFAULT_HOURS} if the file is
     * absent, unreadable, or does not contain a valid {@value #HOURS_KEY} entry.
     *
     * @return non-empty sorted array of valid hours (0-23), never {@code null}
     */
    public static int[] loadScheduledHours() {
        Properties props = new Properties();
        try (InputStream in = new FileInputStream(CONFIG_FILE)) {
            props.load(in);
            logger.info("Loaded schedule configuration from {}", CONFIG_FILE);
        } catch (IOException e) {
            logger.info("Schedule config not found at {} – using defaults ({})",
                    CONFIG_FILE, formatHours(DEFAULT_HOURS));
            return DEFAULT_HOURS.clone();
        }

        String raw = props.getProperty(HOURS_KEY, "").trim();
        if (raw.isEmpty()) {
            logger.warn("Property '{}' is missing or empty in {} – using defaults ({})",
                    HOURS_KEY, CONFIG_FILE, formatHours(DEFAULT_HOURS));
            return DEFAULT_HOURS.clone();
        }

        int[] parsed = parseHours(raw);
        if (parsed.length == 0) {
            logger.warn("No valid hours found in '{}={}' – using defaults ({})",
                    HOURS_KEY, raw, formatHours(DEFAULT_HOURS));
            return DEFAULT_HOURS.clone();
        }

        logger.info("Scheduled hours loaded from config: {}", formatHours(parsed));
        return parsed;
    }

    // -------------------------------------------------------------------------
    // Package-private helpers (also used in tests)
    // -------------------------------------------------------------------------

    /**
     * Parses a comma-separated string of integers into an array of valid hours (0-23).
     * Tokens that are not integers or are outside the 0-23 range are skipped with a warning.
     */
    static int[] parseHours(String raw) {
        Set<Integer> seen = new LinkedHashSet<>();
        for (String token : raw.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                int hour = Integer.parseInt(trimmed);
                if (hour < 0 || hour > 23) {
                    logger.warn("Ignoring invalid hour value {} – must be in range 0-23", hour);
                } else {
                    seen.add(hour);
                }
            } catch (NumberFormatException e) {
                logger.warn("Ignoring non-numeric token '{}' in scheduled.hours", trimmed);
            }
        }

        // Return as a sorted primitive array
        int[] result = new int[seen.size()];
        int i = 0;
        for (int hour : seen) {
            result[i++] = hour;
        }
        Arrays.sort(result);
        return result;
    }

    /** Formats an int array as a human-readable string, e.g. {@code "00:00, 09:00, 15:00, 18:00"}. */
    static String formatHours(int[] hours) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < hours.length; i++) {
            if (i > 0) {
                sb.append(", ");
            }
            sb.append(String.format("%02d:00", hours[i]));
        }
        return sb.toString();
    }
}
