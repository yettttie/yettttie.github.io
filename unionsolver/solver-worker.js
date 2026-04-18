const PIECE_SHAPES = [
  { pieceId: "lv200_warrior", shape: [[2, 1], [1, 1]] },
  { pieceId: "lv200_bowman", shape: [[1, 2, 1, 1]] },
  { pieceId: "lv200_thief", shape: [[1, 0, 0], [1, 2, 1]] },
  { pieceId: "lv200_magician", shape: [[0, 1, 0], [1, 2, 1]] },
  { pieceId: "lv200_pirate", shape: [[1, 2, 0], [0, 1, 1]] },
  { pieceId: "lv250_warrior", shape: [[1, 1, 2], [0, 1, 1]] },
  { pieceId: "lv250_bowman", shape: [[1, 1, 2, 1, 1]] },
  { pieceId: "lv250_thief", shape: [[0, 0, 1], [1, 2, 1], [0, 0, 1]] },
  { pieceId: "lv250_magician", shape: [[0, 1, 0], [1, 2, 1], [0, 1, 0]] },
  { pieceId: "lv250_pirate", shape: [[1, 2, 0, 0], [0, 1, 1, 1]] },
  { pieceId: "lv250_xenon", shape: [[1, 1, 0], [0, 2, 0], [0, 1, 1]] },
].map((piece) => ({
  ...piece,
  cells: getCellsFromShape(piece.shape),
  controlCells: getCellsFromShape(piece.shape, 2),
}));

const ASSET_VERSION = "20260419-corner-packages-39";
const CENTER_CANDIDATE_BUDGETS_MS = [30000, 60000, 120000];
const CORNER_PACKAGE_MIN_PIECES = 4;
const CORNER_PACKAGE_MAX_PIECES = 6;
const CORNER_PACKAGE_WINDOW_SIZE = 8;
const CORNER_PACKAGE_MAX_CANDIDATES = 72;
const CORNER_PACKAGE_MAX_CANDIDATES_PER_CORNER = 24;
const CORNER_PACKAGE_MAX_PLACEMENTS_PER_TYPE = 36;
const CORNER_PACKAGE_MAX_BRANCH_PLACEMENTS = 12;
const CORNER_PACKAGE_BUDGETS_MS = [30000, 60000, 90000];
const CORNER_PACKAGE_MIN_PRIORITY_PIECES = 2;
const CORNER_PACKAGE_PRIORITY_MAX_SCORE = 45;
const CORNER_PACKAGE_PRIORITY_PIECE_IDS = new Set([
  "lv250_magician",
  "lv250_thief",
  "lv250_xenon",
]);
const CORNER_PACKAGE_SUPPORT_PIECE_IDS = new Set([
  "lv250_bowman",
  "lv250_warrior",
  "lv200_bowman",
  "lv200_warrior",
]);

let cancelled = false;
let wasmExportsPromise = null;

self.addEventListener("message", (event) => {
  const data = event.data;

  if (data.type === "stop") {
    cancelled = true;
    return;
  }

  if (data.type === "start") {
    cancelled = false;
    solveRequest(data);
  }
});

async function solveRequest(data) {
  const totalPieceCells = PIECE_SHAPES.reduce((sum, piece) => (
    sum + piece.cells.length * Math.max(0, Math.floor(Number(data.pieceCounts[piece.pieceId] || 0)))
  ), 0);

  if (!Array.isArray(data.target) || data.target.length !== totalPieceCells) {
    finish({
      status: "unsolved",
      message: `목표 칸 ${Array.isArray(data.target) ? data.target.length : 0}칸과 조각 칸 ${totalPieceCells}칸이 같아야 합니다.`,
      placements: [],
      startTime: Date.now(),
      iterations: 0,
      engineLabel: "WASM",
    });
    return;
  }

  if (hasImpossibleRemainingComponent(data.target, data.pieceCounts, data.width)) {
    finish({
      status: "unsolved",
      message: "목표 영역에 남은 블럭 조합으로 채울 수 없는 고립 영역이 있습니다.",
      placements: [],
      startTime: Date.now(),
      iterations: 0,
      engineLabel: "WASM",
    });
    return;
  }

  if (data.useCornerPackages) {
    const cornerPackageResult = await solveWithCornerPackages(data);
    if (cornerPackageResult?.result) {
      finish({
        ...cornerPackageResult.result,
        message: cornerPackageResult.result.message || "배치를 찾았습니다.",
        engineLabel: "WASM",
      });
      return;
    }
  }

  if (data.requireCenterControl) {
    const centeredResult = await solveWithCenterControl(data);
    if (centeredResult?.result) {
      finish({
        ...centeredResult.result,
        engineLabel: "WASM",
      });
      return;
    }

    finish({
      status: "unsolved",
      message: "중앙 기준점 탐색에 실패했습니다.",
      placements: [],
      startTime: Date.now(),
      iterations: 0,
      engineLabel: "WASM",
    });
    return;
  }

  if (shouldUseWasmLiveSolver(data)) {
    const liveWasmResult = await solveWithWasmLive(data);
    if (liveWasmResult?.result) {
      finish({
        ...liveWasmResult.result,
        engineLabel: "WASM",
      });
      return;
    }
  }

  const wasmResult = await solveWithWasm(data);
  if (wasmResult?.result) {
    finish({
      ...wasmResult.result,
      engineLabel: "WASM",
    });
    return;
  }

  finish({
    status: "unsolved",
    message: "탐색 엔진을 불러오지 못했습니다.",
    placements: [],
    startTime: Date.now(),
    iterations: 0,
    engineLabel: "WASM",
  });
}

function shouldUseWasmLiveSolver(data) {
  const hasCandidateBudget = Number(data.candidateBudgetMs || 0) > 0;

  return (Boolean(data.liveSolve) || hasCandidateBudget)
    && (
      data.solverMode === "exact_cover"
      || data.solverMode === "branch_and_bound"
      || data.solverMode === "heuristic_fast"
      || data.solverMode === "heuristic_pruned"
      || data.solverMode === "heuristic_late_prune"
    );
}

function isSupportedWasmMode(mode) {
  return mode === "heuristic_fast"
    || mode === "heuristic_pruned"
    || mode === "heuristic_late_prune"
    || mode === "exact_cover"
    || mode === "branch_and_bound";
}

