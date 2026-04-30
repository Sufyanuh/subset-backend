import express from "express";
import { createAppointmentCheckout } from "../../controller/user/booknow.js";
import { checkAuthToken } from "../../middleware/checkToken.js";

const router = express.Router();

router.post(
  "/create-appointment-session",
  checkAuthToken,
  createAppointmentCheckout
);

export default router;
