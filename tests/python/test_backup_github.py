"""Verify Botge backups with fixture GitHub responses and a local Drive stand-in."""

import contextlib
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from typing import BinaryIO
from unittest.mock import patch

import backup_github as backup

REMOTE = 'test:github/Botge'
OLD = 'botge-20000101T000000Z-00000000'
ASSET = b'release asset'
ASSET_DIGEST = 'sha256:' + hashlib.sha256(ASSET).hexdigest()


def graph_page(nodes: list[object], *, more: bool = False) -> object:
    """Build a GraphQL page with the same connection aliases as the export queries."""
    return {'data': {'result': {'items': {'nodes': nodes, 'pageInfo': {'hasNextPage': more}}}}}


class FakeTools:
    """Provide deterministic responses and store uploaded files in a temporary directory."""

    def __init__(self, drive: Path) -> None:
        """Seed one completed snapshot for retention to remove."""
        self.drive = drive
        prior = drive / OLD
        prior.mkdir(parents=True)
        (prior / backup.CHECKSUM).touch()
        (prior / backup.ARCHIVE).touch()
        self.fail_check = False
        self.remove_checksum = False
        self.asset = ASSET
        self.calls: list[tuple[str, ...]] = []

    def run(self, *args: str, output: BinaryIO | None = None) -> bytes:
        """Dispatch Git, GitHub, and rclone fixture calls."""
        self.calls.append(args)
        if args[0] == 'git':
            if 'clone' in args:
                mirror = Path(args[-1])
                mirror.mkdir()
                (mirror / 'HEAD').write_text('ref: refs/heads/main\n')
            return b''
        if args[0] == 'rclone':
            return self.rclone(args)
        if output is not None:
            output.write(self.asset)
            return b''
        if 'graphql' in args:
            return json.dumps(self.graphql(args)).encode()
        endpoint = args[-1].removeprefix(backup.REPO_API)
        return json.dumps(self.rest(endpoint)).encode()

    def rclone(self, args: tuple[str, ...]) -> bytes:
        """Represent encrypted remote operations with a deterministic local file store."""
        _, command, *fields = args
        match command:
            case 'listremotes':
                return b'test:\n'
            case 'copy':
                archive = self.drive / fields[1].rsplit('/', 1)[1]
                archive.mkdir()
                shutil.copyfile(Path(fields[0]) / backup.ARCHIVE, archive / backup.ARCHIVE)
            case 'cryptcheck':
                if self.fail_check:
                    raise subprocess.CalledProcessError(7, args)
                remote = self.drive / fields[1].rsplit('/', 1)[1] / backup.ARCHIVE
                local = Path(fields[0]) / backup.ARCHIVE
                unittest.TestCase().assertEqual(local.read_bytes(), remote.read_bytes())
            case 'copyto':
                if not self.remove_checksum:
                    shutil.copyfile(fields[0], self.remote_file(fields[1]))
            case 'lsf':
                listing = [str(path.relative_to(self.drive)) for path in self.drive.glob('*/*')]
                return '\n'.join(
                    [*listing, 'unrelated/SHA256SUMS', 'nested/extra/SHA256SUMS']
                ).encode()
            case 'deletefile':
                self.remote_file(fields[0]).unlink()
            case 'rmdir':
                (self.drive / fields[0].rsplit('/', 1)[1]).rmdir()
            case _:
                raise AssertionError(command)
        return b''

    def remote_file(self, destination: str) -> Path:
        """Resolve one object path under the fixture's Drive folder."""
        prefix = REMOTE + '/'
        if not destination.startswith(prefix):
            raise AssertionError(destination)
        return self.drive / destination.removeprefix(prefix)

    @staticmethod
    def rest(endpoint: str) -> object:
        """Provide paginated and single-object responses for supported REST endpoints."""
        path = endpoint.partition('?')[0]
        routes: dict[str, object] = {
            '': {
                'full_name': backup.REPOSITORY,
                'default_branch': 'main',
                'has_wiki': True,
                'has_discussions': True,
            },
            '/rulesets': [[{'id': 4}]],
            '/rulesets/4': {'id': 4, 'name': 'Inherited policy'},
            '/actions/permissions': {'allowed_actions': 'selected'},
            '/actions/permissions/workflow': {'default_workflow_permissions': 'read'},
            '/actions/permissions/selected-actions': {'github_owned_allowed': True},
            '/environments': [
                {
                    'environments': [
                        {
                            'id': 8,
                            'name': 'stage / test',
                            'deployment_branch_policy': {'custom_branch_policies': True},
                        },
                        {'id': 9, 'name': 'production', 'deployment_branch_policy': None},
                    ]
                }
            ],
            '/environments/stage%20%2F%20test/deployment-branch-policies': [
                {'branch_policies': [{'name': 'main'}]}
            ],
            '/releases': [[{'id': 50}]],
            '/releases/50/assets': [[{'id': 31, 'size': len(ASSET), 'digest': ASSET_DIGEST}]],
            '/pulls': [[{'number': 15}], [{'number': 17}]],
            '/pulls/17/reviews': [[{'state': 'APPROVED'}]],
        }
        if path in routes:
            return routes[path]
        empty: list[object] = []
        for key in ('secrets', 'variables'):
            if path.endswith(key):
                return [{key: empty}]
        return [empty]

    @staticmethod
    def graphql(args: tuple[str, ...]) -> object:
        """Exercise multi-page discussion results and per-comment reply queries."""
        query = next(arg for arg in args if arg.startswith('query='))
        if 'branchProtectionRules' in query:
            return [graph_page([{'pattern': 'main'}])]
        if 'items: discussions' in query:
            return [
                graph_page([{'id': 'a', 'number': 10}], more=True),
                graph_page([{'id': 'b', 'number': 20}]),
            ]
        if 'id=a' in args:
            return [graph_page([{'id': 'c', 'replies': {'totalCount': 1}}])]
        if 'id=b' in args:
            return [graph_page([{'id': 'd', 'replies': {'totalCount': 0}}])]
        if 'id=c' in args:
            return [graph_page([{'body': 'Thread reply'}])]
        raise AssertionError(query)


