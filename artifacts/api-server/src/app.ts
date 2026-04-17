import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestLogger } from "./middleware/request-logger";

const app: Express = express();
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:8081",
      "http://localhost:80",
      "http://localhost",
    ];

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Allow server-to-server / curl / Postman (no Origin header)
      if (!origin) return callback(null, true);
      // Allow Replit preview and deployed app domains
      if (
        /\.replit\.dev$/.test(origin) ||
        /\.riker\.replit\.dev$/.test(origin) ||
        /\.replit\.app$/.test(origin)
      ) {
        return callback(null, true);
      }
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(requestLogger);

app.use("/api", router);

// JSON error handler — ensures all errors (including CORS rejections) return JSON
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.warn({ err: err.message }, "Unhandled middleware error");
  res.status(500).json({ success: false, error: err.message ?? "Internal server error" });
});

export default app;
