# Botge GitHub backup and recovery

The backup reads `MrewyOrg/Botge` from GitHub and writes encrypted snapshots to an existing Google
Drive account. It includes published Git refs, the wiki, release assets, repository settings,
applicable rulesets, branch protection settings, deployment environments, Actions variables and
secret names, issues, PRs, reviews, and discussion threads. GitHub API requests run in sequence, so
treat the snapshot as an export taken over that interval.

The scope is one GitHub repository. Keep the live database, local working tree, Docker Hub images,
GitHub Projects, and binary attachments embedded in discussion, issue, or PR bodies outside this
job. The JSON retains links for embedded attachments. Keep any irreplaceable attachment as a release
asset or committed file if it needs to travel with this backup. Git LFS object storage is outside
this version's scope. If Botge starts using Git LFS, add an LFS export and restore check before
relying on the archive for those files.

## Configure and run

1. Install Git, [GitHub CLI](https://cli.github.com/), and a current
   [rclone](https://rclone.org/install/). Use the
   [repository's Python setup](../scripts/README.md#python-setup) or an existing Python 3.15
   interpreter. The script uses only the standard library. Use a GitHub credential for Botge with
   read access to repository administration, contents, issues, pull requests, discussions,
   environments, secrets metadata and variables. The underlying GitHub user needs access to the
   settings being read. Start with a fine-grained token scoped to this repository. Pass it through
   `GH_TOKEN` from your credential store, or use the GitHub CLI credential available to the macOS
   user running the job. Keep credentials out of the script, job file, and logs.
2. Run `rclone config` to create a [Google Drive remote](https://rclone.org/drive/), then a
   [crypt remote](https://rclone.org/crypt/) wrapping a private folder on that remote. The examples
   use `botge-crypt` as the crypt remote name. Save the encryption password and the secondary
   password, if set, in your password manager. Recovery requires both.
3. Run one foreground backup from the repository root.

   ```sh
   .venv/bin/python scripts/operations/backup_github.py botge-crypt:github/Botge
   ```

   Each successful run creates a dated folder containing `botge.tar.gz` and `SHA256SUMS`. The
   checksum is uploaded after encrypted upload verification and marks a complete snapshot. The
   script keeps the newest 30 completed snapshots by default. Pass a second argument to change that
   count. Use a dedicated prefix. Failed uploads can leave an unmarked folder for manual cleanup,
   and Google Drive Trash can still count toward the storage quota after rotation.

## Schedule on macOS

Copy [the LaunchAgent template](../scripts/operations/org.mrewy.botge-github-backup.plist) to
`~/Library/LaunchAgents/org.mrewy.botge-github-backup.plist`. Replace the placeholder paths with
absolute paths to Python, the script, and the log files. A path under `~/Library/Logs` works for the
logs. If macOS blocks the job from reading a checkout in Documents, copy the script into a
user-owned directory outside Documents and point the job there.

The template runs at 03:30 local time while your user session is active. It expects the same GitHub
and rclone credentials to be accessible to the job without an interactive prompt. If you use a token
from your credential store, point the job at a local launcher that retrieves it and invokes the
script. Run the job once from `launchd` to confirm it can access the credentials.

```sh
agent="$HOME/Library/LaunchAgents/org.mrewy.botge-github-backup.plist"
domain="gui/$(id -u)"
plutil -lint "$agent"
launchctl bootstrap "$domain" "$agent"
launchctl kickstart "$domain/org.mrewy.botge-github-backup"
```

Check the configured logs for the verified snapshot name or the reported failure. For changes to the
plist, unload it with `launchctl bootout "$domain" "$agent"` before bootstrapping again.

## Restore from Google Drive

For a single deleted repo, try
[GitHub's repository restore](https://docs.github.com/en/repositories/creating-and-managing-repositories/restoring-a-deleted-repository)
first. To recover from the Drive copy, select a dated snapshot with a checksum marker. Use a fresh
private work directory on disk and verify the download before unpacking it.

```sh
umask 077
mkdir botge-recovery
cd botge-recovery
rclone copy 'botge-crypt:github/Botge/SNAPSHOT_NAME' .
shasum -a 256 -c SHA256SUMS
mkdir snapshot
tar -xzf botge.tar.gz -C snapshot
git -C snapshot/Botge.git fsck --full --no-dangling
git -C snapshot/Botge.git show-ref --verify refs/heads/main
git -C snapshot/Botge.git show-ref --verify refs/heads/dev
```

1. Create an empty recovery repository and disable Actions there before pushing. Push branches and
   tags using the new repository's explicit URL. Use the same process for an initialized wiki in a
   disposable repository. If wiki initialization created a starter commit, replacing it requires a
   force push. Keep GitHub's internal PR refs in the archive for historical access.
2. Reconstruct release assets from `releases/assets/` using the asset IDs and original filenames in
   each release's asset manifest. Use `history/` to look up GitHub activity. New activity records
   created through GitHub may have different authorship, IDs, and timestamps.
3. Reapply the supported repository settings from `settings/`. Verify ruleset bypass actors, classic
   branch protections, default branch, and the deployment approval and branch policies on
   `production`. Remap users, teams, and app IDs to the destination. Use the documented production
   setup to recreate external integrations and retrieve or reissue secret values before resuming
   deployments.
4. Drill the restore in a disposable repository using only the Drive copy. Confirm the wiki can be
   read and check a release asset if the snapshot contains one. Verify the deployment gate before
   allowing Actions.
