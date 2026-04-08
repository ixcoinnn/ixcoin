import { pool } from "@workspace/db";
import { sha256 } from "../blockchain/crypto.js";

export interface MetaIDProfile {
  address: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  website: string;
  twitter: string;
  github: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  txHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface MetaIDPost {
  id: string;
  author: string;
  content: string;
  contentHash: string;
  mediaUrl: string;
  tags: string[];
  likes: number;
  reposts: number;
  parentId?: string;
  txHash: string;
  blockHeight: number;
  timestamp: number;
}

export class MetaIDStorage {
  async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_metaid_profiles (
        address TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        twitter TEXT NOT NULL DEFAULT '',
        github TEXT NOT NULL DEFAULT '',
        verified BOOLEAN NOT NULL DEFAULT false,
        follower_count INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        tx_hash TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_metaid_follows (
        follower TEXT NOT NULL,
        following TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (follower, following)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_metaid_posts (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        media_url TEXT NOT NULL DEFAULT '',
        tags JSONB NOT NULL DEFAULT '[]',
        likes INTEGER NOT NULL DEFAULT 0,
        reposts INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        tx_hash TEXT NOT NULL DEFAULT '',
        block_height INTEGER NOT NULL DEFAULT 0,
        timestamp BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ix_metaid_likes (
        post_id TEXT NOT NULL,
        liker TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (post_id, liker)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_metaid_posts_author ON ix_metaid_posts(author)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_metaid_follows_follower ON ix_metaid_follows(follower)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_metaid_follows_following ON ix_metaid_follows(following)`);
  }

  async registerProfile(params: {
    address: string; username: string; displayName: string;
    bio?: string; avatar?: string; website?: string; twitter?: string; github?: string; txHash: string;
  }): Promise<void> {
    const now = Date.now();
    await pool.query(
      `INSERT INTO ix_metaid_profiles
        (address, username, display_name, bio, avatar, website, twitter, github, tx_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (address) DO UPDATE SET
         username=COALESCE(NULLIF($2,''), ix_metaid_profiles.username),
         display_name=$3, bio=$4, avatar=$5, website=$6, twitter=$7, github=$8, updated_at=$10`,
      [
        params.address, params.username, params.displayName,
        params.bio ?? "", params.avatar ?? "", params.website ?? "",
        params.twitter ?? "", params.github ?? "", params.txHash, now,
      ]
    );
  }

  async getProfile(addressOrUsername: string): Promise<MetaIDProfile | null> {
    const res = await pool.query(
      `SELECT * FROM ix_metaid_profiles WHERE address=$1 OR username=$1 LIMIT 1`,
      [addressOrUsername]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      address: r.address, username: r.username, displayName: r.display_name,
      bio: r.bio, avatar: r.avatar, website: r.website,
      twitter: r.twitter, github: r.github, verified: r.verified,
      followerCount: r.follower_count, followingCount: r.following_count,
      txHash: r.tx_hash, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }

  async followUser(follower: string, following: string): Promise<void> {
    await pool.query(
      `INSERT INTO ix_metaid_follows (follower, following, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [follower, following, Date.now()]
    );
    await pool.query(`UPDATE ix_metaid_profiles SET following_count=following_count+1 WHERE address=$1`, [follower]);
    await pool.query(`UPDATE ix_metaid_profiles SET follower_count=follower_count+1 WHERE address=$1`, [following]);
  }

  async unfollowUser(follower: string, following: string): Promise<void> {
    const res = await pool.query(
      `DELETE FROM ix_metaid_follows WHERE follower=$1 AND following=$2 RETURNING *`,
      [follower, following]
    );
    if (res.rowCount && res.rowCount > 0) {
      await pool.query(`UPDATE ix_metaid_profiles SET following_count=GREATEST(following_count-1,0) WHERE address=$1`, [follower]);
      await pool.query(`UPDATE ix_metaid_profiles SET follower_count=GREATEST(follower_count-1,0) WHERE address=$1`, [following]);
    }
  }

  async getFollowers(address: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT p.address, p.username, p.display_name, p.avatar, f.created_at
       FROM ix_metaid_follows f
       JOIN ix_metaid_profiles p ON p.address = f.follower
       WHERE f.following=$1 ORDER BY f.created_at DESC LIMIT $2`,
      [address, limit]
    );
    return res.rows;
  }

  async getFollowing(address: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT p.address, p.username, p.display_name, p.avatar, f.created_at
       FROM ix_metaid_follows f
       JOIN ix_metaid_profiles p ON p.address = f.following
       WHERE f.follower=$1 ORDER BY f.created_at DESC LIMIT $2`,
      [address, limit]
    );
    return res.rows;
  }

  async createPost(params: {
    id: string; author: string; content: string; mediaUrl?: string;
    tags?: string[]; parentId?: string; txHash: string; blockHeight: number;
  }): Promise<void> {
    const contentHash = sha256(params.content);
    await pool.query(
      `INSERT INTO ix_metaid_posts (id, author, content, content_hash, media_url, tags, parent_id, tx_hash, block_height, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.id, params.author, params.content, contentHash,
        params.mediaUrl ?? "", JSON.stringify(params.tags ?? []),
        params.parentId ?? null, params.txHash, params.blockHeight, Date.now(),
      ]
    );
  }

  async likePost(postId: string, liker: string): Promise<void> {
    await pool.query(
      `INSERT INTO ix_metaid_likes (post_id, liker, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [postId, liker, Date.now()]
    );
    await pool.query(`UPDATE ix_metaid_posts SET likes=likes+1 WHERE id=$1`, [postId]);
  }

  async getFeed(address: string, limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT p.*, pr.username, pr.display_name, pr.avatar
       FROM ix_metaid_posts p
       LEFT JOIN ix_metaid_profiles pr ON pr.address = p.author
       WHERE p.author = $1
          OR p.author IN (SELECT following FROM ix_metaid_follows WHERE follower = $1)
       ORDER BY p.timestamp DESC LIMIT $2`,
      [address, limit]
    );
    return res.rows;
  }

  async searchProfiles(query: string, limit = 10): Promise<object[]> {
    const res = await pool.query(
      `SELECT address, username, display_name, avatar, follower_count, verified
       FROM ix_metaid_profiles
       WHERE username ILIKE $1 OR display_name ILIKE $1
       ORDER BY follower_count DESC LIMIT $2`,
      [`%${query}%`, limit]
    );
    return res.rows;
  }

  async getLeaderboard(limit = 20): Promise<object[]> {
    const res = await pool.query(
      `SELECT address, username, display_name, avatar, follower_count, verified
       FROM ix_metaid_profiles ORDER BY follower_count DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  }
}

export const metaIDStorage = new MetaIDStorage();
