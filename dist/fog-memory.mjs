const remembered = new WeakMap();

export function exploredCells(battle,map) {
  const saved = battle.fogMemory;
  const legacy = battle.explored;
  const cached = remembered.get(battle);
  if (cached && cached.saved === saved && cached.legacy === legacy && cached.cols === map.cols && cached.rows === map.rows) return cached;
  const {cols,rows} = map;
  const result = {cols,rows,bytes:new Uint8Array(Math.ceil(cols*rows/8)),saved,legacy,revision:0,dirty:false};
  if (saved) {
    try {
      const data = atob(saved.data);
      if (saved.cols === cols && saved.rows === rows && data.length === result.bytes.length) {
        for (let i=0;i<data.length;i++) result.bytes[i] = data.charCodeAt(i);
      } else if (Number.isInteger(saved.cols) && saved.cols > 0 && Number.isInteger(saved.rows) && saved.rows > 0 &&
          saved.cols*saved.rows <= 90000 && data.length === Math.ceil(saved.cols*saved.rows/8)) {
        for (let y=0;y<Math.min(rows,saved.rows);y++) for (let x=0;x<Math.min(cols,saved.cols);x++) {
          const previous = y*saved.cols+x;
          if (data.charCodeAt(previous>>3) & (1<<(previous&7))) setCell(result,x,y);
        }
      }
    } catch { /* A damaged save starts with the visible area. */ }
  }
  if (Array.isArray(legacy)) {
    for (const cell of legacy) {
      if (typeof cell !== "string") continue;
      const [x,y] = cell.split(":").map(Number);
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < cols && y >= 0 && y < rows) setCell(result,x,y);
    }
    result.dirty = true;
  }
  remembered.set(battle,result);
  return result;
}

function setCell(memory,x,y) {
  const index = y*memory.cols+x;
  const byte = index>>3;
  const mask = 1<<(index&7);
  if (memory.bytes[byte]&mask) return false;
  memory.bytes[byte] |= mask;
  return true;
}

export function hasExplored(memory,x,y) {
  if (x < 0 || y < 0 || x >= memory.cols || y >= memory.rows) return false;
  const index = y*memory.cols+x;
  return Boolean(memory.bytes[index>>3] & (1<<(index&7)));
}

export function rememberCells(memory,sight) {
  let changed = false;
  for (const cell of sight) {
    const [x,y] = cell.split(":").map(Number);
    if (setCell(memory,x,y)) changed = true;
  }
  if (changed) {
    memory.dirty = true;
    memory.revision++;
  }
}

export function saveExplored(battle,map) {
  const memory = exploredCells(battle,map);
  if (!memory.dirty) return;
  battle.fogMemory = {cols:memory.cols,rows:memory.rows,data:btoa(String.fromCharCode(...memory.bytes))};
  delete battle.explored;
  memory.saved = battle.fogMemory;
  memory.legacy = undefined;
  memory.dirty = false;
}

export function forgetExploration(battle){delete battle.fogMemory;delete battle.explored;remembered.delete(battle);}
