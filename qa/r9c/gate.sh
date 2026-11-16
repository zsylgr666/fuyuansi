#!/bin/bash
# start a browser job only when ≤1 other headless test browser runs on the box (box total ≤2). The desktop GUI browser (sand-exit-watch child) is not a test run.
nb(){ n=0; for p in $(ps -eo pid,args | grep -E "^ *[0-9]+ (/opt/google/chrome/chrome|/usr/bin/google-chrome) --" | grep -v -- "--type=" | awk '{print $1}'); do pp=$(ps -o ppid= -p $p 2>/dev/null); ps -o args= -p $pp 2>/dev/null | grep -q sand-exit-watch || n=$((n+1)); done; echo $n; }
while [ "$(nb)" -ge 2 ]; do sleep 1; done; exec "$@"
