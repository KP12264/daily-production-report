STEP 8.3 — Stable Entry Save + Complete Dashboard
Root causes fixed:
- Row Actual is calculated from the authoritative S.actual map, not DOM-visible inputs.
- One central autosave timer replaces per-cell timers.
- Every save writes the entire actualByCell map.
- Blur and Enter flush the latest values.
- Navigating from Production Entry waits for pending Firestore save before opening Dashboard/Daily Plan/Loss.
- Dashboard KPI Plan falls back to saved adjustedPlan when detailed block mapping is unavailable.

Expected:
BM28 FL 5 + 5 => row Actual 10 immediately.
KPI Actual => 10 immediately.
After clicking Dashboard, the same Actual values are already saved and should all appear.
