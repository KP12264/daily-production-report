Step 3 FIX3
Adds cache-busting query strings to master.html:
- js/firebase-v2.js?v=20260831-fix3
- js/master.js?v=20260831-fix3

This forces GitHub Pages/browser to fetch the latest JavaScript instead of a cached older Step 3 file.
No data logic changed.
No productionLogs write added.
