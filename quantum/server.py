"""CPU-only FastAPI sidecar sampling Botge's Q# Ising-Rx circuit under `TargetProfile.Base`."""

import gc
import os
import secrets
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Final, Literal, Protocol, Self, SupportsInt, cast

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable

# Single-shot rejection sampling (`thm:rejection`): p_A > 1/4, so 256 trials fail with
# probability below (3/4)^256 < 1.05e-32.
BATCH_SHOTS: Final[int] = 1
MAX_BATCHES: Final[int] = 256
MAX_QUBITS: Final[int] = 16
MIN_POOL_SIZE: Final[int] = 2
MAX_BASE_POOL_SIZE: Final[int] = 1024
MAX_OVERLAY_POOL_SIZE: Final[int] = 128
MAX_STEPS: Final[int] = 6
DEFAULT_STEPS: Final[int] = 3
REGISTER_COUNT: Final[int] = 2
QUANTUM_ROOT: Final[Path] = Path(__file__).resolve().parent


def qubit_widths(base_pool_size: int, overlay_pool_size: int) -> tuple[int, int, int]:
    """Compute `(n_b, n_o, n_b + n_o)` with `n = ceil(log2 M)` for pool sizes `M >= 2`."""
    base_bits = (base_pool_size - 1).bit_length()
    overlay_bits = (overlay_pool_size - 1).bit_length()
    return base_bits, overlay_bits, base_bits + overlay_bits


class EntangleRequest(BaseModel):
    """Validated JSON payload for `POST /v1/entangle`."""

    model_config = ConfigDict(frozen=True, extra='forbid')

    base_pool_size: Annotated[StrictInt, Field(ge=MIN_POOL_SIZE, le=MAX_BASE_POOL_SIZE)]
    overlay_pool_size: Annotated[StrictInt, Field(ge=MIN_POOL_SIZE, le=MAX_OVERLAY_POOL_SIZE)]
    steps: Annotated[StrictInt, Field(ge=1, le=MAX_STEPS)] = DEFAULT_STEPS

    @model_validator(mode='after')
    def enforce_qubit_budget(self) -> Self:
        """Reject pool pairs whose circuit needs more than 16 qubits (`prop:budget`)."""
        _, _, total_qubits = qubit_widths(self.base_pool_size, self.overlay_pool_size)
        if total_qubits > MAX_QUBITS:
            msg = f'Circuit width {total_qubits} exceeds {MAX_QUBITS}-qubit limit'
            raise ValueError(msg)
        return self


class EntangleResponse(BaseModel):
    """JSON payload returned by `POST /v1/entangle`."""

    model_config = ConfigDict(frozen=True)

    mode: Literal['entangle'] = 'entangle'
    qubits: int
    base_index: int
    overlay_index: int


class HealthResponse(BaseModel):
    """JSON payload returned by `GET /healthz`."""

    model_config = ConfigDict(frozen=True)

    status: Literal['ok'] = 'ok'
    backend: Literal['cpu'] = 'cpu'


class ShotRunner(Protocol):
    """Abstraction over Q# shot execution for testing and production."""

    @property
    def result_type(self) -> type:
        """The measurement result class the runner returns, such as `qsharp.Result`."""
        raise NotImplementedError

    def initialize(self) -> None:
        """Warm up the underlying simulator runtime before serving requests."""

    def run_entangle(self, shots: int, base_bits: int, overlay_bits: int, steps: int) -> object:
        """Execute `shots` of `EntangleStack` and return raw shot results."""

    def close(self) -> None:
        """Release any thread or simulator resources held by the runner."""


