// controllers/webhookController.js
import Stripe from "stripe";
import { User } from "../../model/user.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const parseStripeTimestamp = (timestamp) => {
  if (!timestamp || isNaN(timestamp) || timestamp <= 0) {
    return null;
  }
  return new Date(timestamp * 1000);
};

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // ✅ Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`🔔 Webhook received: ${event.type}`);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // ✅ Subscription Events
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;

      case "customer.subscription.trial_will_end":
        await handleTrialWillEnd(event.data.object);
        break;

      case "customer.subscription.paused":
        await handleSubscriptionPaused(event.data.object);
        break;

      case "customer.subscription.resumed":
        await handleSubscriptionResumed(event.data.object);
        break;

      // ✅ Payment Events
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case "invoice.payment_action_required":
        await handleInvoicePaymentActionRequired(event.data.object);
        break;

      // ✅ Checkout Events
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "checkout.session.async_payment_succeeded":
        await handleCheckoutAsyncPaymentSucceeded(event.data.object);
        break;

      case "checkout.session.async_payment_failed":
        await handleCheckoutAsyncPaymentFailed(event.data.object);
        break;

      default:
        console.log(`🤷 Unhandled event type: ${event.type}`);
    }
    res.json({ received: true, event: event.type });
  } catch (error) {
    console.error("❌ Webhook handler error:", error);
    res.status(500).json({ error: "Webhook handler failed" });
  }
};

// ✅ Subscription Created
const handleSubscriptionCreated = async (subscription) => {
  console.log("📦 Subscription created:", subscription.id);
  // At the beginning of handleSubscriptionCreated, add:
  console.log("🔍 Subscription data:", {
    id: subscription.id,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    trial_start: subscription.trial_start,
    trial_end: subscription.trial_end,
    status: subscription.status,
  });
  const customerId = subscription.customer;

  // Find user by stripeCustomerId
  const user = await User.findOne({ stripeCustomerId: customerId });

  if (!user) {
    console.log("❌ User not found for customer:", customerId);
    return;
  }

  const isTrial = subscription.status === "trialing";
  const isActive = ["active", "trialing", "past_due"].includes(
    subscription.status
  );

  // Get price and product details
  const price = subscription.items.data[0]?.price;
  const product = price ? await stripe.products.retrieve(price.product) : null;

  const updateData = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: price?.id || null,
    stripeProductId: price?.product || null,
    subscriptionStatus: subscription.status,
    isTrial: isTrial,
    isPaid: isActive,
    currentPeriodStart: parseStripeTimestamp(subscription.current_period_start),
    currentPeriodEnd: parseStripeTimestamp(subscription.current_period_end),
    trialStart: parseStripeTimestamp(subscription.trial_start),
    trialEnd: parseStripeTimestamp(subscription.trial_end),
    canceledAt: parseStripeTimestamp(subscription.canceled_at),
    billingCycle: price?.recurring?.interval || null,
    planName: product?.name || `Plus Plan - ${price?.recurring?.interval}`,
    planId: price?.product || null,
  };

  await User.findByIdAndUpdate(user._id, updateData);

  console.log(`✅ Subscription created for user ${user.email}:`, {
    status: subscription.status,
    isTrial,
    trialEnd: updateData.trialEnd,
    planName: updateData.planName,
  });
};

