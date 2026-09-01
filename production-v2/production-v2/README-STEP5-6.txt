Step 5.6 — Position-based Replacement
Replace no longer tries to add an already-active pallet ID.
Each of the 24 daily positions remains a distinct slot.
REPLACE changes only the compositionSource of that slot from the effective time onward.
Example: Position 6 FUF14 -> FUF18/22 at 14:20 gives FUF14 5 positions and FUF18/22 7 positions after 14:20.
Block snapshots store slot state. Physical Master remains unchanged. No writes to old productionLogs.