async function solveWithCenterControl(data) {
  if (!isSupportedWasmMode(data.solverMode) || cancelled) {
    return null;
  }

  const startTime = data.startTimeOverride || Date.now();
  const iterationOffset = Math.max(0, Math.floor(Number(data.iterationOffset || 0)));
  const baseFixedPlacements = Array.isArray(data.fixedPlacements) ? data.fixedPlacements : [];
  const candidates = getCenterControlCandidates(data);
  if (!candidates.length) {
    return {
      result: {
        status: "unsolved",
        message: "중앙 기준점 후보가 없습니다.",
        placements: [],
        startTime,
        iterations: 0,
      },
    };
  }

  postProgress({
    statusMessage: "중앙 기준점을 탐색합니다.",
    startTime,
    iterations: iterationOffset,
    placements: data.liveSolve ? baseFixedPlacements : undefined,
  });

  let totalIterations = 0;
  let timedOut = false;
  const timeoutMs = Math.max(1, Math.floor(Number(data.timeoutMs || 0)));
  let passIndex = 0;

  while (!timedOut) {
    let deferredCandidate = false;

    for (const candidate of candidates) {
      if (cancelled) {
        return {
          result: {
            status: "cancelled",
            message: "중지됨",
            placements: [],
            startTime,
            iterations: totalIterations,
          },
        };
      }

      const elapsedMs = Date.now() - startTime;
      const remainingMs = timeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        timedOut = true;
        break;
      }

      const candidateBudgetMs = getCenterCandidateBudgetMs(passIndex, remainingMs);
      const fixedCells = new Set(candidate.cells);
      const pieceCounts = { ...data.pieceCounts };
      pieceCounts[candidate.pieceId] = Math.max(0, Number(pieceCounts[candidate.pieceId] || 0) - 1);
      const target = data.target.filter((cell) => !fixedCells.has(cell));
      const fixedPlacements = [...baseFixedPlacements, candidate];
      if (target.length !== getTotalPieceCellCount(pieceCounts)) {
        continue;
      }
      if (hasImpossibleRemainingComponent(target, pieceCounts, data.width)) {
        continue;
      }
      if (data.liveSolve) {
        postProgress({
          statusMessage: `중앙 후보를 탐색합니다. (${passIndex + 1}회차)`,
          startTime,
          iterations: iterationOffset + totalIterations,
          placements: fixedPlacements,
        });
      }

      if (target.length === 0 && isValidCombinedPlacement(fixedPlacements, data.originalTarget || data.target, data.width, data.height)) {
        return {
          result: {
            status: "ok",
            placements: fixedPlacements,
            startTime,
            iterations: totalIterations,
          },
        };
      }

      const innerRequest = {
        ...data,
        target,
        pieceCounts,
        timeoutMs: Math.min(remainingMs, candidateBudgetMs),
        candidateBudgetMs,
        fixedPlacements,
        iterationOffset: iterationOffset + totalIterations,
        startTimeOverride: startTime,
        requireCenterControl: false,
        useCornerPackages: false,
      };
      const wasmResult = shouldUseWasmLiveSolver(innerRequest)
        ? await solveWithWasmLive({
          ...innerRequest,
          liveSolve: data.liveSolve,
        })
        : await solveWithWasm({
          ...innerRequest,
          liveSolve: false,
        });

      const result = wasmResult?.result;
      totalIterations += result?.iterations || 0;

      if (!result) {
        return null;
      }

      if (result.status === "candidate_timeout") {
        deferredCandidate = true;
        continue;
      }

      if (result.status === "timeout") {
        const hasTimeForNextCandidate = Date.now() - startTime < timeoutMs;
        if (hasTimeForNextCandidate) {
          deferredCandidate = true;
          continue;
        }
        timedOut = true;
        break;
      }

      if (result.status === "cancelled") {
        return {
          result: {
            ...result,
            startTime,
            iterations: totalIterations,
          },
        };
      }

      if (result.status !== "ok") {
        continue;
      }

      const placements = [...fixedPlacements, ...result.placements];
      if (!isValidCombinedPlacement(placements, data.originalTarget || data.target, data.width, data.height)) {
        continue;
      }

      return {
        result: {
          status: "ok",
          placements,
          startTime,
          iterations: totalIterations,
        },
      };
    }

    if (timedOut) {
      break;
    }

    if (!deferredCandidate) {
      return {
        result: {
          status: "unsolved",
          message: "조건에 맞는 배치를 찾지 못했습니다.",
          placements: [],
          startTime,
          iterations: totalIterations,
        },
      };
    }

    passIndex += 1;
  }

  return {
    result: {
      status: timedOut ? "timeout" : "unsolved",
      message: timedOut ? "타임아웃" : "조건에 맞는 배치를 찾지 못했습니다.",
      placements: [],
      startTime,
      iterations: totalIterations,
    },
  };
}

function getCenterCandidateBudgetMs(passIndex, remainingMs) {
  const budget = CENTER_CANDIDATE_BUDGETS_MS[Math.min(
    Math.max(0, Math.floor(Number(passIndex || 0))),
    CENTER_CANDIDATE_BUDGETS_MS.length - 1,
  )];

  return Math.max(1, Math.min(Math.max(1, Math.floor(Number(remainingMs || 0))), budget));
}

