#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
INSTALL_DIR=${KDENLIVE_MCP_INSTALL_DIR:-"$HOME/.local/share/kdenlive-mcp"}

command -v node >/dev/null 2>&1 || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }
NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node.js 22 or newer is required; found $(node --version)." >&2; exit 1; }
command -v bun >/dev/null 2>&1 || { echo 'Bun is required: https://bun.sh/docs/installation' >&2; exit 1; }

cd "$REPO_ROOT"
bun install --frozen-lockfile
bun run package:release --platform linux --output artifacts/release
ARCHIVE=$(find "$REPO_ROOT/artifacts/release" -maxdepth 1 -name 'kdenlive-mcp-*-linux-x64.tar.gz' -print | sort | tail -n 1)
[ -n "$ARCHIVE" ] || { echo 'Linux release archive was not created.' >&2; exit 1; }
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$ARCHIVE" -C "$INSTALL_DIR"
PACKAGE_ROOT=$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
"$PACKAGE_ROOT/kdenlive-mcp" --version
"$PACKAGE_ROOT/kdenlive-mcp" --doctor || true
printf 'Installed to %s\n' "$PACKAGE_ROOT"
printf 'Add %s to PATH, then see INSTALL.md for MCP client configuration.\n' "$PACKAGE_ROOT"
