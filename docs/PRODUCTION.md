<!-- cspell:words bigint libcrux aesgcm chacha poly ringbuf webpki rustls mrhx -->

# Production contracts

Implementation requirements live here. Use the wiki for
[hosting](https://github.com/MrewyOrg/Botge/wiki/Hosting) and
[operations](https://github.com/MrewyOrg/Botge/wiki/Operations), and the
[workflow guide](../.github/workflows/README.md) for CI and approval rules.

## Deployment and readiness

Update the host's control client, handler, and `compose.yaml` before the first digest deployment.
Image deployments do not update these host files. An incompatible host configuration rejects the
request rather than deploying an unverified tag.

The handler receives the approved digest, verifies Compose uses `BOTGE_IMAGE`, waits for readiness,
and checks the running image reference and health. It atomically saves the reference in
`.botge-image`; `UP` reuses it. Previous images remain available for rollback. Legacy digest-free
deployment is supported but does not verify the approved artifact's identity.

The private listener defaults to `127.0.0.1:3081` and starts without Activity credentials:

| Endpoint   | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `/healthz` | The process responds; stays successful during Discord reconnects.                |
| `/readyz`  | HTTP 204 after Discord Ready/Resumed; 503 before readiness or during reconnects. |

Compose runs `--healthcheck` against `/readyz` every ten seconds, with a two-second request timeout,
a 30-second startup grace period, and six consecutive failures before marking the container
unhealthy. Unhealthy status alone does not restart it. The Activity API's `/healthz` checks HTTP
availability separately. These checks do not verify providers, rendering, storage, or voice
playback.

## Backups and recovery

Operator targets: an encrypted off-host backup daily, 30 days of retention, an owner for failures,
and a restore exercise at least quarterly and after storage or schema changes. Keep the image digest
and configuration with recovery records; store credentials separately. Scheduling, off-host storage,
and host-level restore drills require operator setup.

Run `scripts/backup-compose.sh NEW_DIRECTORY` on the host with `BOTGE_DIR`, `BOTGE_CONTROL_LOCK`,
and the installed control account's rootless Docker environment. The parent directory must exist;
the destination must not. Backup and import require the container database directory to resolve to
`/app/data`: use the image default or that explicit absolute path. Backup inspects the running
container; import checks Compose configuration and the import container. Unsupported data-directory
or working-directory overrides are rejected before stopping Botge when visible in the preflight. The
script shares the deployment lock, stops Botge, copies redb, verifies all tables read-only with the
running image, and writes a checksum and image ID. Its exit trap restarts the original container
even if copying or verification fails. Upload successful backups to encrypted off-host storage. The
script does not schedule, upload, or delete backups.

To restore:

1. Verify `SHA256SUMS` and keep an offline copy of the current database.
2. Acquire the maintenance lock, stop Botge, and copy the backup into the existing data volume.
   Preserve UID/GID 1000 and private database permissions. Never remove the volume to restore data.
3. Start a compatible pinned image and wait for readiness. Use a separate test application to check
   guild settings, added emotes, rendering, and voice selection.

For image rollback, send `deploy sha256:PREVIOUS_DIGEST` through the control client. The same digest
and readiness checks apply. Preserve failure logs and check database compatibility: rolling back an
image does not undo database writes or migrations.

## Dependency security

Dependency review, npm/Cargo audits, and Docker Scout block critical vulnerabilities. Scout checks
both image platforms, including unfixed findings. Cargo maintenance warnings and advisories without
severity scores are informational. Scanner errors fail checks. Full audits run weekly and on demand;
see the workflow guide for PR triggers. Exceptions need an advisory ID, affected path, reachability
evidence, owner, expiry, and follow-up fix.

### Findings requiring triage

The 2026-11-12 full-lockfile audit found 17 Rust vulnerability entries and five maintenance
warnings. Affected versions included crypto-bigint 0.5.5, libcrux-aesgcm 0.0.7,
libcrux-chacha20poly1305 0.0.7, libcrux-kem 0.0.7, libcrux-secrets 0.0.5, libcrux-sha3 0.0.8,
ringbuf 0.4.8, rustls 0.22.4, and rustls-webpki 0.102.8. Dependency refreshes have not resolved
these paths. Serenity brings the older TLS stack; Songbird brings ringbuf. Some cryptography entries
are absent from the default host feature graph. Trace dependencies with
`cargo tree -i PACKAGE@VERSION`, including `--target all` and production feature selections. A
lockfile finding does not establish runtime reachability. `cargo audit --json` reports the current
critical-only policy; it does not reproduce the historical full inventory.

Discord Activity SDK 2.5.0 depends on Zod 3, affected by the high-severity
[collection validation denial of service](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). No
compatible fix is available. This remains informational under the critical-only policy; an untested
Zod 4 override is not a fix. Lower-severity tooling findings also remain visible in npm audit.

## Monitoring and repository controls

Monitor readiness, restarts, disk space, backup age, and deployment/audit failures. Assign an owner,
configure a notification destination, and test delivery. Monitoring and backup destinations must fit
the cost policy below.

The main ruleset requires `Security / Dependency review`, `Security / Dependency audit (npm)`, and
`Security / Dependency audit (cargo)` alongside existing checks and the approved `production`
deployment. New checks remain pending until the workflows are pushed and run. Actions allowlists
include Scout; default tokens remain read-only and cannot approve PRs.

Dependabot security-update PRs, notifications, and backup scheduling still need operator setup.
Independent review requires another trusted maintainer; single-owner CODEOWNERS and self-reviewable
production approval do not provide separation of duties.

## Cost policy

All project tooling and services must remain free to use without trial credits or paid overages:

- Use Compose on existing hardware or a verified free-tier host. Docker Desktop's free license must
  cover the use; Docker Engine is an alternative.
- Keep the repository public and use standard GitHub-hosted runners. Avoid larger runners and paid
  build services. Stay within included cache/artifact storage and verify account spending controls.
- Keep Docker Hub and the enabled Scout repository within their free entitlements. Retain rollback
  images without enabling paid registry features.
- Keep the Activity on Cloudflare Workers Free. Accept quota failures rather than enabling paid
  usage. Static assets and Worker requests have separate limits.
- Use free capacity for encrypted off-host backups and monitoring; provision and test them
  separately.

A free `gcloud` CLI does not make its resources free. Verify VM eligibility, disks, IP addresses,
network traffic, and snapshots against current Free Tier terms. Voice and media can consume outbound
allowances. Budget alerts are not spending caps; verify any enforced controls and their coverage.
Use existing local hardware if hosted resources cannot remain within verified free limits.

References: [Actions billing][actions-billing], [Google Cloud Free Tier][free-tier], [budget
controls][budgets], [Workers limits][workers], [static asset billing][assets], and [Docker Desktop
licensing][desktop].

[actions-billing]: https://docs.github.com/en/billing/concepts/product-billing/github-actions
[free-tier]: https://docs.cloud.google.com/free/docs/free-cloud-features
[budgets]: https://docs.cloud.google.com/billing/docs/how-to/budgets
[workers]: https://developers.cloudflare.com/workers/platform/limits/
[assets]: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
[desktop]: https://docs.docker.com/subscription-billing/desktop-license/