// ✅ Subscription Updated
const handleSubscriptionUpdated = async (subscription) => {
  console.log("🔄 Subscription updated:", subscription.id);

  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    console.log("❌ User not found for subscription:", subscription.id);
    return;
  }

  const isTrial = subscription.status === "trialing";
  const isActive = ["active", "trialing", "past_due"].includes(
    subscription.status
  );

  // Get price and product details
  const price = subscription.items.data[0]?.price;
  const product = price ? await stripe.products.retrieve(price.product) : null;

  const updateData = {
    subscriptionStatus: subscription.status,
    isTrial: isTrial,
    isPaid: isActive && !subscription.cancel_at_period_end,
    currentPeriodStart: parseStripeTimestamp(subscription.current_period_start),
    currentPeriodEnd: parseStripeTimestamp(subscription.current_period_end),
    trialStart: parseStripeTimestamp(subscription.trial_start),
    trialEnd: parseStripeTimestamp(subscription.trial_end),
    canceledAt: parseStripeTimestamp(subscription.canceled_at),
    willCancelAt: subscription.cancel_at_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    billingCycle: price?.recurring?.interval || user.billingCycle,
    planName: product?.name || user.planName,
  };

  // Handle different subscription statuses
  if (subscription.status === "canceled") {
    updateData.isPaid = false;
    updateData.isTrial = false;
    updateData.willCancelAt = null;
    updateData.cancelAtPeriodEnd = false;
  } else if (subscription.status === "incomplete") {
    updateData.isPaid = false;
    updateData.latestInvoiceStatus = "open";
  } else if (subscription.status === "incomplete_expired") {
    updateData.isPaid = false;
    updateData.isTrial = false;
  } else if (subscription.status === "unpaid") {
    updateData.isPaid = false;
  } else if (subscription.status === "paused") {
    updateData.isPaid = false;
  }

  await User.findByIdAndUpdate(user._id, updateData);

  console.log(`✅ Subscription updated for user ${user.email}:`, {
    status: subscription.status,
    isPaid: updateData.isPaid,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    billingCycle: updateData.billingCycle,
  });
};

// ✅ Subscription Paused
const handleSubscriptionPaused = async (subscription) => {
  console.log("⏸️ Subscription paused:", subscription.id);

  await User.findOneAndUpdate(
    { stripeSubscriptionId: subscription.id },
    {
      subscriptionStatus: "paused",
      isPaid: false,
      latestInvoiceStatus: "void",
    }
  );

  console.log(`✅ Subscription paused for: ${subscription.id}`);
};

// ✅ Subscription Resumed
const handleSubscriptionResumed = async (subscription) => {
  console.log("▶️ Subscription resumed:", subscription.id);

  const user = await User.findOne({ stripeSubscriptionId: subscription.id });
  if (!user) return;

  const updateData = {
    subscriptionStatus: subscription.status,
    isPaid: ["active", "trialing", "past_due"].includes(subscription.status),
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  await User.findByIdAndUpdate(user._id, updateData);

  console.log(`✅ Subscription resumed for user ${user.email}`);
};

// ✅ Subscription Deleted/Canceled
const handleSubscriptionDeleted = async (subscription) => {
  console.log("🗑️ Subscription deleted:", subscription.id);

  await User.findOneAndUpdate(
    { stripeSubscriptionId: subscription.id },
    {
      isPaid: false,
      isTrial: false,
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
      stripePriceId: null,
      billingCycle: null,
      trialStart: null,
      trialEnd: null,
      willCancelAt: null,
      cancelAtPeriodEnd: false,
      canceledAt: new Date(subscription.canceled_at * 1000),
      planName: null,
      planId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      latestInvoiceId: null,
      latestInvoiceStatus: null,
    }
  );

  console.log(`✅ Subscription canceled for: ${subscription.id}`);
};

// ✅ Trial Period Ending Soon (3 days before)
const handleTrialWillEnd = async (subscription) => {
  console.log("⏰ Trial ending soon:", subscription.id);

  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) return;

  // Update trial ending date
  await User.findByIdAndUpdate(user._id, {
    trialEnd: new Date(subscription.trial_end * 1000),
  });

  console.log(
    `📧 Trial ending soon for user ${user.email} on ${new Date(
      subscription.trial_end * 1000
    )}`
  );

  // TODO: Send email notification about trial ending
  // await sendTrialEndingEmail(user.email, subscription.trial_end);
};

// ✅ Invoice Payment Succeeded
const handleInvoicePaymentSucceeded = async (invoice) => {
  console.log("💳 Invoice payment succeeded:", invoice.id);

  if (invoice.subscription) {
    const user = await User.findOne({
      stripeSubscriptionId: invoice.subscription,
    });

    if (user) {
      const updateData = {
        latestInvoiceId: invoice.id,
        latestInvoiceStatus: invoice.status,
        subscriptionStatus: "active",
      };

      // If user was on trial, convert to paid
      if (user.isTrial) {
        updateData.isTrial = false;
        updateData.isPaid = true;
        updateData.trialEnd = null;
        console.log(`✅ User ${user.email} converted from trial to paid`);
      } else {
        updateData.isPaid = true;
        console.log(`✅ Payment succeeded for user ${user.email}`);
      }

      await User.findByIdAndUpdate(user._id, updateData);
    }
  }
};

