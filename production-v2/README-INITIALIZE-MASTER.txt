Production V2 - Initialize Model & Door Master

Adds one-click Initialize A/B/C Master.
Writes ONLY to prodV2_models through the existing V2 safety layer.
Uses deterministic document IDs + merge, so pressing Initialize again does not create duplicate matching records.
Does not write/update/delete productionLogs.

After upload:
1. Open Master Setup
2. Ctrl+F5
3. Open Model & Door
4. Click Initialize A/B/C Master once
5. Confirm
6. Check A/B/C dropdown lists
