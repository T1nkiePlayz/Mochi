# Save sync

Save sync copies your [save backups](save-backups.md) through a folder you choose, so a second computer can pick them up. The
folder is kept in step by a tool you already run (Syncthing, Nextcloud, a mounted WebDAV share, a USB drive). **Mochi never
uploads anything itself and nothing is hosted by Mochi.**

## Where

**Settings > Save sync**: choose the sync folder, switch **Sync save backups** on, press **Sync now**. The status line shows the
last sync time, how many backups were imported and exported, backups still arriving and any error. On a game page a notice
appears when another device has newer saves than this one.

## What is written

```
<sync folder>/Mochi Saves/<sync key>/<created ms>-<device id>.zip
<sync folder>/Mochi Saves/<sync key>/manifest.json
```

`manifest.json` lists each snapshot: id, created_at, device name and id, size, sha256, kind and file counts. Every file is
written to a temporary file and renamed, so a sync tool never sees a half-written file from Mochi.

**Sync key.** The local backup key contains a hash of the local folder path, which differs between computers. The sync key is
derived from the game identity instead: game id, kind (Minecraft world, Steam Cloud, added folder), the Minecraft instance
name and the folder label (world name, `Steam Cloud saves (account N)`, or the added folder's name). The same world on two
computers needs the same instance name and world name; an added folder needs the same folder name.

## When it runs

- **Export**: after every manual or automatic backup (not "before restore" safety backups, not imported ones), and on **Sync now**.
- **Import**: once shortly after start (at most once a minute) and on **Sync now**. A snapshot is added to the local backup list
  only when it is not there yet and was not seen before (a backup you deleted does not come back). The game's save folder must be
  known on this device (it is found from the game's Minecraft instances, Steam id or added folders).
- **Never automatic restore.** Imported snapshots appear in the Saves dialog marked "From <device>". When the newest snapshot of a
  game came from another device and is newer than anything taken here, the game page offers **Restore them...**, which uses the normal
  restore: the current saves are backed up first and the game must be closed.

## Safety

- A file still being synced (smaller than the manifest says) is "pending" and retried on the next sync. A full-size file with the
  wrong sha256 is reported as damaged and skipped; the status line is rewritten each sync, so errors do not pile up.
- Syncthing conflict files (`*.sync-conflict-*`) are ignored.
- If the folder is not there (unmounted share), nothing is written and the status says so; Mochi does not create it.
- Mochi deletes only files it wrote: this device's snapshots beyond the local "keep" setting, and, with **Remove from sync folder**,
  all of this device's snapshots (which also turns sync off). Other devices' files and any other file are never deleted.
- Two devices that write the manifest at the same moment can lose each other's entries; each device re-adds its own on its next sync.

## Limits

Backups can be large (whole Minecraft worlds), so a sync copies full zip files. The folder must be on a drive this device can
write to. Clocks of the devices are compared for "newer", so keep them roughly right. Windows is not supported.
