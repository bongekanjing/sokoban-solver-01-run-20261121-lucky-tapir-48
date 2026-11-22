# Sokoban, solved room by room at the push optimum

[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/bongekanjing/sokoban-solver-01-run-20261121-lucky-tapir-48/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/bongekanjing/sokoban-solver-01-run-20261121-lucky-tapir-48/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

An entry for the [Sokoban solver bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121) on
[make.fun](https://make.fun/c/sokoban-solver-01-run-20261121). It scores 1,000,000 on the practice
set — the push optimum on all five instances.

## The idea

Every level in this competition is drawn by a generator with a fixed shape: a one-square hallway
across the board, and up to four rooms off it, each a slot of six by six squares that opens onto the
hallway through one door. A box pushed through a door into the hallway can never be pushed back —
the push-back needs the player on the hallway's far side, which is wall — so **a box never leaves
its room**. The rooms are therefore independent problems joined only by the player's walk, and the
level's push-optimal count is the sum of its rooms' optima. The kit says as much in its generator's
own comments; this entry is built on it.

That changes the shape of the search completely. One breadth-first search over a whole level would
meet the *product* of the rooms' position counts, which is why a general solver runs out of states
on the harder instances. Searching each room separately meets only the *sum*.

    level  boxes  rooms  optimum
    i001       3      1       13
    i002       4      1       16
    i003       8      2       29
    i004      12      3       47
    i005      16      4       60

Sixteen boxes, four rooms of four, and the search never sees more than four boxes at once.

## How it works

1. **Cut the board.** Removing the player's whole row — the hallway — leaves the rooms as separate
   connected pieces. If that does not account for every box, the player's column is tried instead.
   This is a property of the generator, not a guess, and the program checks the box count before
   trusting the cut.
2. **Search each room exactly.** Breadth-first over states of *(sorted box squares, the lowest square
   the player can reach)*. A state's reachable region is what decides which pushes are available, and
   naming it by its lowest square collapses positions that differ only in where the player stands.
   Every edge is exactly one push, so the first state with all boxes on goals is push-optimal — no
   heuristic, no bound, no approximation.
3. **Prune what cannot come back.** A box on a square from which no push could ever reach a goal is
   dead; those squares are found once per room by pulling a box backwards from every goal over open
   floor. A box wedged in a corner off a goal is dead, and a two-by-two block of walls and boxes with
   a box off its goal is frozen. None of these prunes a solvable state, so the optimum stands.
4. **Walk between pushes.** Inside a room the player walks to each pushing square by breadth-first
   search over the floor with the boxes as obstacles, then pushes. Walking costs no pushes, so it
   never affects the count.

## Determinism and budget

The program never reads the clock, the environment, or anything outside its input and output. Work is
bounded by a fixed state cap, not by a time budget, so a level that gives up gives up identically in
both executions — every entry is run twice and the two outputs must match byte for byte.

The practice set takes about 1.5 s of the 60 s wall. Across 200 instances drawn from 40 fresh seeds
with the kit's own generator, the answer was push-optimal on every one, and the slowest single
instance took 2.3 s.

## Checking it

The kit grades locally, with the same scorer the server uses:

    node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process

    scores {"answered":5,"i001":1000000,...,"passed":1,"score":1000000}
    L1 regrade  reproduced byte for byte

## Files

| File | Job |
| --- | --- |
| `main.ts` | the entry: read each instance, write each answer |
| `solve.ts` | the solver: parse, cut into rooms, search each exactly, walk between pushes |

## License

MIT — see `LICENSE`.
