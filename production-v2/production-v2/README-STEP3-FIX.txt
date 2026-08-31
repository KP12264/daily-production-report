Step 3 fix
Fixes: ProdV2DB.getAll is not a function.
Step 3 now reads prodV2_ collections with the Firebase compat db instance already used by this page.
Writes remain through ProdV2DB.set and remain restricted to prodV2_ collections.
No productionLogs write was added.
