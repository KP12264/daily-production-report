STEP 8.5 — Right-side Actual fix
- Each Model/Door row now has its own stable row ID.
- Right-side Actual/Diff/Ach are updated by row index and the authoritative S.actual map.
- No closest-row / ambiguous class selector is used.
- All row summaries are refreshed after render/load.
- Dashboard All Models/All Doors uses saved actualTotal exactly.
Test: BM28 FL 5+5+5 => right-side Actual 15 immediately; top KPI 15; after Save Actual and Dashboard => Actual 15.
