import dotenv from "dotenv";
import Stripe from "stripe";
import { Mentor } from "../../model/mentor.js";

dotenv.config();

const serviceDeatil = [
  {
    title: "Mentorship",
    detail: "3 x 30-min sessions over 3 months",
    price: 125,
  },
  {
    title: "1:1 Coaching",
    detail: "2 x 30-min sessions per month",
    price: 75,
  },
  {
    title: "Portfolio Review",
    detail: "1 x 30-min session",
    price: 50,
  },
  {
    title: "Recruiter Connect",
    detail: "1 x 30-min session",
    price: 50,
  },
  {
    title: "Academic Counseling",
    detail: "1 x 30-min session",
    price: 50,
  },
  {
    title: "Choose Your Topic",
    detail: "1 x 30-min session",
    price: 50,
  },
];

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const createAppointmentCheckout = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { mentorId, serviceName, successUrl, cancelUrl } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!mentorId || !serviceName) {
      return res
        .status(400)
        .json({ message: "mentorId and serviceName are required" });
    }
    const mentor = await Mentor.findById(mentorId);
    if (!mentor) {
      return res.status(400).message({ message: "Mentor Not Found" });
    }
    const service = serviceDeatil.find(
      (s) =>
        s.title.trim().toLowerCase() ===
        String(serviceName).trim().toLowerCase()
    );

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    const amountInCents = Number(service.price) * 100;

    const product = await stripe.products.create({
      name: `${service.title.trim()} | Mentor Booking`,
      description: `${service.detail} | Mentor: ${mentor.fullName}`,
    });

    const price = await stripe.prices.create({
      unit_amount: amountInCents,
      currency: "usd",
      product: product.id,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?success=true&mentorId=${encodeURIComponent(
        mentorId
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelUrl}?success=false`,
      metadata: {
        userId: String(userId),
        mentorId: String(mentorId),
        serviceName: service.title.trim(),
      },
    });

    // Prefer redirect if this endpoint is hit from a browser navigation; otherwise return URL
    if (req.headers.accept && req.headers.accept.includes("text/html")) {
      return res.redirect(303, session.url);
    }

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Stripe booking checkout error:", error);
    return res.status(500).json({ message: error.message });
  }
};
