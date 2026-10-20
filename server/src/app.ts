import express from "express";
import { apiRouter } from "./api/index.js";

export const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Dashboard API. JSON parsing, 404s and errors are handled inside the router.
app.use("/api", apiRouter);