async function solveWithCornerPackages(data) {
  if (!isSupportedWasmMode(data.solverMode) || cancelled) {
    return null;
  }

  const startTime = data.startTimeOverride || Date.now();
  const iterationOffset = Math.max(0, Math.floor(Number(data.iterationOffset || 0)));
  const baseFixedPlacements = Array.isArray(data.fixedPlacements) ? data.fixedPlacements : [];
  const timeoutMs = Math.max(1, Math.floor(Number(data.timeoutMs || 0)));
  const candidates = getCornerPackageCandidates(data);
  if (!candidates.length) {
    return {
      result: {
        status: "unsolved",
        message: "모서리 패키지 후보가 없습니다.",
        placements: [],
        startTime,
        iterations: 0,
      },
    };
  }

  postProgress({
    statusMessage: `모서리 후보 ${candidates.length}개를 찾았습니다.`,
    startTime,
    iterations: iterationOffset,
    placements: data.liveSolve ? baseFixedPlacements : undefined,
  });

  let totalIterations = 0;
  let timedOut = false;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    if (cancelled) {
      return {
        result: {
          status: "cancelled",
          message: "중지됨",
          placements: [],
          startTime,
          iterations: totalIterations,
        },
      };
    }

    const elapsedMs = Date.now() - startTime;
    const remainingMs = timeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      timedOut = true;
      break;
    }

    const candidate = candidates[candidateIndex];
    const packageBudgetMs = getCornerPackageBudgetMs(candidateIndex, remainingMs);
    const pieceCounts = decrementPieceCountsForPlacements(data.pieceCounts, candidate.placements);
    if (!pieceCounts) {
      continue;
    }

    const fixedCells = new Set(candidate.cells);
    const target = data.target.filter((cell) => !fixedCells.has(cell));
    if (target.length !== getTotalPieceCellCount(pieceCounts)) {
      continue;
    }
    if (hasImpossibleRemainingComponent(target, pieceCounts, data.width)) {
      continue;
    }

    const fixedPlacements = [...baseFixedPlacements, ...candidate.placements];
    postProgress({
      statusMessage: `모서리 후보를 탐색합니다. (${candidateIndex + 1}/${candidates.length})`,
      startTime,
      iterations: iterationOffset + totalIterations,
      placements: data.liveSolve ? fixedPlacements : undefined,
    });

    if (target.length === 0 && isValidCombinedPlacement(fixedPlacements, data.originalTarget || data.target, data.width, data.height)) {
      return {
        result: {
          status: "ok",
          message: "배치를 찾았습니다.",
          placements: fixedPlacements,
          startTime,
          iterations: totalIterations,
        },
      };
    }

    const innerRequest = {
      ...data,
      target,
      pieceCounts,
      timeoutMs: packageBudgetMs,
      candidateBudgetMs: packageBudgetMs,
      fixedPlacements,
      originalTarget: data.originalTarget || data.target,
      iterationOffset: iterationOffset + totalIterations,
      startTimeOverride: startTime,
      useCornerPackages: false,
    };

    const wasmResult = data.requireCenterControl
      ? await solveWithCenterControl(innerRequest)
      : shouldUseWasmLiveSolver(innerRequest)
        ? await solveWithWasmLive(innerRequest)
        : await solveWithWasm({ ...innerRequest, liveSolve: false });

    const result = wasmResult?.result;
    totalIterations += result?.iterations || 0;

    if (!result) {
      continue;
    }

    if (result.status === "cancelled") {
      return {
        result: {
          ...result,
          startTime,
          iterations: totalIterations,
        },
      };
    }

    if (result.status === "timeout" || result.status === "candidate_timeout") {
      timedOut = Date.now() - startTime >= timeoutMs;
      if (timedOut) {
        break;
      }
      continue;
    }

    if (result.status !== "ok") {
      continue;
    }

    const placements = data.requireCenterControl
      ? result.placements
      : [...fixedPlacements, ...result.placements];
    if (!isValidCombinedPlacement(placements, data.originalTarget || data.target, data.width, data.height)) {
      continue;
    }

    return {
      result: {
        status: "ok",
        message: "배치를 찾았습니다.",
        placements,
        startTime,
        iterations: totalIterations,
      },
    };
  }

  if (timedOut) {
    return {
      result: {
        status: "timeout",
        message: "타임아웃",
        placements: [],
        startTime,
        iterations: totalIterations,
      },
    };
  }

  return {
    result: {
      status: "unsolved",
      message: "모서리 후보에서 찾지 못했습니다.",
      placements: [],
      startTime,
      iterations: totalIterations,
    },
  };
}

function getCornerPackageBudgetMs(candidateIndex, remainingMs) {
  const budget = CORNER_PACKAGE_BUDGETS_MS[Math.min(
    Math.max(0, Math.floor(Number(candidateIndex || 0))),
    CORNER_PACKAGE_BUDGETS_MS.length - 1,
  )];

  return Math.max(1, Math.min(Math.max(1, Math.floor(Number(remainingMs || 0))), budget));
}

function decrementPieceCountsForPlacements(pieceCounts, placements) {
  const nextCounts = { ...pieceCounts };

  for (const placement of placements) {
    const current = Math.max(0, Math.floor(Number(nextCounts[placement.pieceId] || 0)));
    if (current <= 0) {
      return null;
    }
    nextCounts[placement.pieceId] = current - 1;
  }

  return nextCounts;
}

function getTotalPieceCellCount(pieceCounts) {
  return PIECE_SHAPES.reduce((sum, piece) => (
    sum + piece.cells.length * Math.max(0, Math.floor(Number(pieceCounts[piece.pieceId] || 0)))
  ), 0);
}

function hasImpossibleRemainingComponent(target, pieceCounts, width) {
  if (!Array.isArray(target) || target.length === 0) {
    return false;
  }

  const pieceSizeCounts = new Map();
  PIECE_SHAPES.forEach((piece) => {
    const count = Math.max(0, Math.floor(Number(pieceCounts[piece.pieceId] || 0)));
    if (count > 0) {
      pieceSizeCounts.set(piece.cells.length, (pieceSizeCounts.get(piece.cells.length) || 0) + count);
    }
  });

  if (!pieceSizeCounts.size) {
    return target.length > 0;
  }

  const remaining = new Set(target);
  const offsets = [-width, width, -1, 1];

  for (const start of target) {
    if (!remaining.has(start)) {
      continue;
    }

    let componentSize = 0;
    const stack = [start];
    remaining.delete(start);

    while (stack.length) {
      const cell = stack.pop();
      componentSize += 1;
      const col = cell % width;

      for (const offset of offsets) {
        if ((offset === -1 && col === 0) || (offset === 1 && col === width - 1)) {
          continue;
        }

        const next = cell + offset;
        if (!remaining.has(next)) {
          continue;
        }

        remaining.delete(next);
        stack.push(next);
      }
    }

    if (!canFillComponentSize(componentSize, pieceSizeCounts)) {
      return true;
    }
  }

  return false;
}

