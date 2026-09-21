/* 席替えジェネレーター。画面の状態と抽選処理をこのファイルで一元管理する。 */

export {};

type BoardType = 'blackboard' | 'whiteboard';
type View = 'student' | 'teacher';
type PairType = 'separate' | 'together';
type PairRange = 'neighbor' | 'surrounding';
type Step = 1 | 2 | 3 | 4;
type Cell = string | null;
type Grid = Cell[][];

interface ParsedNames {
  names: string[];
  furigana: Record<string, string>;
}

interface Pair {
  a: string;
  b: string;
  type: PairType;
  range: PairRange;
}

interface CellPosition {
  r: number;
  c: number;
}

interface FixedSeat {
  r: number;
  c: number;
  name: string;
}

interface ConstraintResult {
  grid: Grid;
  satisfied: boolean;
}

interface SavedState {
  cols: number;
  rows: number;
  namesText: string;
  cellActive: boolean[][];
  boardType: BoardType;
}

interface AppState {
  step: Step;
  cols: number;
  rows: number;
  cellActive: boolean[][];
  namesText: string;
  boardType: BoardType;
  pairs: Pair[];
  assignment: Grid | null;
  shuffling: boolean;
  shuffleFrame: Grid | null;
  view: View;
  constraintsSatisfied: boolean;
}

interface ModalApi {
  alert(message: string): Promise<void>;
}

declare const Modal: ModalApi;

const SAMPLE_NAMES = `田中 颯太\tたなか そうた
佐藤 美咲\tさとう みさき
鈴木 健\tすずき けん
高橋 葵\tたかはし あおい
伊藤 大翔\tいとう ひろと
渡辺 結愛\tわたなべ ゆあ
山本 蓮\tやまもと れん
中村 陽菜\tなかむら ひな
小林 颯\tこばやし はやて
加藤 心春\tかとう こはる
吉田 樹\tよしだ いつき
山田 莉子\tやまだ りこ
佐々木 海斗\tささき かいと
山口 紬\tやまぐち つむぎ
松本 翔\tまつもと しょう
井上 凛\tいのうえ りん
木村 拓海\tきむら たくみ
林 杏\tはやし あん
清水 颯真\tしみず そうま
山崎 さくら\tやまざき さくら
森 蒼\tもり あおい
池田 彩\tいけだ あや
橋本 陸\tはしもと りく
阿部 結菜\tあべ ゆいな
石川 光\tいしかわ ひかる
山下 楓\tやました かえで
中島 蒼空\tなかじま そら
石井 美月\tいしい みづき`;

const STORAGE_KEY = 'seat-shuffle:state:v1';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`必要な画面要素が見つかりません: #${id}`);
  return element as T;
}

function child<T extends Element>(parent: Element, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`必要な画面要素が見つかりません: ${selector}`);
  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNames(raw: string): ParsedNames {
  const names: string[] = [];
  const furigana: Record<string, string> = {};
  raw.split('\n').forEach((line) => {
    const parts = line.split('\t');
    let name = (parts[0] ?? '').trim();
    let furi = (parts[1] ?? '').trim();
    if (!furi && name) {
      const tokens = name.split(/\s+/);
      const kanaRe = /^[ぁ-ゟ゠-ヿ]+$/;
      const splitIndex = tokens.findIndex((token) => kanaRe.test(token));
      if (splitIndex > 0) {
        furi = tokens.slice(splitIndex).join(' ');
        name = tokens.slice(0, splitIndex).join(' ');
      }
    }
    if (!name) return;
    names.push(name);
    if (furi) furigana[name] = furi;
  });
  return { names, furigana };
}

function shuffleArray<T>(values: T[]): T[] {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = result[i];
    const target = result[j];
    if (current !== undefined && target !== undefined) {
      result[i] = target;
      result[j] = current;
    }
  }
  return result;
}

function makeDefaultGrid(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => true));
}

