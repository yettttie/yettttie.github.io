const BOARD_WIDTH = 22;
const BOARD_HEIGHT = 20;
const STORAGE_KEY = "yettttie-union-solver-v2";

const PIECES = [
  { id: "lv200_warrior", label: "Lv.200 전사", color: "#f25f5c", shape: [[2, 2], [2, 2]] },
  { id: "lv200_bowman", label: "Lv.200 궁수", color: "#6fd08c", shape: [[1, 2, 2, 1]] },
  { id: "lv200_thief", label: "Lv.200 도적", color: "#9a7cff", shape: [[1, 0, 0], [1, 2, 1]] },
  { id: "lv200_magician", label: "Lv.200 마법사", color: "#5ad1c3", shape: [[0, 1, 0], [1, 2, 1]] },
  { id: "lv200_pirate", label: "Lv.200 해적", color: "#ff8fab", shape: [[1, 2, 0], [0, 2, 1]] },
  { id: "lv250_warrior", label: "Lv.250 전사", color: "#ff924c", shape: [[1, 1, 2], [0, 1, 1]] },
  { id: "lv250_bowman", label: "Lv.250 궁수", color: "#8bd450", shape: [[1, 1, 2, 1, 1]] },
  { id: "lv250_thief", label: "Lv.250 도적", color: "#b38cff", shape: [[0, 0, 1], [1, 2, 1], [0, 0, 1]] },
  { id: "lv250_magician", label: "Lv.250 마법사", color: "#37c6c0", shape: [[0, 1, 0], [1, 2, 1], [0, 1, 0]] },
  { id: "lv250_pirate", label: "Lv.250 해적", color: "#ff6fa6", shape: [[1, 2, 0, 0], [0, 1, 1, 1]] },
  { id: "lv250_xenon", label: "Lv.250 제논", color: "#5fa8ff", shape: [[1, 1, 0], [0, 2, 0], [0, 1, 1]] },
].map((piece) => ({
  ...piece,
  cells: getCellsFromShape(piece.shape),
}));

const boardState = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(false);
const boardCells = [];
const pieceInputs = new Map();
const solutionMap = new Map();
const regionGroups = buildRegionGroups();
const regionMap = buildRegionMap();
const borderMap = buildBorderMap();

let worker = null;
let isPainting = false;
let paintValue = false;
let solving = false;
let regionClickEnabled = false;
let liveSolveEnabled = false;
let solverMode = "exact_cover";
let hoveredRegion = -1;

const boardGrid = document.getElementById("board-grid");
const pieceList = document.getElementById("piece-list");
const regionClickInput = document.getElementById("region-click-input");
const liveSolveInput = document.getElementById("live-solve-input");
const solverModeSelect = document.getElementById("solver-mode-select");
const targetCountElement = document.getElementById("target-count");
const pieceCountElement = document.getElementById("piece-count");
const characterCountElement = document.getElementById("character-count");
const solverStatusElement = document.getElementById("solver-status");
const elapsedTimeElement = document.getElementById("elapsed-time");
const iterationCountElement = document.getElementById("iteration-count");
const boardCaptionElement = document.getElementById("board-caption");
const timeoutInput = document.getElementById("timeout-input");
const solveButton = document.getElementById("solve-button");
const stopButton = document.getElementById("stop-button");
const clearButton = document.getElementById("clear-button");
const clearPieceButton = document.getElementById("clear-piece-button");

function init() {
  renderPieceInputs();
  renderBoard();
  bindEvents();
  restoreState();
  updateStats();
}

function bindEvents() {
  window.addEventListener("pointerup", () => {
    isPainting = false;
  });

  solveButton.addEventListener("click", startSolve);
  stopButton.addEventListener("click", stopSolve);
  clearButton.addEventListener("click", clearBoard);
  clearPieceButton.addEventListener("click", clearPieces);

  regionClickInput.addEventListener("change", () => {
    regionClickEnabled = regionClickInput.checked;
    clearHoveredRegion();
    paintBoard();
    persistState();
  });

  liveSolveInput.addEventListener("change", () => {
    liveSolveEnabled = liveSolveInput.checked;
    persistState();
  });

  solverModeSelect.addEventListener("change", () => {
    solverMode = solverModeSelect.value;
    persistState();
  });
}

