#!/bin/bash
# recseg.sh NAME FACTOR -- then reads "time_in_anim_seconds js" lines from stdin; last line "END t".
cd /hypede; H=tools/dev/shell-headless.sh
export DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/hypede-dev/bus) DCONF_PROFILE=hypede
NAME=$1; F=$2; DIR=/tmp/rec/$NAME; rm -rf $DIR
$H eval "$(grep -v '^//' /tmp/rec.js)" >/dev/null
$H eval "imports.gi.St.Settings.get().slow_down_factor = $F; 1" >/dev/null
$H eval "globalThis.__recStop=false; globalThis.__recDone=false; __rec('$DIR', 100000).catch(e => log('REC ' + e)); 1" >/dev/null
START=$(date +%s.%N)
while read -r T JS; do
  target=$(python3 -c "print($START + $T*$F)")
  now=$(date +%s.%N); d=$(python3 -c "print(max(0, $target - $now))"); sleep $d
  [ "$JS" = "" ] && continue
  if [[ "$JS" == SH:* ]]; then bash -c "${JS#SH:}" & else $H eval "$JS" >/dev/null; fi
done
$H eval "globalThis.__recStop=true; 1" >/dev/null
for i in $(seq 30); do [ -f $DIR/times.json ] && break; sleep 0.5; done
$H eval "imports.gi.St.Settings.get().slow_down_factor = 1; 1" >/dev/null
echo "$F" > $DIR/factor; ls $DIR | wc -l
