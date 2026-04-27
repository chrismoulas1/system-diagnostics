#!/bin/bash
# ---------------------------------------------------------------------------
# system-diagnostics.sh
# Startup wrapper for the System Diagnostics application.
# Uses the IBM JRE installed at the Siemens standard path.
# ---------------------------------------------------------------------------

JAVA_HOME=/opt/siemens/share/ibm-java-x86_64-80/jre
JAVA_BIN=${JAVA_HOME}/bin/java
JAR=/opt/siemens/diagnostics/lib/system-diagnostics-1.0.0.jar
LOG_DIR=/var/siemens/common/log

# Ensure the log directory exists (belt-and-suspenders; also done in systemd unit)
mkdir -p "${LOG_DIR}"

if [ ! -x "${JAVA_BIN}" ]; then
    echo "ERROR: Java executable not found at ${JAVA_BIN}" >&2
    exit 1
fi

if [ ! -f "${JAR}" ]; then
    echo "ERROR: JAR not found at ${JAR}" >&2
    exit 1
fi

exec "${JAVA_BIN}" \
    -Xms64m -Xmx256m \
    -Djava.awt.headless=true \
    -Dfile.encoding=UTF-8 \
    -jar "${JAR}" --run
