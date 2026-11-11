<!-- cspell:words gpasswd -->

# Botge control setup

Run Botge on a Debian 13 host with rootless Docker. Local or remote accounts control the stack
through a restricted Unix socket.

## Install

Use a dedicated VM: setup removes conflicting Docker packages and disables system-wide Docker. It
downloads supporting files from `MrewyOrg/Botge/main`, installs rootless Docker and the control
socket, and creates the initial Compose, nginx, and application configuration. It does not start
Botge.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl --fail --silent --show-error --location --create-dirs \
  https://raw.githubusercontent.com/MrewyOrg/Botge/main/botge_control/setup.sh \
  --output botge_control/setup.sh
```

Review the downloaded script, then run it with your control name:

```bash
BOTGE_CONTROL_NAME=botge_control
sudo bash botge_control/setup.sh "$BOTGE_CONTROL_NAME"
BOTGE_DOWNLOAD_DIR="/opt/$BOTGE_CONTROL_NAME"
```

The name determines the Linux account, systemd units, `/run/<control-name>.sock`, and
`/opt/<control-name>`. Use 1-24 lowercase letters, digits, underscores, or hyphens, starting with a
letter or underscore. UID `4242` is fixed in [config](config.sh); a second name alone cannot support
another installation on the same VM.

Setup preserves existing control config, Compose files, application settings, and secrets. To rerun:

```bash
sudo bash "$BOTGE_DOWNLOAD_DIR/botge_control/setup" "$BOTGE_CONTROL_NAME"
```

If your installed setup script predates the `.sh` source filenames, download and run the current
`setup.sh` first. It updates the saved setup script and keeps the installed command paths.

## Configure and start

Edit `.env` and `botge.config.json` in `/home/<control-name>/botge`. Import any existing data before
starting. Setup installs the default Compose stack with Botge and nginx. Botge runs as `node` and
stores data in the `botge-data` named volume.

Using the variables set during installation:

```bash
sudo -u "$BOTGE_CONTROL_NAME" env BOTGE_CONTROL_SOCKET="/run/$BOTGE_CONTROL_NAME.sock" \
  bash "$BOTGE_DOWNLOAD_DIR/scripts/botge-control" up
```

Use `stop` to stop the stack or `deploy` to pull and update only Botge. Set the variables again in a
new shell. For `BUSY`, retry later; for `ERROR`, run the diagnostic script below.

Start and deploy wait for Compose services to be running or healthy, with a 120-second timeout.
Botge has no application health check, so an `OK` response does not confirm Discord login. Image
cleanup failure is logged but does not turn a completed deployment into a failed response.

## Import an existing data folder

Stop the old bot and keep its data folder as a backup. Replace the source path below:

```bash
sudo bash "$BOTGE_DOWNLOAD_DIR/botge_control/import_data" /path/to/existing/data
```

The script stops destination Botge, locks control operations, and imports as `node`. It refuses
nonempty volumes. Avoid direct Docker commands during import. After success, start the stack with
`up`; after failure, inspect any partial data before retrying.

## Grant control access

To let another local or SSH account control Botge, add it to the socket access group:

```bash
sudo gpasswd -a USERNAME "${BOTGE_CONTROL_NAME}_trigger"
```

Replace `USERNAME` with the account name. Open a new session as that account, set
`BOTGE_CONTROL_NAME` to the same control name, and check:

```bash
id
test -w "/run/$BOTGE_CONTROL_NAME.sock"
```

Socket access allows starting, stopping, and deploying Botge without granting direct Docker access
or sudo. That account can run the client with `BOTGE_CONTROL_SOCKET` set to the socket path.

## Inspect and troubleshoot

Run the [diagnostic script](inspect.sh) to collect socket status, handler logs, rootless Docker
status, container status, and Botge logs:

```bash
sudo bash "$BOTGE_DOWNLOAD_DIR/botge_control/inspect"
```

It continues after failed checks and exits with a nonzero status if any check fails.

## Remove

Back up configuration and the data volume, then run the saved teardown script:

```bash
sudo bash "$BOTGE_DOWNLOAD_DIR/botge_control/teardown"
```

After you type `DELETE`, teardown removes the control account and its home, application files,
rootless Docker data and volumes, control groups, handler, and systemd units. It derives the control
name from `/opt/<control-name>` and uses the saved config. External bind mounts need separate
cleanup.

Docker packages, the APT repository, and downloaded setup files remain. System-wide Docker is not
re-enabled.

## Development checks

Run `npm run lint:shell` and `npm run lint:workflows` with ShellCheck and actionlint installed. The
local `tests/control/` suite substitutes temporary Docker, lock, and socket commands; it does not
provision a host or run containers. Setup, teardown, and data import require separate validation on
a disposable Debian host. See [the workflow guide](../.github/workflows/README.md) for deployment
approval and image promotion.
