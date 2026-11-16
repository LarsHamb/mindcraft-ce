#!/bin/sh
# Server-side check of the shelter: origin ox oy oz, as the tool reported it. Inner size 3x3, height 3.
OX=$1; OY=$2; OZ=$3
X0=$((OX+2)); Z0=$((OZ-2)); X1=$((X0+4)); Z1=$((Z0+4))
cmds=""
for y in $(seq $OY $((OY+3))); do
  for z in $(seq $Z0 $Z1); do
    for x in $(seq $X0 $X1); do
      cmds="$cmds|execute if block $x $y $z #minecraft:replaceable"
    done
  done
done
IFS='
'
out=$(~/mindcraft-ce-lauf/rcon26.sh $(echo "$cmds" | tr '|' '\n' | sed '/^$/d'))
i=0
for y in $(seq $OY $((OY+3))); do
  echo "y=$y  (# fest, . leer/ersetzbar)"
  for z in $(seq $Z0 $Z1); do
    line=""
    for x in $(seq $X0 $X1); do
      i=$((i+1)); r=$(echo "$out" | sed -n "${i}p")
      case "$r" in Test\ passed*) line="$line.";; *) line="$line#";; esac
    done
    echo "   $line   z=$z"
  done
done
