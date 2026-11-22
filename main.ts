// main.ts — the entry: solve every instance of the set, in one run.
//
// The work itself is solve.ts; this file only reads the set and writes the
// answers, so the solver can be exercised on other levels without the driver.
//
// Local run: MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel, solveLevel, replaySolved } from './solve.ts';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const ids = readdirSync(INPUT).sort();
for (const id of ids) {
  const text = readFileSync(join(INPUT, id, 'level.txt'), 'utf8');
  const board = parseLevel(text);
  const moves = solveLevel(text) ?? '';

  if (moves.length > 0 && replaySolved(board, moves) === false) {
    console.error(`sokoban: ${id}: the answer does not finish the level`);
  }

  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'solution.txt'), `${moves}\n`);
}