function buildAssignment(
  rows: number,
  cols: number,
  cellActive: boolean[][],
  names: string[],
  fixedSeats: FixedSeat[],
): Grid {
  const grid: Grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  fixedSeats.forEach((fixed) => {
    if (fixed.r >= 0 && fixed.r < rows && fixed.c >= 0 && fixed.c < cols) {
      const row = grid[fixed.r];
      if (row) row[fixed.c] = fixed.name;
    }
  });
  const fixedNames = new Set(fixedSeats.map((fixed) => fixed.name));
  const fixedPositions = new Set(fixedSeats.map((fixed) => `${fixed.r},${fixed.c}`));
  const shuffled = shuffleArray(names.filter((name) => !fixedNames.has(name)));
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const active = cellActive[r]?.[c] ?? false;
      if (!active || fixedPositions.has(`${r},${c}`)) continue;
      const name = shuffled[index];
      if (name !== undefined) {
        const row = grid[r];
        if (row) row[c] = name;
        index += 1;
      }
    }
  }
  return grid;
}

function findInGrid(grid: Grid, name: string): CellPosition | null {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] === name) return { r, c };
    }
  }
  return null;
}

function isAdjacent(a: CellPosition, b: CellPosition, range: PairRange): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (range === 'neighbor') return dr === 0 && dc === 1;
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

function checkConstraints(grid: Grid, pairs: Pair[]): boolean {
  for (const pair of pairs) {
    const a = findInGrid(grid, pair.a);
    const b = findInGrid(grid, pair.b);
    if (!a || !b) continue;
    const adjacent = isAdjacent(a, b, pair.range);
    if (pair.type === 'separate' && adjacent) return false;
    if (pair.type === 'together' && !adjacent) return false;
  }
  return true;
}

function buildAssignmentWithConstraints(
  rows: number,
  cols: number,
  cellActive: boolean[][],
  names: string[],
  pairs: Pair[],
  maxAttempts: number,
): ConstraintResult {
  const validPairs = pairs.filter((pair) =>
    Boolean(pair.a && pair.b && pair.a !== pair.b && names.includes(pair.a) && names.includes(pair.b)),
  );
  let lastGrid: Grid | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const grid = buildAssignment(rows, cols, cellActive, names, []);
    lastGrid = grid;
    if (validPairs.length === 0 || checkConstraints(grid, validPairs)) {
      return { grid, satisfied: true };
    }
  }
  return {
    grid: lastGrid ?? buildAssignment(rows, cols, cellActive, names, []),
    satisfied: false,
  };
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function loadState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const cols = boundedInt(value.cols, 1, 12);
    const rows = boundedInt(value.rows, 1, 10);
    const namesText = value.namesText;
    const activeValue = value.cellActive;
    if (cols === null || rows === null || typeof namesText !== 'string' || !Array.isArray(activeValue)) return null;
    if (activeValue.length !== rows) return null;
    const cellActive: boolean[][] = [];
    for (const rowValue of activeValue) {
      if (!Array.isArray(rowValue) || rowValue.length !== cols || !rowValue.every((cell) => typeof cell === 'boolean')) {
        return null;
      }
      cellActive.push(rowValue.map((cell) => cell === true));
    }
    const boardType: BoardType = value.boardType === 'whiteboard' ? 'whiteboard' : 'blackboard';
    return { cols, rows, namesText, cellActive, boardType };
  } catch {
    return null;
  }
}

const loadedState = loadState();
const initialState: SavedState = loadedState ?? {
  cols: 6,
  rows: 5,
  namesText: SAMPLE_NAMES,
  cellActive: makeDefaultGrid(5, 6),
  boardType: 'blackboard',
};

const state: AppState = {
  step: 1,
  cols: initialState.cols,
  rows: initialState.rows,
  cellActive: initialState.cellActive,
  namesText: initialState.namesText,
  boardType: initialState.boardType,
  pairs: [],
  assignment: null,
  shuffling: false,
  shuffleFrame: null,
  view: 'student',
  constraintsSatisfied: true,
};

