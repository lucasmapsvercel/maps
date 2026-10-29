#!/bin/sh
set -eu
cp /run/secrets/mongo_keyfile /data/configdb/maps-keyfile
chown mongodb:mongodb /data/configdb/maps-keyfile
chmod 400 /data/configdb/maps-keyfile
exec /usr/local/bin/docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/configdb/maps-keyfile --bind_ip_all
