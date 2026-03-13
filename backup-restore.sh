#!/usr/bin/env bash
# ClassChat backup / restore / compile. Run from the app folder (where server.js lives).
# Works with 1.0 and 2.0 layouts. Missing folders are skipped; process does not halt.
# Usage:
#   ./backup-restore.sh -b          → create data.zip (data/ + public/uploads/ if present)
#   ./backup-restore.sh -r          → restore from data.zip
#   ./backup-restore.sh -c          → compile: npm install + init DB
#   ./backup-restore.sh -r -c      → restore from data.zip then compile
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ZIP_FILE="${ZIP_FILE:-$SCRIPT_DIR/data.zip}"
DATA_DIR="$SCRIPT_DIR/data"
UPLOADS_DIR="$SCRIPT_DIR/public/uploads"

usage() {
  echo "Usage: $0 [ -b | -r | -c ] [ -r ] [ -c ]"
  echo "  -b    Backup: create data.zip from data/ and public/uploads/ (skips missing)"
  echo "  -r    Restore: extract data.zip into data/ and public/uploads/"
  echo "  -c    Compile: npm install and initialize DB (run initDb)"
  echo "  -r -c Restore from data.zip then compile"
  echo "Set ZIP_FILE to use a different path (default: ./data.zip)"
  exit 1
}

do_backup() {
  echo "Creating $ZIP_FILE ..."
  rm -f "$ZIP_FILE"
  ADDED=0
  if [ -d "$DATA_DIR" ]; then
    ( cd "$SCRIPT_DIR" && zip -rq "$ZIP_FILE" data ) && echo "  Added data/" && ADDED=1
  else
    echo "  (data/ not found, skipping)"
  fi
  if [ -d "$UPLOADS_DIR" ]; then
    ( cd "$SCRIPT_DIR" && zip -rq "$ZIP_FILE" public/uploads ) && echo "  Added public/uploads/" && ADDED=1
  else
    echo "  (public/uploads/ not found, skipping)"
  fi
  if [ "$ADDED" -eq 1 ] && [ -f "$ZIP_FILE" ]; then
    echo "Backup saved to: $ZIP_FILE"
  else
    echo "Nothing to backup (no data/ or public/uploads/ present)."
  fi
}

do_restore() {
  if [ ! -f "$ZIP_FILE" ]; then
    echo "No data.zip found at: $ZIP_FILE"
    exit 1
  fi
  echo "Restoring from: $ZIP_FILE"
  [ -d "$DATA_DIR" ] && rm -rf "$DATA_DIR"
  [ -d "$UPLOADS_DIR" ] && rm -rf "$UPLOADS_DIR"
  unzip -o -q "$ZIP_FILE" -d "$SCRIPT_DIR" 2>/dev/null || true
  mkdir -p "$(dirname "$UPLOADS_DIR")" 2>/dev/null || true
  [ -d "$SCRIPT_DIR/public/uploads" ] && echo "Restored public/uploads/"
  [ -d "$DATA_DIR" ] && echo "Restored data/"
  echo "Restore complete."
}

do_compile() {
  echo "Compiling..."
  if [ -f "$SCRIPT_DIR/package.json" ]; then
    npm install && echo "  npm install done" || echo "  npm install failed (non-fatal)"
  else
    echo "  (package.json not found, skipping npm install)"
  fi
  if [ -f "$SCRIPT_DIR/db.js" ]; then
    node -e "require('./db').initDb(); console.log('  DB initialized');" 2>/dev/null || echo "  DB init failed or skipped (non-fatal)"
  else
    echo "  (db.js not found, skipping initDb)"
  fi
  echo "Compile complete."
}

DO_BACKUP=
DO_RESTORE=
DO_COMPILE=
while getopts "brch" opt; do
  case "$opt" in
    b) DO_BACKUP=1 ;;
    r) DO_RESTORE=1 ;;
    c) DO_COMPILE=1 ;;
    h) usage ;;
    *) usage ;;
  esac
done

[ -n "$DO_BACKUP" ] && do_backup
[ -n "$DO_RESTORE" ] && do_restore
[ -n "$DO_COMPILE" ] && do_compile

if [ -z "$DO_BACKUP$DO_RESTORE$DO_COMPILE" ]; then
  usage
fi
