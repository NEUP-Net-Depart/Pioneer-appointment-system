// Spreadsheet values remain the same non-negative safe integers as the API.
export function parseCapacityGrid(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('请粘贴最多 4 行、4 列的预约人数');
  const lines = text.replaceAll('\r\n','\n').replaceAll('\r','\n').replace(/\n+$/,'').split('\n');
  const grid = lines.map(line => line.split('\t').map(value => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) throw new Error('所有格子都须为非负整数，空格子请填写 0');
    return String(Number(trimmed));
  }));
  if (grid.length > 4 || grid[0].length > 4 || grid.some(row => row.length !== grid[0].length)) {
    throw new Error('请粘贴完整的矩形区域，最多 4 行、4 列');
  }
  return grid;
}

export function gridRange(anchor, end) {
  return { top:Math.min(anchor.row,end.row), bottom:Math.max(anchor.row,end.row), left:Math.min(anchor.col,end.col), right:Math.max(anchor.col,end.col) };
}

export function rangeContains(range, row, col) {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export function repeatGridValue(grid, source, row, col) {
  const wrap = (value,size) => ((value % size) + size) % size;
  return grid[wrap(row - source.top,grid.length)][wrap(col - source.left,grid[0].length)];
}

export function pasteRange(grid, selection) {
  const height = selection.bottom - selection.top + 1, width = selection.right - selection.left + 1;
  if (height === 1 && width === 1) {
    const range = { ...selection,bottom:selection.top + grid.length - 1,right:selection.left + grid[0].length - 1 };
    if (range.bottom >= 4 || range.right >= 4) throw new Error('粘贴区域超出表格，请从更靠左上方的格子粘贴');
    return range;
  }
  if (height % grid.length || width % grid[0].length) throw new Error('选区大小须与复制区域相同，或为其整倍数');
  return selection;
}
