#!/bin/bash
# Restart the web client + WebSocket bridge in the background.
# COSMIC_SERVERS: name=host pairs shown on the login screen (first is the default).
cd "$(dirname "$0")"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null
COSMIC_SERVERS="${COSMIC_SERVERS:-cosmic=192.168.2.2,dev=127.0.0.1}" nohup node server.js > server.log 2>&1 &
echo $! > server.pid
sleep 1; cat server.log
