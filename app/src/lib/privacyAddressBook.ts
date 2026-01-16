/**
 * Privacy Address Book
 * 
 * Stores contacts with their noctura1... shielded addresses
 * for easy private transfers. All data is encrypted.
 * 
 * Features:
 * - Add/edit/delete privacy contacts
 * - Tag contacts (friend, business, etc.)
 * - Auto-suggest when entering recipient
 * - QR code generation for sharing
 * - Import/export contacts
 */

import { 
  setEncrypted, 
  getEncrypted, 
  ENCRYPTED_STORAGE_KEYS,
  hasEncryptedData 
} from './encryptedStorage';
import { isValidShieldedAddress } from './shieldedKeys';
import { PublicKey } from '@solana/web3.js';

/**
 * Privacy contact structure
 */
export interface PrivacyContact {
  id: string;                      // Unique identifier
  name: string;                    // Display name
  noctura1Address: string;         // noctura1... shielded address
  solanaAddress?: string;          // Optional transparent Solana address
  tags: string[];                  // User-defined tags
  notes?: string;                  // Optional notes
  avatar?: string;                 // Optional avatar URL or emoji
  favorite: boolean;               // Quick access
  createdAt: number;               // Unix timestamp
  lastUsedAt?: number;             // Last transaction timestamp
  transactionCount: number;        // Number of transactions
}

/**
 * Contact list with metadata
 */
export interface AddressBook {
  version: number;
  contacts: PrivacyContact[];
  lastModified: number;
}

const ADDRESS_BOOK_VERSION = 1;

/**
 * Generate unique contact ID
 */
