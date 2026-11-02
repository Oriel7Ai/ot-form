#!/bin/sh
# בניית האתר ל-Cloudflare Pages: מעתיק לתיקייה dist רק את קובצי האתר.
# הבדיקות, קוד ה-Worker וההוראות להקמה נשארים בריפו ולא מתפרסמים באתר.
set -e
rm -rf dist
mkdir dist
cp index.html sw.js manifest.webmanifest icon.svg _headers dist/
echo "dist: $(ls dist | tr '\n' ' ')"
