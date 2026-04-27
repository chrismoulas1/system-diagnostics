package com.siemens.diagnostics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;

/**
 * Executes Linux shell commands and returns their output as a String.
 * All commands are run through {@code /bin/bash -c} so that pipe operators
 * and shell built-ins work correctly.
 */
public class CommandExecutor {

    private static final Logger logger = LoggerFactory.getLogger(CommandExecutor.class);
    private static final int TIMEOUT_SECONDS = 60;

    /**
     * Executes the given shell command and returns its combined stdout.
     * If the command times out or fails, a descriptive error string is returned
     * instead of throwing an exception so that the report is always complete.
     *
     * @param command the shell command (may contain pipes, redirects, etc.)
     * @return stdout of the command, or an error description
     */
    public String execute(String command) {
        logger.debug("Executing: {}", command);
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();

        try {
            ProcessBuilder pb = new ProcessBuilder("/bin/bash", "-c", command);
            Process process = pb.start();

            // Drain stdout
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    stdout.append(line).append(System.lineSeparator());
                }
            }

            // Drain stderr (needed to prevent blocking on full pipe buffer)
            try (BufferedReader errReader = new BufferedReader(
                    new InputStreamReader(process.getErrorStream()))) {
                String line;
                while ((line = errReader.readLine()) != null) {
                    stderr.append(line).append(System.lineSeparator());
                }
            }

            boolean finished = process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                logger.warn("Command timed out ({}s): {}", TIMEOUT_SECONDS, command);
                return "TIMEOUT: command did not complete within " + TIMEOUT_SECONDS + " seconds";
            }

            int exitCode = process.exitValue();
            if (exitCode != 0 && stdout.length() == 0) {
                String errMsg = stderr.toString().trim();
                logger.debug("Command '{}' exited with code {} stderr: {}", command, exitCode, errMsg);
                return errMsg.isEmpty()
                        ? "Command exited with code " + exitCode
                        : "Exit code " + exitCode + ": " + errMsg;
            }

        } catch (IOException e) {
            logger.error("IOException executing command '{}': {}", command, e.getMessage());
            return "ERROR (IO): " + e.getMessage();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("Interrupted while executing command '{}'", command);
            return "ERROR (interrupted)";
        }

        return stdout.toString();
    }
}
