#!/bin/bash
# Apply localhost-only changes to classchatnode/server.js. Run from project root.
TARGET="classchatnode/server.js"
[ -f "$TARGET" ] || { echo "File not found: $TARGET"; exit 1; }
DIR=$(dirname "$TARGET")
BASE=$(basename "$TARGET")
cp "$TARGET" "$TARGET.bak"
cd "$DIR" || exit 1

# Write unified diff with cat, then apply it
cat << PATCHEOF | patch -p0
--- $BASE
+++ $BASE
@@ -5,8 +5,6 @@
 const path = require('path');
 const fs = require('fs');
-const os = require('os');
-const https = require('https');
 const express = require('express');
 const session = require('express-session');
@@ -692,17 +690,6 @@
   res.redirect(`/staff/support/${encodeURIComponent(other.username)}`);
 });
 
-app.listen(PORT, '0.0.0.0', () => {
-  console.log(`ClassChat running at http://localhost:${PORT}`);
-  const nets = os.networkInterfaces();
-  for (const name of Object.keys(nets)) {
-    for (const net of nets[name]) {
-      if (net.family === 'IPv4' && !net.internal) {
-        console.log(`  local: http://${net.address}:${PORT}`);
-        break;
-      }
-    }
-  }
-  https.get('https://ifconfig.me/ip', { timeout: 3000 }, (res) => {
-    let ip = '';
-    res.on('data', (c) => (ip += c));
-    res.on('end', () => {
-      ip = ip.trim();
-      if (ip) console.log(`  internet: http://${ip}:${PORT}`);
-    });
-  }).on('error', () => {});
+app.listen(PORT, '127.0.0.1', () => {
+  console.log(`ClassChat running at http://localhost:${PORT} (localhost only)`);
 });
PATCHEOF

echo "Applied. Backup: $TARGET.bak"
grep -A1 "app.listen" "$BASE"
