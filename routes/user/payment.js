import express from "express";
import {
  cancelSubscription,
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  getCancellationOptions,
  reactivateSubscription,
  verifyCheckoutSession,
} from "../../controller/user/payment.js";
import { checkAuthToken } from "../../middleware/checkToken.js";

const router = express.Router();

// Payment routes
router.post("/create-checkout-session", checkAuthToken, createCheckoutSession);
router.get("/verify-session", verifyCheckoutSession);
router.post('/cancel-immediately',checkAuthToken, cancelSubscription);
router.post('/cancel-at-period-end',checkAuthToken, cancelSubscriptionAtPeriodEnd);
router.post('/reactivate',checkAuthToken, reactivateSubscription);
router.get('/cancellation-options',checkAuthToken, getCancellationOptions);

export { router as paymentRoutes };

