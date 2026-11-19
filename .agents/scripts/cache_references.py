"""Cache checksum-pinned references on demand; --check never uses the network."""

import argparse
import hashlib
import json
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING, override
from urllib.parse import urlsplit
from urllib.request import urlopen

from _support import fail, read_json, record, sequence, text

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

MAX_BYTES = 4 * 1024 * 1024  # Bound each reference download independently of remote headers.
SHA256_LENGTH = 64


class Text(HTMLParser):
    """Extract main content without executing upstream scripts."""

    def __init__(self) -> None:
        """Initialize an isolated, text-only parser."""
        super().__init__()
        self.active = False
        self.hidden = 0
        self.parts: list[str] = []

    @override
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Retain main-content boundaries and section anchors."""
        if tag == 'main':
            self.active = True
        if not self.active:
            return
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag in ('h1', 'h2', 'h3', 'h4', 'p', 'li', 'pre', 'tr'):
            self.parts.append('\n')
        anchor = dict(attrs).get('id')
        if anchor:
            self.parts.append(f' [{anchor}] ')

    @override
    def handle_endtag(self, tag: str) -> None:
        """Stop at the main boundary and discard script/style text."""
        if tag == 'main':
            self.active = False
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1
        if self.active and tag in ('h1', 'h2', 'h3', 'h4', 'p', 'li', 'pre', 'tr'):
            self.parts.append('\n')

    @override
    def handle_data(self, data: str) -> None:
        """Collect visible document text."""
        if self.active and not self.hidden:
            self.parts.append(data)


INLINE_WRAPPERS = ('strong', 'emphasis', 'newTerm', 'inlineHead')


@dataclass(frozen=True, slots=True)
class DocC:
    """Render one DocC JSON page (Apple's documentation data format) as plain text.

    Headings keep their anchors, lists become `-` items and tables become `|` rows. Images and
    navigation are dropped; references keep their titles.
    """

    references: Mapping[str, object]

    def inline(self, items: object) -> str:
        """Join inline text, code spans and reference titles."""
        parts: list[str] = []
        for item in sequence(items):
            node = record(item)
            kind = node.get('type')
            if kind == 'text':
                parts.append(text(node.get('text')))
            elif kind == 'codeVoice':
                parts.append(f'`{text(node.get("code"))}`')
            elif kind in INLINE_WRAPPERS:
                parts.append(self.inline(node.get('inlineContent', [])))
            elif kind == 'reference':
                target = self.references.get(text(node.get('identifier')))
                if isinstance(target, dict) and isinstance(target.get('title'), str):
                    parts.append(target['title'])
        return ''.join(parts)

    def blocks(self, items: object, prefix: str = '') -> list[str]:
        """Render block content; unknown block types are skipped."""
        lines: list[str] = []
        for item in sequence(items):
            lines.extend(self.block(record(item), prefix))
        return lines

    def block(self, node: Mapping[str, object], prefix: str) -> list[str]:
        """Render one block node through the renderer for its type."""
        renderers: dict[object, Callable[[Mapping[str, object], str], list[str]]] = {
            'heading': self.heading,
            'paragraph': self.paragraph,
            'unorderedList': self.listing,
            'orderedList': self.listing,
            'aside': self.aside,
            'table': self.table,
            'codeListing': self.code,
        }
        render = renderers.get(node.get('type'))
        return render(node, prefix) if render else []

    @staticmethod
    def heading(node: Mapping[str, object], _prefix: str) -> list[str]:
        """Render a heading with its anchor."""
        anchor = node.get('anchor')
        tag = f' [{anchor}]' if isinstance(anchor, str) else ''
        level = node.get('level')
        marks = '#' * (level if isinstance(level, int) else 2)
        return [f'\n{marks} {text(node.get("text"))}{tag}']

    def paragraph(self, node: Mapping[str, object], prefix: str) -> list[str]:
        """Render a non-empty paragraph."""
        body = self.inline(node.get('inlineContent', [])).strip()
        return [f'{prefix}{body}'] if body else []

    def listing(self, node: Mapping[str, object], prefix: str) -> list[str]:
        """Render list items as `-` lines."""
        return [
            line
            for entry in sequence(node.get('items', []))
            for line in self.blocks(record(entry).get('content', []), f'{prefix}- ')
        ]

    def aside(self, node: Mapping[str, object], prefix: str) -> list[str]:
        """Render an aside with its name as a prefix."""
        name = node.get('name') or node.get('style') or 'Note'
        return self.blocks(node.get('content', []), f'{prefix}{name}: ')

    def table(self, node: Mapping[str, object], prefix: str) -> list[str]:
        """Render table rows."""
        return [self.row(row, prefix) for row in sequence(node.get('rows', []))]

    @staticmethod
    def code(node: Mapping[str, object], prefix: str) -> list[str]:
        """Render a code listing indented by four spaces."""
        return [f'{prefix}    {line}' for line in sequence(node.get('code', []))]

    def row(self, cells: object, prefix: str) -> str:
        """Render one table row."""
        rendered = [' '.join(self.blocks(cell)) for cell in sequence(cells)]
        return f'{prefix}| ' + ' | '.join(rendered) + ' |'


def docc_text(data: bytes) -> str:
    """Render a DocC JSON page as plain text with its title and abstract first.

    Raises:
        SystemExit: The data is not a DocC page object.
        UnicodeError: The data is not UTF-8.
        ValueError: The data is not JSON.

    """
    page = record(json.loads(data.decode()))
    render = DocC(record(page.get('references', {})))
    title = text(record(page.get('metadata')).get('title'))
    lines = [f'# {title}', render.inline(page.get('abstract', []))]
    for section in sequence(page.get('primaryContentSections', [])):
        lines.extend(render.blocks(record(section).get('content', [])))
    return '\n'.join(lines)


def filename(value: object) -> str:
    """Reject traversal and non-file cache names."""
    name = text(value)
    if Path(name).name != name or name in ('.', '..'):
        fail('Reference filenames must be flat')
    return name


@dataclass(frozen=True, slots=True)
class Source:
    """A validated reference location and expected content identity."""

    file: str
    url: str
    sha256: str
    extract: str | None

    @classmethod
    def parse(cls, value: object) -> Source:
        """Validate every manifest field before performing I/O."""
        item = record(value)
        url = text(item.get('url'))
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            fail('Reference URLs must be public HTTPS URLs without credentials')
        digest = text(item.get('sha256'))
        if len(digest) != SHA256_LENGTH or any(c not in '0123456789abcdef' for c in digest):
            fail('Expected a lowercase SHA-256 digest')
        extract = filename(item['text']) if 'text' in item else None
        return cls(file=filename(item.get('file')), url=url, sha256=digest, extract=extract)

    def verify(self, cache: Path, *, offline: bool) -> None:
        """Check pinned bytes and optional text extracts before storing a snapshot.

        Args:
            cache: Directory holding flat snapshot and license filenames.
            offline: Require existing matching files without network access or writes.

        Raises:
            SystemExit: Bytes exceed the limit, fail integrity checks or are missing offline.
            OSError: A file or HTTPS operation fails.
            UnicodeError: An HTML source cannot be decoded as UTF-8.

        """
        path = cache / self.file
        if path.exists():
            data = path.read_bytes()
        elif offline:
            fail(f'Missing {self.file}; run python3 .agents/scripts/cache_references.py')
        else:
            # parse() requires HTTPS, and the digest is checked before any content is stored.
            with urlopen(self.url, timeout=30) as response:  # noqa: S310
                data: bytes = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            fail(f'Reference exceeds the download budget: {self.file}')
        if hashlib.sha256(data).hexdigest() != self.sha256:
            fail(f'Checksum mismatch: {self.file}; review upstream before refreshing sources.json')
        if not offline and not path.exists():
            path.write_bytes(data)
        if self.extract is not None:
            self.verify_text(cache / self.extract, data, offline=offline)

    def verify_text(self, path: Path, data: bytes, *, offline: bool) -> None:
        """Reproduce a deterministic text extract and check it in offline mode.

        DocC JSON sources (`.json`) use [`docc_text`]; other sources are HTML.
        """
        if self.file.endswith('.json'):
            raw = docc_text(data)
        else:
            extractor = Text()
            extractor.feed(data.decode())
            raw = ''.join(extractor.parts)
        body = '\n'.join(line.rstrip() for line in raw.splitlines() if line.strip())
        if not body:
            fail(f'No main text found: {self.file}')
        content = (
            f'Text extract; no substantive edits. Source: {self.url}\n'
            f'See accompanying licenses and ../sources.json.\n\n{body}\n'
        )
        if offline:
            if not path.exists() or path.read_text() != content:
                fail(f'Missing or stale text extract: {path.name}')
        else:
            path.write_text(content)


def main() -> None:
    """Verify all snapshots; network access requires an explicit non-check invocation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the cache offline')
    args = parser.parse_args()
    references = Path(__file__).resolve().parents[1] / 'references'
    manifest = record(read_json(references / 'sources.json'))
    sources = tuple(Source.parse(item) for item in sequence(manifest.get('files')))
    names: list[str] = []
    for source in sources:
        names.append(source.file)
        if source.extract is not None:
            names.append(source.extract)
    if not sources or len(names) != len(set(names)):
        fail('Reference manifest must contain sources with unique cache filenames')
    cache = references / 'cache'
    if not args.check:
        cache.mkdir(parents=True, exist_ok=True)
    for source in sources:
        source.verify(cache, offline=args.check)
    print(f'Verified {len(sources)} source/license snapshots and their text extracts.')


if __name__ == '__main__':
    main()
