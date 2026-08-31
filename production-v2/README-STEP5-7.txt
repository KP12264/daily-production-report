Step 5.7 — Pallet Change Loss
- Pallet change can record Change/Loss Time in minutes.
- Generated loss category: Pallet Change.
- Composition replacement becomes effective after the loss and at the next cycle boundary.
- Plan table separates Scheduled Rounds, Loss, Adjusted Rounds, Original Plan and Adjusted Plan.
- Daily Plan snapshot stores palletChangeLosses, originalPlan, adjustedPlan and lossMinutes.
- Old productionLogs is untouched.
Example Line C: change 14:20, loss 10 min -> 14:20–14:30 Loss, new composition effective 14:30.
