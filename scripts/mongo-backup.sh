#!/bin/sh
set -eu
umask 077
config="$(mktemp)"
trap 'rm -f "$config"; if [ -n "${archive:-}" ]; then rm -f "$archive"; fi' EXIT HUP INT TERM
printf 'password: "%s"\n' "$(cat /run/secrets/mongo_root_password)" > "$config"
database="${MONGODB_DB_NAME:-MAPS}"
case "$database" in *[!A-Za-z0-9_-]*|'') echo "Nome de banco invalido" >&2; exit 1 ;; esac
mkdir -p /backups
if [ "${1:-backup}" = "restore" ]; then
  [ "${CONFIRM_RESTORE:-}" = "$database" ] || { echo "Defina CONFIRM_RESTORE com o nome do banco para autorizar a restauracao destrutiva." >&2; exit 1; }
  mongorestore --config="$config" --uri="mongodb://maps_root@mongo:27017/?authSource=admin&replicaSet=rs0" --gzip --archive=/backups/maps.archive.gz --nsInclude="$database.*" --drop
  exit 0
fi
archive="$(mktemp /backups/maps.XXXXXX.archive.gz)"
mongodump --config="$config" --uri="mongodb://maps_root@mongo:27017/?authSource=admin&replicaSet=rs0" --db="$database" --gzip --archive="$archive"
mv "$archive" /backups/maps.archive.gz
