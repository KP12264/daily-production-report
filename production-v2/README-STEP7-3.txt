STEP 7.3 — Restore Saved Daily Plan
Problem fixed:
Loss page correctly read the previously SAVED Daily Plan, but reopening Daily Plan rebuilt the Master/default state.
That made the page appear to have no pallet change even though the saved plan still contained Pallet Change Loss.

This patch:
- checks prodV2_dailyPlans/plan_{date}_{line}_{shift} after normal Master load;
- restores saved daily state where available;
- restores pallet order/config/change history/plan snapshot fields using backward-compatible field names;
- re-renders the Daily Plan so previously saved pallet changes remain editable;
- does not modify old productionLogs.

Important:
A plan must have been SAVED before leaving the page. Unsaved browser-only edits cannot be recovered.
