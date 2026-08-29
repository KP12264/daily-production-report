# Production V2

Isolated V2 implementation. Existing root `index.html` is intentionally unchanged.

Safety invariant: V2 client write helpers reject any collection that does not start with `prodV2_`.

Step 1 implemented:
- V2 navigation/skeleton pages
- Firebase V2 safety layer
- Line Master using `prodV2_lines`

Next: Model & Door Master, versioned Pallet/Jig Layout, Shift & Time.