const app = byId<HTMLElement>('seatShuffleApp');
const progressFill = byId<HTMLElement>('ssProgressFill');
const progressNodes = app.querySelectorAll<HTMLButtonElement>('.ss-progress-node');
const colInput = byId<HTMLInputElement>('ssColCount');
const rowInput = byId<HTMLInputElement>('ssRowCount');
const applyButton = byId<HTMLButtonElement>('ssApplyLayoutBtn');
const seatGridEdit = byId<HTMLElement>('ssSeatGridEdit');
const activeCount = byId<HTMLElement>('ssActiveCount');
const activeCountSub = byId<HTMLElement>('ssActiveCountSub');
const namesText = byId<HTMLTextAreaElement>('ssNamesText');
const namesCount = byId<HTMLElement>('ssNamesCount');
const statusChip = byId<HTMLElement>('ssStatusChip');
const statusText = child<HTMLElement>(statusChip, '.ss-status-text');
const addPairButton = byId<HTMLButtonElement>('ssAddPairBtn');
const pairList = byId<HTMLElement>('ssPairList');
const pairEmpty = byId<HTMLElement>('ssPairEmpty');
const runButton = byId<HTMLButtonElement>('ssRunBtn');
const againButton = byId<HTMLButtonElement>('ssAgainBtn');
const printButton = byId<HTMLButtonElement>('ssPrintBtn');
const resultDescription = byId<HTMLElement>('ssResultDesc');
const warning = byId<HTMLElement>('ssWarning');
const seatGridResult = byId<HTMLElement>('ssSeatGridResult');
const resultBoardTop = byId<HTMLElement>('ssResultBoardTop');
const resultBoardBottom = byId<HTMLElement>('ssResultBoardBottom');
const layoutBoard = byId<HTMLElement>('ssLayoutBoard');
const boardToggleButtons = app.querySelectorAll<HTMLButtonElement>('.ss-board-toggle-btn');
const viewButtons = app.querySelectorAll<HTMLButtonElement>('.ss-view-btn');
const stepSections: Record<Step, HTMLElement> = {
  1: byId<HTMLElement>('ssStep1'),
  2: byId<HTMLElement>('ssStep2'),
  3: byId<HTMLElement>('ssStep3'),
  4: byId<HTMLElement>('ssStep4'),
};
const resultTitle = child<HTMLElement>(stepSections[4], '.ss-step-title');

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cols: state.cols,
      rows: state.rows,
      namesText: state.namesText,
      cellActive: state.cellActive,
      boardType: state.boardType,
    } satisfies SavedState));
  } catch {
    // 保存領域が利用できない環境では、画面操作を継続する。
  }
}

function renderProgress(): void {
  progressFill.style.width = `${((state.step - 1) / 3) * 100}%`;
  progressNodes.forEach((node) => {
    const step = boundedInt(node.dataset.step, 1, 4);
    const circle = child<HTMLElement>(node, '.ss-progress-circle');
    if (step === null) return;
    if (step === state.step) {
      node.setAttribute('aria-current', 'step');
      node.removeAttribute('data-state');
      circle.textContent = String(step);
    } else if (step < state.step) {
      node.removeAttribute('aria-current');
      node.setAttribute('data-state', 'done');
      circle.textContent = '✓';
    } else {
      node.removeAttribute('aria-current');
      node.removeAttribute('data-state');
      circle.textContent = String(step);
    }
  });
}

function showStep(step: Step): void {
  state.step = step;
  (Object.keys(stepSections) as Array<`${Step}`>).forEach((key) => {
    const currentStep = Number(key) as Step;
    const section = stepSections[currentStep];
    section.hidden = currentStep !== step;
    section.classList.toggle('ss-step-active', currentStep === step);
  });
  renderProgress();
  if (step === 3) renderPairs();
  if (step === 4) renderResult();
}

