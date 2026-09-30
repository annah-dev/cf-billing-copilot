PR #5 looks good; hold it until the agent PR merges. While you wait: the engine is now on main,
and your fixtures use hand-made values (Nimbus Studio, Workers requests, Database reads) while the
real seed has Velvet Comet Workshop and different meters. Build the fixture state from the
engine's seed() and engine functions instead of literal values, so the preview and the evidence
match the live demo and every number has one source. Regenerate the evidence screenshots, run the
gate, and tell me when it is ready again. Do not change src/engine or src/contracts.
