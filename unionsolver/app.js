const BOARD_WIDTH = 22;
const BOARD_HEIGHT = 20;
const STORAGE_KEY = "yettttie-union-solver-v2";
const NEXON_API_KEY_STORAGE_KEY = "yettttie-nexon-api-key";
const NEXON_API_BASE = "https://open.api.nexon.com/maplestory/v1";

const PIECES = [
  { id: "lv200_warrior", label: "Lv.200 전사", color: "#f25f5c", shape: [[2, 2], [2, 2]] },
  { id: "lv200_bowman", label: "Lv.200 궁수 / Lv.120 메이플 M", color: "#6fd08c", shape: [[1, 2, 2, 1]] },
  { id: "lv200_thief", label: "Lv.200 도적 / 제논", color: "#9a7cff", shape: [[1, 0, 0], [1, 2, 1]] },
  { id: "lv200_magician", label: "Lv.200 마법사", color: "#5ad1c3", shape: [[0, 1, 0], [1, 2, 1]] },
  { id: "lv200_pirate", label: "Lv.200 해적", color: "#ff8fab", shape: [[1, 2, 0], [0, 2, 1]] },
  { id: "lv250_warrior", label: "Lv.250 전사", color: "#ff924c", shape: [[1, 1, 2], [0, 1, 1]] },
  { id: "lv250_bowman", label: "Lv.250 궁수 / Lv.250 메이플 M", color: "#8bd450", shape: [[1, 1, 2, 1, 1]] },
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
const CLASS_TYPE_MAP = buildClassTypeMap();

let worker = null;
let isPainting = false;
let paintValue = false;
let solving = false;
let regionClickEnabled = false;
let liveSolveEnabled = false;
let solverMode = "exact_cover";
let hoveredRegion = -1;
let nexonCandidates = [];
let nexonSelectedIds = new Set();
let nexonSelectionLimit = 0;
let nexonHighestCharacter = null;
let nexonUnionClassTypes = new Map();
let nexonMapleMCount = 0;
let nexonExcludedBelowLevelCount = 0;

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
const nexonApiButton = document.getElementById("nexon-api-button");
const nexonDialog = document.getElementById("nexon-dialog");
const nexonDialogCloseButton = document.getElementById("nexon-dialog-close");
const nexonDialogSummaryElement = document.getElementById("nexon-dialog-summary");
const nexonApiKeyInput = document.getElementById("nexon-api-key-input");
const nexonLoadButton = document.getElementById("nexon-load-button");
const nexonTopCountInput = document.getElementById("nexon-top-count-input");
const nexonTopSelectButton = document.getElementById("nexon-top-select-button");
const nexonClearSelectionButton = document.getElementById("nexon-clear-selection-button");
const nexonSelectionCountElement = document.getElementById("nexon-selection-count");
const nexonStatusElement = document.getElementById("nexon-status");
const nexonCharacterListElement = document.getElementById("nexon-character-list");
const nexonCancelButton = document.getElementById("nexon-cancel-button");
const nexonConfirmButton = document.getElementById("nexon-confirm-button");

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
  nexonApiButton.addEventListener("click", openNexonDialog);
  nexonDialogCloseButton.addEventListener("click", closeNexonDialog);
  nexonCancelButton.addEventListener("click", closeNexonDialog);
  nexonLoadButton.addEventListener("click", loadNexonCharacters);
  nexonTopSelectButton.addEventListener("click", selectTopNexonCandidates);
  nexonClearSelectionButton.addEventListener("click", clearNexonSelection);
  nexonConfirmButton.addEventListener("click", applyNexonSelection);
  nexonDialog.addEventListener("cancel", closeNexonDialog);

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
      cell.style.borderTopColor = topWidth > 1 ? "var(--region-line)" : "var(--board-cell-line)";
      cell.style.borderLeftColor = leftWidth > 1 ? "var(--region-line)" : "var(--board-cell-line)";
      cell.style.borderRightColor = rightWidth > 1 ? "var(--region-line)" : "var(--board-cell-line)";
      cell.style.borderBottomColor = bottomWidth > 1 ? "var(--region-line)" : "var(--board-cell-line)";
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
      cell.style.backgroundColor = solutionMap.get(index).color;
    }

    paintCellBorders(cell, index);
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