function renderPieceInputs() {
  PIECES.forEach((piece) => {
    const row = document.createElement("div");
    row.className = "piece-row";

    const preview = document.createElement("div");
    preview.className = "piece-preview";
    preview.style.gridTemplateColumns = `repeat(${piece.shape[0].length}, 12px)`;
    preview.style.gridTemplateRows = `repeat(${piece.shape.length}, 12px)`;
    preview.style.setProperty("--piece-color", piece.color);

    for (let y = 0; y < piece.shape.length; y += 1) {
      for (let x = 0; x < piece.shape[y].length; x += 1) {
        const dot = document.createElement("div");
        dot.className = "piece-preview-cell";
        if (piece.shape[y][x] > 0) {
          dot.classList.add("active");
        }
        preview.appendChild(dot);
      }
    }

    const meta = document.createElement("div");
    meta.className = "piece-meta";
    const title = document.createElement("p");
    title.className = "piece-title";
    title.textContent = piece.label;
    meta.append(title);

    const input = document.createElement("input");
    input.className = "piece-input";
    input.type = "number";
    input.min = "0";
    input.max = "99";
    input.step = "1";
    input.value = "0";
    input.addEventListener("input", () => {
      clearSolution();
      updateStats();
      persistState();
    });

    pieceInputs.set(piece.id, input);
    row.append(preview, meta, input);
    pieceList.appendChild(row);
  });
}

function renderBoard() {
  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    for (let col = 0; col < BOARD_WIDTH; col += 1) {
      const index = row * BOARD_WIDTH + col;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "board-cell";

      const borders = borderMap[index];
      const topWidth = getRenderedTopBorder(row, col, borders);
      const leftWidth = getRenderedLeftBorder(row, col, borders);
      const rightWidth = col === BOARD_WIDTH - 1 ? borders.right : 0;
      const bottomWidth = row === BOARD_HEIGHT - 1 ? borders.bottom : 0;

      cell.style.borderTopWidth = `${topWidth}px`;
      cell.style.borderLeftWidth = `${leftWidth}px`;
      cell.style.borderRightWidth = `${rightWidth}px`;
      cell.style.borderBottomWidth = `${bottomWidth}px`;
      cell.style.borderTopColor = topWidth > 1 ? "var(--region-line)" : "#c7d2df";
      cell.style.borderLeftColor = leftWidth > 1 ? "var(--region-line)" : "#c7d2df";
      cell.style.borderRightColor = rightWidth > 1 ? "var(--region-line)" : "#c7d2df";
      cell.style.borderBottomColor = bottomWidth > 1 ? "var(--region-line)" : "#c7d2df";
      cell.dataset.region = String(regionMap[index]);

      cell.addEventListener("pointerdown", () => {
        if (solving) {
          return;
        }

        isPainting = true;
        paintValue = !boardState[index];

        if (regionClickEnabled) {
          setRegion(regionMap[index], paintValue);
          isPainting = false;
          return;
        }

        setBoardCell(index, paintValue);
      });

      cell.addEventListener("pointerenter", () => {
        if (!solving && regionClickEnabled) {
          setHoveredRegion(regionMap[index]);
        }

        if (!isPainting || solving || regionClickEnabled) {
          return;
        }

        setBoardCell(index, paintValue);
      });

      cell.addEventListener("pointerleave", () => {
        if (regionClickEnabled) {
          clearHoveredRegion();
        }
      });

      boardCells.push(cell);
      boardGrid.appendChild(cell);
    }
  }

  paintBoard();
}

function setBoardCell(index, value) {
  boardState[index] = value;
  clearSolution();
  paintBoard();
  updateStats();
  persistState();
}

function setRegion(regionIndex, value) {
  if (regionIndex < 0) {
    return;
  }

  regionGroups[regionIndex].forEach((index) => {
    boardState[index] = value;
  });

  clearSolution();
  paintBoard();
  updateStats();
  persistState();
}

function setHoveredRegion(regionIndex) {
  hoveredRegion = regionIndex;
  paintBoard();
}

function clearHoveredRegion() {
  if (hoveredRegion === -1) {
    return;
  }
  hoveredRegion = -1;
  paintBoard();
}