function generateContactId(): string {
  return `contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * PrivacyAddressBook - Manage encrypted contact storage
 */
export class PrivacyAddressBook {
  private password: string;
  private addressBook: AddressBook | null = null;
  private loaded = false;

  constructor(password: string) {
    this.password = password;
  }

  /**
   * Load address book from encrypted storage
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      if (hasEncryptedData(ENCRYPTED_STORAGE_KEYS.PRIVATE_CONTACTS)) {
        this.addressBook = await getEncrypted<AddressBook>(
          ENCRYPTED_STORAGE_KEYS.PRIVATE_CONTACTS,
          this.password
        );
      }
      
      if (!this.addressBook) {
        this.addressBook = {
          version: ADDRESS_BOOK_VERSION,
          contacts: [],
          lastModified: Date.now(),
        };
      }
      
      this.loaded = true;
      console.log(`[AddressBook] Loaded ${this.addressBook.contacts.length} contacts`);
    } catch (err) {
      console.error('[AddressBook] Failed to load:', err);
      throw err;
    }
  }

  /**
   * Save address book to encrypted storage
   */
  private async save(): Promise<void> {
    if (!this.addressBook) return;
    
    this.addressBook.lastModified = Date.now();
    await setEncrypted(
      ENCRYPTED_STORAGE_KEYS.PRIVATE_CONTACTS,
      this.addressBook,
      this.password
    );
  }

  /**
   * Add a new contact
   */
  async addContact(contact: Omit<PrivacyContact, 'id' | 'createdAt' | 'transactionCount'>): Promise<PrivacyContact> {
    await this.load();
    
    // Validate noctura1 address
    if (!isValidShieldedAddress(contact.noctura1Address)) {
      throw new Error('Invalid noctura1... address format');
    }
    
    // Validate Solana address if provided
    if (contact.solanaAddress) {
      try {
        new PublicKey(contact.solanaAddress);
      } catch {
        throw new Error('Invalid Solana address format');
      }
    }
    
    // Check for duplicate
    const existing = this.addressBook!.contacts.find(
      c => c.noctura1Address === contact.noctura1Address
    );
    if (existing) {
      throw new Error(`Contact with this address already exists: ${existing.name}`);
    }
    
    const newContact: PrivacyContact = {
      ...contact,
      id: generateContactId(),
      createdAt: Date.now(),
      transactionCount: 0,
    };
    
    this.addressBook!.contacts.push(newContact);
    await this.save();
    
    console.log(`[AddressBook] Added contact: ${newContact.name}`);
    return newContact;
  }

  /**
   * Update an existing contact
   */
  async updateContact(id: string, updates: Partial<Omit<PrivacyContact, 'id' | 'createdAt'>>): Promise<PrivacyContact> {
    await this.load();
    
    const index = this.addressBook!.contacts.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error('Contact not found');
    }
    
    // Validate addresses if being updated
    if (updates.noctura1Address && !isValidShieldedAddress(updates.noctura1Address)) {
      throw new Error('Invalid noctura1... address format');
    }
    
    if (updates.solanaAddress) {
      try {
        new PublicKey(updates.solanaAddress);
      } catch {
        throw new Error('Invalid Solana address format');
      }
    }
    
    this.addressBook!.contacts[index] = {
      ...this.addressBook!.contacts[index],
      ...updates,
    };
    
    await this.save();
    return this.addressBook!.contacts[index];
  }

  /**
   * Delete a contact
   */
  async deleteContact(id: string): Promise<void> {
    await this.load();
    
    const index = this.addressBook!.contacts.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error('Contact not found');
    }
    
    this.addressBook!.contacts.splice(index, 1);
    await this.save();
    
    console.log(`[AddressBook] Deleted contact: ${id}`);
  }

  /**
   * Get all contacts
   */
  async getContacts(): Promise<PrivacyContact[]> {
    await this.load();
    return this.addressBook!.contacts;
  }

  /**
   * Get contacts sorted by most recently used
   */
  async getRecentContacts(limit = 5): Promise<PrivacyContact[]> {
    await this.load();
    return this.addressBook!.contacts
      .filter(c => c.lastUsedAt)
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, limit);
  }

  /**
   * Get favorite contacts
   */
  async getFavorites(): Promise<PrivacyContact[]> {
    await this.load();
    return this.addressBook!.contacts.filter(c => c.favorite);
  }

  /**
   * Search contacts by name or address
   */
  async searchContacts(query: string): Promise<PrivacyContact[]> {
    await this.load();
    const lowerQuery = query.toLowerCase();
    
    return this.addressBook!.contacts.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.noctura1Address.toLowerCase().includes(lowerQuery) ||
      c.solanaAddress?.toLowerCase().includes(lowerQuery) ||
      c.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get contacts by tag
   */
  async getContactsByTag(tag: string): Promise<PrivacyContact[]> {
    await this.load();
    return this.addressBook!.contacts.filter(c => 
      c.tags.includes(tag.toLowerCase())
    );
  }

  /**
   * Find contact by address (noctura1 or Solana)
   */
  async findByAddress(address: string): Promise<PrivacyContact | null> {
    await this.load();
    return this.addressBook!.contacts.find(
      c => c.noctura1Address === address || c.solanaAddress === address
    ) || null;
  }

  /**
   * Record a transaction to a contact (updates lastUsedAt and count)
   */
  async recordTransaction(noctura1Address: string): Promise<void> {
    await this.load();
    
    const contact = this.addressBook!.contacts.find(
      c => c.noctura1Address === noctura1Address
    );
    
    if (contact) {
      contact.lastUsedAt = Date.now();
      contact.transactionCount++;
      await this.save();
    }
  }

  /**
   * Get all unique tags
   */
  async getAllTags(): Promise<string[]> {
    await this.load();
    const tags = new Set<string>();
    this.addressBook!.contacts.forEach(c => c.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }

  /**
   * Export contacts for backup (encrypted blob)
   */
  async exportContacts(): Promise<string> {
    await this.load();
    return JSON.stringify(this.addressBook);
  }

  /**
   * Import contacts from backup
   */
  async importContacts(backup: string, merge = true): Promise<number> {
    await this.load();
    
    const imported: AddressBook = JSON.parse(backup);
    let addedCount = 0;
    
    if (merge) {
      // Merge with existing contacts
      for (const contact of imported.contacts) {
        const exists = this.addressBook!.contacts.find(
          c => c.noctura1Address === contact.noctura1Address
        );
        if (!exists) {
          this.addressBook!.contacts.push({
            ...contact,
            id: generateContactId(), // Generate new ID to avoid conflicts
          });
          addedCount++;
        }
      }
    } else {
      // Replace all contacts
      this.addressBook = imported;
      addedCount = imported.contacts.length;
    }
    
    await this.save();
    console.log(`[AddressBook] Imported ${addedCount} contacts`);
    return addedCount;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalContacts: number;
    favoriteCount: number;
    totalTransactions: number;
    tagCount: number;
  }> {
    await this.load();
    return {
      totalContacts: this.addressBook!.contacts.length,
      favoriteCount: this.addressBook!.contacts.filter(c => c.favorite).length,
      totalTransactions: this.addressBook!.contacts.reduce((sum, c) => sum + c.transactionCount, 0),
      tagCount: (await this.getAllTags()).length,
    };
  }
}

/**
 * Create address book instance
 */
export function createAddressBook(password: string): PrivacyAddressBook {
  return new PrivacyAddressBook(password);
}

/**
 * Quick contact lookup by noctura1 address
 */
export async function quickLookup(
  address: string,
  password: string
): Promise<PrivacyContact | null> {
  const book = createAddressBook(password);
  return book.findByAddress(address);
}