function openNexonDialog() {
  nexonApiKeyInput.value = localStorage.getItem(NEXON_API_KEY_STORAGE_KEY) || "";
  setNexonStatus(nexonApiKeyInput.value ? "불러오기를 눌러 캐릭터 목록을 갱신하세요." : "API 키를 입력하세요.");
  setNexonSummary("API 키를 입력하고 캐릭터 목록을 불러오세요.");
  updateNexonSelectionCount();

  if (typeof nexonDialog.showModal === "function") {
    nexonDialog.showModal();
  } else {
    nexonDialog.setAttribute("open", "");
  }

  nexonApiKeyInput.focus();
}

function closeNexonDialog(event) {
  if (event) {
    event.preventDefault();
  }
  if (nexonDialog.open) {
    nexonDialog.close();
  } else {
    nexonDialog.removeAttribute("open");
  }
}

async function loadNexonCharacters() {
  const apiKey = nexonApiKeyInput.value.trim();
  if (!apiKey) {
    setNexonStatus("API 키를 입력해야 합니다.", true);
    nexonApiKeyInput.focus();
    return;
  }

  setNexonLoading(true);
  setNexonStatus("전체 캐릭터 목록을 불러오는 중입니다.");
  nexonCharacterListElement.replaceChildren();

  try {
    localStorage.setItem(NEXON_API_KEY_STORAGE_KEY, apiKey);

    const listData = await fetchNexonJson("/character/list", apiKey);
    const characters = normalizeNexonCharacterList(listData);
    if (!characters.length) {
      throw new Error("캐릭터 목록이 비어 있습니다.");
    }

    nexonHighestCharacter = characters.reduce((highest, character) => (
      character.level > highest.level ? character : highest
    ), characters[0]);

    setNexonStatus(`${nexonHighestCharacter.name} 기준 유니온 공격대 정보를 불러오는 중입니다.`);
    const unionData = await fetchNexonJson(
      `/user/union-raider?ocid=${encodeURIComponent(nexonHighestCharacter.ocid)}`,
      apiKey,
    );
    const unionBlocks = getNexonUnionBlocks(unionData);
    const eligibleCharacters = characters.filter((character) => character.level >= 200);

    nexonMapleMCount = getNexonMapleMCount(unionBlocks);
    nexonExcludedBelowLevelCount = characters.length - eligibleCharacters.length;
    nexonSelectionLimit = unionBlocks.length || eligibleCharacters.length;
    nexonUnionClassTypes = buildUnionClassTypes(unionBlocks);
    nexonCandidates = buildNexonCandidates(eligibleCharacters, unionBlocks, nexonHighestCharacter);

    const defaultCount = Math.min(nexonSelectionLimit, nexonCandidates.length);
    nexonTopCountInput.max = String(nexonSelectionLimit);
    nexonTopCountInput.value = String(defaultCount);
    setNexonSelectedIds(getTopNexonCandidateIds(defaultCount));

    renderNexonCharacters();
    setNexonSummary(
      `${nexonHighestCharacter.world} ${nexonHighestCharacter.name} Lv.${nexonHighestCharacter.level} 기준, ` +
      `공격대 ${formatNexonRaidLimit()}까지 선택할 수 있습니다.`,
    );
    setNexonStatus(getNexonLoadedStatus());
  } catch (error) {
    setNexonStatus(error.message || "NEXON OPEN API 호출에 실패했습니다.", true);
  } finally {
    setNexonLoading(false);
  }
}