// ✅ Invoice Payment Failed
const handleInvoicePaymentFailed = async (invoice) => {
  console.log("❌ Invoice payment failed:", invoice.id);

  if (invoice.subscription) {
    const user = await User.findOne({
      stripeSubscriptionId: invoice.subscription,
    });

    if (user) {
      const updateData = {
        latestInvoiceId: invoice.id,
        latestInvoiceStatus: invoice.status,
        subscriptionStatus: "past_due",
        isPaid: false,
      };

      // Only mark as unpaid if not in trial (trial users don't have payment issues)
      if (!user.isTrial) {
        updateData.subscriptionStatus = "unpaid";
        console.log(
          `❌ Payment failed for paid user ${user.email}, subscription deactivated`
        );
      } else {
        console.log(
          `⚠️ Payment failed for trial user ${user.email}, keeping trial active`
        );
      }

      await User.findByIdAndUpdate(user._id, updateData);
    }
  }
};

// ✅ Invoice Payment Action Required
const handleInvoicePaymentActionRequired = async (invoice) => {
  console.log("⚠️ Invoice payment action required:", invoice.id);

  if (invoice.subscription) {
    await User.findOneAndUpdate(
      { stripeSubscriptionId: invoice.subscription },
      {
        latestInvoiceId: invoice.id,
        latestInvoiceStatus: "open",
        subscriptionStatus: "incomplete",
      }
    );

    console.log(
      `📧 Payment action required for subscription: ${invoice.subscription}`
    );

    // TODO: Send email to user about required action
    // await sendPaymentActionRequiredEmail(user.email, invoice.hosted_invoice_url);
  }
};

// ✅ Checkout Completed
const handleCheckoutCompleted = async (session) => {
  console.log("🛒 Checkout completed:", session.id);

  if (session.mode === "subscription" && session.subscription) {
    const userId = session.metadata?.userId;

    if (userId) {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription
      );
      const isTrial = subscription.status === "trialing";

      // Get price and product details
      const price = subscription.items.data[0]?.price;
      const product = price
        ? await stripe.products.retrieve(price.product)
        : null;

      const updateData = {
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        stripePriceId: price?.id || null,
        stripeProductId: price?.product || null,
        isPaid: true,
        isTrial: isTrial,
        subscriptionStatus: subscription.status,
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        billingCycle:
          price?.recurring?.interval || session.metadata?.billingCycle,
        planName:
          product?.name ||
          session.metadata?.planName ||
          `Plus Plan - ${session.metadata?.billingCycle}`,
        planId: price?.product || null,
        latestInvoiceId: session.invoice || null,
        latestInvoiceStatus: "paid",
      };

      await User.findByIdAndUpdate(userId, updateData);

      console.log(
        `✅ Checkout completed for user ${userId}, trial: ${isTrial}, plan: ${updateData.planName}`
      );
    }
  }
};

// ✅ Checkout Async Payment Succeeded
const handleCheckoutAsyncPaymentSucceeded = async (session) => {
  console.log("✅ Async payment succeeded:", session.id);

  // Handle successful async payment (like SCA/3D Secure)
  await handleCheckoutCompleted(session);
};

// ✅ Checkout Async Payment Failed
const handleCheckoutAsyncPaymentFailed = async (session) => {
  console.log("❌ Async payment failed:", session.id);

  if (session.subscription) {
    await User.findOneAndUpdate(
      { stripeSubscriptionId: session.subscription },
      {
        subscriptionStatus: "incomplete",
        isPaid: false,
        latestInvoiceStatus: "open",
      }
    );

    console.log(
      `❌ Async payment failed for subscription: ${session.subscription}`
    );
  }
};

export default handleStripeWebhook;

