"""Offline and Q#-backed unit tests for the Botge quantum sidecar."""

import os
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from enum import IntEnum
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast, override

from fastapi.testclient import TestClient

if TYPE_CHECKING:
    from collections.abc import Generator, Mapping

    from fastapi import FastAPI

QUANTUM_DIR = Path(__file__).resolve().parent.parent
if str(QUANTUM_DIR) not in sys.path:
    sys.path.insert(0, str(QUANTUM_DIR))

import server  # noqa: E402 - The sidecar module lives in the parent quantum directory.


class ApiResponse(Protocol):
    """Typed HTTP response surface returned by TestClient."""

    status_code: int
    text: str

    def json(self) -> dict[str, object]:
        """Decode the JSON response body."""
        raise NotImplementedError


class ApiClient(Protocol):
    """Typed HTTP client surface wrapping FastAPI's TestClient."""

    def get(self, url: str) -> ApiResponse:
        """Send an HTTP GET request."""
        raise NotImplementedError

    def post(
        self,
        url: str,
        *,
        json: object = None,
        headers: Mapping[str, str] | None = None,
    ) -> ApiResponse:
        """Send an HTTP POST request."""
        raise NotImplementedError


@contextmanager
def client_for(app: FastAPI, *, raise_server_exceptions: bool = True) -> Generator[ApiClient]:
    """Open a typed TestClient context managing FastAPI lifespan startup and shutdown."""
    with TestClient(app, raise_server_exceptions=raise_server_exceptions) as raw_client:
        yield cast('ApiClient', cast('object', raw_client))


class FakeResult(IntEnum):
    """Stands in for `qsharp.Result`, including the `Loss` variant."""

    Zero = 0
    One = 1
    Loss = 2


def register(index: int, width: int) -> list[object]:
    """Encode `index` as a little-endian list of `FakeResult` values."""
    return [FakeResult.One if (index >> bit) & 1 else FakeResult.Zero for bit in range(width)]


def shot(base_index: int, base_bits: int, overlay_index: int, overlay_bits: int) -> object:
    """Build one raw `EntangleStack` shot `(Result[], Result[])`."""
    return (register(base_index, base_bits), register(overlay_index, overlay_bits))


class StubRunner:
    """Deterministic shot runner for testing rejection sampling, errors, and locking."""

    result_type: type = FakeResult

    def __init__(
        self,
        batches: list[object],
        *,
        delay_seconds: float = 0.0,
    ) -> None:
        """Initialize a stub with scripted batch results and concurrency tracking."""
        self.batches = list(batches)
        self.delay_seconds = delay_seconds
        self.calls: list[tuple[int, int, int, int]] = []
        self.initialized = 0
        self.closed = 0
        self.active = 0
        self.max_active = 0
        self._state_lock = threading.Lock()

    def initialize(self) -> None:
        """Count lifespan initialization calls."""
        self.initialized += 1

    def close(self) -> None:
        """Count lifespan shutdown calls."""
        self.closed += 1

    def run_entangle(self, shots: int, base_bits: int, overlay_bits: int, steps: int) -> object:
        """Track concurrency overlap and return the next scripted batch."""
        with self._state_lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.calls.append((shots, base_bits, overlay_bits, steps))
        try:
            if self.delay_seconds > 0.0:
                time.sleep(self.delay_seconds)
            if len(self.batches) > 1:
                return self.batches.pop(0)
            return self.batches[0]
        finally:
            with self._state_lock:
                self.active -= 1