class BackupTests(unittest.TestCase):
    """Exercise the backup command, archive, and failure handling offline."""

    def test_backup_and_restore(self) -> None:
        """Recover a verified archive and retain only completed snapshots in the window."""
        with tempfile.TemporaryDirectory() as temp:
            drive = Path(temp)
            fake = FakeTools(drive)
            with (
                patch.object(backup, '_run', side_effect=fake.run),
                patch.object(backup.shutil, 'which', return_value='/fixture/tool'),
                patch.object(sys, 'argv', ['backup_github.py', REMOTE, '1']),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                backup.main()
            self.assertFalse((drive / OLD).exists())
            marker = next(drive.glob(f'*/{backup.CHECKSUM}'))
            archive = marker.parent / backup.ARCHIVE
            self.assertEqual(
                marker.read_text().split()[0], hashlib.sha256(archive.read_bytes()).hexdigest()
            )
            restored = drive / 'restored'
            with tarfile.open(archive, 'r:gz') as snapshot:
                snapshot.extractall(restored, filter='data')
            manifest = json.loads((restored / 'manifest.json').read_text())
            self.assertEqual(manifest['snapshot'], marker.parent.name)
            self.assertTrue((restored / 'Botge.git/HEAD').is_file())
            self.assertTrue((restored / 'Botge.wiki.git/HEAD').is_file())
            self.assertEqual((restored / 'releases/assets/31').read_bytes(), ASSET)
            self.assertTrue((restored / 'settings/environments/8/branches.json').is_file())
            self.assertTrue((restored / 'history/reviews/17.json').is_file())
            self.assertTrue((restored / 'history/discussions/10/replies-0.json').is_file())
            self.assertTrue(
                any('/environments/stage%20%2F%20test/' in call[-1] for call in fake.calls)
            )

    def test_backup_failures_keep_previous_snapshots(self) -> None:
        """Preserve earlier backups on an asset, upload verification, or marker failure."""
        for failure in ('asset size', 'asset digest', 'verification', 'remote listing'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                drive = Path(temp)
                fake = FakeTools(drive)
                if failure == 'asset size':
                    fake.asset = b'short'
                if failure == 'asset digest':
                    fake.asset = b'x' * len(ASSET)
                fake.fail_check = failure == 'verification'
                fake.remove_checksum = failure == 'remote listing'
                with (
                    patch.object(backup, '_run', side_effect=fake.run),
                    patch.object(backup.shutil, 'which', return_value='/fixture/tool'),
                    patch.object(sys, 'argv', ['backup_github.py', REMOTE, '1']),
                    contextlib.redirect_stderr(io.StringIO()) as errors,
                    self.assertRaisesRegex(SystemExit, '1'),
                ):
                    backup.main()
                self.assertIn('backup failed', errors.getvalue())
                self.assertEqual(list(drive.glob('*/SHA256SUMS')), [drive / OLD / 'SHA256SUMS'])
                self.assertFalse(any('deletefile' in call for call in fake.calls))

    def test_invalid_export_data(self) -> None:
        """Abort on malformed JSON, invalid IDs, and incomplete API pages."""
        cases: tuple[tuple[str, object], ...] = (
            (backup.REPO_API, {'full_name': 'Other/Repo'}),
            (backup.REPO_API, {'full_name': backup.REPOSITORY, 'default_branch': 'main'}),
            ('/rulesets?', {}),
            ('/rulesets?', []),
            ('/rulesets?', [None]),
            ('/rulesets?', [[False]]),
            ('/rulesets?', [[{'id': True}]]),
            ('/rulesets?', [[{'id': 0}]]),
            ('/rulesets?', [[{'id': '../escape'}]]),
            ('/environments?', [{'environments': [{'name': ''}]}]),
            ('graphql', []),
            ('graphql', [{'errors': [{'message': 'denied'}]}]),
            ('graphql', [graph_page([], more=True)]),
        )
        for route, payload in cases:
            with self.subTest(route=route, payload=payload), tempfile.TemporaryDirectory() as temp:
                fake = FakeTools(Path(temp))

                def invalid_response(
                    *args: str,
                    output: BinaryIO | None = None,
                    route: str = route,
                    payload: object = payload,
                    fake: FakeTools = fake,
                ) -> bytes:
                    if args[0] == 'gh' and (
                        args[-1] == route
                        or route in args
                        or (route.startswith('/') and route in args[-1])
                    ):
                        return json.dumps(payload).encode()
                    return fake.run(*args, output=output)

                with (
                    patch.object(backup, '_run', side_effect=invalid_response),
                    patch.object(backup.shutil, 'which', return_value='/fixture/tool'),
                    patch.object(sys, 'argv', ['backup_github.py', REMOTE]),
                    contextlib.redirect_stderr(io.StringIO()) as errors,
                    self.assertRaisesRegex(SystemExit, '1'),
                ):
                    backup.main()
                self.assertIn('backup failed', errors.getvalue())
                self.assertFalse(any('copy' in call for call in fake.calls))

    def test_cli_validation(self) -> None:
        """Reject invalid destination paths and retention counts before running tools."""
        for args in (
            ('bad',),
            ('remote:/root',),
            ('remote:.',),
            ('remote:folder/../archive',),
            (REMOTE, '0'),
            (REMOTE, '01'),
            (REMOTE, '10000'),
            (REMOTE, '-8'),
        ):
            with (
                self.subTest(args=args),
                patch.object(sys, 'argv', ['backup_github.py', *args]),
                patch.object(backup, '_run') as runner,
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaisesRegex(SystemExit, '2'),
            ):
                backup.main()
            runner.assert_not_called()

    def test_tool_lookup_and_subprocess_environment(self) -> None:
        """Require tools and a crypt remote, and ignore inherited GitHub debug settings."""
        with (
            patch.object(backup.shutil, 'which', return_value=None),
            patch.object(sys, 'argv', ['backup_github.py', REMOTE]),
            contextlib.redirect_stderr(io.StringIO()) as errors,
            self.assertRaisesRegex(SystemExit, '1'),
        ):
            backup.main()
        self.assertIn('Install git', errors.getvalue())

        with (
            patch.object(backup.shutil, 'which', return_value='/fixture/tool'),
            patch.object(sys, 'argv', ['backup_github.py', REMOTE + '/']),
            patch.dict(backup.os.environ, {'GH_DEBUG': 'api', 'GH_REPO': 'Other/Repo'}),
            patch.object(backup.subprocess, 'run') as runner,
            contextlib.redirect_stderr(io.StringIO()) as errors,
            self.assertRaisesRegex(SystemExit, '1'),
        ):
            runner.return_value.stdout = b'other:\n'
            backup.main()
        self.assertIn('configured rclone crypt remote', errors.getvalue())
        self.assertEqual(
            runner.call_args.args[0], ('rclone', 'listremotes', '--type', 'crypt', '--exact')
        )
        self.assertTrue(runner.call_args.kwargs['check'])
        self.assertNotIn('GH_DEBUG', runner.call_args.kwargs['env'])
        self.assertNotIn('GH_REPO', runner.call_args.kwargs['env'])