function canFillComponentSize(componentSize, pieceSizeCounts) {
  const maxFourCount = Math.min(pieceSizeCounts.get(4) || 0, Math.floor(componentSize / 4));
  const maxFiveCount = Math.min(pieceSizeCounts.get(5) || 0, Math.floor(componentSize / 5));

  for (let fourCount = 0; fourCount <= maxFourCount; fourCount += 1) {
    const remainingSize = componentSize - fourCount * 4;
    if (remainingSize < 0) {
      break;
    }
    if (remainingSize % 5 !== 0) {
      continue;
    }
    if (remainingSize / 5 <= maxFiveCount) {
      return true;
    }
  }

  return false;
}

function getCornerPackageCandidates(data) {
  const targetSet = new Set(data.target);
  const corners = getTargetCornerDefinitions(data.target, data.width, data.height);
  const candidates = [];
  const seenPackages = new Set();

  for (const corner of corners) {
    if (candidates.length >= CORNER_PACKAGE_MAX_CANDIDATES) {
      break;
    }

    const placementsByPiece = new Map();
    PIECE_SHAPES.forEach((piece, pieceIndex) => {
      if (Math.max(0, Math.floor(Number(data.pieceCounts[piece.pieceId] || 0))) <= 0) {
        return;
      }

      const placements = getCornerPlacementsForPiece(data, piece, pieceIndex, corner, targetSet)
        .sort((left, right) => left.score - right.score)
        .slice(0, CORNER_PACKAGE_MAX_PLACEMENTS_PER_TYPE);
      if (placements.length) {
        placementsByPiece.set(piece.pieceId, placements);
      }
    });

    if (!placementsByPiece.size) {
      continue;
    }

    const pieceOrder = PIECE_SHAPES
      .map((piece, pieceIndex) => ({
        piece,
        pieceIndex,
        count: Math.max(0, Math.floor(Number(data.pieceCounts[piece.pieceId] || 0))),
        placementCount: placementsByPiece.get(piece.pieceId)?.length || 0,
      }))
      .filter((item) => item.count > 0 && item.placementCount > 0)
      .sort((left, right) => (
        getCornerPackagePiecePriority(right.piece.pieceId) - getCornerPackagePiecePriority(left.piece.pieceId)
        || left.placementCount - right.placementCount
        || right.piece.cells.length - left.piece.cells.length
        || right.count - left.count
        || left.pieceIndex - right.pieceIndex
      ));

    const countsLeft = { ...data.pieceCounts };
    const priorityRequirement = getCornerPackagePriorityRequirement(data.pieceCounts);

    const cornerCandidates = [];
    searchCornerPackages({
      data,
      corner,
      pieceOrder,
      placementsByPiece,
      countsLeft,
      selected: [],
      occupied: new Set(),
      minOrderIndex: 0,
      priorityRequirement,
      cornerCandidates,
      seenPackages,
    });

    cornerCandidates
      .sort(compareCornerPackageCandidates)
      .slice(0, CORNER_PACKAGE_MAX_CANDIDATES_PER_CORNER)
      .forEach((candidate) => {
        if (candidates.length < CORNER_PACKAGE_MAX_CANDIDATES) {
          candidates.push(candidate);
        }
      });
  }

  return candidates.sort(compareCornerPackageCandidates).slice(0, CORNER_PACKAGE_MAX_CANDIDATES);
}

function searchCornerPackages({
  data,
  corner,
  pieceOrder,
  placementsByPiece,
  countsLeft,
  selected,
  occupied,
  minOrderIndex,
  priorityRequirement,
  cornerCandidates,
  seenPackages,
}) {
  if (cornerCandidates.length >= CORNER_PACKAGE_MAX_CANDIDATES_PER_CORNER * 2) {
    return;
  }

  const selectedPriorityPieces = countPriorityCornerPieces(selected);
  if (selectedPriorityPieces + getRemainingPriorityCornerPieceCount(countsLeft) < priorityRequirement) {
    return;
  }

  if (selected.length + getRemainingCornerPieceCount(countsLeft) < CORNER_PACKAGE_MIN_PIECES) {
    return;
  }

  if (
    selected.length >= CORNER_PACKAGE_MIN_PIECES
    && isGoodCornerPackage(selected, occupied, corner, data, countsLeft, priorityRequirement)
  ) {
    const packageKey = getCornerPackageKey(selected);
    if (!seenPackages.has(packageKey)) {
      seenPackages.add(packageKey);
      cornerCandidates.push({
        placements: selected.map((placement) => ({
          pieceId: placement.pieceId,
          pieceIndex: placement.pieceIndex,
          cells: [...placement.cells],
        })),
        cells: [...occupied].sort((left, right) => left - right),
        cornerId: corner.id,
        score: scoreCornerPackage(selected, occupied, corner, data),
      });
    }
  }

  if (selected.length >= CORNER_PACKAGE_MAX_PIECES) {
    return;
  }

  for (let orderIndex = minOrderIndex; orderIndex < pieceOrder.length; orderIndex += 1) {
    const { piece } = pieceOrder[orderIndex];
    const isPriorityPiece = CORNER_PACKAGE_PRIORITY_PIECE_IDS.has(piece.pieceId);
    if (
      selectedPriorityPieces < priorityRequirement
      && !isPriorityPiece
    ) {
      continue;
    }
    if (priorityRequirement > 0 && selectedPriorityPieces >= priorityRequirement && isPriorityPiece) {
      continue;
    }
    if (Math.max(0, Math.floor(Number(countsLeft[piece.pieceId] || 0))) <= 0) {
      continue;
    }

    const placements = placementsByPiece.get(piece.pieceId) || [];
    const branchLimit = CORNER_PACKAGE_MAX_BRANCH_PLACEMENTS;
    let branchCount = 0;
    for (const placement of placements) {
      if (branchCount >= branchLimit) {
        break;
      }
      if (
        priorityRequirement > 0
        && isPriorityPiece
        && !isPriorityPlacementNearCorner(placement, corner)
      ) {
        continue;
      }
      if (placement.cells.some((cell) => occupied.has(cell))) {
        continue;
      }
      if (selected.length > 0 && !isAdjacentToOccupied(placement.cells, occupied, data.width)) {
        continue;
      }

      branchCount += 1;
      countsLeft[piece.pieceId] -= 1;
      const nextOccupied = new Set(occupied);
      placement.cells.forEach((cell) => nextOccupied.add(cell));
      selected.push(placement);

      searchCornerPackages({
        data,
        corner,
        pieceOrder,
        placementsByPiece,
        countsLeft,
        selected,
        occupied: nextOccupied,
        minOrderIndex: orderIndex,
        priorityRequirement,
        cornerCandidates,
        seenPackages,
      });

      selected.pop();
      countsLeft[piece.pieceId] += 1;
    }
  }
}

