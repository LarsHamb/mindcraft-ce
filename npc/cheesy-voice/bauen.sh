#!/bin/sh
# Baut cheesy-voice (Voice + "!npc aus/an") auf dem Laptop. Seit 1.1.0 wird gegen die Server-Jar 26.3, den
# Fabric-Loader, Mixin und die Fabric-Message-API gebaut (26.x ist nicht verschleiert). Die Jars kommen aus dem
# Boys-Server-Ordner nach ../libs (nur gelesen). Ergebnis: target/cheesy-voice-<version>.jar
# Aufruf (im Ordner npc/cheesy-voice): sh bauen.sh
MC=${MC:-/home/lars/minecraft}
LIB=$(cd .. && pwd)/libs
mkdir -p "$LIB"
cp "$MC/versions/26.3/server-26.3.jar" "$LIB/"
for j in net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar net/fabricmc/sponge-mixin/0.17.5+mixin.0.8.7/sponge-mixin-0.17.5+mixin.0.8.7.jar \
         com/mojang/brigadier/1.3.11/brigadier-1.3.11.jar com/mojang/datafixerupper/10.0.21/datafixerupper-10.0.21.jar \
         com/mojang/authlib/10.0.77/authlib-10.0.77.jar com/mojang/logging/1.7.12/logging-1.7.12.jar \
         com/google/guava/guava/33.6.0-jre/guava-33.6.0-jre.jar com/google/code/gson/gson/2.14.0/gson-2.14.0.jar \
         org/joml/joml/1.10.9/joml-1.10.9.jar org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.jar org/jspecify/jspecify/1.0.0/jspecify-1.0.0.jar \
         io/netty/netty-common/4.2.16.Final/netty-common-4.2.16.Final.jar io/netty/netty-transport/4.2.16.Final/netty-transport-4.2.16.Final.jar \
         io/netty/netty-buffer/4.2.16.Final/netty-buffer-4.2.16.Final.jar it/unimi/dsi/fastutil/8.5.18/fastutil-8.5.18.jar; do
  cp "$MC/libraries/$j" "$LIB/" || exit 1
done
# the message API and API base are nested in the fabric-api jar
python3 - "$MC/mods" "$LIB" <<'PY'
import glob, sys, zipfile
api = sorted(glob.glob(sys.argv[1] + '/fabric-api-*.jar'))[-1]
z = zipfile.ZipFile(api)
for n in z.namelist():
    if n.endswith('.jar') and ('fabric-message-api-v1' in n or 'fabric-api-base' in n):
        open(sys.argv[2] + '/' + n.split('/')[-1], 'wb').write(z.read(n))
PY
docker run --rm -v "$(cd .. && pwd)":/b -v "$HOME/cheesy-voice-bau/m2":/root/.m2 -w /b/cheesy-voice maven:3.9-eclipse-temurin-25 mvn -q package
ls -la target/*.jar
