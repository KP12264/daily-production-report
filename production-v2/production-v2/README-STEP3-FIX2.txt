Step 3 FIX2
Fixes: db is not defined.
v2ReadAll now obtains the Firestore collection through ProdV2DB.collection(), which is part of the existing V2 helper API.
Writes remain ProdV2DB.set to prodV2_jigLayouts only.
No productionLogs write added.
