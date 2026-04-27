package com.siemens.diagnostics;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Holds the results of a single diagnostics run.
 *
 * <p>Command keys follow the pattern "COMMAND_N" where N is the 1-based index
 * from the requirements specification. Each value is the raw shell output
 * (or a count string for commands 5, 10 and 11 in the PDF report).
 */
public class DiagnosticsReport {

    /** Key constant for each of the 12 commands */
    public static final String CMD_1  = "COMMAND_1";
    public static final String CMD_2  = "COMMAND_2";
    public static final String CMD_3  = "COMMAND_3";
    public static final String CMD_4  = "COMMAND_4";
    public static final String CMD_5  = "COMMAND_5";
    public static final String CMD_6  = "COMMAND_6";
    public static final String CMD_7  = "COMMAND_7";
    public static final String CMD_8  = "COMMAND_8";
    public static final String CMD_9  = "COMMAND_9";
    public static final String CMD_10 = "COMMAND_10";
    public static final String CMD_11 = "COMMAND_11";
    public static final String CMD_12 = "COMMAND_12";

    private final LocalDateTime timestamp;
    private String serverPid;
    /** Ordered map: command key -> raw output */
    private final Map<String, String> results = new LinkedHashMap<>();
    /** Ordered map: command key -> the actual shell command that was run */
    private final Map<String, String> commandLines = new LinkedHashMap<>();

    public DiagnosticsReport(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public String getServerPid() {
        return serverPid;
    }

    public void setServerPid(String serverPid) {
        this.serverPid = serverPid;
    }

    public void addResult(String commandKey, String commandLine, String output) {
        commandLines.put(commandKey, commandLine);
        results.put(commandKey, output);
    }

    public Map<String, String> getResults() {
        return results;
    }

    public Map<String, String> getCommandLines() {
        return commandLines;
    }

    public String getOutput(String commandKey) {
        return results.getOrDefault(commandKey, "");
    }

    public String getCommandLine(String commandKey) {
        return commandLines.getOrDefault(commandKey, commandKey);
    }
}