class QSharpEntangleRunner:
    """Thread-affine CPU-only Q# runner backed by `qdk.code.BotgeQuantum.EntangleStack`.

    PyO3 marks QDK's native `Interpreter` as unsendable across Python threads, so
    initialization and all `qsharp.run` calls execute on a dedicated single worker thread.
    """

    def __init__(self, project_root: Path = QUANTUM_ROOT) -> None:
        """Prepare an uninitialized runner bound to `project_root`."""
        self._project_root = project_root
        self._executor: ThreadPoolExecutor | None = None
        self._run_fn: Callable[..., object] | None = None
        self._callable: object | None = None
        self._result_type: type | None = None

    @property
    def result_type(self) -> type:
        """Return `qsharp.Result` once the runner is initialized."""
        if self._result_type is None:
            msg = 'Q# runner is not initialized'
            raise RuntimeError(msg)
        return self._result_type

    def _get_executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='qdk-worker')
        return self._executor

    def _init_on_worker(self) -> tuple[Callable[..., object], object]:
        if self._run_fn is not None and self._callable is not None:
            return self._run_fn, self._callable
        os.environ['QDK_PYTHON_TELEMETRY'] = 'none'
        from qdk import qsharp  # noqa: PLC0415  # pyright: ignore[reportMissingTypeStubs]

        qsharp.init(
            project_root=str(self._project_root),
            target_profile=qsharp.TargetProfile.Base,
        )
        from qdk.code.BotgeQuantum import (  # noqa: PLC0415  # pyright: ignore[reportMissingImports]
            EntangleStack,  # pyright: ignore[reportUnknownVariableType]
        )

        self._run_fn = cast(
            'Callable[..., object]',
            qsharp.run,  # pyright: ignore[reportUnknownMemberType]
        )
        self._callable = cast('object', EntangleStack)
        self._result_type = cast('type', qsharp.Result)
        return self._run_fn, self._callable

    def _run_on_worker(self, shots: int, base_bits: int, overlay_bits: int, steps: int) -> object:
        run_fn, callable_obj = self._init_on_worker()
        return run_fn(callable_obj, shots, base_bits, overlay_bits, steps)

    def _reset_on_worker(self) -> None:
        self._run_fn = None
        self._callable = None
        interp_mod = sys.modules.get('qdk._interpreter')
        if interp_mod is not None:
            clear_code = interp_mod.__dict__.get('_clear_code_module')
            if callable(clear_code):
                clear_code()
            interp_mod.__dict__['_default_context'] = None
        gc.collect()

    def initialize(self) -> None:
        """Disable QDK telemetry, initialize `qsharp` under Base, and bind `EntangleStack` once."""
        self._get_executor().submit(self._init_on_worker).result()

    def run_entangle(self, shots: int, base_bits: int, overlay_bits: int, steps: int) -> object:
        """Invoke `qsharp.run(EntangleStack, ...)` on the Q# worker thread."""
        return (
            self._get_executor()
            .submit(self._run_on_worker, shots, base_bits, overlay_bits, steps)
            .result()
        )

    def close(self) -> None:
        """Release Q# handles on the worker thread and shut down the executor."""
        if self._executor is not None:
            self._executor.submit(self._reset_on_worker).result()
            self._executor.shutdown(wait=True)
            self._executor = None


def decode_register(raw: object, width: int, result_type: type) -> int:
    """Decode one measured register, least significant bit first, into an index.

    Only exact `result_type` instances count: `bool`, `int`, and other values equal to a
    result are rejected, and so is any variant other than `Zero` (0) and `One` (1), such as
    `Loss`.

    Raises:
        TypeError: The register is not a list of `result_type` values.
        ValueError: The register has the wrong width or a result other than `Zero` or `One`.

    """
    if not isinstance(raw, list):
        msg = 'Unexpected Q# register payload type'
        raise TypeError(msg)
    items = cast('list[object]', raw)
    if len(items) != width:
        msg = f'Expected {width} Q# results, got {len(items)}'
        raise ValueError(msg)
    index = 0
    for position, item in enumerate(items):
        if type(item) is not result_type or not isinstance(item, SupportsInt):
            msg = 'Unexpected Q# result type'
            raise TypeError(msg)
        bit = int(item)
        if bit not in {0, 1}:
            msg = 'Unexpected Q# result variant'
            raise ValueError(msg)
        index |= bit << position
    return index


