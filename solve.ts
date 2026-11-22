// solve.ts — the push-optimal Sokoban solver, as a library main.ts drives.
//
// Every level this competition draws is a one-square hallway with up to four
// rooms off it, and a box pushed into the hallway can never be pushed back, so
// the rooms are independent: a level's optimal push count is the sum of its
// rooms'. The program therefore cuts the player's row out of the board, groups
// what is left into rooms, and searches each room exactly for its fewest
// pushes. A room is at most six squares by six holding at most four boxes, so a
// breadth-first search over (boxes, reachable region) states closes it: every
// edge is one push, so the first time all boxes stand on goals the path found
// is push-optimal. Between rooms the player just walks, which costs no pushes.
//
// Nothing here reads the clock, the environment or any file: the same level
// always gives the same answer, so two executions write the same bytes.

// The four steps, in a fixed order so two executions build the same answer.
const STEPS = [
  { ch: 'u', dr: -1, dc: 0 },
  { ch: 'd', dr: 1, dc: 0 },
  { ch: 'l', dr: 0, dc: -1 },
  { ch: 'r', dr: 0, dc: 1 },
];

// A room search is closed or abandoned at this many states; the cap is on work,
// never on the clock, so both executions of a level abandon at the same point.
const STATE_CAP = 400000;

// Read a level in XSB: # wall, space floor, . goal, $ box, * box on goal,
// @ player, + player on goal. Short rows are padded as wall.
export function parseLevel(text) {
  const rows = text.split('\n').filter((line) => line.length > 0);
  const h = rows.length;
  let w = 0;
  for (const row of rows) if (row.length > w) w = row.length;

  const wall = new Uint8Array(w * h);
  const goal = new Uint8Array(w * h);
  const boxMask = new Uint8Array(w * h);
  const boxes = [];
  let player = -1;

  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const ch = c < row.length ? row[c] : '#';
      const i = r * w + c;
      if (ch === '#') {
        wall[i] = 1;
        continue;
      }
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') {
        boxes.push(i);
        boxMask[i] = 1;
      }
      if (ch === '@' || ch === '+') player = i;
    }
  }

  return { w, h, wall, goal, boxMask, boxes, player };
}

// Every square the player can reach without pushing a box, marked, plus the
// smallest square reached: two positions with the same mark set and the same
// smallest square are the same state as far as pushes are concerned.
function reach(board, blocked, from) {
  const n = board.w * board.h;
  const mark = new Uint8Array(n);
  const stack = [from];
  mark[from] = 1;
  let least = from;

  while (stack.length > 0) {
    const i = stack.pop();
    if (i < least) least = i;
    const r = (i / board.w) | 0;
    const c = i - r * board.w;

    if (r > 0) {
      const j = i - board.w;
      if (mark[j] === 0 && board.wall[j] === 0 && blocked[j] === 0) {
        mark[j] = 1;
        stack.push(j);
      }
    }
    if (r + 1 < board.h) {
      const j = i + board.w;
      if (mark[j] === 0 && board.wall[j] === 0 && blocked[j] === 0) {
        mark[j] = 1;
        stack.push(j);
      }
    }
    if (c > 0) {
      const j = i - 1;
      if (mark[j] === 0 && board.wall[j] === 0 && blocked[j] === 0) {
        mark[j] = 1;
        stack.push(j);
      }
    }
    if (c + 1 < board.w) {
      const j = i + 1;
      if (mark[j] === 0 && board.wall[j] === 0 && blocked[j] === 0) {
        mark[j] = 1;
        stack.push(j);
      }
    }
  }

  return { mark, least };
}

// A configuration is dead when some box can never move again and is not on a
// goal. Two sound tests cover almost all of it: a box wedged in a corner off a
// goal, and a two-by-two square filled with boxes and walls, inside which no
// player can ever stand to push.
function isDead(board, boxes, boxMask) {
  for (const b of boxes) {
    if (board.goal[b] === 1) continue;
    const r = (b / board.w) | 0;
    const c = b - r * board.w;
    const up = r > 0 && board.wall[b - board.w] === 1;
    const down = r + 1 < board.h && board.wall[b + board.w] === 1;
    const left = c > 0 && board.wall[b - 1] === 1;
    const right = c + 1 < board.w && board.wall[b + 1] === 1;
    if ((up || down) && (left || right)) return true;
  }

  for (const b of boxes) {
    if (board.goal[b] === 1) continue;
    const r = (b / board.w) | 0;
    const c = b - r * board.w;
    if (r + 1 >= board.h || c + 1 >= board.w) continue;
    const square = [b, b + 1, b + board.w, b + board.w + 1];
    let filled = 0;
    let walled = 0;
    let held = false;
    for (const i of square) {
      if (board.wall[i] === 1) {
        filled += 1;
        walled += 1;
      } else if (boxMask[i] === 1) {
        filled += 1;
        if (i === b) held = true;
      }
    }
    if (filled === 4 && walled > 0 && held) return true;
  }

  return false;
}