async function fetchNexonJson(path, apiKey) {
  const response = await fetch(`${NEXON_API_BASE}${path}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-nxopen-api-key": apiKey,
    },
  });

  if (!response.ok) {
    let message = `NEXON OPEN API 오류 (${response.status})`;
    try {
      const errorBody = await response.json();
      message = errorBody.message || errorBody.error_description || message;
    } catch (_error) {
      // Keep the generic HTTP message.
    }
    throw new Error(message);
  }

  return response.json();
}

function normalizeNexonCharacterList(data) {
  const accounts = Array.isArray(data?.account_list) ? data.account_list : [];
  const characters = [];

  accounts.forEach((account) => {
    const characterList = Array.isArray(account.character_list) ? account.character_list : [];
    characterList.forEach((character) => {
      characters.push({
        id: character.ocid,
        ocid: character.ocid,
        name: character.character_name || "",
        world: character.world_name || "",
        className: character.character_class || "",
        level: Number(character.character_level || 0),
        accountId: account.account_id || "",
        isMapleM: false,
      });
    });
  });

  return characters.filter((character) => character.ocid && character.name);
}

function getNexonUnionBlocks(data) {
  if (Array.isArray(data?.union_block)) {
    return data.union_block;
  }

  const preset = Object.keys(data || {})
    .filter((key) => key.startsWith("union_raider_preset_"))
    .map((key) => data[key])
    .find((value) => Array.isArray(value?.union_block) && value.union_block.length);

  return preset?.union_block || [];
}

function getNexonMapleMCount(unionBlocks) {
  return unionBlocks.filter((block) => block.block_type === "메이플 M 캐릭터").length;
}

function buildUnionClassTypes(unionBlocks) {
  const classTypes = new Map();
  unionBlocks.forEach((block) => {
    if (block.block_class && block.block_type) {
      classTypes.set(block.block_class, block.block_type);
    }
  });
  return classTypes;
}

function buildNexonCandidates(characters, unionBlocks, highestCharacter) {
  const mapleMCharacters = unionBlocks
    .filter((block) => block.block_type === "메이플 M 캐릭터")
    .map((block, index) => ({
      id: `maple-m-${index}`,
      ocid: `maple-m-${index}`,
      name: "메이플 M 캐릭터",
      world: highestCharacter.world,
      className: block.block_class || "모바일 캐릭터",
      level: Number(block.block_level || 0),
      blockType: "궁수",
      blockLevel: Number(block.block_level || 0),
      isMapleM: true,
    }));

  const sortedCharacters = [...characters].sort((left, right) => {
    const leftSameWorld = left.world === highestCharacter.world ? 1 : 0;
    const rightSameWorld = right.world === highestCharacter.world ? 1 : 0;
    if (leftSameWorld !== rightSameWorld) {
      return rightSameWorld - leftSameWorld;
    }
    if (left.level !== right.level) {
      return right.level - left.level;
    }
    return left.name.localeCompare(right.name, "ko-KR");
  });

  return [...mapleMCharacters, ...sortedCharacters];
}

function selectTopNexonCandidates() {
  const count = clampNexonSelectionCount(Number(nexonTopCountInput.value || 0));
  nexonTopCountInput.value = String(count);
  setNexonSelectedIds(getTopNexonCandidateIds(count));
  renderNexonCharacters();
  setNexonStatus(`상위 ${count}명을 선택했습니다.`);
}

function clearNexonSelection() {
  nexonSelectedIds.clear();
  renderNexonCharacters();
  setNexonStatus("선택을 전부 해제했습니다.");
}

function clampNexonSelectionCount(value) {
  const max = Math.min(nexonSelectionLimit, nexonCandidates.length);
  return Math.max(0, Math.min(max, Math.floor(Number.isFinite(value) ? value : 0)));
}

function getTopNexonCandidateIds(count) {
  return new Set(nexonCandidates.slice(0, clampNexonSelectionCount(count)).map((candidate) => candidate.id));
}

function setNexonSelectedIds(ids) {
  nexonSelectedIds = ids;
  updateNexonSelectionCount();
}

function renderNexonCharacters() {
  nexonCharacterListElement.replaceChildren();

  if (!nexonCandidates.length) {
    const empty = document.createElement("p");
    empty.className = "nexon-empty";
    empty.textContent = "불러온 캐릭터가 없습니다.";
    nexonCharacterListElement.append(empty);
    updateNexonSelectionCount();
    return;
  }

  nexonCandidates.forEach((candidate) => {
    const row = document.createElement("label");
    row.className = "nexon-character-row";
    row.classList.toggle("selected", nexonSelectedIds.has(candidate.id));

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = nexonSelectedIds.has(candidate.id);
    input.addEventListener("change", () => {
      updateNexonCandidateSelection(candidate, input.checked);
      renderNexonCharacters();
    });

    const main = document.createElement("span");
    main.className = "nexon-character-main";

    const name = document.createElement("strong");
    name.textContent = candidate.name;

    const detail = document.createElement("span");
    detail.textContent = `${candidate.world} · Lv.${candidate.level || "-"} · ${candidate.className}`;

    main.append(name, detail);

    const badge = document.createElement("span");
    badge.className = "nexon-character-badge";
    badge.textContent = getPieceLabelForCandidate(candidate);

    row.append(input, main, renderNexonPiecePreview(candidate), badge);
    nexonCharacterListElement.append(row);
  });

  updateNexonSelectionCount();
}

function updateNexonCandidateSelection(candidate, selected) {
  if (selected) {
    if (nexonSelectedIds.size >= nexonSelectionLimit) {
      setNexonStatus(`최대 ${formatNexonRaidLimit()}까지 선택할 수 있습니다.`, true);
      return;
    }
    nexonSelectedIds.add(candidate.id);
  } else {
    nexonSelectedIds.delete(candidate.id);
  }

  setNexonStatus("선택을 변경했습니다.");
  updateNexonSelectionCount();
}

function applyNexonSelection() {
  const selectedCandidates = nexonCandidates.filter((candidate) => nexonSelectedIds.has(candidate.id));
  if (!selectedCandidates.length) {
    setNexonStatus("반영할 캐릭터를 선택하세요.", true);
    return;
  }

  const counts = {};
  PIECES.forEach((piece) => {
    counts[piece.id] = 0;
  });

  const skipped = [];
  selectedCandidates.forEach((candidate) => {
    const pieceId = getPieceIdForCandidate(candidate);
    if (!pieceId || !pieceInputs.has(pieceId)) {
      skipped.push(candidate.name);
      return;
    }
    counts[pieceId] += 1;
  });

  Object.entries(counts).forEach(([pieceId, count]) => {
    pieceInputs.get(pieceId).value = String(count);
  });

  clearSolution();
  updateStats();
  persistState();
  setBoardCaption(`NEXON OPEN API 선택 ${selectedCandidates.length - skipped.length}명을 유니온 대원 수에 반영했습니다.`);

  if (skipped.length) {
    setNexonStatus(`지원되지 않는 직업 ${skipped.length}명은 제외했습니다.`, true);
    return;
  }

  closeNexonDialog();
}

function getPieceIdForCandidate(candidate) {
  if (candidate.isMapleM) {
    return Number(candidate.blockLevel || candidate.level || 0) >= 250 ? "lv250_bowman" : "lv200_bowman";
  }

  const blockType = candidate.blockType || nexonUnionClassTypes.get(candidate.className) || CLASS_TYPE_MAP.get(candidate.className);
  if (blockType === "하이브리드" || candidate.className === "제논") {
    return Number(candidate.blockLevel || candidate.level || 0) >= 250 ? "lv250_xenon" : "lv200_thief";
  }

  const pieceType = {
    전사: "warrior",
    궁수: "bowman",
    도적: "thief",
    마법사: "magician",
    해적: "pirate",
  }[blockType];

  if (!pieceType) {
    return "";
  }

  const tier = Number(candidate.blockLevel || candidate.level || 0) >= 250 ? "lv250" : "lv200";
  return `${tier}_${pieceType}`;
}

function getPieceLabelForCandidate(candidate) {
  if (candidate.isMapleM) {
    return Number(candidate.blockLevel || candidate.level || 0) >= 250 ? "Lv.250 메이플 M" : "Lv.120 메이플 M";
  }

  if (candidate.className === "제논" && Number(candidate.blockLevel || candidate.level || 0) < 250) {
    return "Lv.200 제논";
  }

  const piece = PIECES.find((item) => item.id === getPieceIdForCandidate(candidate));
  return piece ? piece.label.split(" / ")[0] : "미지원";
}

function renderNexonPiecePreview(candidate) {
  const piece = PIECES.find((item) => item.id === getPieceIdForCandidate(candidate));
  const preview = document.createElement("span");
  preview.className = "nexon-piece-preview";

  if (!piece) {
    preview.classList.add("empty");
    preview.setAttribute("aria-label", "지원되지 않는 블럭");
    return preview;
  }

  preview.style.gridTemplateColumns = `repeat(${piece.shape[0].length}, 8px)`;
  preview.style.gridTemplateRows = `repeat(${piece.shape.length}, 8px)`;
  preview.style.setProperty("--piece-color", piece.color);
  preview.setAttribute("aria-label", `${piece.label} 블럭 모양`);

  for (let y = 0; y < piece.shape.length; y += 1) {
    for (let x = 0; x < piece.shape[y].length; x += 1) {
      const dot = document.createElement("span");
      dot.className = "nexon-piece-preview-cell";
      if (piece.shape[y][x] > 0) {
        dot.classList.add("active");
      }
      preview.append(dot);
    }
  }

  return preview;
}

function setNexonLoading(loading) {
  nexonLoadButton.disabled = loading;
  nexonConfirmButton.disabled = loading;
  nexonTopSelectButton.disabled = loading || !nexonCandidates.length;
  nexonClearSelectionButton.disabled = loading || !nexonCandidates.length;
}

function setNexonSummary(text) {
  nexonDialogSummaryElement.textContent = text;
}

function setNexonStatus(text, isError = false) {
  nexonStatusElement.textContent = text;
  nexonStatusElement.classList.toggle("error", isError);
}

function updateNexonSelectionCount() {
  nexonSelectionCountElement.textContent = `${nexonSelectedIds.size} / ${formatNexonRaidLimit()}`;
  nexonTopSelectButton.textContent = `상위 ${formatNexonRaidLimit()} 선택`;
  nexonTopSelectButton.disabled = !nexonCandidates.length;
  nexonClearSelectionButton.disabled = !nexonCandidates.length;
}

function formatNexonRaidLimit() {
  if (nexonMapleMCount > 0 && nexonSelectionLimit > nexonMapleMCount) {
    return `${nexonSelectionLimit - nexonMapleMCount} + ${nexonMapleMCount}명`;
  }

  return `${nexonSelectionLimit}명`;
}

function getNexonLoadedStatus() {
  if (nexonExcludedBelowLevelCount > 0) {
    return (
      `캐릭터 목록을 불러왔습니다. ` +
      `200레벨 미만 캐릭터 ${nexonExcludedBelowLevelCount}명은 유니온 블럭을 지원하지 않아 제외했습니다. ` +
      `해당 캐릭터는 인게임 자동 배치 시스템을 사용해 주세요.`
    );
  }

  return "캐릭터 목록을 불러왔습니다.";
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

  placements.forEach((placement, placementIndex) => {
    const piece = PIECES.find((item) => item.id === placement.pieceId);
    if (!piece) {
      return;
    }

    const placementId = `${placement.pieceId}:${placementIndex}`;
    placement.cells.forEach((index) => {
      solutionMap.set(index, {
        color: piece.color,
        placementId,
      });
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

function buildClassTypeMap() {
  const map = new Map();
  const add = (type, classNames) => {
    classNames.forEach((className) => {
      map.set(className, type);
    });
  };

  add("전사", [
    "검사",
    "파이터",
    "크루세이더",
    "히어로",
    "페이지",
    "나이트",
    "팔라딘",
    "스피어맨",
    "버서커",
    "다크나이트",
    "소울마스터",
    "미하일",
    "블래스터",
    "데몬슬레이어",
    "데몬어벤져",
    "아란",
    "카이저",
    "아델",
    "제로",
    "렌",
  ]);
  add("궁수", [
    "아처",
    "헌터",
    "레인저",
    "보우마스터",
    "석궁사수",
    "저격수",
    "신궁",
    "패스파인더",
    "윈드브레이커",
    "와일드헌터",
    "메르세데스",
    "카인",
  ]);
  add("마법사", [
    "매지션",
    "위자드(불,독)",
    "메이지(불,독)",
    "아크메이지(불,독)",
    "위자드(썬,콜)",
    "메이지(썬,콜)",
    "아크메이지(썬,콜)",
    "클레릭",
    "프리스트",
    "비숍",
    "플레임위자드",
    "배틀메이지",
    "에반",
    "루미너스",
    "일리움",
    "라라",
    "키네시스",
  ]);
  add("도적", [
    "로그",
    "어쌔신",
    "허밋",
    "나이트로드",
    "시프",
    "시프마스터",
    "섀도어",
    "세미듀어러",
    "듀어러",
    "듀얼마스터",
    "슬래셔",
    "듀얼블레이더",
    "나이트워커",
    "팬텀",
    "카데나",
    "칼리",
    "호영",
  ]);
  add("해적", [
    "해적",
    "인파이터",
    "버커니어",
    "바이퍼",
    "건슬링거",
    "발키리",
    "캡틴",
    "캐논슈터",
    "캐논블래스터",
    "캐논마스터",
    "스트라이커",
    "메카닉",
    "은월",
    "엔젤릭버스터",
    "아크",
  ]);
  add("하이브리드", ["제논"]);

  return map;
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

function paintCellBorders(cell, index) {
  const row = Math.floor(index / BOARD_WIDTH);
  const col = index % BOARD_WIDTH;
  const borders = borderMap[index];
  const topWidth = getRenderedTopBorder(row, col, borders);
  const leftWidth = getRenderedLeftBorder(row, col, borders);
  const rightWidth = col === BOARD_WIDTH - 1 ? borders.right : 0;
  const bottomWidth = row === BOARD_HEIGHT - 1 ? borders.bottom : 0;
  const topStyle = getSolutionEdgeStyle(index, row > 0 ? toIndex(row - 1, col) : -1, topWidth);
  const leftStyle = getSolutionEdgeStyle(index, col > 0 ? toIndex(row, col - 1) : -1, leftWidth);
  const rightStyle = getSolutionEdgeStyle(index, -1, rightWidth);
  const bottomStyle = getSolutionEdgeStyle(index, -1, bottomWidth);

  cell.style.borderTopWidth = `${topStyle.width}px`;
  cell.style.borderLeftWidth = `${leftStyle.width}px`;
  cell.style.borderRightWidth = `${rightStyle.width}px`;
  cell.style.borderBottomWidth = `${bottomStyle.width}px`;
  cell.style.borderTopColor = topStyle.color;
  cell.style.borderLeftColor = leftStyle.color;
  cell.style.borderRightColor = rightStyle.color;
  cell.style.borderBottomColor = bottomStyle.color;
}

function getSolutionEdgeStyle(index, neighborIndex, baseWidth) {
  if (baseWidth === 0) {
    return {
      width: 0,
      color: "transparent",
    };
  }

  const current = solutionMap.get(index);
  const neighbor = neighborIndex >= 0 ? solutionMap.get(neighborIndex) : null;

  if (!current && !neighbor) {
    return getBaseEdgeStyle(baseWidth);
  }

  if (baseWidth > 1) {
    return {
      width: baseWidth,
      color: "var(--region-line)",
    };
  }

  if (current && neighbor && current.placementId === neighbor.placementId) {
    return {
      width: 0,
      color: "transparent",
    };
  }

  return {
    width: 2,
    color: "var(--solution-piece-line)",
  };
}

function getBaseEdgeStyle(baseWidth) {
  return {
    width: baseWidth,
    color: baseWidth > 1 ? "var(--region-line)" : "var(--board-cell-line)",
  };
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
