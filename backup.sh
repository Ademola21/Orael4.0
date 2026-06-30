#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Orael Database Backup Script
# Run via cron: 0 */6 * * * /path/to/orael/backup.sh
# Creates a timestamped backup every 6 hours, keeps last 30
# ─────────────────────────────────────────────────────────────

DB_PATH="data/orael.db"
BACKUP_DIR="data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MAX_BACKUPS=30

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
  echo "[BACKUP] Database not found at $DB_PATH"
  exit 1
fi

# Create backup using SQLite's .backup command (safe online backup)
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/orael_$TIMESTAMP.db'"

# Also create a compressed copy
gzip -c "$BACKUP_DIR/orael_$TIMESTAMP.db" > "$BACKUP_DIR/orael_$TIMESTAMP.db.gz"

# Remove the uncompressed backup (keep only gzipped)
rm "$BACKUP_DIR/orael_$TIMESTAMP.db"

echo "[BACKUP] Created: orael_$TIMESTAMP.db.gz"

# Clean up old backups (keep only the last MAX_BACKUPS)
ls -t "$BACKUP_DIR"/orael_*.db.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null

echo "[BACKUP] Cleanup complete. Keeping last $MAX_BACKUPS backups."
echo "[BACKUP] Current backups:"
ls -lh "$BACKUP_DIR"/orael_*.db.gz 2>/dev/null | wc -l
