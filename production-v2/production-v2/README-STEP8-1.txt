STEP 8.1 — Data Mapping Fix
- Production Entry totals now read from the same actualByCell map that autosave writes.
- Row Actual / Total Actual are based on all entered cells, not a wrong top-level state field.
- Dashboard Actual reads the same actualByCell keys.
- Dashboard Plan parser supports the saved Daily Plan / Master Snapshot matrix shapes and Entry plan snapshot fallback.
- No changes to old productionLogs.
Test example: BM28 FL 8 + 5 must total 13 in Entry and Dashboard.