// The squares a box alone could still be pushed from onto some goal, found by
// pulling a box backwards from every goal over open floor. A box standing on a
// square outside this set can never reach a goal, so such a state is dead and
// the search discards it before expanding anything. This is the strongest of
// the cheap prunings: it is what keeps a room's state count inside its cap.
function liveSquares(board) {
  const n = board.w * board.h;
  const live = new Uint8Array(n);
  const queue = [];

  for (let i = 0; i < n; i++) {
    if (board.goal[i] === 1) {
      live[i] = 1;
      queue.push(i);
    }
  }

  while (queue.length > 0) {
    const at = queue.shift();
    const ar = (at / board.w) | 0;
    const ac = at - ar * board.w;

    for (const step of STEPS) {
      // Pulling a box from `from` to `at` means the player stood beyond `at`,
      // with floor behind the box's old square for it to come from.
      const fr = ar - step.dr;
      const fc = ac - step.dc;
      if (fr < 0 || fr >= board.h || fc < 0 || fc >= board.w) continue;
      const from = fr * board.w + fc;
      if (board.wall[from] === 1 || live[from] === 1) continue;

      const br = fr - step.dr;
      const bc = fc - step.dc;
      if (br < 0 || br >= board.h || bc < 0 || bc >= board.w) continue;
      if (board.wall[br * board.w + bc] === 1) continue;

      live[from] = 1;
      queue.push(from);
    }
  }

  return live;
}

// Fewest pushes that put this room's boxes on goals, as the pushes themselves,
// or null when the room cannot be closed within the state cap. `movable` holds
// the room's own boxes: boxes of other rooms are obstacles here, never pushed.
function solveRoom(board, movable, allBoxes, player) {
  const n = board.w * board.h;
  const blocked = new Uint8Array(n);
  const boxMask = new Uint8Array(n);
  for (const b of allBoxes) {
    blocked[b] = 1;
    boxMask[b] = 1;
  }

  const live = liveSquares(board);
  const solved = (state) => state.every((b) => board.goal[b] === 1);
  const order = movable.slice().sort((a, b) => a - b);
  if (solved(order)) return [];

  // A state is its sorted box squares and the lowest square the player can
  // reach, so the same position is never expanded twice under another name.
  const keyOf = (boxes, low) => {
    let k = low;
    for (const b of boxes) k = k * n + b;
    return k;
  };

  const first = reach(board, blocked, player);
  const nodes = [{ boxes: order, player, parent: -1, from: -1, to: -1, ch: '' }];
  const seen = new Set([keyOf(order, first.least)]);
  let head = 0;

  while (head < nodes.length) {
    const node = nodes[head];
    const here = node.boxes;

    blocked.fill(0);
    boxMask.fill(0);
    for (const b of here) {
      blocked[b] = 1;
      boxMask[b] = 1;
    }
    const region = reach(board, blocked, node.player);

    for (const from of here) {
      const r = (from / board.w) | 0;
      const c = from - r * board.w;

      for (const step of STEPS) {
        const nr = r + step.dr;
        const nc = c + step.dc;
        if (nr < 0 || nr >= board.h || nc < 0 || nc >= board.w) continue;
        const to = nr * board.w + nc;
        if (board.wall[to] === 1 || boxMask[to] === 1) continue;
        if (live[to] === 0) continue;

        const stand = from - step.dr * board.w - step.dc;
        if (region.mark[stand] === 0) continue;

        const next = here.filter((b) => b !== from);
        next.push(to);
        next.sort((a, b) => a - b);

        const movedMask = new Uint8Array(n);
        for (const b of next) movedMask[b] = 1;
        if (isDead(board, next, movedMask)) continue;

        const after = reach(board, movedMask, from);
        const key = keyOf(next, after.least);
        if (seen.has(key)) continue;
        if (nodes.length >= STATE_CAP) return null;

        seen.add(key);
        nodes.push({ boxes: next, player: from, parent: head, from, to, ch: step.ch });

        if (solved(next)) {
          const chain = [];
          let at = nodes.length - 1;
          while (nodes[at].parent !== -1) {
            chain.push({ from: nodes[at].from, to: nodes[at].to, ch: nodes[at].ch });
            at = nodes[at].parent;
          }
          chain.reverse();
          return chain;
        }
      }
    }

    head += 1;
    if (head >= STATE_CAP) return null;
  }

  return null;
}

// The steps that carry the player from one square to another around the boxes,
// or null when no such walk exists.
function walk(board, from, to, blocked) {
  if (from === to) return '';
  const n = board.w * board.h;
  const prev = new Int32Array(n).fill(-1);
  const via = new Array(n).fill('');
  const queue = [from];
  prev[from] = from;

  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const r = (i / board.w) | 0;
    const c = i - r * board.w;

    for (const step of STEPS) {
      const nr = r + step.dr;
      const nc = c + step.dc;
      if (nr < 0 || nr >= board.h || nc < 0 || nc >= board.w) continue;
      const j = nr * board.w + nc;
      if (prev[j] !== -1 || board.wall[j] === 1 || blocked[j] === 1) continue;
      prev[j] = i;
      via[j] = step.ch;
      if (j === to) {
        let path = '';
        let at = j;
        while (at !== from) {
          path = via[at] + path;
          at = prev[at];
        }
        return path;
      }
      queue.push(j);
    }
  }

  return null;
}

