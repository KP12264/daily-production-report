Production V2 — Step 3B A/B Draft
Adds Initialize A/B Draft.
Only confirmed pallet composition relationships are seeded.
A/B jig/pallet counts and rounds/hour are NOT treated as confirmed.
Records use verificationStatus=PENDING.
Writes only prodV2_jigLayouts through ProdV2DB.set.
Does not write productionLogs.