function paintBoard() {
  boardCells.forEach((cell, index) => {
    const hoverActive = regionClickEnabled && hoveredRegion === regionMap[index] && !boardState[index];
    cell.classList.toggle("target", boardState[index]);
    cell.classList.toggle("region-hover", hoverActive);
    cell.classList.remove("solution");
    cell.style.backgroundColor = boardState[index] ? "" : hoverActive ? "#d7dee8" : "#f2f5f8";

    if (solutionMap.has(index)) {
      cell.classList.add("solution");
      cell.style.backgroundColor = solutionMap.get(index);
    }
  });
}

function clearBoard() {
  boardState.fill(false);
  clearSolution();
  paintBoard();
  updateStats();
  persistState();
}

function clearPieces() {
  pieceInputs.forEach((input) => {
    input.value = "0";
  });

  clearSolution();
  updateStats();
  persistState();
}

function getPieceCounts() {
  const counts = {};
  PIECES.forEach((piece) => {
    counts[piece.id] = Math.max(0, Math.floor(Number(pieceInputs.get(piece.id).value || 0)));
  });
  return counts;
}

function updateStats() {
  const targetCount = boardState.filter(Boolean).length;
  const pieceCounts = getPieceCounts();
  const totalPieceCells = PIECES.reduce((sum, piece) => sum + piece.cells.length * pieceCounts[piece.id], 0);
  const totalCharacters = Object.values(pieceCounts).reduce((sum, count) => sum + count, 0);

  targetCountElement.textContent = String(targetCount);
  pieceCountElement.textContent = String(totalPieceCells);
  characterCountElement.textContent = String(totalCharacters);
}

function setBoardCaption(text) {
  if (boardCaptionElement) {
    boardCaptionElement.textContent = text;
  }
}

function startSolve() {
  const target = boardState.map((value, index) => (value ? index : -1)).filter((value) => value !== -1);
  const pieceCounts = getPieceCounts();
  const totalPieceCells = PIECES.reduce((sum, piece) => sum + piece.cells.length * pieceCounts[piece.id], 0);
  const isHeuristicMode = ["heuristic_fast", "heuristic_pruned", "heuristic_late_prune"].includes(solverMode);

  if (!target.length) {
    setStatus("목표 칸 없음");
    setBoardCaption("보드에서 채울 칸을 먼저 선택해야 합니다.");
    return;
  }

  if (isHeuristicMode && target.length !== totalPieceCells) {
    setStatus("칸 수 불일치");
    setBoardCaption(`목표 칸 ${target.length}칸과 조각 칸 ${totalPieceCells}칸이 같아야 합니다.`);
    return;
  }

  if (!isHeuristicMode && target.length > totalPieceCells) {
    setStatus("조각 부족");
    setBoardCaption(`목표 칸 ${target.length}칸을 덮으려면 조각 칸이 최소 ${target.length}칸 이상 필요합니다.`);
    return;
  }

  clearSolution();
  createWorker();
  solving = true;
  solveButton.disabled = true;
  stopButton.disabled = false;
  setStatus("탐색 중");
  elapsedTimeElement.textContent = "0.00s";
  iterationCountElement.textContent = "0";
  setBoardCaption(liveSolveEnabled
    ? "실시간 보기로 배치를 그리면서 탐색 중입니다."
    : solverMode === "exact_cover"
      ? "정확 탐색으로 배치를 계산하고 있습니다."
      : solverMode === "branch_and_bound"
        ? "최적화 탐색으로 더 좋은 배치를 계산하고 있습니다."
        : "워커에서 자동 배치를 탐색하고 있습니다.");

  worker.postMessage({
    type: "start",
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    target,
    pieceCounts,
    timeoutMs: Math.max(1, Number(timeoutInput.value || 120)) * 1000,
    liveSolve: liveSolveEnabled,
    solverMode,
  });
}

function stopSolve() {
  if (worker) {
    worker.postMessage({ type: "stop" });
  }
}

function createWorker() {
  if (worker) {
    worker.terminate();
  }

  worker = new Worker("./solver-worker.js");
  worker.addEventListener("message", handleWorkerMessage);
}