function applyBoardType(): void {
  const isWhiteboard = state.boardType === 'whiteboard';
  const label = isWhiteboard ? 'ホワイトボード' : '黒板';
  [layoutBoard, resultBoardTop, resultBoardBottom].forEach((board) => {
    board.textContent = label;
    board.classList.toggle('ss-blackboard-whiteboard', isWhiteboard);
  });
  boardToggleButtons.forEach((button) => {
    const selected = button.dataset.board === state.boardType;
    button.classList.toggle('ss-board-toggle-active', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
}

function updateActiveCount(): number {
  let count = 0;
  for (let r = 0; r < state.rows; r += 1) {
    for (let c = 0; c < state.cols; c += 1) {
      if (state.cellActive[r]?.[c]) count += 1;
    }
  }
  activeCount.textContent = String(count);
  activeCountSub.textContent = String(count);
  return count;
}

function renderEditGrid(): void {
  seatGridEdit.style.setProperty('--ss-cols', String(state.cols));
  seatGridEdit.replaceChildren();
  for (let r = 0; r < state.rows; r += 1) {
    for (let c = 0; c < state.cols; c += 1) {
      const isActive = state.cellActive[r]?.[c] === true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ss-cell-edit';
      button.dataset.r = String(r);
      button.dataset.c = String(c);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.setAttribute('aria-label', `${c + 1}列${r + 1}行の席（${isActive ? '使用中' : '空席'}）`);
      button.textContent = isActive ? '机' : '·';
      seatGridEdit.appendChild(button);
    }
  }
  updateActiveCount();
}

function updateNamesSummary(): ParsedNames {
  const parsed = parseNames(state.namesText);
  const difference = parsed.names.length - updateActiveCount();
  namesCount.textContent = String(parsed.names.length);
  if (difference === 0) {
    statusChip.removeAttribute('data-state');
    statusText.textContent = '過不足なし';
  } else {
    statusChip.setAttribute('data-state', 'warn');
    statusText.textContent = difference > 0 ? `生徒が ${difference} 名多い` : `空席が ${-difference} 席`;
  }
  return parsed;
}

function makeOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function createPairRow(pair: Pair, index: number, names: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ss-pair-row';
  const selectA = document.createElement('select');
  const selectB = document.createElement('select');
  const selectType = document.createElement('select');
  const selectRange = document.createElement('select');
  selectA.setAttribute('aria-label', '対象A');
  selectB.setAttribute('aria-label', '対象B');
  selectType.setAttribute('aria-label', '種別');
  selectRange.setAttribute('aria-label', '範囲');
  selectA.appendChild(makeOption('', '--'));
  selectB.appendChild(makeOption('', '--'));
  names.forEach((name) => {
    selectA.appendChild(makeOption(name, name));
    selectB.appendChild(makeOption(name, name));
  });
  selectType.append(makeOption('separate', '離す'), makeOption('together', 'くっつける'));
  selectRange.append(makeOption('neighbor', '左右となり'), makeOption('surrounding', 'まわり全部'));
  selectA.value = pair.a;
  selectB.value = pair.b;
  selectType.value = pair.type;
  selectRange.value = pair.range;
  const updatePair = (update: (current: Pair) => void): void => {
    const current = state.pairs[index];
    if (current) update(current);
  };
  selectA.addEventListener('change', () => { updatePair((current) => { current.a = selectA.value; }); });
  selectB.addEventListener('change', () => { updatePair((current) => { current.b = selectB.value; }); });
  selectType.addEventListener('change', () => {
    updatePair((current) => { current.type = selectType.value === 'together' ? 'together' : 'separate'; });
  });
  selectRange.addEventListener('change', () => {
    updatePair((current) => { current.range = selectRange.value === 'surrounding' ? 'surrounding' : 'neighbor'; });
  });
  const glue = (text: string): HTMLSpanElement => {
    const element = document.createElement('span');
    element.className = 'ss-pair-glue';
    element.textContent = text;
    return element;
  };
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'ss-pair-remove';
  removeButton.setAttribute('aria-label', 'この条件を削除');
  removeButton.textContent = '×';
  removeButton.addEventListener('click', () => {
    state.pairs.splice(index, 1);
    renderPairs();
  });
  row.append(selectA, glue('と'), selectB, glue('を'), selectType, selectRange, removeButton);
  return row;
}

function renderPairs(): void {
  const names = parseNames(state.namesText).names;
  pairList.replaceChildren();
  pairEmpty.hidden = state.pairs.length !== 0;
  state.pairs.forEach((pair, index) => pairList.appendChild(createPairRow(pair, index, names)));
}

function renderResult(): void {
  const parsed = parseNames(state.namesText);
  const grid = state.shuffleFrame ?? state.assignment;
  if (!grid) {
    seatGridResult.replaceChildren();
    seatGridResult.style.setProperty('--ss-cols', String(state.cols));
    return;
  }
  seatGridResult.style.setProperty('--ss-cols', String(state.cols));
  seatGridResult.style.setProperty('--ss-rows', String(state.rows));
  const rowOrder = Array.from({ length: state.rows }, (_, index) => index);
  const colOrder = Array.from({ length: state.cols }, (_, index) => index);
  if (state.view === 'teacher') {
    rowOrder.reverse();
    colOrder.reverse();
  }
  seatGridResult.replaceChildren();
  rowOrder.forEach((r) => colOrder.forEach((c) => {
    const active = state.cellActive[r]?.[c] === true;
    const name = grid[r]?.[c] ?? null;
    const cell = document.createElement('div');
    cell.className = `ss-cell-result${active ? '' : ' ss-cell-result-empty'}`;
    if (state.shuffling) {
      cell.classList.add('ss-cell-result-shuffling');
      const scale = 0.92 + Math.random() * 0.12;
      const rotation = (Math.random() - 0.5) * 6;
      cell.style.transform = `scale(${scale.toFixed(3)}) rotate(${rotation.toFixed(2)}deg)`;
      cell.style.opacity = (0.6 + Math.random() * 0.4).toFixed(2);
      const shadowY = 4 + Math.random() * 6;
      const shadowBlur = 10 + Math.random() * 10;
      const shadowAlpha = 0.1 + Math.random() * 0.15;
      cell.style.boxShadow = `0 ${shadowY.toFixed(1)}px ${shadowBlur.toFixed(1)}px rgba(38,133,133,${shadowAlpha.toFixed(2)})`;
    }
    if (active && name) {
      const furi = parsed.furigana[name];
      if (furi) {
        const furiElement = document.createElement('div');
        furiElement.className = 'ss-cell-furigana';
        furiElement.textContent = furi;
        cell.appendChild(furiElement);
      }
      const nameElement = document.createElement('div');
      nameElement.className = 'ss-cell-name';
      nameElement.textContent = name;
      cell.appendChild(nameElement);
    }
    seatGridResult.appendChild(cell);
  }));
  resultBoardTop.hidden = state.view !== 'student';
  resultBoardBottom.hidden = state.view === 'student';
  resultTitle.textContent = state.shuffling ? '抽選中…' : '席替の結果';
  resultDescription.textContent = state.shuffling ? '✨ 名簿をシャッフルしています' : '気に入らなければ何度でも再生成できます。';
  warning.hidden = state.constraintsSatisfied || state.shuffling;
  againButton.disabled = state.shuffling;
}

function normalizeLayoutInputs(): { cols: number; rows: number } {
  const cols = Math.min(12, Math.max(1, Math.floor(Number(colInput.value)) || 1));
  const rows = Math.min(10, Math.max(1, Math.floor(Number(rowInput.value)) || 1));
  colInput.value = String(cols);
  rowInput.value = String(rows);
  return { cols, rows };
}

function applyLayoutFromInputs(): void {
  const next = normalizeLayoutInputs();
  if (next.cols === state.cols && next.rows === state.rows) return;
  const nextGrid = makeDefaultGrid(next.rows, next.cols);
  for (let r = 0; r < next.rows; r += 1) {
    for (let c = 0; c < next.cols; c += 1) {
      const current = state.cellActive[r]?.[c];
      if (typeof current === 'boolean') nextGrid[r]![c] = current;
    }
  }
  state.cols = next.cols;
  state.rows = next.rows;
  state.cellActive = nextGrid;
  renderEditGrid();
  updateNamesSummary();
  saveState();
}

function setView(view: View): void {
  state.view = view;
  viewButtons.forEach((button) => {
    const selected = button.dataset.view === view;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.classList.toggle('ss-view-active', selected);
  });
  renderResult();
}

async function runShuffle(): Promise<void> {
  const names = parseNames(state.namesText).names;
  if (names.length === 0) {
    await Modal.alert('名簿が空です。STEP 2 で生徒名を入力してください。');
    showStep(2);
    return;
  }
  state.shuffling = true;
  state.constraintsSatisfied = true;
  state.assignment = null;
  showStep(4);
  for (let frameIndex = 0; frameIndex < 14; frameIndex += 1) {
    state.shuffleFrame = buildAssignment(state.rows, state.cols, state.cellActive, names, []);
    renderResult();
    const delay = 50 + frameIndex * 18;
    await new Promise<void>((resolve) => { window.setTimeout(resolve, delay); });
  }
  const result = buildAssignmentWithConstraints(state.rows, state.cols, state.cellActive, names, state.pairs, 100);
  state.assignment = result.grid;
  state.constraintsSatisfied = result.satisfied;
  state.shuffleFrame = null;
  state.shuffling = false;
  renderResult();
}

progressNodes.forEach((node) => node.addEventListener('click', () => {
  const step = boundedInt(node.dataset.step, 1, 4);
  if (step === null) return;
  if (state.step === 1 && step !== 1) applyLayoutFromInputs();
  showStep(step as Step);
}));

app.querySelectorAll<HTMLElement>('[data-go-step]').forEach((button) => button.addEventListener('click', () => {
  const step = boundedInt(button.dataset.goStep, 1, 4);
  if (step === null) return;
  if (state.step === 1 && step !== 1) applyLayoutFromInputs();
  showStep(step as Step);
}));

applyButton.addEventListener('click', () => {
  const next = normalizeLayoutInputs();
  state.cols = next.cols;
  state.rows = next.rows;
  state.cellActive = makeDefaultGrid(next.rows, next.cols);
  renderEditGrid();
  updateNamesSummary();
  saveState();
});

[colInput, rowInput].forEach((input) => {
  input.addEventListener('change', applyLayoutFromInputs);
  input.addEventListener('blur', () => { normalizeLayoutInputs(); applyLayoutFromInputs(); });
});

seatGridEdit.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('.ss-cell-edit');
  if (!button) return;
  const r = boundedInt(button.dataset.r, 0, state.rows - 1);
  const c = boundedInt(button.dataset.c, 0, state.cols - 1);
  if (r === null || c === null || !state.cellActive[r]) return;
  state.cellActive[r][c] = !state.cellActive[r][c];
  const active = state.cellActive[r][c];
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.textContent = active ? '机' : '·';
  button.setAttribute('aria-label', `${c + 1}列${r + 1}行の席（${active ? '使用中' : '空席'}）`);
  updateActiveCount();
  saveState();
});

namesText.addEventListener('input', () => {
  state.namesText = namesText.value;
  updateNamesSummary();
  saveState();
});

boardToggleButtons.forEach((button) => button.addEventListener('click', () => {
  const next: BoardType = button.dataset.board === 'whiteboard' ? 'whiteboard' : 'blackboard';
  if (state.boardType === next) return;
  state.boardType = next;
  applyBoardType();
  saveState();
}));

addPairButton.addEventListener('click', () => {
  state.pairs.push({ a: '', b: '', type: 'separate', range: 'neighbor' });
  renderPairs();
});
runButton.addEventListener('click', () => { if (!state.shuffling) void runShuffle(); });
againButton.addEventListener('click', () => { if (!state.shuffling) void runShuffle(); });
printButton.addEventListener('click', () => { window.print(); });

viewButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    setView(button.dataset.view === 'teacher' ? 'teacher' : 'student');
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + viewButtons.length) % viewButtons.length;
    const nextButton = viewButtons.item(nextIndex);
    if (!nextButton) return;
    nextButton.focus();
    setView(nextButton.dataset.view === 'teacher' ? 'teacher' : 'student');
  });
});

colInput.value = String(state.cols);
rowInput.value = String(state.rows);
namesText.value = state.namesText;
applyBoardType();
renderEditGrid();
updateNamesSummary();
renderProgress();
showStep(1);
