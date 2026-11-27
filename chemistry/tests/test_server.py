"""Offline and RDKit-backed HTTP tests for the Botge chemistry sidecar."""

import base64
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from fastapi.testclient import TestClient

if TYPE_CHECKING:
    from collections.abc import Generator, Mapping

    from fastapi import FastAPI

CHEMISTRY_DIR = Path(__file__).resolve().parent.parent
if str(CHEMISTRY_DIR) not in sys.path:
    sys.path.insert(0, str(CHEMISTRY_DIR))

import server  # noqa: E402


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


class ServerTests(unittest.TestCase):
    """Verify `/healthz`, `/v1/react` validation, auth, outcomes, and concurrency."""

    def test_healthz_and_reacted_with_diagram(self) -> None:
        """Health endpoint reports rdkit-cpu and reaction endpoint returns PNG + indices."""
        with client_for(server.create_app(secret='')) as client:
            health = client.get('/healthz')
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json(), {'status': 'ok', 'backend': 'rdkit-cpu'})

            res = client.post(
                '/v1/react',
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'condition': 'heat',
                    'base_pool_size': 16,
                    'overlay_pool_size': 8,
                    'exclude_base_indices': [0, 1],
                    'include_diagram': True,
                },
            )
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body['outcome'], 'reacted')
            self.assertEqual(body['reaction_id'], 'diels_alder')
            self.assertNotIn(body['base_index'], (0, 1))
            b64 = cast('str', body['diagram_png_b64'])
            self.assertTrue(base64.b64decode(b64, validate=True).startswith(b'\x89PNG\r\n\x1a\n'))

    def test_all_conditions_and_no_reaction_hints(self) -> None:
        """Every condition branch serializes cleanly and wrong conditions return hints."""
        with client_for(server.create_app(secret='')) as client:
            for a, b, cond in (
                (8, 11, 'acid'),
                (22, 16, 'base'),
                (26, 28, 'palladium'),
            ):
                res = client.post(
                    '/v1/react',
                    json={
                        'reactant_a': a,
                        'reactant_b': b,
                        'condition': cond,
                        'base_pool_size': 8,
                        'overlay_pool_size': 4,
                        'include_diagram': False,
                    },
                )
                self.assertEqual(res.status_code, 200)
                body = res.json()
                self.assertEqual(body['outcome'], 'reacted')
                self.assertEqual(body['condition_used'], cond)
                self.assertIsNone(body['diagram_png_b64'])

            # Incompatible under acid, hints palladium.
            hinted = client.post(
                '/v1/react',
                json={
                    'reactant_a': 26,
                    'reactant_b': 28,
                    'condition': 'acid',
                    'base_pool_size': 8,
                    'overlay_pool_size': 4,
                },
            )
            self.assertEqual(hinted.status_code, 200)
            self.assertEqual(hinted.json()['outcome'], 'no_reaction')
            self.assertEqual(hinted.json()['hint_condition'], 'palladium')

            # Completely inert under acid, no alternative condition hints.
            inert = client.post(
                '/v1/react',
                json={
                    'reactant_a': 0,
                    'reactant_b': 0,
                    'condition': 'acid',
                    'base_pool_size': 8,
                    'overlay_pool_size': 4,
                },
            )
            self.assertEqual(inert.status_code, 200)
            self.assertEqual(inert.json()['outcome'], 'no_reaction')
            self.assertIsNone(inert.json()['hint_condition'])

    def test_bearer_auth_and_strict_validation(self) -> None:
        """Constant-time bearer auth and strict Pydantic bounds reject bad payloads."""
        token = 'chem-secret'  # noqa: S105 - test bearer value
        with client_for(server.create_app(secret=f'  {token}  ')) as client:
            unauth = client.post(
                '/v1/react',
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'base_pool_size': 4,
                    'overlay_pool_size': 4,
                },
            )
            self.assertEqual(unauth.status_code, 401)

            ok = client.post(
                '/v1/react',
                headers={'Authorization': f'Bearer {token}'},
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'base_pool_size': 4,
                    'overlay_pool_size': 4,
                },
            )
            self.assertEqual(ok.status_code, 200)

            bad_extra = client.post(
                '/v1/react',
                headers={'Authorization': f'Bearer {token}'},
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'base_pool_size': 4,
                    'overlay_pool_size': 4,
                    'extra': 1,
                },
            )
            self.assertEqual(bad_extra.status_code, 422)

            bad_excl_len = client.post(
                '/v1/react',
                headers={'Authorization': f'Bearer {token}'},
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'base_pool_size': 8,
                    'overlay_pool_size': 4,
                    'exclude_base_indices': [0, 1, 2],
                },
            )
            self.assertEqual(bad_excl_len.status_code, 422)

            bad_excl_range = client.post(
                '/v1/react',
                headers={'Authorization': f'Bearer {token}'},
                json={
                    'reactant_a': 0,
                    'reactant_b': 4,
                    'base_pool_size': 4,
                    'overlay_pool_size': 4,
                    'exclude_base_indices': [4],
                },
            )
            self.assertEqual(bad_excl_range.status_code, 422)

    def test_concurrent_requests_and_uninitialized_error(self) -> None:
        """Concurrent requests succeed and uninitialized app returns HTTP 503."""
        app = server.create_app(secret='')
        raw = cast('ApiClient', cast('object', TestClient(app)))
        uninit = raw.post(
            '/v1/react',
            json={
                'reactant_a': 0,
                'reactant_b': 4,
                'base_pool_size': 4,
                'overlay_pool_size': 4,
            },
        )
        self.assertEqual(uninit.status_code, 503)

        with client_for(app) as client:

            def call(_idx: int) -> int:
                resp = client.post(
                    '/v1/react',
                    json={
                        'reactant_a': 0,
                        'reactant_b': 4,
                        'base_pool_size': 16,
                        'overlay_pool_size': 8,
                    },
                )
                return resp.status_code

            with ThreadPoolExecutor(max_workers=4) as pool:
                statuses = list(pool.map(call, range(4)))
            self.assertEqual(statuses, [200, 200, 200, 200])


if __name__ == '__main__':
    unittest.main()
