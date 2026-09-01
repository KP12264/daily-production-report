STEP 8.4 — Actual total + Firestore race fix
- Fixes the row Actual cell: it now sums every visible time-block input in that same row.
- Fixes the real root cause of incomplete Dashboard Actual: Firestore writes are now serialized, never racing each other.
- Each save writes the complete actualByCell map plus actualTotal.
- Added Save Actual button for explicit/manual save when desired.
- Dashboard reads the same plan.blocks[].cells[].plan and actualByCell structures as Production Entry.
- Dashboard can validate/fallback to saved actualTotal for the unfiltered view.
Expected test: BM28 FL 5+5+5 => row Actual 15, top Actual 15, Dashboard Actual 15.
