"""Back up MrewyOrg/Botge and verify its encrypted snapshot before rotating backups."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, cast
from urllib.parse import quote
from uuid import uuid4

REPOSITORY = 'MrewyOrg/Botge'
REPO_API = f'repos/{REPOSITORY}'
GH_API = ('gh', 'api', '--hostname', 'github.com')
REST_API = (*GH_API, '-H', 'X-GitHub-Api-Version: 2022-11-28')
ARCHIVE = 'botge.tar.gz'
CHECKSUM = 'SHA256SUMS'
REMOTE = re.compile(r'[a-zA-Z0-9_-]+:[a-zA-Z0-9_./-]+')
SNAPSHOT = re.compile(r'botge-[0-9]{8}T[0-9]{6}Z-[a-zA-Z0-9]{8}')

BRANCH_QUERY = """
query($endCursor: String) {
  result: repository(owner: "MrewyOrg", name: "Botge") {
    items: branchProtectionRules(first: 100, after: $endCursor) {
      nodes {
        id pattern allowsDeletions allowsForcePushes blocksCreations dismissesStaleReviews
        isAdminEnforced lockBranch lockAllowsFetchAndMerge requireLastPushApproval
        requiredApprovingReviewCount requiredStatusCheckContexts requiresApprovingReviews
        requiresCodeOwnerReviews requiresCommitSignatures requiresConversationResolution
        requiresLinearHistory requiresStatusChecks requiresStrictStatusChecks
        requiresDeployments requiredDeploymentEnvironments
        restrictsPushes restrictsReviewDismissals
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

DISCUSSIONS_QUERY = """
query($endCursor: String) {
  result: repository(owner: "MrewyOrg", name: "Botge") {
    items: discussions(first: 50, after: $endCursor) {
      nodes {
        id number title body url author { login } createdAt updatedAt closed locked
        answer { id }
        category { id name slug description isAnswerable }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

COMMENTS_QUERY = """
query($id: ID!, $endCursor: String) {
  result: node(id: $id) {
    ... on Discussion {
      items: comments(first: 50, after: $endCursor) {
        nodes { id body url author { login } createdAt updatedAt replies(first: 1) { totalCount } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
"""

REPLIES_QUERY = """
query($id: ID!, $endCursor: String) {
  result: node(id: $id) {
    ... on DiscussionComment {
      items: replies(first: 50, after: $endCursor) {
        nodes { id body url author { login } createdAt updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
"""


class BackupError(Exception):
    """An export or verification could not be completed."""


def _run(*args: str, output: BinaryIO | None = None) -> bytes:
    env = os.environ | {
        'GH_HOST': 'github.com',
        'GH_PROMPT_DISABLED': '1',
        'GIT_TERMINAL_PROMPT': '0',
    }
    env.pop('GH_DEBUG', None)
    env.pop('GH_REPO', None)
    result = subprocess.run(  # noqa: S603 - Fixed executables and separate arguments, without a shell.
        args, stdout=output if output is not None else subprocess.PIPE, check=True, env=env
    )
    return result.stdout if output is None else b''


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        message = 'Expected a JSON object from GitHub'
        raise BackupError(message)
    # JSON object keys are strings.
    return cast('dict[str, object]', value)


def _array(value: object) -> list[object]:
    if not isinstance(value, list):
        message = 'Expected a JSON array from GitHub'
        raise BackupError(message)
    return cast('list[object]', value)


def _integer(value: object, *, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        message = 'Expected a valid numeric ID or count from GitHub'
        raise BackupError(message)
    return value


def _string(value: object) -> str:
    if not isinstance(value, str) or not value:
        message = 'Expected a nonempty string from GitHub'
        raise BackupError(message)
    return value


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def _rest(path: str, endpoint: str, destination: Path) -> dict[str, object]:
    result = _object(json.loads(_run(*REST_API, f'{path}{endpoint}')))
    _write(destination, result)
    return result


def _entries(
    path: str, endpoint: str, destination: Path, *, key: str | None = None
) -> list[dict[str, object]]:
    separator = '&' if '?' in endpoint else '?'
    pages = _array(
        json.loads(
            _run(*REST_API, '--paginate', '--slurp', f'{path}{endpoint}{separator}per_page=30')
        )
    )
    if not pages:
        message = 'GitHub returned no REST pages'
        raise BackupError(message)
    entries = [
        _object(item)
        for page in pages
        for item in _array(page if key is None else _object(page)[key])
    ]
    _write(destination, entries)
    return entries


def _graphql(query: str, destination: Path, *fields: str) -> list[dict[str, object]]:
    pages = _array(
        json.loads(
            _run(*GH_API, 'graphql', '--paginate', '--slurp', '-f', f'query={query}', *fields)
        )
    )
    entries: list[dict[str, object]] = []
    complete = False
    for raw in pages:
        page = _object(raw)
        if page.get('errors'):
            message = 'GitHub returned GraphQL errors'
            raise BackupError(message)
        data = _object(page['data'])
        items = _object(_object(data['result'])['items'])
        entries.extend(_object(item) for item in _array(items['nodes']))
        complete = _object(items['pageInfo'])['hasNextPage'] is False
    if not complete:
        message = 'GitHub returned incomplete GraphQL results'
        raise BackupError(message)
    _write(destination, entries)
    return entries


def _mirror(repository: str, destination: Path) -> None:
    _run(
        'git',
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'clone',
        '--mirror',
        f'https://github.com/{repository}.git',
        str(destination),
    )
    _run('git', '-C', str(destination), 'fsck', '--full', '--no-dangling')


def _git_data(root: Path, repository: dict[str, object]) -> None:
    if (
        repository.get('full_name') != REPOSITORY
        or not isinstance(repository.get('default_branch'), str)
        or not isinstance(repository.get('has_wiki'), bool)
        or not isinstance(repository.get('has_discussions'), bool)
    ):
        message = 'GitHub returned unexpected Botge repository metadata'
        raise BackupError(message)
    mirror = root / 'Botge.git'
    _mirror(REPOSITORY, mirror)
    for branch in ('main', 'dev'):
        _run('git', '-C', str(mirror), 'show-ref', '--verify', '--quiet', f'refs/heads/{branch}')
    if repository['has_wiki'] is True:
        wiki = root / 'Botge.wiki.git'
        _mirror(f'{REPOSITORY}.wiki', wiki)
        _run('git', '-C', str(wiki), 'rev-parse', '--verify', 'HEAD')


def _settings(root: Path) -> None:
    for name in ('collaborators', 'teams'):
        _entries(REPO_API, f'/{name}', root / f'{name}.json')
    _entries(REPO_API, '/properties/values', root / 'custom-properties.json')
    rulesets = _entries(REPO_API, '/rulesets?includes_parents=true', root / 'rulesets.json')
    for rule in rulesets:
        identifier = _integer(rule['id'])
        _rest(
            REPO_API,
            f'/rulesets/{identifier}?includes_parents=true',
            root / 'rulesets' / f'{identifier}.json',
        )
    _graphql(BRANCH_QUERY, root / 'branch-protection.json')


def _deployments(root: Path) -> None:
    actions = f'{REPO_API}/actions'
    permissions = _rest(actions, '/permissions', root / 'actions.json')
    _rest(actions, '/permissions/workflow', root / 'actions-workflow.json')
    if permissions['allowed_actions'] == 'selected':
        _rest(actions, '/permissions/selected-actions', root / 'actions-allowed.json')
    for prefix in ('', 'organization-'):
        _entries(actions, f'/{prefix}secrets', root / f'{prefix}secret-names.json', key='secrets')
        _entries(actions, f'/{prefix}variables', root / f'{prefix}variables.json', key='variables')
    environments = _entries(
        REPO_API, '/environments', root / 'environments.json', key='environments'
    )
    for environment in environments:
        name = quote(_string(environment['name']), safe='')
        path = f'{REPO_API}/environments/{name}'
        destination = root / 'environments' / str(_integer(environment['id']))
        policy = environment.get('deployment_branch_policy')
        if policy is not None and _object(policy)['custom_branch_policies'] is True:
            _entries(
                path,
                '/deployment-branch-policies',
                destination / 'branches.json',
                key='branch_policies',
            )
        _entries(path, '/secrets', destination / 'secret-names.json', key='secrets')
        _entries(path, '/variables', destination / 'variables.json', key='variables')


def _sha256(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def _releases(root: Path) -> None:
    releases = _entries(REPO_API, '/releases', root / 'releases.json')
    assets_dir = root / 'assets'
    assets_dir.mkdir()
    for release in releases:
        identifier = _integer(release['id'])
        assets = _entries(
            REPO_API, f'/releases/{identifier}/assets', root / f'{identifier}-assets.json'
        )
        for asset in assets:
            asset_id = _integer(asset['id'])
            size = _integer(asset['size'], minimum=0)
            path = assets_dir / str(asset_id)
            with path.open('wb') as output:
                _run(
                    *REST_API,
                    f'{REPO_API}/releases/assets/{asset_id}',
                    '-H',
                    'Accept: application/octet-stream',
                    output=output,
                )
            if path.stat().st_size != size:
                message = f'Unexpected size for release asset {asset_id}'
                raise BackupError(message)
            digest = asset.get('digest')
            if (
                isinstance(digest, str)
                and digest.startswith('sha256:')
                and _sha256(path) != digest[7:]
            ):
                message = f'Unexpected digest for release asset {asset_id}'
                raise BackupError(message)


def _history(root: Path) -> None:
    for endpoint, name in (
        ('/issues?state=all', 'issues'),
        ('/issues/comments', 'issue-comments'),
        ('/labels', 'labels'),
        ('/milestones?state=all', 'milestones'),
        ('/pulls/comments', 'review-comments'),
    ):
        _entries(REPO_API, endpoint, root / f'{name}.json')
    pulls = _entries(REPO_API, '/pulls?state=all', root / 'pulls.json')
    for pull in pulls:
        number = _integer(pull['number'])
        _entries(REPO_API, f'/pulls/{number}/reviews', root / 'reviews' / f'{number}.json')


def _discussions(root: Path) -> None:
    discussions = _graphql(DISCUSSIONS_QUERY, root / 'discussions.json')
    for discussion in discussions:
        directory = root / str(_integer(discussion['number']))
        discussion_id = _string(discussion['id'])
        comments = _graphql(
            COMMENTS_QUERY, directory / 'comments.json', '-f', f'id={discussion_id}'
        )
        for index, comment in enumerate(comments):
            count = _integer(_object(comment['replies'])['totalCount'], minimum=0)
            if count:
                comment_id = _string(comment['id'])
                _graphql(
                    REPLIES_QUERY, directory / f'replies-{index}.json', '-f', f'id={comment_id}'
                )


def _upload(root: Path, data: Path, remote: str, snapshot: str) -> None:
    upload = root / 'upload'
    upload.mkdir()
    archive = upload / ARCHIVE
    with tarfile.open(archive, 'w:gz') as output:
        output.add(data, arcname='.')
    with tarfile.open(archive, 'r:gz') as check:
        check.getmember('./manifest.json')
    checksum = root / CHECKSUM
    checksum.write_text(f'{_sha256(archive)}  {ARCHIVE}\n', encoding='ascii')
    destination = f'{remote}/{snapshot}'
    _run('rclone', 'copy', str(upload), destination, '--immutable')
    _run('rclone', 'cryptcheck', str(upload), destination)
    # Upload the completion marker only after verifying the encrypted archive.
    _run('rclone', 'copyto', str(checksum), f'{destination}/{CHECKSUM}', '--immutable')


def _rotate(remote: str, snapshot: str, keep: int) -> None:
    listing = _run(
        'rclone', 'lsf', remote, '--recursive', '--files-only', '--include', f'/botge-*/{CHECKSUM}'
    )
    suffix = f'/{CHECKSUM}'
    complete = {
        name
        for file in listing.decode('utf-8').splitlines()
        if file.endswith(suffix) and SNAPSHOT.fullmatch(name := file.removesuffix(suffix))
    }
    if snapshot not in complete:
        message = 'The completed snapshot is missing from the remote listing'
        raise BackupError(message)
    for old in sorted(complete - {snapshot}, reverse=True)[keep - 1 :]:
        # Remove the marker first so an interrupted deletion cannot count as a complete archive.
        _run('rclone', 'deletefile', f'{remote}/{old}/{CHECKSUM}')
        _run('rclone', 'deletefile', f'{remote}/{old}/{ARCHIVE}')
        _run('rclone', 'rmdir', f'{remote}/{old}')


def _destination(value: str) -> str:
    remote = value.removesuffix('/')
    _, _, path = remote.partition(':')
    if (
        not REMOTE.fullmatch(remote)
        or not path
        or path.startswith('/')
        or '..' in path
        or path == '.'
    ):
        message = 'Use a dedicated rclone crypt remote and folder'
        raise argparse.ArgumentTypeError(message)
    return remote


def _retention(value: str) -> int:
    if not re.fullmatch(r'[1-9][0-9]{0,3}', value):
        message = 'KEEP must be between 1 and 9999'
        raise argparse.ArgumentTypeError(message)
    return int(value)


def _backup(remote: str, keep: int) -> None:
    for tool in ('git', 'gh', 'rclone'):
        if shutil.which(tool) is None:
            message = f'Install {tool}'
            raise BackupError(message)
    crypt_remotes = (
        _run('rclone', 'listremotes', '--type', 'crypt', '--exact').decode().splitlines()
    )
    if f'{remote.partition(":")[0]}:' not in crypt_remotes:
        message = 'The destination must use a configured rclone crypt remote'
        raise BackupError(message)

    with tempfile.TemporaryDirectory(prefix='botge-github.') as directory:
        root = Path(directory)
        stamp = datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')
        snapshot = f'botge-{stamp}-{uuid4().hex[:8]}'
        data = root / 'snapshot'
        settings = data / 'settings'
        repository = _rest(REPO_API, '', settings / 'repository.json')
        _git_data(data, repository)
        _settings(settings)
        _deployments(settings)
        _releases(data / 'releases')
        _history(data / 'history')
        if repository['has_discussions'] is True:
            _discussions(data / 'history' / 'discussions')
        _write(
            data / 'manifest.json', {'format': 1, 'repository': REPOSITORY, 'snapshot': snapshot}
        )
        _upload(root, data, remote, snapshot)
        _rotate(remote, snapshot, keep)
    print(f'Verified Botge GitHub backup {snapshot}')


def main() -> None:
    """Parse arguments, run a single backup, and report failures without exporting API payloads."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('remote', metavar='CRYPT_REMOTE:DESTINATION', type=_destination)
    parser.add_argument('keep', metavar='KEEP', type=_retention, nargs='?', default=30)
    args = parser.parse_args()
    try:
        _backup(args.remote, args.keep)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f'Botge GitHub backup failed ({error.cmd[0]} exited {error.returncode}).\n')
    except (BackupError, OSError, ValueError, KeyError, tarfile.TarError) as error:
        parser.exit(1, f'Botge GitHub backup failed ({type(error).__name__}): {error}\n')


if __name__ == '__main__':
    main()
