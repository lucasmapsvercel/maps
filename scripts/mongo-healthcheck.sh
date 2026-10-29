#!/bin/sh
set -eu
exec mongosh --quiet --host 127.0.0.1 --eval '
  const admin = db.getSiblingDB("admin");
  admin.auth("maps_root", require("fs").readFileSync("/run/secrets/mongo_root_password", "utf8").trimEnd());
  const options = admin.runCommand({getCmdLineOpts: 1});
  quit(options.ok && options.parsed.replication && options.parsed.replication.replSetName === "rs0" ? 0 : 1);
'