function handleWorkerMessage(event) {
  const data = event.data;

  if (data.type === "progress") {
    setStatus(data.statusMessage || "탐색 중");
    elapsedTimeElement.textContent = formatMs(data.elapsedMs);
    iterationCountElement.textContent = formatNumber(data.iterations);

    if (liveSolveEnabled && Array.isArray(data.placements)) {
      applySolution(data.placements);
    }
    return;
  }

  solving = false;
  solveButton.disabled = false;
  stopButton.disabled = true;

  if (data.status === "ok") {
    applySolution(data.placements);
    setStatus("완료");
    setBoardCaption("배치를 찾았습니다.");
  } else if (data.status === "timeout") {
    clearSolution();
    setStatus("타임아웃");
    setBoardCaption("지정한 시간 안에 배치를 찾지 못했습니다.");
  } else if (data.status === "cancelled") {
    clearSolution();
    setStatus("중지됨");
    setBoardCaption("탐색을 직접 중지했습니다.");
  } else {
    clearSolution();
    setStatus(data.message || "해 없음");
    setBoardCaption(data.message || "현재 설정으로는 배치를 찾지 못했습니다.");
  }

  elapsedTimeElement.textContent = formatMs(data.elapsedMs || 0);
  iterationCountElement.textContent = formatNumber(data.iterations || 0);
}

function applySolution(placements) {
  solutionMap.clear();

  placements.forEach((placement) => {
    const piece = PIECES.find((item) => item.id === placement.pieceId);
    if (!piece) {
      return;
    }

    placement.cells.forEach((index) => {
      solutionMap.set(index, piece.color);
    });
  });

  paintBoard();
}

function clearSolution() {
  solutionMap.clear();
  paintBoard();
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      boardState,
      pieceCounts: getPieceCounts(),
      timeout: timeoutInput.value,
      regionClickEnabled,
      liveSolveEnabled,
      solverMode,
    }),
  );
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      regionClickInput.checked = false;
      liveSolveInput.checked = true;
      liveSolveEnabled = true;
      solverMode = "exact_cover";
      solverModeSelect.value = solverMode;
      return;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.boardState) && parsed.boardState.length === boardState.length) {
      parsed.boardState.forEach((value, index) => {
        boardState[index] = Boolean(value);
      });
    }

    if (parsed.pieceCounts) {
      Object.entries(parsed.pieceCounts).forEach(([pieceId, count]) => {
        if (pieceInputs.has(pieceId)) {
          pieceInputs.get(pieceId).value = String(count);
        }
      });
    }

    if (parsed.timeout) {
      timeoutInput.value = parsed.timeout;
    }

    regionClickEnabled = Boolean(parsed.regionClickEnabled);
    liveSolveEnabled = parsed.liveSolveEnabled !== false;
    solverMode = normalizeSolverMode(parsed.solverMode);
    regionClickInput.checked = regionClickEnabled;
    liveSolveInput.checked = liveSolveEnabled;
    solverModeSelect.value = solverMode;

    paintBoard();
  } catch (_error) {
    regionClickInput.checked = false;
    liveSolveInput.checked = true;
    liveSolveEnabled = true;
    solverMode = "exact_cover";
    solverModeSelect.value = solverMode;
  }
}

function normalizeSolverMode(value) {
  const legacyModeMap = {
    xenogent: "heuristic_fast",
    improved: "heuristic_pruned",
    improved2: "heuristic_late_prune",
    exact: "exact_cover",
    optimize: "branch_and_bound",
  };
  const normalized = legacyModeMap[value] || value;

  return [
    "exact_cover",
    "branch_and_bound",
    "heuristic_fast",
    "heuristic_pruned",
    "heuristic_late_prune",
  ].includes(normalized)
    ? normalized
    : "exact_cover";
}

function setStatus(text) {
  solverStatusElement.textContent = text;
}

