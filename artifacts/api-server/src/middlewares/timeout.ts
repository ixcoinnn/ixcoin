import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ path: req.path, method: req.method, ip: req.ip }, "Request timed out");
        res.status(503).json({ error: "Request timeout — server terlalu sibuk, coba lagi" });
      }
    }, ms);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

export function miningTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ path: req.path, ip: req.ip }, "Mining request timed out");
        res.status(503).json({ error: "Mining timeout — server sedang sibuk, coba lagi" });
      }
    }, ms);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}