function getCornerPlacementsForPiece(data, piece, pieceIndex, corner, targetSet) {
  const placements = [];
  const seen = new Set();

  getTransformedPieceVariants(piece).forEach((variant) => {
    const xs = variant.cells.map(([x]) => x);
    const ys = variant.cells.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const variantWidth = maxX - minX + 1;
    const variantHeight = maxY - minY + 1;
    const ranges = getCornerOriginRanges(data.width, data.height, variantWidth, variantHeight, corner);

    for (let originY = ranges.minY; originY <= ranges.maxY; originY += 1) {
      for (let originX = ranges.minX; originX <= ranges.maxX; originX += 1) {
        const points = variant.cells.map(([x, y]) => [
          originX + x - minX,
          originY + y - minY,
        ]);
        if (!points.every(([x, y]) => x >= 0 && x < data.width && y >= 0 && y < data.height)) {
          continue;
        }

        const cells = points.map(([x, y]) => toIndex(y, x, data.width)).sort((left, right) => left - right);
        if (!cells.every((cell) => targetSet.has(cell))) {
          continue;
        }

        const key = `${piece.pieceId}:${cells.join(",")}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        placements.push({
          pieceId: piece.pieceId,
          pieceIndex,
          cells,
          score: scoreCornerPlacement(cells, corner, data.width),
        });
      }
    }
  });

  return placements;
}

function getCornerDefinitions(width, height) {
  return getBoardCornerDefinitions(0, width - 1, 0, height - 1, width, height);
}

function getTargetCornerDefinitions(target, width, height) {
  if (!Array.isArray(target) || !target.length) {
    return getCornerDefinitions(width, height);
  }

  const points = target.map((cell) => indexToPoint(cell, width));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return getBoardCornerDefinitions(
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
    width,
    height,
  );
}

function getBoardCornerDefinitions(minX, maxX, minY, maxY, width, height) {
  return [
    { id: "top-left", edgeX: minX, edgeY: minY, horizontalEdge: "left", verticalEdge: "top", minX, maxX: minX + CORNER_PACKAGE_WINDOW_SIZE - 1, minY, maxY: minY + CORNER_PACKAGE_WINDOW_SIZE - 1 },
    { id: "top-right", edgeX: maxX, edgeY: minY, horizontalEdge: "right", verticalEdge: "top", minX: maxX - CORNER_PACKAGE_WINDOW_SIZE + 1, maxX, minY, maxY: minY + CORNER_PACKAGE_WINDOW_SIZE - 1 },
    { id: "bottom-left", edgeX: minX, edgeY: maxY, horizontalEdge: "left", verticalEdge: "bottom", minX, maxX: minX + CORNER_PACKAGE_WINDOW_SIZE - 1, minY: maxY - CORNER_PACKAGE_WINDOW_SIZE + 1, maxY },
    { id: "bottom-right", edgeX: maxX, edgeY: maxY, horizontalEdge: "right", verticalEdge: "bottom", minX: maxX - CORNER_PACKAGE_WINDOW_SIZE + 1, maxX, minY: maxY - CORNER_PACKAGE_WINDOW_SIZE + 1, maxY },
  ].map((corner) => ({
    ...corner,
    minX: Math.max(0, corner.minX),
    maxX: Math.min(width - 1, corner.maxX),
    minY: Math.max(0, corner.minY),
    maxY: Math.min(height - 1, corner.maxY),
  }));
}

function getCornerOriginRanges(width, height, variantWidth, variantHeight, corner) {
  const minX = Math.max(0, corner.minX);
  const maxX = Math.min(width - variantWidth, corner.maxX - variantWidth + 1);
  const minY = Math.max(0, corner.minY);
  const maxY = Math.min(height - variantHeight, corner.maxY - variantHeight + 1);

  return {
    minX,
    maxX: Math.max(minX - 1, maxX),
    minY,
    maxY: Math.max(minY - 1, maxY),
  };
}

function isGoodCornerPackage(selected, occupied, corner, data, countsLeft, priorityRequirement) {
  if (countPriorityCornerPieces(selected) < priorityRequirement) {
    return false;
  }
  if (!touchesCornerEdges(occupied, corner, data.width, data.height)) {
    return false;
  }
  if (priorityRequirement > 0 && !hasCornerNearPriorityPiece(selected, corner, data.width)) {
    return false;
  }
  if (!isConnectedCellSet(occupied, data.width)) {
    return false;
  }

  const remainingTarget = data.target.filter((cell) => !occupied.has(cell));
  if (remainingTarget.length !== getTotalPieceCellCount(countsLeft)) {
    return false;
  }

  return !hasImpossibleRemainingComponent(remainingTarget, countsLeft, data.width);
}

function touchesCornerEdges(cells, corner, width, height) {
  let touchesHorizontal = false;
  let touchesVertical = false;

  cells.forEach((cell) => {
    const [x, y] = indexToPoint(cell, width);
    if (x === corner.edgeX) {
      touchesHorizontal = true;
    }
    if (y === corner.edgeY) {
      touchesVertical = true;
    }
  });

  return touchesHorizontal && touchesVertical;
}

function isConnectedCellSet(cells, width) {
  if (!cells.size) {
    return false;
  }

  const remaining = new Set(cells);
  const first = remaining.values().next().value;
  const stack = [first];
  remaining.delete(first);

  while (stack.length) {
    const cell = stack.pop();
    const col = cell % width;
    const neighbors = [cell - width, cell + width];
    if (col > 0) {
      neighbors.push(cell - 1);
    }
    if (col < width - 1) {
      neighbors.push(cell + 1);
    }

    neighbors.forEach((neighbor) => {
      if (remaining.has(neighbor)) {
        remaining.delete(neighbor);
        stack.push(neighbor);
      }
    });
  }

  return remaining.size === 0;
}

function isAdjacentToOccupied(cells, occupied, width) {
  return cells.some((cell) => {
    const col = cell % width;
    return occupied.has(cell - width)
      || occupied.has(cell + width)
      || (col > 0 && occupied.has(cell - 1))
      || (col < width - 1 && occupied.has(cell + 1));
  });
}

function scoreCornerPlacement(cells, corner, width) {
  return cells.reduce((sum, cell) => {
    const [x, y] = indexToPoint(cell, width);
    const distanceX = Math.abs(x - corner.edgeX);
    const distanceY = Math.abs(y - corner.edgeY);
    return sum + distanceX + distanceY;
  }, 0);
}

function isPriorityPlacementNearCorner(placement, corner) {
  return placement.score <= CORNER_PACKAGE_PRIORITY_MAX_SCORE;
}

function hasCornerNearPriorityPiece(placements, corner, width) {
  return placements.some((placement) => (
    CORNER_PACKAGE_PRIORITY_PIECE_IDS.has(placement.pieceId)
    && isPriorityPlacementNearCorner(placement, corner)
    && placement.cells.some((cell) => {
      const [x, y] = indexToPoint(cell, width);
      return x === corner.edgeX || y === corner.edgeY;
    })
  ));
}

function scoreCornerPackage(selected, occupied, corner, data) {
  const points = [...occupied].map((cell) => indexToPoint(cell, data.width));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
  const occupiedCount = occupied.size;
  const holePenalty = area - occupiedCount;
  const distancePenalty = scoreCornerPlacement([...occupied], corner, data.width);
  const fiveCellPieces = selected.filter((placement) => PIECE_SHAPES[placement.pieceIndex].cells.length >= 5).length;
  const priorityPieces = countPriorityCornerPieces(selected);
  const supportPieces = countSupportCornerPieces(selected);
  const packageVariety = new Set(selected.map((placement) => placement.pieceId)).size;
  const constrainedScore = selected.reduce((sum, placement) => sum + Math.max(0, 10 - placement.score), 0);

  return occupiedCount * 100
    + selected.length * 12
    + fiveCellPieces * 16
    + priorityPieces * 90
    + supportPieces * 36
    + packageVariety * 8
    + constrainedScore
    - holePenalty * 8
    - distancePenalty;
}

function getCornerPackagePriorityRequirement(pieceCounts) {
  const priorityCount = [...CORNER_PACKAGE_PRIORITY_PIECE_IDS].reduce((sum, pieceId) => (
    sum + Math.max(0, Math.floor(Number(pieceCounts[pieceId] || 0)))
  ), 0);

  return priorityCount >= CORNER_PACKAGE_MIN_PRIORITY_PIECES
    ? CORNER_PACKAGE_MIN_PRIORITY_PIECES
    : 0;
}

function countPriorityCornerPieces(placements) {
  return placements.filter((placement) => CORNER_PACKAGE_PRIORITY_PIECE_IDS.has(placement.pieceId)).length;
}

function countSupportCornerPieces(placements) {
  return placements.filter((placement) => CORNER_PACKAGE_SUPPORT_PIECE_IDS.has(placement.pieceId)).length;
}

function getCornerPackagePiecePriority(pieceId) {
  if (CORNER_PACKAGE_PRIORITY_PIECE_IDS.has(pieceId)) {
    return 2;
  }
  if (CORNER_PACKAGE_SUPPORT_PIECE_IDS.has(pieceId)) {
    return 1;
  }
  return 0;
}

function getRemainingPriorityCornerPieceCount(pieceCounts) {
  return [...CORNER_PACKAGE_PRIORITY_PIECE_IDS].reduce((sum, pieceId) => (
    sum + Math.max(0, Math.floor(Number(pieceCounts[pieceId] || 0)))
  ), 0);
}

function getRemainingCornerPieceCount(pieceCounts) {
  return Object.values(pieceCounts).reduce((sum, count) => (
    sum + Math.max(0, Math.floor(Number(count || 0)))
  ), 0);
}

function compareCornerPackageCandidates(left, right) {
  return right.score - left.score
    || right.cells.length - left.cells.length
    || left.cornerId.localeCompare(right.cornerId)
    || getCornerPackageKey(left.placements).localeCompare(getCornerPackageKey(right.placements));
}

function getCornerPackageKey(placements) {
  return placements
    .map((placement) => `${placement.pieceId}:${placement.cells.join(",")}`)
    .sort()
    .join("|");
}

function getCenterControlCandidates(data) {
  const centerIndexes = getCenterIndexes(data.width, data.height);
  const candidates = [];
  const seen = new Set();

  PIECE_SHAPES.forEach((piece, pieceIndex) => {
    if (Math.max(0, Math.floor(Number(data.pieceCounts[piece.pieceId] || 0))) <= 0) {
      return;
    }

    centerIndexes.forEach((centerIndex) => {
      const centerPoint = indexToPoint(centerIndex, data.width);
      getTransformedPieceVariants(piece).forEach((variant) => {
        const cells = variant.cells.map(([x, y]) => [
          centerPoint[0] + x - variant.control[0],
          centerPoint[1] + y - variant.control[1],
        ]);

        if (!cells.every(([x, y]) => x >= 0 && x < data.width && y >= 0 && y < data.height)) {
          return;
        }

        const indexes = cells.map(([x, y]) => toIndex(y, x, data.width)).sort((left, right) => left - right);
        const key = `${piece.pieceId}:${indexes.join(",")}`;
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        candidates.push({
          pieceId: piece.pieceId,
          pieceIndex,
          cells: indexes,
          centerIndex,
        });
      });
    });
  });

  return candidates.sort((left, right) => {
    const leftSize = PIECE_SHAPES[left.pieceIndex].cells.length;
    const rightSize = PIECE_SHAPES[right.pieceIndex].cells.length;
    return rightSize - leftSize || left.pieceIndex - right.pieceIndex || left.centerIndex - right.centerIndex;
  });
}

function getCenterIndexes(width, height) {
  const left = Math.floor(width / 2) - 1;
  const right = Math.floor(width / 2);
  const top = Math.floor(height / 2) - 1;
  const bottom = Math.floor(height / 2);
  return [
    toIndex(top, left, width),
    toIndex(top, right, width),
    toIndex(bottom, left, width),
    toIndex(bottom, right, width),
  ];
}

function getTransformedPieceVariants(piece) {
  const variants = [];
  const seen = new Set();
  const controlCells = piece.controlCells.length ? piece.controlCells : piece.cells;

  controlCells.forEach((controlCell) => {
    [-1, 1].forEach((flipX) => {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const cells = piece.cells.map((cell) => transformPoint(cell, flipX, rotation));
        const control = transformPoint(controlCell, flipX, rotation);
        const key = `${normalizeCells(cells)}:${control.join(",")}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        variants.push({ cells, control });
      }
    });
  });

  return variants;
}

