"""Build pydoc HTML for shared and agent helpers without invoking their entry points.

Run with the root virtual environment. Output defaults to ignored target/pydoc;
--output selects another generated-document directory. Source modules must be safe
to import. A failed import or missing document fails the build.
"""

import argparse
import html
import os
import pydoc
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def build(root: Path, output: Path) -> tuple[Path, ...]:
    """Render each helper and publish HTML only after every module succeeds.

    Args:
        root: Repository holding shared and agent Python helper directories.
        output: Directory for generated module pages and an index; pages are replaced.

    Returns:
        Module page paths in name order, excluding the generated index.

    Raises:
        SystemExit: Module names collide, imports fail or pydoc omits a document.
        OSError: Files cannot be created, copied or read.
        subprocess.TimeoutExpired: Documentation does not finish within 60 seconds.

    """
    files = (
        *root.glob('scripts/**/*.py'),
        *root.glob('.agents/scripts/*.py'),
        *root.glob('quantum/proofs/symbolic/*.py'),
    )
    directories = sorted({path.parent for path in files})
    modules = sorted(path.stem for path in files)
    if not modules or len(modules) != len(set(modules)) or not all(map(str.isidentifier, modules)):
        message = 'Python helpers must have unique, importable module names'
        raise SystemExit(message)
    with tempfile.TemporaryDirectory(prefix='botge-pydoc-') as temporary:
        staging = Path(temporary)
        result = subprocess.run(  # noqa: S603 - Fixed pydoc invocation and validated local names.
            (sys.executable, '-m', 'pydoc', '-w', *modules),
            cwd=staging,
            env={**os.environ, 'PYTHONPATH': os.pathsep.join(map(str, directories))},
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        missing = [name for name in modules if not (staging / f'{name}.html').is_file()]
        if result.returncode or missing:
            message = (
                f'Python documentation failed: {", ".join(missing)}\n{result.stdout}{result.stderr}'
            )
            raise SystemExit(message)
        output.mkdir(parents=True, exist_ok=True)
        pages: list[Path] = []
        for name in modules:
            path = output / f'{name}.html'
            shutil.copyfile(staging / path.name, path)
            pages.append(path)
        links = ''.join(
            f'<li><a href="{name}.html">{html.escape(name)}</a></li>' for name in modules
        )
        (output / 'index.html').write_text(
            pydoc.HTMLDoc().page(
                'Botge Python helpers', f'<h1>Botge Python helpers</h1><ul>{links}</ul>'
            )
        )
    return tuple(pages)


def main() -> None:
    """Generate helper documentation from any directory using the root environment."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'target' / 'pydoc')
    args = parser.parse_args()
    pages = build(ROOT, args.output)
    print(f'Generated {len(pages)} module pages and {args.output / "index.html"}')


if __name__ == '__main__':
    main()
