import Stripe from "stripe";
import { User } from "../model/user.js";
import dotenv from "dotenv";
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Get subscription details
export const getSubscriptionDetails = async (stripeSubscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId,
      {
        expand: ["customer", "latest_invoice", "items.data.price.product"],
      }
    );

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      items: subscription.items.data.map((item) => ({
        price: {
          id: item.price.id,
          product: item.price.product,
          amount: item.price.unit_amount,
          currency: item.price.currency,
          interval: item.price.recurring?.interval,
        },
      })),
      customer: subscription.customer,
    };
  } catch (error) {
    console.error("Error fetching subscription:", error);
    throw error;
  }
};

// Get subscription for a specific user
export const getUserSubscription = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.stripeSubscriptionId) {
    return null;
  }

  return await getSubscriptionDetails(user.stripeSubscriptionId);
};
