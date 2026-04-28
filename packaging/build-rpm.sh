#!/bin/bash
# Build an RPM from the pre-built fat JAR.
#
# This script is invoked by Maven's exec-maven-plugin and receives the
# following environment variables:
#   PROJECT_ARTIFACT  – Maven artifactId   (e.g. system-diagnostics)
#   PROJECT_VERSION   – Maven project version (e.g. 1.0.0)
#   JAR_PATH          – absolute path to the shaded JAR produced by mvn package
#   PACKAGING_DIR     – absolute path to the packaging/ source directory
#   BUILD_DIR         – absolute path to the Maven target/ directory
#
# When running on Cygwin the Java process provides Windows-style paths
# (e.g. C:\Users\...).  rpmbuild is a native Cygwin binary and cannot
# resolve those paths.  cygpath is used to convert them when available.

set -e

# ---------------------------------------------------------------------------
# Helper: convert a Windows path to a Unix/Cygwin path when on Cygwin,
# leave it untouched otherwise.
# ---------------------------------------------------------------------------
convert_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -u "$1"
    else
        echo "$1"
    fi
}

JAR_PATH=$(convert_path "$JAR_PATH")
PACKAGING_DIR=$(convert_path "$PACKAGING_DIR")
BUILD_DIR=$(convert_path "$BUILD_DIR")

RPMBUILD_DIR="$BUILD_DIR/rpmbuild"

# ---------------------------------------------------------------------------
# Create the rpmbuild directory tree inside target/ so that we never touch
# ~/rpmbuild and avoid any home-directory path issues on Windows/Cygwin.
# ---------------------------------------------------------------------------
mkdir -p "$RPMBUILD_DIR/SPECS" \
         "$RPMBUILD_DIR/SOURCES" \
         "$RPMBUILD_DIR/BUILD" \
         "$RPMBUILD_DIR/RPMS" \
         "$RPMBUILD_DIR/SRPMS"

# ---------------------------------------------------------------------------
# Stage the files that the spec file expects to find in %{_sourcedir}.
# ---------------------------------------------------------------------------
cp "$JAR_PATH"                                   "$RPMBUILD_DIR/SOURCES/"
cp "$PACKAGING_DIR/system-diagnostics.sh"        "$RPMBUILD_DIR/SOURCES/"
cp "$PACKAGING_DIR/system-diagnostics.service"   "$RPMBUILD_DIR/SOURCES/"
cp "$PACKAGING_DIR/schedule.conf"                "$RPMBUILD_DIR/SOURCES/"
cp "$PACKAGING_DIR/system-diagnostics.spec"      "$RPMBUILD_DIR/SPECS/"

# ---------------------------------------------------------------------------
# Build the binary RPM.
# _topdir overrides the default ~/rpmbuild location so all artifacts land
# inside the Maven build tree.
# ---------------------------------------------------------------------------
rpmbuild -bb \
    --define "_topdir $RPMBUILD_DIR" \
    "$RPMBUILD_DIR/SPECS/system-diagnostics.spec"

echo "[build-rpm] RPM written to $RPMBUILD_DIR/RPMS/"
