// routes/webhookRoutes.js
import express from "express";
import handleStripeWebhook from "../controller/admin/webhookController.js";

const webhookRoutes = express.Router();

// ✅ Important: Raw body required for Stripe webhooks
webhookRoutes.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

export default webhookRoutes;
