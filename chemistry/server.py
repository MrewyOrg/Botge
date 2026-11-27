"""CPU-only FastAPI sidecar running RDKit organic reactions for Botge."""

import os
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Annotated, Final, Literal, Self

from atlas import ATLAS_SIZE
from engine import (
    MAX_BASE_POOL,
    MAX_OVERLAY_POOL,
    MIN_BASE_POOL,
    MIN_OVERLAY_POOL,
    ChemistryEngine,
    PoolTarget,
    ReactedOutcome,
)
from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

MAX_EXCLUDED_INDICES: Final[int] = 2

_EXPLICIT_CONDITIONS: Final[dict[str, Literal['heat', 'acid', 'base', 'palladium']]] = {
    'heat': 'heat',
    'acid': 'acid',
    'base': 'base',
    'palladium': 'palladium',
}


class ReactRequest(BaseModel):
    """Validated JSON payload for `POST /v1/react`."""

    model_config = ConfigDict(frozen=True, extra='forbid')

    reactant_a: Annotated[StrictInt, Field(ge=0, lt=ATLAS_SIZE)]
    reactant_b: Annotated[StrictInt, Field(ge=0, lt=ATLAS_SIZE)]
    condition: Literal['auto', 'heat', 'acid', 'base', 'palladium'] = 'auto'
    base_pool_size: Annotated[StrictInt, Field(ge=MIN_BASE_POOL, le=MAX_BASE_POOL)]
    overlay_pool_size: Annotated[StrictInt, Field(ge=MIN_OVERLAY_POOL, le=MAX_OVERLAY_POOL)]
    exclude_base_indices: tuple[Annotated[StrictInt, Field(ge=0)], ...] = ()
    include_diagram: StrictBool = True

    @model_validator(mode='after')
    def check_exclusions(self) -> Self:
        """Ensure excluded base indices are bounded in count and within `[0, base_pool_size)`."""
        if len(self.exclude_base_indices) > MAX_EXCLUDED_INDICES:
            msg = f'At most {MAX_EXCLUDED_INDICES} base indices may be excluded'
            raise ValueError(msg)
        for index in self.exclude_base_indices:
            if index >= self.base_pool_size:
                msg = f'Excluded base index {index} >= base_pool_size {self.base_pool_size}'
                raise ValueError(msg)
        return self


class ReactedResponse(BaseModel):
    """JSON payload returned by `POST /v1/react` when a reaction succeeds."""

    model_config = ConfigDict(frozen=True)

    outcome: Literal['reacted'] = 'reacted'
    reaction_id: str
    reaction_name: str
    condition_used: Literal['heat', 'acid', 'base', 'palladium']
    substrate_a_name: str
    substrate_b_name: str
    product_smiles: str
    product_formula: str
    product_mw: float
    inchi_key: str
    base_index: int
    overlay_index: int
    diagram_png_b64: str | None = None


class NoReactionResponse(BaseModel):
    """JSON payload returned by `POST /v1/react` when substrates are incompatible."""

    model_config = ConfigDict(frozen=True)

    outcome: Literal['no_reaction'] = 'no_reaction'
    substrate_a_name: str
    substrate_a_group: str
    substrate_b_name: str
    substrate_b_group: str
    reason: str
    hint_condition: Literal['heat', 'acid', 'base', 'palladium'] | None = None
    hint_reaction: str | None = None


class HealthResponse(BaseModel):
    """JSON payload returned by `GET /healthz`."""

    model_config = ConfigDict(frozen=True)

    status: Literal['ok'] = 'ok'
    backend: Literal['rdkit-cpu'] = 'rdkit-cpu'


def verify_bearer(authorization: str | None, expected_secret: str) -> None:
    """Enforce optional constant-time Bearer token authorization."""
    if not expected_secret:
        return
    expected_header = f'Bearer {expected_secret}'
    if not secrets.compare_digest(authorization or '', expected_header):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='unauthorized')


def _evaluate(
    engine: ChemistryEngine,
    payload: ReactRequest,
    lock: threading.Lock,
) -> ReactedResponse | NoReactionResponse:
    """Execute one reaction under `lock` and convert the domain result to HTTP JSON."""
    with lock:
        result = engine.react(
            payload.reactant_a,
            payload.reactant_b,
            payload.condition,
            PoolTarget(
                base_pool_size=payload.base_pool_size,
                overlay_pool_size=payload.overlay_pool_size,
                exclude_base_indices=payload.exclude_base_indices,
                include_diagram=payload.include_diagram,
            ),
        )
    if isinstance(result, ReactedOutcome):
        return ReactedResponse(
            reaction_id=result.reaction_id,
            reaction_name=result.reaction_name,
            condition_used=_EXPLICIT_CONDITIONS[result.condition_used],
            substrate_a_name=result.substrate_a_name,
            substrate_b_name=result.substrate_b_name,
            product_smiles=result.product_smiles,
            product_formula=result.product_formula,
            product_mw=result.product_mw,
            inchi_key=result.inchi_key,
            base_index=result.base_index,
            overlay_index=result.overlay_index,
            diagram_png_b64=result.diagram_png_b64,
        )
    hint_condition = (
        _EXPLICIT_CONDITIONS[result.hint_condition] if result.hint_condition is not None else None
    )
    return NoReactionResponse(
        substrate_a_name=result.substrate_a_name,
        substrate_a_group=result.substrate_a_group,
        substrate_b_name=result.substrate_b_name,
        substrate_b_group=result.substrate_b_group,
        reason=result.reason,
        hint_condition=hint_condition,
        hint_reaction=result.hint_reaction,
    )


def create_app(*, secret: str | None = None) -> FastAPI:
    """Construct the FastAPI chemistry sidecar application."""
    configured_secret = (
        os.environ.get('BOTGE_CHEMISTRY_SECRET', '') if secret is None else secret
    ).strip()
    engine_holder: list[ChemistryEngine] = []
    executor_holder: list[ThreadPoolExecutor] = []
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        """Compile RDKit templates on startup and shut down the worker cleanly."""
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='rdkit-worker')
        engine_holder.append(ChemistryEngine())
        executor_holder.append(executor)
        try:
            yield
        finally:
            executor.shutdown(wait=True)
            executor_holder.clear()
            engine_holder.clear()

    application = FastAPI(title='Botge Chemistry Sidecar', version='1.0.0', lifespan=lifespan)

    @application.get('/healthz')
    def healthz() -> HealthResponse:
        """Report sidecar liveness and RDKit CPU backend status."""
        return HealthResponse()

    @application.post('/v1/react', response_model=ReactedResponse | NoReactionResponse)
    def react(
        payload: ReactRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> ReactedResponse | NoReactionResponse:
        """Evaluate one bimolecular reaction and return projected emote indices."""
        verify_bearer(authorization, configured_secret)
        if not engine_holder or not executor_holder:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail='chemistry engine not initialized',
            )
        return executor_holder[0].submit(_evaluate, engine_holder[0], payload, lock).result()

    return application


app = create_app()
