STEP 7.4
Fixes the root cause:
- Daily Plan load now checks the exact saved document plan_{date}_{line}_{shift}.
- If it exists, it restores masterSnapshot.activePalletIds, palletOrder, palletChanges and palletChangeLosses BEFORE rendering.
- Pallet Change history is visible again and can be deleted with its existing Delete action, then Save Plan.
- Added Delete Saved Plan button to remove the whole saved daily plan. This also makes its auto Pallet Change Loss disappear from Loss page.
- If no saved plan exists, only then does the page initialize from Master.
- No writes to old productionLogs.
