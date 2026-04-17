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

const ASSET_VERSION = "20260418-center-candidate-slicing-6";
const CENTER_CANDIDATE_BUDGETS_MS = [30000, 60000, 120000];

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
      message: "중앙 4칸 기준점 조건 탐색을 실행하지 못했습니다.",
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
    message: "탐색 엔진을 로드하지 못했습니다.",
    placements: [],
    startTime: Date.now(),
    iterations: 0,
    engineLabel: "WASM",
  });
}

function shouldUseWasmLiveSolver(data) {
  return (Boolean(data.liveSolve) || data.solverMode === "branch_and_bound" || Number(data.candidateBudgetMs || 0) > 0)
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

  const startTime = Date.now();
  const candidates = getCenterControlCandidates(data);
  if (!candidates.length) {
    return {
      result: {
        status: "unsolved",
        message: "중앙 4칸에 기준점을 둘 수 있는 블럭이 없습니다.",
        placements: [],
        startTime,
        iterations: 0,
      },
    };
  }

  postProgress({
    statusMessage: "중앙 기준점 조건 탐색 중",
    startTime,
    iterations: 0,
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
      if (target.length !== getTotalPieceCellCount(pieceCounts)) {
        continue;
      }
      if (hasImpossibleRemainingComponent(target, pieceCounts, data.width)) {
        continue;
      }
      if (data.liveSolve) {
        postProgress({
          statusMessage: `중앙 기준점 후보 탐색 중 (${passIndex + 1}회차)`,
          startTime,
          iterations: totalIterations,
          placements: [candidate],
        });
      }

      if (target.length === 0 && isValidCombinedPlacement([candidate], data.target, data.width, data.height)) {
        return {
          result: {
            status: "ok",
            placements: [candidate],
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
        fixedPlacements: [candidate],
        iterationOffset: totalIterations,
        startTimeOverride: startTime,
        requireCenterControl: false,
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

      const placements = [candidate, ...result.placements];
      if (!isValidCombinedPlacement(placements, data.target, data.width, data.height)) {
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
          message: "중앙 4칸 기준점 조건을 만족하는 배치를 찾지 못했습니다.",
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
      message: timedOut ? "타임아웃" : "중앙 4칸 기준점 조건을 만족하는 배치를 찾지 못했습니다.",
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
    statusMessage: data.liveSolve ? "실시간 탐색 중" : "탐색 중",
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
            message: "중앙 기준점 후보 시간 초과",
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
          statusMessage: data.liveSolve ? "실시간 탐색 중" : "탐색 중",
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
          message: "중앙 기준점 후보 시간 초과",
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
        message: "탐색 엔진 실행 중 오류가 발생했습니다.",
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
    statusMessage: "탐색 중",
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
        message: "탐색 엔진 실행 중 오류가 발생했습니다.",
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