// The rooms of a level: cutting one whole line of the board out leaves the
// rooms as separate pieces. The line is the player's row, which is the hallway
// the generator lays; if that does not account for every box, the player's
// column is tried instead.
function findRooms(board) {
  const n = board.w * board.h;
  const playerRow = (board.player / board.w) | 0;
  const playerCol = board.player - playerRow * board.w;

  const byRow = cut(board, (r) => r === playerRow);
  if (byRow.boxes === board.boxes.length) return byRow.rooms;

  const byCol = cut(board, (r, c) => c === playerCol);
  if (byCol.boxes === board.boxes.length) return byCol.rooms;

  return byRow.rooms;
}

function cut(board, drop) {
  const n = board.w * board.h;
  const free = new Uint8Array(n);
  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      const i = r * board.w + c;
      if (drop(r, c)) continue;
      if (board.wall[i] === 0) free[i] = 1;
    }
  }

  const seen = new Uint8Array(n);
  const rooms = [];
  let boxes = 0;

  for (let i = 0; i < n; i++) {
    if (free[i] === 0 || seen[i] === 1) continue;
    const cells = [];
    const stack = [i];
    seen[i] = 1;

    while (stack.length > 0) {
      const j = stack.pop();
      cells.push(j);
      const r = (j / board.w) | 0;
      const c = j - r * board.w;
      if (r > 0) {
        const k = j - board.w;
        if (free[k] === 1 && seen[k] === 0) {
          seen[k] = 1;
          stack.push(k);
        }
      }
      if (r + 1 < board.h) {
        const k = j + board.w;
        if (free[k] === 1 && seen[k] === 0) {
          seen[k] = 1;
          stack.push(k);
        }
      }
      if (c > 0) {
        const k = j - 1;
        if (free[k] === 1 && seen[k] === 0) {
          seen[k] = 1;
          stack.push(k);
        }
      }
      if (c + 1 < board.w) {
        const k = j + 1;
        if (free[k] === 1 && seen[k] === 0) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }

    const mine = cells.filter((x) => board.boxMask[x] === 1);
    boxes += mine.length;
    rooms.push({ cells, boxes: mine });
  }

  rooms.sort((a, b) => Math.min(...a.cells) - Math.min(...b.cells));
  return { rooms, boxes };
}

// The level's answer: for every room in turn, walk to each push and push, in
// the order the room's search found. Null when a room or a walk is unclosed.
export function solveLevel(text) {
  const board = parseLevel(text);
  const rooms = findRooms(board);

  let allBoxes = board.boxes.slice().sort((a, b) => a - b);
  let player = board.player;
  let moves = '';
  const n = board.w * board.h;
  const blocked = new Uint8Array(n);

  for (const room of rooms) {
    if (room.boxes.length === 0) continue;

    const chain = solveRoom(board, room.boxes, allBoxes, player);
    if (chain === null) return null;

    for (const push of chain) {
      const step = push.to - push.from;
      const stand = push.from - step;

      blocked.fill(0);
      for (const b of allBoxes) blocked[b] = 1;
      const path = walk(board, player, stand, blocked);
      if (path === null) return null;

      moves += path + push.ch;

      allBoxes = allBoxes.filter((b) => b !== push.from);
      allBoxes.push(push.to);
      allBoxes.sort((a, b) => a - b);
      player = push.from;
    }
  }

  return moves;
}

// Replay an answer on its level and say whether every box ends on a goal, so a
// run that produced nothing usable says so instead of handing in a broken file.
export function replaySolved(board, moves) {
  const boxMask = new Uint8Array(board.w * board.h);
  for (const b of board.boxes) boxMask[b] = 1;
  let player = board.player;

  for (const ch of moves.toLowerCase()) {
    let dr = 0;
    let dc = 0;
    if (ch === 'u') dr = -1;
    else if (ch === 'd') dr = 1;
    else if (ch === 'l') dc = -1;
    else if (ch === 'r') dc = 1;
    else return false;

    const r = (player / board.w) | 0;
    const c = player - r * board.w;
    const to = (r + dr) * board.w + (c + dc);
    if (board.wall[to] === 1) return false;

    if (boxMask[to] === 1) {
      const beyond = to + dr * board.w + dc;
      if (board.wall[beyond] === 1 || boxMask[beyond] === 1) return false;
      boxMask[to] = 0;
      boxMask[beyond] = 1;
    }
    player = to;
  }

  // Every box left on the board must stand on a goal, and every goal must hold
  // one: a level has as many boxes as goals, so the two counts agreeing means
  // the room is closed.
  let onGoal = 0;
  let counted = 0;
  for (let i = 0; i < boxMask.length; i++) {
    if (boxMask[i] !== 1) continue;
    counted += 1;
    if (board.goal[i] === 1) onGoal += 1;
  }
  if (counted !== board.boxes.length) return false;
  return onGoal === counted;
}