function transformPoint(point, flipX, rotation) {
  let x = point[0] * flipX;
  let y = point[1];

  for (let index = 0; index < rotation; index += 1) {
    [x, y] = [-y, x];
  }

  return [x, y];
}

function normalizeCells(cells) {
  return cells
    .map(([x, y]) => [Number(x), Number(y)])
    .sort((left, right) => left[1] - right[1] || left[0] - right[0])
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

function isValidCombinedPlacement(placements, target, width, height) {
  const occupied = new Set();
  const targetSet = new Set(target);
  const coveredTarget = new Set();

  for (const placement of placements) {
    if (!placement || !Array.isArray(placement.cells)) {
      return false;
    }

    for (const cell of placement.cells) {
      const [x, y] = indexToPoint(cell, width);
      if (x < 0 || x >= width || y < 0 || y >= height || occupied.has(cell)) {
        return false;
      }

      occupied.add(cell);
      if (targetSet.has(cell)) {
        coveredTarget.add(cell);
      }
    }
  }

  return coveredTarget.size === targetSet.size;
}

async function solveWithWasmLive(data) {
  if (!shouldUseWasmLiveSolver(data) || cancelled) {
    return null;
  }

  const wasmExports = await getWasmExports();
  if (!wasmExports || typeof wasmExports.start_live_solve !== "function" || typeof wasmExports.resume_live_solve !== "function") {
    return null;
  }

  const startTime = data.startTimeOverride || Date.now();
  const iterationOffset = Math.max(0, Math.floor(Number(data.iterationOffset || 0)));
  const liveBatchSize = getLiveBatchSize(data.solverMode);
  const candidateBudgetMs = Math.max(0, Math.floor(Number(data.candidateBudgetMs || 0)));
  const candidateStartTime = Date.now();
  let lastProgressAt = startTime;
  let lastProgressIterations = 0;

  postProgress({
    statusMessage: data.liveSolve ? "실시간으로 탐색하고 있습니다." : "탐색합니다.",
    startTime,
    iterations: iterationOffset,
    placements: getProgressPlacements(data, []),
  });

  try {
    const encoded = encodeWasmRequest(data);
    const inputPtr = wasmExports.alloc(encoded.length);
    new Uint8Array(wasmExports.memory.buffer, inputPtr, encoded.length).set(encoded);

    let outputPtr = wasmExports.start_live_solve(inputPtr, encoded.length);
    let resultLength = wasmExports.last_result_len();
    let outputBytes = new Uint8Array(wasmExports.memory.buffer, outputPtr, resultLength).slice();

    wasmExports.free_buffer(inputPtr, encoded.length);
    wasmExports.free_buffer(outputPtr, resultLength);

    let result = normalizeSolvedResult(decodeWasmResult(outputBytes, startTime), data.target);
    if (!result) {
      return null;
    }

    while (result.status === "progress") {
      const now = Date.now();
      if (candidateBudgetMs > 0 && now - candidateStartTime >= candidateBudgetMs) {
        if (typeof wasmExports.clear_live_session === "function") {
          wasmExports.clear_live_session();
        }
        return {
          result: {
            status: "candidate_timeout",
            message: "중앙 후보 시간이 초과되었습니다.",
            placements: getProgressPlacements(data, result.placements),
            startTime,
            iterations: result.iterations,
          },
        };
      }

      if (
        result.iterations - lastProgressIterations >= liveBatchSize
        && now - lastProgressAt >= 100
      ) {
        postProgress({
          statusMessage: data.liveSolve ? "실시간으로 탐색하고 있습니다." : "탐색합니다.",
          startTime,
          iterations: iterationOffset + result.iterations,
          placements: data.liveSolve ? getProgressPlacements(data, result.placements) : undefined,
        });
        lastProgressAt = now;
        lastProgressIterations = result.iterations;
      }

      if (cancelled) {
        if (typeof wasmExports.clear_live_session === "function") {
          wasmExports.clear_live_session();
        }
        return {
          result: {
            status: "cancelled",
            message: "중지됨",
            placements: getProgressPlacements(data, result.placements),
            startTime,
            iterations: result.iterations,
          },
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 0));

      outputPtr = wasmExports.resume_live_solve(liveBatchSize);
      resultLength = wasmExports.last_result_len();
      outputBytes = new Uint8Array(wasmExports.memory.buffer, outputPtr, resultLength).slice();
      wasmExports.free_buffer(outputPtr, resultLength);

      result = normalizeSolvedResult(decodeWasmResult(outputBytes, startTime), data.target);
      if (!result) {
        return null;
      }
    }

    if (result.status === "timeout" && candidateBudgetMs > 0) {
      if (typeof wasmExports.clear_live_session === "function") {
        wasmExports.clear_live_session();
      }
      return {
        result: {
          status: "candidate_timeout",
          message: "중앙 후보 시간이 초과되었습니다.",
          placements: getProgressPlacements(data, result.placements),
          startTime,
          iterations: result.iterations,
        },
      };
    }

    if (result.status === "ok" && typeof wasmExports.clear_live_session === "function") {
      wasmExports.clear_live_session();
    }

    return { result };
  } catch (_error) {
    wasmExportsPromise = null;
    return {
      result: {
        status: "unsolved",
        message: "탐색 엔진 오류가 발생했습니다.",
        placements: [],
        startTime,
        iterations: 0,
      },
    };
  }
}

function getLiveBatchSize(mode) {
  if (mode === "exact_cover" || mode === "branch_and_bound") {
    return 20000;
  }

  return 30000;
}

async function solveWithWasm(data) {
  if (!isSupportedWasmMode(data.solverMode) || cancelled) {
    return null;
  }

  const wasmExports = await getWasmExports();
  if (!wasmExports) {
    return null;
  }

  const startTime = Date.now();
  postProgress({
    statusMessage: "탐색합니다.",
    startTime,
    iterations: 0,
  });

  try {
    const encoded = encodeWasmRequest(data);
    const inputPtr = wasmExports.alloc(encoded.length);
    new Uint8Array(wasmExports.memory.buffer, inputPtr, encoded.length).set(encoded);

    const outputPtr = wasmExports.solve(inputPtr, encoded.length);
    const resultLength = wasmExports.last_result_len();
    const outputBytes = new Uint8Array(wasmExports.memory.buffer, outputPtr, resultLength).slice();

    wasmExports.free_buffer(inputPtr, encoded.length);
    wasmExports.free_buffer(outputPtr, resultLength);

    const result = normalizeSolvedResult(decodeWasmResult(outputBytes, startTime), data.target);
    if (!result) {
      return null;
    }

    if (cancelled) {
      return {
        result: {
          status: "cancelled",
          message: "중지됨",
          placements: result.placements,
          startTime,
          iterations: result.iterations,
        },
      };
    }

    return { result };
  } catch (_error) {
    wasmExportsPromise = null;
    return {
      result: {
        status: "unsolved",
        message: "탐색 엔진 오류가 발생했습니다.",
        placements: [],
        startTime,
        iterations: 0,
      },
    };
  }
}

async function getWasmExports() {
  if (wasmExportsPromise) {
    return wasmExportsPromise;
  }

  wasmExportsPromise = (async () => {
    if (typeof WebAssembly === "undefined" || typeof fetch !== "function") {
      return null;
    }

    const response = await fetch(`./solver-core.wasm?v=${ASSET_VERSION}`);
    if (!response.ok) {
      return null;
    }

    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        now_ms: () => Date.now(),
      },
    });
    return instance.exports;
  })().catch(() => null);

  return wasmExportsPromise;
}

