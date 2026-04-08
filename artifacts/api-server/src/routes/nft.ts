import { Router } from "express";
import { nftStorage } from "../features/nft.js";
import { sha256 } from "../blockchain/crypto.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Create collection
router.post("/collections", async (req, res) => {
  try {
    const { creator, name, symbol, description, coverImage, category, royaltyPercent, maxSupply } = req.body;
    if (!creator || !name || !symbol) return res.status(400).json({ error: "creator, name, symbol required" });
    const id = sha256(`col:${creator}:${name}:${Date.now()}`).slice(0, 32);
    const txHash = sha256(`col_tx:${id}`);
    await nftStorage.createCollection({ id, creator, name, symbol, description: description ?? "", coverImage: coverImage ?? "", category: category ?? "art", royaltyPercent: royaltyPercent ?? 2.5, maxSupply: maxSupply ?? 0, txHash, createdAt: Date.now() });
    res.json({ success: true, id, txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List all collections
router.get("/collections", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const collections = await nftStorage.listCollections(limit);
    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get collection
router.get("/collections/:id", async (req, res) => {
  try {
    const col = await nftStorage.getCollection(req.params.id);
    if (!col) return res.status(404).json({ error: "Not found" });
    res.json(col);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get collection tokens
router.get("/collections/:id/tokens", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const tokens = await nftStorage.getCollectionTokens(req.params.id, limit);
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Mint NFT
router.post("/mint", async (req, res) => {
  try {
    const { collectionId, owner, name, description, image, attributes, rarity, edition } = req.body;
    if (!collectionId || !owner || !name) return res.status(400).json({ error: "collectionId, owner, name required" });

    const col = await nftStorage.getCollection(collectionId);
    if (!col) return res.status(404).json({ error: "Collection not found" });
    if (col.maxSupply > 0 && col.totalMinted >= col.maxSupply) return res.status(400).json({ error: "Collection fully minted" });

    const tokenId = col.totalMinted + 1;
    const id = sha256(`nft:${collectionId}:${tokenId}:${owner}`).slice(0, 40);
    const txHash = sha256(`mint:${id}:${Date.now()}`);

    await nftStorage.mintNFT({
      id, collectionId, tokenId, owner, creator: owner, name,
      description: description ?? "", image: image ?? "",
      attributes: attributes ?? [], rarity: rarity ?? 0,
      edition: edition ?? 1, txHash, mintedAt: Date.now(),
    });
    res.json({ success: true, id, tokenId, txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Transfer NFT
router.post("/transfer", async (req, res) => {
  try {
    const { nftId, from, to } = req.body;
    if (!nftId || !from || !to) return res.status(400).json({ error: "nftId, from, to required" });

    const nft = await nftStorage.getNFT(nftId);
    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner !== from) return res.status(403).json({ error: "Not owner" });
    if (nft.listed) return res.status(400).json({ error: "NFT is listed, cancel listing first" });

    const col = await nftStorage.getCollection(nft.collectionId);
    const txHash = sha256(`transfer:${nftId}:${from}:${to}:${Date.now()}`);
    const royalty = (col?.royaltyPercent ?? 0) / 100;
    await nftStorage.transferNFT(nftId, from, to, 0, royalty, txHash);
    res.json({ success: true, txHash });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List NFT on marketplace
router.post("/list", async (req, res) => {
  try {
    const { nftId, seller, price, currency, expiresInDays } = req.body;
    if (!nftId || !seller || !price) return res.status(400).json({ error: "nftId, seller, price required" });

    const nft = await nftStorage.getNFT(nftId);
    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (nft.owner !== seller) return res.status(403).json({ error: "Not owner" });

    const listingId = uuidv4();
    const expiresAt = expiresInDays ? Date.now() + expiresInDays * 86400000 : undefined;
    await nftStorage.listNFT({ id: listingId, nftId, collectionId: nft.collectionId, seller, price, currency: currency ?? "IXC", expiresAt, active: true, createdAt: Date.now() });
    res.json({ success: true, listingId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Cancel listing
router.post("/cancel-listing", async (req, res) => {
  try {
    const { nftId, seller } = req.body;
    await nftStorage.cancelListing(nftId, seller);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Buy NFT from marketplace
router.post("/buy", async (req, res) => {
  try {
    const { nftId, buyer } = req.body;
    if (!nftId || !buyer) return res.status(400).json({ error: "nftId, buyer required" });

    const nft = await nftStorage.getNFT(nftId);
    if (!nft) return res.status(404).json({ error: "NFT not found" });
    if (!nft.listed) return res.status(400).json({ error: "NFT not listed" });

    const listing = await nftStorage.getActiveListing(nftId);
    if (!listing) return res.status(400).json({ error: "No active listing" });

    const col = await nftStorage.getCollection(nft.collectionId);
    const royaltyPct = (col?.royaltyPercent ?? 0) / 100;
    const royaltyPaid = listing.price * royaltyPct;

    const txHash = sha256(`buy:${nftId}:${buyer}:${Date.now()}`);
    await nftStorage.transferNFT(nftId, listing.seller, buyer, listing.price, royaltyPaid, txHash);

    res.json({ success: true, txHash, price: listing.price, royaltyPaid, seller: listing.seller });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Place bid
router.post("/bid", async (req, res) => {
  try {
    const { nftId, bidder, amount, expiresInHours = 24 } = req.body;
    if (!nftId || !bidder || !amount) return res.status(400).json({ error: "nftId, bidder, amount required" });
    const id = uuidv4();
    await nftStorage.placeBid({ id, nftId, bidder, amount, expiresAt: Date.now() + expiresInHours * 3600000, active: true, createdAt: Date.now() });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Marketplace listing (all active)
router.get("/marketplace", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 40;
    const listings = await nftStorage.getMarketplace(limit);
    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get NFT detail
router.get("/token/:id", async (req, res) => {
  try {
    const nft = await nftStorage.getNFT(req.params.id);
    if (!nft) return res.status(404).json({ error: "Not found" });
    const [bids] = await Promise.all([nftStorage.getBids(nft.id)]);
    res.json({ ...nft, bids });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get NFTs owned by address
router.get("/owned/:address", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 40;
    const tokens = await nftStorage.getOwnedNFTs(req.params.address, limit);
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
