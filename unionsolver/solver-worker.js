const PIECE_SHAPES = [
  { pieceId: "lv200_warrior" },
  { pieceId: "lv200_bowman" },
  { pieceId: "lv200_thief" },
  { pieceId: "lv200_magician" },
  { pieceId: "lv200_pirate" },
  { pieceId: "lv250_warrior" },
  { pieceId: "lv250_bowman" },
  { pieceId: "lv250_thief" },
  { pieceId: "lv250_magician" },
  { pieceId: "lv250_pirate" },
  { pieceId: "lv250_xenon" },
];

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
  return Boolean(data.liveSolve)
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

async function solveWithWasmLive(data) {
  if (!shouldUseWasmLiveSolver(data) || cancelled) {
    return null;
  }

  const wasmExports = await getWasmExports();
  if (!wasmExports || typeof wasmExports.start_live_solve !== "function" || typeof wasmExports.resume_live_solve !== "function") {
    return null;
  }

  const startTime = Date.now();
  const liveBatchSize = getLiveBatchSize(data.solverMode);
  let lastProgressAt = startTime;
  let lastProgressIterations = 0;

  postProgress({
    statusMessage: "실시간 탐색 중",
    startTime,
    iterations: 0,
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
      if (
        result.iterations - lastProgressIterations >= liveBatchSize
        && now - lastProgressAt >= 100
      ) {
        postProgress({
          statusMessage: "실시간 탐색 중",
          startTime,
          iterations: result.iterations,
          placements: result.placements,
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
            placements: result.placements,
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

    const response = await fetch("./solver-core.wasm");
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