function encodeWasmRequest(data) {
  const pieceCounts = PIECE_SHAPES.map((shape) => Math.max(0, Math.floor(Number(data.pieceCounts[shape.pieceId] || 0))));
  const ints = new Int32Array(5 + pieceCounts.length + data.target.length);

  if (data.solverMode === "branch_and_bound") {
    ints[0] = 1;
  } else if (data.solverMode === "heuristic_fast") {
    ints[0] = 2;
  } else if (data.solverMode === "heuristic_pruned") {
    ints[0] = 3;
  } else if (data.solverMode === "heuristic_late_prune") {
    ints[0] = 4;
  } else {
    ints[0] = 0;
  }

  ints[1] = data.width;
  ints[2] = data.height;
  ints[3] = Math.max(1, Math.floor(Number(data.timeoutMs || 0)));
  ints[4] = data.target.length;

  pieceCounts.forEach((count, index) => {
    ints[5 + index] = count;
  });

  data.target.forEach((cell, index) => {
    ints[5 + pieceCounts.length + index] = cell;
  });

  return new Uint8Array(ints.buffer.slice(0));
}

function decodeWasmResult(bytes, startTime) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length % 4 !== 0) {
    return null;
  }

  const ints = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const statusCode = ints[0];
  const iterations = ints[1] || 0;
  const placementCount = ints[2] || 0;
  const placements = [];
  let cursor = 3;

  for (let index = 0; index < placementCount; index += 1) {
    const pieceIndex = ints[cursor];
    const cellCount = ints[cursor + 1];
    cursor += 2;

    const shape = PIECE_SHAPES[pieceIndex];
    if (!shape || cellCount <= 0 || cursor + cellCount > ints.length) {
      return null;
    }

    const cells = [];
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      cells.push(ints[cursor + cellIndex]);
    }
    cursor += cellCount;

    placements.push({
      pieceId: shape.pieceId,
      cells,
    });
  }

  if (statusCode === 1) {
    return {
      status: "ok",
      placements,
      startTime,
      iterations,
    };
  }

  if (statusCode === 2) {
    return {
      status: "timeout",
      message: "타임아웃",
      placements,
      startTime,
      iterations,
    };
  }

  if (statusCode === 3) {
    return {
      status: "progress",
      placements,
      startTime,
      iterations,
    };
  }

  return {
    status: "unsolved",
    message: "현재 설정으로는 배치를 찾지 못했습니다.",
    placements,
    startTime,
    iterations,
  };
}

