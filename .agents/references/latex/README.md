# LaTeX references

Reviewed 2026-11-25 for [Botge's quantum specification](../../../quantum/docs/botge-quantum.tex),
its generated dark-mode PDF, workspace ChkTeX rules, and VS Code LaTeX Workshop configuration. The
[audit](AUDIT.md) maps each guide and subguide to local rules, lint settings, and verification
results. The [manifest](../sources.json) pins every source URL and its SHA-256. Run
`python3 .agents/scripts/cache_references.py` to populate the ignored cache, or add `--check` to
verify the cached bytes offline.

## Source inventory

- [latex3/latex2e][latex2e-repo] (`0919db37a88f`): core LaTeX2e author, historic, font, encoding,
  class/package, and `amsmath` guides.
- [latex3/mathtools][mathtools-repo] (`f5e89ededb56`): `mathtools` extensions (`\coloneqq`, paired
  delimiters) and `amsmath` refinements.
- [latex3/hyperref][hyperref-repo] (`2b042a8b8c34`): PDF hyperlinks, metadata, and `\texorpdfstring`
  rules.
- [schneeschmelze/l2tabu-english][l2tabu-repo] (`048dc531516e`): obsolete LaTeX2e commands,
  packages, and mathematical typesetting guidance (`l2tabuen.tex`).
- [CTAN `nag`][nag-ctan] (`0.7`): automated `l2tabu` + `orthodox` compile-time detector.
- [Rdeisenroth/darkmode-latex-package][darkmode-repo] (`6c3329da2f11`): `darkmode` package API and
  `\IfDarkModeTF` hooks.
- [overleaf/chktex][chktex-repo] (`c9bd5e8cc2c6`): ChkTeX manual (`ChkTeX.tex.in`) and default
  configuration (`chktexrc`). (Mirrors upstream ChkTeX; Savannah cgit failed with `No route to host`
  during discovery.)
- [James-Yu/LaTeX-Workshop][workshop-repo] (`5b5da4f44ba1`): `package.json` configuration schema and
  ChkTeX, LaCheck, and `latexindent` integration modules.

### Core LaTeX2e and math guides

- [LaTeX2e for authors (current)](../cache/latex-usrguide.tex) and
  [historic guide](../cache/latex-usrguide-historic.tex)
- [Font selection guide](../cache/latex-fntguide.tex),
  [font encodings guide](../cache/latex-encguide.tex), and
  [class/package writer guide](../cache/latex-clsguide.tex)
- [`amsmath` user's guide](../cache/latex-amsldoc.tex),
  [`mathtools` documentation](../cache/latex-mathtools.dtx), and
  [`hyperref` manual](../cache/latex-hyperref-doc.tex) ([README](../cache/latex-hyperref-readme.md))

### Hygiene, linting, dark mode, and IDE specs

- [`l2tabuen` (LaTeX2e sins)](../cache/latex-l2tabuen.tex)
  ([README](../cache/latex-l2tabuen-readme.md)) and [`nag` package](../cache/latex-nag.dtx)
  ([README](../cache/latex-nag-readme.txt))
- [`darkmode` package](../cache/latex-darkmode.dtx) ([README](../cache/latex-darkmode-readme.md))
- [ChkTeX manual](../cache/latex-chktex-manual.tex) and
  [default `chktexrc`](../cache/latex-chktexrc)
- [LaTeX Workshop schema](../cache/latex-workshop-package.json),
  [ChkTeX runner](../cache/latex-workshop-chktex.ts),
  [LaCheck runner](../cache/latex-workshop-lacheck.ts), and
  [`latexindent` runner](../cache/latex-workshop-latexindent.ts)

## Licenses

LaTeX2e, `mathtools`, `hyperref`, `nag`, and `darkmode` sources carry LPPL notices
([LaTeX2e](../cache/LATEX-2E-LICENSE.txt), [mathtools](../cache/LATEX-MATHTOOLS-LICENSE.txt),
[darkmode](../cache/LATEX-DARKMODE-LICENSE.txt)). `l2tabuen.tex` embeds its GFDL-1.2-or-later notice
verbatim. ChkTeX is licensed under [GPL-2.0](../cache/LATEX-CHKTEX-LICENSE.txt), and LaTeX Workshop
under [MIT](../cache/LATEX-WORKSHOP-LICENSE.txt). Snapshots preserve upstream bytes verbatim.

[latex2e-repo]: https://github.com/latex3/latex2e/tree/0919db37a88f89e6af3809f8d3aeac198b0cdf2b
[mathtools-repo]: https://github.com/latex3/mathtools/tree/f5e89ededb560bddf257c3d0496f8b0fd9173706
[hyperref-repo]: https://github.com/latex3/hyperref/tree/2b042a8b8c3463b95b385a52e8925c0c4787af7d
[l2tabu-repo]:
  https://github.com/schneeschmelze/l2tabu-english/tree/048dc531516ed1a5762e717911d0a35d329b8977
[nag-ctan]: https://ctan.org/pkg/nag
[darkmode-repo]:
  https://github.com/Rdeisenroth/darkmode-latex-package/tree/6c3329da2f113913d59e6e255aff6f158a36d4e2
[chktex-repo]: https://github.com/overleaf/chktex/tree/c9bd5e8cc2c6b7480368f3349ec547abf9ead196
[workshop-repo]:
  https://github.com/James-Yu/LaTeX-Workshop/tree/5b5da4f44ba18a5d37108b05f53677b881cc470c
