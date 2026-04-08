import { pool } from "@workspace/db";
import { sha256 } from "../blockchain/crypto.js";

export interface NFTCollection {
  id: string;
  creator: string;
  name: string;
  symbol: string;
  description: string;
  coverImage: string;
  category: string;
  royaltyPercent: number;
  maxSupply: number;
  totalMinted: number;
  floorPrice: number;
  totalVolume: number;
  txHash: string;
  createdAt: number;
}

export interface NFTToken {
  id: string;
  collectionId: string;
  tokenId: number;
  owner: string;
  creator: string;
  name: string;
  description: string;
  image: string;
  attributes: { trait_type: string; value: string }[];
  rarity: number;
  edition: number;
  listingPrice?: number;
  listed: boolean;
  txHash: string;
  mintedAt: number;
  transferCount: number;
}

export interface NFTListing {
  id: string;
  nftId: string;
  collectionId: string;
  seller: string;
  price: number;
  currency: string;
  expiresAt?: number;
  active: boolean;
  createdAt: number;
}

export interface NFTBid {
  id: string;
  nftId: string;
  bidder: string;
  amount: number;
  expiresAt: number;
  active: boolean;
  createdAt: number;
}

export class NFTStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_nft_collections (
        id TEXT PRIMARY KEY,
        creator TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cover_image TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'art',
        royalty_percent NUMERIC NOT NULL DEFAULT 2.5,
        max_supply INTEGER NOT NULL DEFAULT 0,
        total_minted INTEGER NOT NULL DEFAULT 0,
        floor_price NUMERIC NOT NULL DEFAULT 0,
        total_volume NUMERIC NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_nft_tokens (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES ix_nft_collections(id),
        token_id INTEGER NOT NULL,
        owner TEXT NOT NULL,
        creator TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        attributes JSONB NOT NULL DEFAULT '[]',
        rarity NUMERIC NOT NULL DEFAULT 0,
        edition INTEGER NOT NULL DEFAULT 1,
        listing_price NUMERIC,
        listed BOOLEAN NOT NULL DEFAULT false,
        tx_hash TEXT NOT NULL,
        minted_at BIGINT NOT NULL,
        transfer_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (collection_id, token_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_nft_listings (
        id TEXT PRIMARY KEY,
        nft_id TEXT NOT NULL REFERENCES ix_nft_tokens(id),
        collection_id TEXT NOT NULL,
        seller TEXT NOT NULL,
        price NUMERIC NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IXC',
        expires_at BIGINT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_nft_bids (
        id TEXT PRIMARY KEY,
        nft_id TEXT NOT NULL REFERENCES ix_nft_tokens(id),
        bidder TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        expires_at BIGINT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_nft_transfers (
        id TEXT PRIMARY KEY,
        nft_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        price NUMERIC NOT NULL DEFAULT 0,
        royalty_paid NUMERIC NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL DEFAULT '',
        timestamp BIGINT NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_nft_tokens_owner ON ix_nft_tokens(owner)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_nft_tokens_collection ON ix_nft_tokens(collection_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_nft_listings_active ON ix_nft_listings(active) WHERE active=true`);
  }

  async createCollection(col: Omit<NFTCollection, "totalMinted" | "floorPrice" | "totalVolume">): Promise<void> {
    await pool.query(
      `INSERT INTO ix_nft_collections (id, creator, name, symbol, description, cover_image, category, royalty_percent, max_supply, tx_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [col.id, col.creator, col.name, col.symbol, col.description, col.coverImage, col.category, col.royaltyPercent, col.maxSupply, col.txHash, col.createdAt]
    );
  }

  async mintNFT(token: Omit<NFTToken, "listed" | "transferCount" | "listingPrice">): Promise<void> {
    await pool.query(
      `INSERT INTO ix_nft_tokens (id, collection_id, token_id, owner, creator, name, description, image, attributes, rarity, edition, tx_hash, minted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        token.id, token.collectionId, token.tokenId, token.owner, token.creator,
        token.name, token.description, token.image,
        JSON.stringify(token.attributes), token.rarity, token.edition,
        token.txHash, token.mintedAt,
      ]
    );
    await pool.query(
      `UPDATE ix_nft_collections SET total_minted=total_minted+1 WHERE id=$1`,
      [token.collectionId]
    );
  }

  async transferNFT(nftId: string, from: string, to: string, price: number, royaltyPaid: number, txHash: string): Promise<void> {
    await pool.query(`UPDATE ix_nft_tokens SET owner=$2, transfer_count=transfer_count+1, listed=false, listing_price=null WHERE id=$1`, [nftId, to]);
    const nft = await this.getNFT(nftId);
    if (nft) {
      await pool.query(
        `INSERT INTO ix_nft_transfers (id, nft_id, collection_id, from_addr, to_addr, price, royalty_paid, tx_hash, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sha256(`${nftId}:${from}:${to}:${Date.now()}`), nftId, nft.collectionId, from, to, price, royaltyPaid, txHash, Date.now()]
      );
      if (price > 0) {
        await pool.query(
          `UPDATE ix_nft_collections SET total_volume=total_volume+$2, floor_price=LEAST(NULLIF(floor_price,0), $2) WHERE id=$3`,
          [nft.collectionId, price, nft.collectionId]
        );
      }
    }
    await pool.query(`UPDATE ix_nft_listings SET active=false WHERE nft_id=$1`, [nftId]);
  }

  async listNFT(listing: NFTListing): Promise<void> {
    await pool.query(`UPDATE ix_nft_listings SET active=false WHERE nft_id=$1`, [listing.nftId]);
    await pool.query(
      `INSERT INTO ix_nft_listings (id, nft_id, collection_id, seller, price, currency, expires_at, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [listing.id, listing.nftId, listing.collectionId, listing.seller, listing.price, listing.currency, listing.expiresAt ?? null, true, listing.createdAt]
    );
    await pool.query(`UPDATE ix_nft_tokens SET listed=true, listing_price=$2 WHERE id=$1`, [listing.nftId, listing.price]);
  }

  async cancelListing(nftId: string, seller: string): Promise<void> {
    await pool.query(`UPDATE ix_nft_listings SET active=false WHERE nft_id=$1 AND seller=$2`, [nftId, seller]);
    await pool.query(`UPDATE ix_nft_tokens SET listed=false, listing_price=null WHERE id=$1`, [nftId]);
  }

  async placeBid(bid: NFTBid): Promise<void> {
    await pool.query(
      `INSERT INTO ix_nft_bids (id, nft_id, bidder, amount, expires_at, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bid.id, bid.nftId, bid.bidder, bid.amount, bid.expiresAt, true, bid.createdAt]
    );
  }

  async getNFT(id: string): Promise<NFTToken | null> {
    const res = await pool.query(`SELECT * FROM ix_nft_tokens WHERE id=$1`, [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, collectionId: r.collection_id, tokenId: r.token_id,
      owner: r.owner, creator: r.creator, name: r.name, description: r.description,
      image: r.image, attributes: r.attributes, rarity: Number(r.rarity),
      edition: r.edition, listingPrice: r.listing_price ? Number(r.listing_price) : undefined,
      listed: r.listed, txHash: r.tx_hash, mintedAt: Number(r.minted_at), transferCount: r.transfer_count,
    };
  }

  async getCollection(id: string): Promise<NFTCollection | null> {
    const res = await pool.query(`SELECT * FROM ix_nft_collections WHERE id=$1`, [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, creator: r.creator, name: r.name, symbol: r.symbol,
      description: r.description, coverImage: r.cover_image, category: r.category,
      royaltyPercent: Number(r.royalty_percent), maxSupply: r.max_supply,
      totalMinted: r.total_minted, floorPrice: Number(r.floor_price),
      totalVolume: Number(r.total_volume), txHash: r.tx_hash, createdAt: Number(r.created_at),
    };
  }

  async listCollections(limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_nft_collections ORDER BY total_volume DESC LIMIT $1`, [limit]
    );
    return res.rows;
  }

  async getCollectionTokens(collectionId: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_nft_tokens WHERE collection_id=$1 ORDER BY token_id ASC LIMIT $2`, [collectionId, limit]
    );
    return res.rows;
  }

  async getMarketplace(limit = 40): Promise<object[]> {
    const res = await pool.query(
      `SELECT l.*, t.name, t.image, t.attributes, t.collection_id,
              c.name as collection_name, c.royalty_percent
       FROM ix_nft_listings l
       JOIN ix_nft_tokens t ON t.id = l.nft_id
       JOIN ix_nft_collections c ON c.id = l.collection_id
       WHERE l.active=true AND (l.expires_at IS NULL OR l.expires_at > $2)
       ORDER BY l.created_at DESC LIMIT $1`,
      [limit, Date.now()]
    );
    return res.rows;
  }

  async getActiveListing(nftId: string): Promise<NFTListing | null> {
    const res = await pool.query(
      `SELECT * FROM ix_nft_listings WHERE nft_id=$1 AND active=true LIMIT 1`, [nftId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, nftId: r.nft_id, collectionId: r.collection_id,
      seller: r.seller, price: Number(r.price), currency: r.currency,
      expiresAt: r.expires_at ? Number(r.expires_at) : undefined,
      active: r.active, createdAt: Number(r.created_at),
    };
  }

  async getOwnedNFTs(address: string, limit = 40): Promise<object[]> {
    const res = await pool.query(
      `SELECT t.*, c.name as collection_name, c.symbol as collection_symbol
       FROM ix_nft_tokens t
       JOIN ix_nft_collections c ON c.id = t.collection_id
       WHERE t.owner=$1 ORDER BY t.minted_at DESC LIMIT $2`,
      [address, limit]
    );
    return res.rows;
  }

  async getBids(nftId: string): Promise<object[]> {
    const res = await pool.query(
      `SELECT * FROM ix_nft_bids WHERE nft_id=$1 AND active=true AND expires_at>$2 ORDER BY amount DESC`,
      [nftId, Date.now()]
    );
    return res.rows;
  }
}

export const nftStorage = new NFTStorage();
