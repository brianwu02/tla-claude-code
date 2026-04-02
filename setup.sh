#!/bin/bash
# Install tla-claude-code skill and prerequisites
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="${1:-.claude/skills/tla}"
TLA_DIR="$HOME/tla"
TLA_JAR="$TLA_DIR/tla2tools.jar"

echo "Installing tla-claude-code skill..."

# Copy skill files from plugin structure
mkdir -p "$SKILL_DIR"
cp -r "$SCRIPT_DIR/skills/tla/"* "$SKILL_DIR/"

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
echo ""
echo "Or install as a plugin:"
echo "  /plugin marketplace add brianwu02/tla-claude-code"
echo "  /plugin install tla-claude-code@tla-claude-code"
