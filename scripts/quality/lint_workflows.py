"""Check workflows in a temporary copy using actionlint and ShellCheck."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
LOCAL_ACTION = re.compile(r'^([ \t]*(?:-[ \t]+)?uses:[ \t]*)\$/', re.MULTILINE)


def lint(root: Path) -> int:
    """Normalize checkout-relative action references and return the linter's status."""
    actionlint = shutil.which('actionlint')
    if actionlint is None or shutil.which('shellcheck') is None:
        print('Install actionlint and ShellCheck before running workflow lint.', file=sys.stderr)
        return 1

    source = root / '.github'
    with TemporaryDirectory(prefix='botge-actionlint.') as temporary:
        workspace = Path(temporary)
        github = workspace / '.github'
        workflows = github / 'workflows'
        workflows.mkdir(parents=True)
        (workspace / '.git').mkdir()
        shutil.copyfile(source / 'actionlint.yaml', github / 'actionlint.yaml')
        if (source / 'actions').is_dir():
            shutil.copytree(source / 'actions', github / 'actions')
        for workflow in sorted((source / 'workflows').glob('*.y*ml')):
            if workflow.suffix in {'.yml', '.yaml'} and workflow.is_file():
                text = workflow.read_text(encoding='utf-8')
                (workflows / workflow.name).write_text(
                    LOCAL_ACTION.sub(r'\g<1>./', text),
                    encoding='utf-8',
                )
        result = subprocess.run(  # noqa: S603 - A local linter on a disposable workflow copy.
            (actionlint, '-color=false'),
            cwd=workspace,
            check=False,
        )
        return result.returncode


def main() -> None:
    """Run the workflow checks from any working directory."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    raise SystemExit(lint(ROOT))


if __name__ == '__main__':
    main()