function normalizeSolvedResult(result, target) {
  if (!result || result.status === "ok" || result.status === "cancelled") {
    return result;
  }

  if (!placementsExactlyCoverTarget(result.placements, target)) {
    return result;
  }

  return {
    ...result,
    status: "ok",
    message: undefined,
  };
}

function placementsExactlyCoverTarget(placements, target) {
  if (!Array.isArray(placements) || !Array.isArray(target) || target.length === 0) {
    return false;
  }

  const targetSet = new Set(target);
  const covered = new Set();

  for (const placement of placements) {
    if (!placement || !Array.isArray(placement.cells)) {
      return false;
    }

    for (const cell of placement.cells) {
      if (!targetSet.has(cell) || covered.has(cell)) {
        return false;
      }

      covered.add(cell);
    }
  }

  return covered.size === targetSet.size;
}

function getCellsFromShape(shape, targetValue = null) {
  const cells = [];

  for (let y = 0; y < shape.length; y += 1) {
    for (let x = 0; x < shape[y].length; x += 1) {
      const value = shape[y][x];
      if (targetValue === null ? value > 0 : value === targetValue) {
        cells.push([x, y]);
      }
    }
  }

  return cells;
}

function toIndex(row, col, width) {
  return row * width + col;
}

function indexToPoint(index, width) {
  return [index % width, Math.floor(index / width)];
}

function getProgressPlacements(data, placements = []) {
  const fixedPlacements = Array.isArray(data.fixedPlacements) ? data.fixedPlacements : [];
  return [...fixedPlacements, ...placements];
}

function postProgress({ statusMessage, startTime, iterations, placements }) {
  self.postMessage({
    type: "progress",
    statusMessage,
    elapsedMs: Date.now() - startTime,
    iterations,
    placements,
  });
}

function finish({ status, message, placements = [], startTime, iterations, engineLabel }) {
  self.postMessage({
    type: "done",
    status,
    message,
    placements,
    elapsedMs: Date.now() - startTime,
    iterations,
    engineLabel,
  });
}
