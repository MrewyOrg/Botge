import type { Quote } from '../types.ts';
import { NamedEntriesDatabase } from './named-entries-database.ts';

type QuoteOnlyNameAndContent = Pick<Quote, 'name' | 'content'>;

export class QuotesDatabase extends NamedEntriesDatabase {
  public constructor(filepath: string) {
    super(filepath, 'quote', 'content');
  }

  public insert(userId: string, quote: Quote): void {
    this.insertEntry(userId, {
      name: quote.name,
      value: quote.content,
      dateAdded: quote.dateAdded
    });
  }
  public delete(userId: string, quote: QuoteOnlyNameAndContent): void {
    this.deleteEntry(userId, quote.name, quote.content);
  }
  public rename(userId: string, content: string, name: string): void {
    this.renameEntry(userId, content, name);
  }
  public getQuoteName(userId: string, content: string): string | undefined {
    return this.getEntryName(userId, content);
  }
  public getQuoteContent(userId: string, name: string): string | undefined {
    return this.findEntryValue(userId, name);
  }
  public getAllQuote(userId: string): readonly Quote[] {
    return this.getEntries(userId).map((entry) => ({
      name: entry.name,
      content: entry.value,
      dateAdded: entry.dateAdded
    }));
  }
  public quoteContentExists(userId: string, content: string): boolean {
    return this.entryValueExists(userId, content);
  }
  public quoteNameExists(userId: string, name: string): boolean {
    return this.entryNameExists(userId, name);
  }
}