def decode_shot(
    raw: object,
    base_bits: int,
    overlay_bits: int,
    result_type: type,
) -> tuple[int, int]:
    """Decode a raw `EntangleStack` shot `(Result[], Result[])` into `(base, overlay)` indices.

    Raises:
        TypeError: The shot is not a tuple, or a register fails `decode_register`.
        ValueError: The shot is not a pair, or a register fails `decode_register`.

    """
    if not isinstance(raw, tuple):
        msg = 'Unexpected Q# shot payload type'
        raise TypeError(msg)
    registers = cast('tuple[object, ...]', raw)
    if len(registers) != REGISTER_COUNT:
        msg = 'Unexpected Q# shot payload length'
        raise ValueError(msg)
    base_raw, overlay_raw = registers
    return (
        decode_register(base_raw, base_bits, result_type),
        decode_register(overlay_raw, overlay_bits, result_type),
    )


def verify_bearer(authorization: str | None, expected_secret: str) -> None:
    """Enforce optional constant-time Bearer token authorization."""
    if not expected_secret:
        return
    expected_header = f'Bearer {expected_secret}'
    if not secrets.compare_digest(authorization or '', expected_header):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='unauthorized')


def sample_entangle(
    request: EntangleRequest,
    runner: ShotRunner,
    lock: threading.Lock,
) -> EntangleResponse:
    """Rejection-sample one in-pool `EntangleStack` shot under a process-wide lock.

    Each trial is a single shot; the first with `base < M_b` and `overlay < M_o` is returned, so
    accepted pairs keep their Born probability ratios (`eq:cond-law`). There is no classical
    fallback: after `MAX_BATCHES` rejected trials the request fails with HTTP 503.
    """
    base_bits, overlay_bits, total_qubits = qubit_widths(
        request.base_pool_size,
        request.overlay_pool_size,
    )
    with lock:
        result_type = runner.result_type
        for _ in range(MAX_BATCHES):
            batch = runner.run_entangle(BATCH_SHOTS, base_bits, overlay_bits, request.steps)
            if not isinstance(batch, list):
                msg = 'Expected list of shots from Q# runner'
                raise TypeError(msg)
            for raw_shot in cast('list[object]', batch):
                base_idx, overlay_idx = decode_shot(raw_shot, base_bits, overlay_bits, result_type)
                if base_idx < request.base_pool_size and overlay_idx < request.overlay_pool_size:
                    return EntangleResponse(
                        qubits=total_qubits,
                        base_index=base_idx,
                        overlay_index=overlay_idx,
                    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail='rejection sampling budget exhausted',
    )


def create_app(
    *,
    secret: str | None = None,
    runner: ShotRunner | None = None,
) -> FastAPI:
    """Construct the FastAPI sidecar application."""
    # Surrounding whitespace is ignored, as the bot ignores it, so a blank value disables auth.
    configured_secret = (
        os.environ.get('BOTGE_QUANTUM_SECRET', '') if secret is None else secret
    ).strip()
    active_runner: ShotRunner = QSharpEntangleRunner() if runner is None else runner
    run_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        """Initialize the Q# runtime on startup and release its worker on shutdown."""
        with run_lock:
            active_runner.initialize()
        try:
            yield
        finally:
            with run_lock:
                active_runner.close()

    application = FastAPI(title='Botge Quantum Sidecar', version='2.0.0', lifespan=lifespan)

    @application.get('/healthz')
    def healthz() -> HealthResponse:
        """Report sidecar liveness and CPU backend status."""
        return HealthResponse()

    @application.post('/v1/entangle')
    def entangle(
        payload: EntangleRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> EntangleResponse:
        """Sample an entangled base and overlay emote index pair."""
        verify_bearer(authorization, configured_secret)
        return sample_entangle(payload, active_runner, run_lock)

    return application


app = create_app()
