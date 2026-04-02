#!/bin/bash
# Install general-tla skill and prerequisites
set -e

SKILL_DIR="${1:-.claude/skills/general-tla}"
TLA_DIR="$HOME/tla"
TLA_JAR="$TLA_DIR/tla2tools.jar"

echo "Installing general-tla skill..."

# Copy skill files
mkdir -p "$SKILL_DIR/references"
cp SKILL.md "$SKILL_DIR/"
cp references/*.md "$SKILL_DIR/references/"

echo "Skill installed to $SKILL_DIR"

# Install TLA+ tools if missing
if [ -f "$TLA_JAR" ]; then
    echo "tla2tools.jar already exists at $TLA_JAR"
else
    echo "Downloading tla2tools.jar..."
    mkdir -p "$TLA_DIR"
    curl -L -o "$TLA_JAR" \
        https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
    echo "tla2tools.jar installed to $TLA_JAR"
fi

# Check Java
if command -v java &>/dev/null; then
    echo "Java: $(java -version 2>&1 | head -1)"
else
    echo "WARNING: Java not found. TLC requires Java 11+."
    echo "  macOS:  brew install openjdk"
    echo "  Linux:  sudo apt install default-jdk"
fi

echo ""
echo "Done. Run 'java -jar ~/tla/tla2tools.jar' to verify TLC works."