class SidecarApiTests(unittest.TestCase):
    """Exercise health, auth, validation, sampling, and concurrency serialization."""

    live_runner: server.QSharpEntangleRunner
    lazy_sample: object

    @override
    @classmethod
    def setUpClass(cls) -> None:
        """Lazily initialize the shared CPU Q# engine once for live simulation tests."""
        cls.live_runner = server.QSharpEntangleRunner()
        cls.lazy_sample = cls.live_runner.run_entangle(1, 1, 1, 1)

    @override
    @classmethod
    def tearDownClass(cls) -> None:
        """Shut down the shared Q# worker thread cleanly."""
        cls.live_runner.close()

    def test_healthz_succeeds_with_and_without_secret(self) -> None:
        """GET /healthz returns CPU status without requiring auth."""
        for configured in ('', 'fixture-auth-value'):
            app = server.create_app(secret=configured, runner=StubRunner([[]]))
            with client_for(app) as client:
                response = client.get('/healthz')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'status': 'ok', 'backend': 'cpu'})

    def test_qdk_telemetry_is_disabled_after_initialization(self) -> None:
        """Initializing the real Q# runner sets QDK_PYTHON_TELEMETRY=none and binds Result."""
        self.assertIsInstance(self.lazy_sample, list)
        self.assertEqual(os.environ.get('QDK_PYTHON_TELEMETRY'), 'none')
        self.live_runner.initialize()
        self.assertEqual(self.live_runner.result_type.__name__, 'Result')

    def test_uninitialized_runner_has_no_result_type(self) -> None:
        """Reading the result type before initialization fails instead of guessing."""
        with self.assertRaisesRegex(RuntimeError, 'not initialized'):
            _ = server.QSharpEntangleRunner().result_type

    def test_bearer_authentication_enforcement(self) -> None:
        """Verify 401 on missing/invalid tokens and 200 on matching Bearer tokens."""
        stub = StubRunner([[shot(1, 2, 0, 1)]])
        auth_value = 'alpha-' + 'bearer-fixture'
        app = server.create_app(secret=auth_value, runner=stub)
        with client_for(app) as client:
            for headers in (
                {},
                {'Authorization': 'Basic YWxwaGEtYmVhcmVyLWZpeHR1cmU='},
                {'Authorization': 'Bearer wrong-value'},
            ):
                resp = client.post(
                    '/v1/entangle',
                    json={'base_pool_size': 4, 'overlay_pool_size': 2},
                    headers=headers,
                )
                self.assertEqual(resp.status_code, 401)
                self.assertEqual(resp.json(), {'detail': 'unauthorized'})

            ok = client.post(
                '/v1/entangle',
                json={'base_pool_size': 4, 'overlay_pool_size': 2, 'steps': 3},
                headers={'Authorization': f'Bearer {auth_value}'},
            )
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(
                ok.json(),
                {'mode': 'entangle', 'qubits': 3, 'base_index': 1, 'overlay_index': 0},
            )
        self.assertEqual(stub.calls, [(1, 2, 1, 3)])

    def test_secret_ignores_surrounding_whitespace(self) -> None:
        """A padded secret matches its trimmed token, and a blank one disables authentication."""
        body = {'base_pool_size': 4, 'overlay_pool_size': 2}
        token = 'alpha-' + 'padded-fixture'
        padded_secret, blank_secret = f' {token}\n', ' ' + '\t'
        padded = server.create_app(secret=padded_secret, runner=StubRunner([[shot(1, 2, 0, 1)]]))
        with client_for(padded) as client:
            resp = client.post(
                '/v1/entangle', json=body, headers={'Authorization': f'Bearer {token}'}
            )
            self.assertEqual(resp.status_code, 200)
        blank = server.create_app(secret=blank_secret, runner=StubRunner([[shot(1, 2, 0, 1)]]))
        with client_for(blank) as client:
            self.assertEqual(client.post('/v1/entangle', json=body).status_code, 200)

    def test_qubit_widths_follow_the_register_sizing(self) -> None:
        """`n = ceil(log2 M)`, with both 16-qubit maxima at the piecewise domain caps."""
        self.assertEqual(server.qubit_widths(2, 2), (1, 1, 2))
        self.assertEqual(server.qubit_widths(3, 5), (2, 3, 5))
        self.assertEqual(server.qubit_widths(512, 128), (9, 7, 16))
        self.assertEqual(server.qubit_widths(1024, 64), (10, 6, 16))
        self.assertEqual(server.qubit_widths(513, 65), (10, 7, 17))

    def test_request_validation_and_qubit_budget_cap(self) -> None:
        """Reject invalid bounds, boolean ints, extra fields, and >16-qubit requests with 422."""
        app = server.create_app(secret='', runner=StubRunner([[shot(0, 1, 0, 1)]]))
        invalid_payloads: tuple[dict[str, object], ...] = (
            {'base_pool_size': 1, 'overlay_pool_size': 2},
            {'base_pool_size': 2, 'overlay_pool_size': 1},
            {'base_pool_size': 1025, 'overlay_pool_size': 2},
            {'base_pool_size': 4, 'overlay_pool_size': 129},
            {'base_pool_size': 4, 'overlay_pool_size': 2, 'steps': 0},
            {'base_pool_size': 4, 'overlay_pool_size': 2, 'steps': 7},
            {'base_pool_size': True, 'overlay_pool_size': 2},
            {'base_pool_size': 4, 'overlay_pool_size': True},
            {'base_pool_size': 4, 'overlay_pool_size': 2, 'steps': True},
            {'base_pool_size': 4, 'overlay_pool_size': 2, 'extra': 1},
            {'base_pool_size': 4},
            # n_b = 10 and n_o = 7: 17 qubits exceed the 16-qubit budget.
            {'base_pool_size': 513, 'overlay_pool_size': 65},
            {'base_pool_size': 1024, 'overlay_pool_size': 65},
        )
        with client_for(app) as client:
            for payload in invalid_payloads:
                with self.subTest(payload=payload):
                    response = client.post('/v1/entangle', json=payload)
                    self.assertEqual(response.status_code, 422, response.text)

    def test_live_qsharp_samples_in_pool_indices(self) -> None:
        """Sample on the real Base-profile Q# runner, including both 16-qubit maxima."""
        app = server.create_app(secret='', runner=self.live_runner)
        cases: tuple[tuple[int, int, int], ...] = (
            (2, 2, 2),
            (3, 3, 4),
            (5, 100, 10),
            (512, 128, 16),
            (1024, 64, 16),
        )
        with client_for(app) as client:
            for base_size, overlay_size, expected_qubits in cases:
                with self.subTest(base=base_size, overlay=overlay_size):
                    response = client.post(
                        '/v1/entangle',
                        json={
                            'base_pool_size': base_size,
                            'overlay_pool_size': overlay_size,
                            'steps': 3,
                        },
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    body = response.json()
                    self.assertEqual(set(body), {'mode', 'qubits', 'base_index', 'overlay_index'})
                    self.assertEqual(body['mode'], 'entangle')
                    self.assertEqual(body['qubits'], expected_qubits)
                    base_idx = body['base_index']
                    overlay_idx = body['overlay_index']
                    self.assertIsInstance(base_idx, int)
                    self.assertIsInstance(overlay_idx, int)
                    if isinstance(base_idx, int) and isinstance(overlay_idx, int):
                        self.assertIn(base_idx, range(base_size))
                        self.assertIn(overlay_idx, range(overlay_size))

    def test_rejection_sampling_accepts_the_second_single_shot(self) -> None:
        """Reject an out-of-pool shot, then accept the next single shot."""
        stub = StubRunner([[shot(3, 2, 1, 2)], [shot(2, 2, 1, 2)]])
        app = server.create_app(secret='', runner=stub)
        with client_for(app) as client:
            response = client.post(
                '/v1/entangle',
                json={'base_pool_size': 3, 'overlay_pool_size': 3, 'steps': 4},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {'mode': 'entangle', 'qubits': 4, 'base_index': 2, 'overlay_index': 1},
        )
        self.assertEqual(stub.calls, [(1, 2, 2, 4)] * 2)

    def test_rejection_checks_the_overlay_pool(self) -> None:
        """An in-pool base with an out-of-pool overlay is rejected too."""
        stub = StubRunner([[shot(0, 2, 3, 2)], [shot(0, 2, 2, 2)]])
        app = server.create_app(secret='', runner=stub)
        with client_for(app) as client:
            response = client.post(
                '/v1/entangle',
                json={'base_pool_size': 4, 'overlay_pool_size': 3},
            )
        self.assertEqual(response.json()['overlay_index'], 2)
        self.assertEqual(len(stub.calls), 2)

    def test_rejection_sampling_exhaustion_returns_503(self) -> None:
        """Return HTTP 503 after MAX_BATCHES single-shot trials fail acceptance."""
        stub = StubRunner([[shot(7, 3, 0, 1)]])
        app = server.create_app(secret='', runner=stub)
        with client_for(app) as client:
            response = client.post(
                '/v1/entangle',
                json={'base_pool_size': 5, 'overlay_pool_size': 2},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'detail': 'rejection sampling budget exhausted'})
        self.assertEqual(len(stub.calls), server.MAX_BATCHES)
        self.assertEqual(server.MAX_BATCHES, 256)
        self.assertTrue(all(call[0] == server.BATCH_SHOTS == 1 for call in stub.calls))

    def test_lock_serializes_concurrent_entangle_requests(self) -> None:
        """Concurrent POST /v1/entangle requests never enter the Q# runner simultaneously."""
        stub = StubRunner([[shot(0, 1, 1, 1)]], delay_seconds=0.05)
        app = server.create_app(secret='', runner=stub)
        with client_for(app) as client:

            def invoke(_idx: int) -> int:
                return client.post(
                    '/v1/entangle',
                    json={'base_pool_size': 2, 'overlay_pool_size': 2},
                ).status_code

            with ThreadPoolExecutor(max_workers=4) as pool:
                statuses = list(pool.map(invoke, range(4)))

        self.assertEqual(statuses, [200, 200, 200, 200])
        self.assertEqual(stub.max_active, 1)
        self.assertEqual(stub.closed, 1)

    def test_decoder_reads_little_endian_registers(self) -> None:
        """Bit `j` of a register carries weight `2^j`."""
        one, zero = FakeResult.One, FakeResult.Zero
        self.assertEqual(server.decode_register([one, zero, zero], 3, FakeResult), 1)
        self.assertEqual(server.decode_register([zero, zero, one], 3, FakeResult), 4)
        self.assertEqual(server.decode_register(register(1023, 10), 10, FakeResult), 1023)
        self.assertEqual(server.decode_shot(shot(5, 3, 6, 3), 3, 3, FakeResult), (5, 6))

    def test_decoder_rejects_malformed_results(self) -> None:
        """Reject non-pairs, wrong widths, `bool`/`int` look-alikes, and `Loss`."""
        type_errors: tuple[object, ...] = (
            [register(0, 1), register(0, 1)],
            ('not-a-list', register(0, 1)),
            ([True], register(0, 1)),
            ([1], register(0, 1)),
            (register(0, 1), [0]),
        )
        for bad in type_errors:
            with self.subTest(bad=bad), self.assertRaises(TypeError):
                server.decode_shot(bad, 1, 1, FakeResult)

        value_errors: tuple[object, ...] = (
            (register(0, 1),),
            (register(0, 1), register(0, 1), register(0, 1)),
            (register(0, 2), register(0, 1)),
            (register(0, 1), register(0, 0)),
            ([FakeResult.Loss], register(0, 1)),
        )
        for bad in value_errors:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                server.decode_shot(bad, 1, 1, FakeResult)

        bad_batch_app = server.create_app(secret='', runner=StubRunner(['not-a-list']))
        with client_for(bad_batch_app) as client, self.assertRaises(TypeError):
            client.post('/v1/entangle', json={'base_pool_size': 2, 'overlay_pool_size': 2})


if __name__ == '__main__':
    unittest.main()
