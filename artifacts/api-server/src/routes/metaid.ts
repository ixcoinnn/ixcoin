import { Router } from "express";
import { metaIDStorage } from "../features/metaid.js";
import { sha256 } from "../blockchain/crypto.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Register / update profile
router.post("/register", async (req, res) => {
  try {
    const { address, username, displayName, bio, avatar, website, twitter, github } = req.body;
    if (!address || !username || !displayName) {
      return res.status(400).json({ error: "address, username, displayName required" });
    }
    const txHash = sha256(`metaid:${address}:${username}:${Date.now()}`);
    await metaIDStorage.registerProfile({ address, username, displayName, bio, avatar, website, twitter, github, txHash });
    res.json({ success: true, txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Get profile by address or username
router.get("/profile/:addressOrUsername", async (req, res) => {
  try {
    const profile = await metaIDStorage.getProfile(req.params.addressOrUsername);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Follow a user
router.post("/follow", async (req, res) => {
  try {
    const { follower, following } = req.body;
    if (!follower || !following) return res.status(400).json({ error: "follower, following required" });
    await metaIDStorage.followUser(follower, following);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Unfollow
router.post("/unfollow", async (req, res) => {
  try {
    const { follower, following } = req.body;
    await metaIDStorage.unfollowUser(follower, following);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get followers
router.get("/followers/:address", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const followers = await metaIDStorage.getFollowers(req.params.address, limit);
    res.json(followers);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get following
router.get("/following/:address", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const following = await metaIDStorage.getFollowing(req.params.address, limit);
    res.json(following);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create post
router.post("/post", async (req, res) => {
  try {
    const { author, content, mediaUrl, tags, parentId, blockHeight = 0 } = req.body;
    if (!author || !content) return res.status(400).json({ error: "author, content required" });
    const id = uuidv4();
    const txHash = sha256(`post:${author}:${content}:${Date.now()}`);
    await metaIDStorage.createPost({ id, author, content, mediaUrl, tags, parentId, txHash, blockHeight });
    res.json({ success: true, id, txHash });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Like a post
router.post("/like", async (req, res) => {
  try {
    const { postId, liker } = req.body;
    await metaIDStorage.likePost(postId, liker);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get feed for address
router.get("/feed/:address", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const feed = await metaIDStorage.getFeed(req.params.address, limit);
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Search profiles
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const limit = parseInt(req.query.limit as string) || 10;
    const results = await metaIDStorage.searchProfiles(q, limit);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Leaderboard
router.get("/leaderboard", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const list = await metaIDStorage.getLeaderboard(limit);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