function formatMs(value) {
  return `${(value / 1000).toFixed(2)}s`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function getCellsFromShape(shape) {
  const cells = [];

  for (let y = 0; y < shape.length; y += 1) {
    for (let x = 0; x < shape[y].length; x += 1) {
      if (shape[y][x] > 0) {
        cells.push([x, y]);
      }
    }
  }

  return cells;
}

function buildRegionGroups() {
  const groups = Array.from({ length: 16 }, () => []);
  const rows = BOARD_HEIGHT;
  const cols = BOARD_WIDTH;

  for (let i = 0; i < rows / 4; i += 1) {
    for (let j = i; j < rows / 2; j += 1) {
      groups[0].push(toIndex(j, i));
      groups[1].push(toIndex(i, j + 1));
      groups[2].push(toIndex(i, cols - 2 - j));
      groups[3].push(toIndex(j, cols - 1 - i));
      groups[4].push(toIndex(rows - 1 - j, cols - 1 - i));
      groups[5].push(toIndex(rows - 1 - i, cols - 2 - j));
      groups[6].push(toIndex(rows - 1 - i, j + 1));
      groups[7].push(toIndex(rows - 1 - j, i));
    }
  }

  for (let i = rows / 4; i < rows / 2; i += 1) {
    for (let j = i; j < rows / 2; j += 1) {
      groups[8].push(toIndex(j, i));
      groups[9].push(toIndex(i, j + 1));
      groups[10].push(toIndex(3 * rows / 4 - 1 - j, rows / 4 + 1 + i));
      groups[11].push(toIndex(j, cols - 1 - i));
      groups[12].push(toIndex(rows - 1 - j, cols - 1 - i));
      groups[13].push(toIndex(j + rows / 4, i + rows / 4 + 1));
      groups[14].push(toIndex(j + rows / 4, 3 * rows / 4 - i));
      groups[15].push(toIndex(rows - j - 1, i));
    }
  }

  return groups;
}

function buildRegionMap() {
  const map = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(-1);
  regionGroups.forEach((group, groupIndex) => {
    group.forEach((index) => {
      map[index] = groupIndex;
    });
  });
  return map;
}

function buildBorderMap() {
  const borders = Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, () => ({
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
  }));

  for (let i = 0; i < BOARD_WIDTH / 2; i += 1) {
    setBorder(borders, i, i, "top", 3);
    setBorder(borders, i, i, "right", 3);
    setBorder(borders, BOARD_HEIGHT - i - 1, i, "bottom", 3);
    setBorder(borders, BOARD_HEIGHT - i - 1, i, "right", 3);
    setBorder(borders, i, BOARD_WIDTH - i - 1, "top", 3);
    setBorder(borders, i, BOARD_WIDTH - i - 1, "left", 3);
    setBorder(borders, BOARD_HEIGHT - i - 1, BOARD_WIDTH - i - 1, "bottom", 3);
    setBorder(borders, BOARD_HEIGHT - i - 1, BOARD_WIDTH - i - 1, "left", 3);
  }

  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    setBorder(borders, row, 0, "left", 3);
    setBorder(borders, row, BOARD_WIDTH / 2, "left", 3);
    setBorder(borders, row, BOARD_WIDTH - 1, "right", 3);
  }

  for (let col = 0; col < BOARD_WIDTH; col += 1) {
    setBorder(borders, 0, col, "top", 3);
    setBorder(borders, BOARD_HEIGHT / 2, col, "top", 3);
    setBorder(borders, BOARD_HEIGHT - 1, col, "bottom", 3);
  }

  for (let row = BOARD_HEIGHT / 4; row < 3 * BOARD_HEIGHT / 4; row += 1) {
    setBorder(borders, row, Math.floor(BOARD_WIDTH / 4), "left", 3);
    setBorder(borders, row, Math.floor((3 * BOARD_WIDTH) / 4), "right", 3);
  }

  for (let col = Math.ceil(BOARD_WIDTH / 4); col < Math.floor((3 * BOARD_WIDTH) / 4); col += 1) {
    setBorder(borders, BOARD_HEIGHT / 4, col, "top", 3);
    setBorder(borders, (3 * BOARD_HEIGHT) / 4, col, "top", 3);
  }

  return borders;
}

function setBorder(borders, row, col, side, width) {
  borders[toIndex(row, col)][side] = width;
}

function getRenderedTopBorder(row, col, borders) {
  if (row === 0) {
    return borders.top;
  }

  const above = borderMap[toIndex(row - 1, col)];
  return Math.max(borders.top, above.bottom);
}

function getRenderedLeftBorder(row, col, borders) {
  if (col === 0) {
    return borders.left;
  }

  const leftCell = borderMap[toIndex(row, col - 1)];
  return Math.max(borders.left, leftCell.right);
}

function toIndex(row, col) {
  return row * BOARD_WIDTH + col;
}

init();
