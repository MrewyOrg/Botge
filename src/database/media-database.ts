import type { Media } from '../types.ts';
import { NamedEntriesDatabase } from './named-entries-database.ts';

type MediaOnlyNameAndLink = Pick<Media, 'name' | 'url'>;

export class MediaDatabase extends NamedEntriesDatabase {
  public constructor(filepath: string) {
    super(filepath, 'media', 'url');
  }

  public insert(userId: string, media: Media): void {
    this.insertEntry(userId, { name: media.name, value: media.url, dateAdded: media.dateAdded });
  }
  public delete(userId: string, media: MediaOnlyNameAndLink): void {
    this.deleteEntry(userId, media.name, media.url);
  }
  public rename(userId: string, url: string, name: string): void {
    this.renameEntry(userId, url, name);
  }
  public getMediaName(userId: string, url: string): string | undefined {
    return this.getEntryName(userId, url);
  }
  public getMediaUrl(userId: string, name: string): string | undefined {
    return this.findEntryValue(userId, name);
  }
  public getAllMedia(userId: string): readonly Media[] {
    return this.getEntries(userId).map((entry) => ({
      name: entry.name,
      url: entry.value,
      dateAdded: entry.dateAdded
    }));
  }
  public mediaUrlExists(userId: string, url: string): boolean {
    return this.entryValueExists(userId, url);
  }
  public mediaNameExists(userId: string, name: string): boolean {
    return this.entryNameExists(userId, name);
  }
}
