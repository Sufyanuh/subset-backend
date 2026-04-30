import dotenv from "dotenv";
import Stripe from "stripe";
import { User } from "../../model/user.js";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const planObj = [
  {
    id: 1,
    title: "Plus:$40/year",
    services:
      "Plus Plan — Annual Membership Unlock unlimited discovery and full access to the SUB•SET community all year long. Unlimited inspiration tiles, unlimited boards, private boards, early access to events, local communities, job opportunities, and more. Billed yearly.",
  },
  {
    id: 2,
    title: "Plus:$4/month",
    services:
      "Unlock unlimited discovery and full access to the SUB•SET community all year long. Unlimited inspiration tiles, unlimited boards, private boards, early access to events, local communities, job opportunities, and more. Billed month-to-month.",
  },
];

export const createCheckoutSession = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { successUrl, cancelUrl, id } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const selectedPlan = planObj.find((p) => p.id === id);
    if (!selectedPlan) {
      return res.status(400).json({ message: "Invalid Plan ID" });
    }

    const priceMatch = selectedPlan.title.match(/\$(\d+)/);
    const priceInDollars = priceMatch ? parseInt(priceMatch[1]) : 0;
    const amountInCents = priceInDollars * 100;

    const interval = selectedPlan.title.toLowerCase().includes("year")
      ? "year"
      : "month";

    // ✅ Create or reuse product
    const productName = `Plus Plan - ${interval}`;
    const product = await stripe.products.create({
      name: productName,
      description: selectedPlan.services,
    });

    const price = await stripe.prices.create({
      unit_amount: amountInCents,
      currency: "usd",
      recurring: { interval },
      product: product.id,
    });

    // ✅ Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName,
        metadata: {
          userId: String(userId),
          username: user.username,
        },
      });
      customerId = customer.id;

      // Save customer ID to user
      await User.findByIdAndUpdate(userId, { stripeCustomerId: customerId });
    }

    // ✅ Check if user is eligible for trial (new user with no previous subscription)
    // Simple logic: if no stripeSubscriptionId exists, they're eligible for trial
    const isNewUser = !user.stripeSubscriptionId;
    const trialPeriodDays = isNewUser ? 30 : 0; // 30-day trial for new users

    console.log(`🎯 User ${user.username} trial eligibility:`, {
      isNewUser,
      hasStripeSubscription: !!user.stripeSubscriptionId,
      trialDays: trialPeriodDays,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: {
        trial_period_days: trialPeriodDays,
        metadata: {
          planName: productName,
          billingCycle: interval,
          isTrialEligible: isNewUser.toString(),
          trialDays: trialPeriodDays.toString(),
        },
      },
      success_url:
        successUrl ||
        `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/payment/cancel`,
      metadata: {
        userId: String(userId),
        planName: productName,
        billingCycle: interval,
        productId: product.id,
        priceId: price.id,
        isTrialEligible: isNewUser.toString(),
        trialDays: trialPeriodDays.toString(),
      },
      allow_promotion_codes: true,
      billing_address_collection: "required",
    });

    return res.status(200).json({
      id: session.id,
      url: session.url,
      sessionId: session.id,
      trialEligible: isNewUser,
      trialDays: trialPeriodDays,
    });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return res.status(500).json({
      message: "Failed to create checkout session",
      error: error.message,
    });
  }
};

export const verifyCheckoutSession = async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ message: "Missing sessionId" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.default_payment_method"],
    });

    // ✅ Enhanced subscription validation
    const validSubscriptionStatuses = ["active", "trialing", "past_due"];
    const validPaymentStatuses = ["paid", "no_payment_required"];

    const hasValidSubscription =
      session.subscription &&
      validSubscriptionStatuses.includes(session.subscription.status);

    const hasValidPayment =
      validPaymentStatuses.includes(session.payment_status) ||
      session.subscription?.status === "trialing";

    if (hasValidSubscription && hasValidPayment) {
      const userId = session.metadata?.userId;
      const planName = session.metadata?.planName;
      const billingCycle = session.metadata?.billingCycle;

      if (userId) {
        const isTrial = session.subscription.status === "trialing";

        // Get price and product details
        const price = session.subscription.items.data[0]?.price;
        const product = price
          ? await stripe.products.retrieve(price.product)
          : null;

        const updateData = {
          isPaid: true,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription.id,
          stripePriceId: price?.id || null,
          stripeProductId: price?.product || null,

          billingCycle: billingCycle,
          subscriptionStatus: session.subscription.status,
          isTrial: isTrial,
          trialStart: session.subscription.trial_start
            ? new Date(session.subscription.trial_start * 1000)
            : null,
          trialEnd: session.subscription.trial_end
            ? new Date(session.subscription.trial_end * 1000)
            : null,
          currentPeriodStart: new Date(
            session.subscription.current_period_start * 1000
          ),
          currentPeriodEnd: new Date(
            session.subscription.current_period_end * 1000
          ),
          cancelAtPeriodEnd: session.subscription.cancel_at_period_end,
          planName: product?.name || planName || `Plus Plan - ${billingCycle}`,
          planId: price?.product || null,
          latestInvoiceId: session.invoice || null,
          latestInvoiceStatus: "paid",
        };

        if (session.subscription.cancel_at_period_end) {
          updateData.willCancelAt = new Date(
            session.subscription.current_period_end * 1000
          );
        }

        await User.findByIdAndUpdate(userId, updateData, { new: true });

        console.log(`✅ Subscription verified for user ${userId}:`, {
          status: session.subscription.status,
          isTrial,
          planName: updateData.planName,
          billingCycle: updateData.billingCycle,
        });
      }

      return res.status(200).json({
        success: true,
        paid: true,
        billingCycle,
        subscriptionId: session.subscription.id,
        customerId: session.customer,
        status: session.subscription.status,
        isTrial: session.subscription.status === "trialing",
        trialStart: session.subscription.trial_start
          ? new Date(session.subscription.trial_start * 1000)
          : null,
        trialEnd: session.subscription.trial_end
          ? new Date(session.subscription.trial_end * 1000)
          : null,
        currentPeriodStart: new Date(
          session.subscription.current_period_start * 1000
        ),
        currentPeriodEnd: new Date(
          session.subscription.current_period_end * 1000
        ),
        planName: planName,
      });
    }

    return res.status(200).json({
      paid: false,
      status: session.payment_status,
      subscriptionStatus: session.subscription?.status || "incomplete",
      message: "Payment not completed",
    });
  } catch (error) {
    console.error("Verify session error:", error);
    return res.status(500).json({
      message: "Failed to verify session",
      error: error.message,
    });
  }
};

// ✅ Enhanced subscription status check
export const checkSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // ✅ Sync with Stripe if subscription exists
    let stripeSyncResult = null;
    if (user.stripeSubscriptionId) {
      try {
        stripeSyncResult = await user.syncSubscriptionWithStripe(stripe);
        console.log(`✅ Stripe sync completed for user ${userId}`);
      } catch (syncError) {
        console.error("Stripe sync error:", syncError);
        // Continue with local data if sync fails
      }
    }

    // ✅ Use the schema method to check access
    const access = user.checkSubscriptionAccess();

    // ✅ Get subscription summary
    const subscriptionSummary = user.getSubscriptionSummary();

    return res.status(200).json({
      success: true,
      hasAccess: access.hasAccess,
      accessDetails: access,
      subscription: {
        isPaid: user.isPaid,
        isTrial: user.isTrial,
        subscriptionStatus: user.subscriptionStatus,
        billingCycle: user.billingCycle,
        planName: user.planName,
        planId: user.planId,
        trialStart: user.trialStart,
        trialEnd: user.trialEnd,
        currentPeriodStart: user.currentPeriodStart,
        currentPeriodEnd: user.currentPeriodEnd,
        cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        willCancelAt: user.willCancelAt,
        canceledAt: user.canceledAt,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        stripePriceId: user.stripePriceId,
        stripeProductId: user.stripeProductId,
        latestInvoiceStatus: user.latestInvoiceStatus,
      },
      summary: subscriptionSummary,
      syncResult: stripeSyncResult,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    console.error("Check subscription status error:", error);
    return res.status(500).json({
      message: "Failed to check subscription status",
      error: error.message,
    });
  }
};

// ✅ Enhanced billing portal session
export const createBillingPortalSession = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ message: "No customer found" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/account`,
      flow_data: {
        type: "payment_method_update",
      },
    });

    return res.status(200).json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("Billing portal error:", error);
    return res.status(500).json({
      message: "Failed to create billing portal session",
      error: error.message,
    });
  }
};

// ✅ Enhanced cancel subscription immediately
export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "No active subscription found",
      });
    }

    // Cancel subscription immediately in Stripe
    const deletedSubscription = await stripe.subscriptions.cancel(
      user.stripeSubscriptionId
    );

    // Update user record with complete cancellation
    await User.findByIdAndUpdate(userId, {
      isPaid: false,
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
      stripePriceId: null,
      billingCycle: null,
      planName: null,
      planId: null,
      isTrial: false,
      trialStart: null,
      trialEnd: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      willCancelAt: null,
      canceledAt: new Date(),
      latestInvoiceId: null,
      latestInvoiceStatus: null,
    });

    console.log(`✅ Subscription canceled immediately for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Subscription canceled successfully",
      subscription: {
        id: deletedSubscription.id,
        status: deletedSubscription.status,
        canceledAt: new Date(deletedSubscription.canceled_at * 1000),
      },
    });
  } catch (error) {
    console.error("Cancel subscription error:", error);
    return res.status(500).json({
      message: "Failed to cancel subscription",
      error: error.message,
    });
  }
};

// ✅ Enhanced cancel subscription at period end
export const cancelSubscriptionAtPeriodEnd = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "No active subscription found",
      });
    }

    // Update subscription to cancel at period end
    const updatedSubscription = await stripe.subscriptions.update(
      user.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    // Update user record
    await User.findByIdAndUpdate(userId, {
      willCancelAt: new Date(updatedSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: true,
      subscriptionStatus: updatedSubscription.status,
    });

    console.log(
      `✅ Subscription set to cancel at period end for user ${userId}`
    );

    return res.status(200).json({
      success: true,
      message: "Subscription will be canceled at the end of the billing period",
      subscription: {
        id: updatedSubscription.id,
        status: updatedSubscription.status,
        cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
        currentPeriodStart: new Date(
          updatedSubscription.current_period_start * 1000
        ),
        currentPeriodEnd: new Date(
          updatedSubscription.current_period_end * 1000
        ),
        willCancelAt: new Date(updatedSubscription.current_period_end * 1000),
      },
    });
  } catch (error) {
    console.error("Cancel subscription at period end error:", error);
    return res.status(500).json({
      message: "Failed to schedule subscription cancellation",
      error: error.message,
    });
  }
};

// ✅ Enhanced reactivate subscription
export const reactivateSubscription = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "No subscription found to reactivate",
      });
    }

    // Check if subscription can be reactivated
    const subscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId
    );

    if (!subscription.cancel_at_period_end) {
      return res.status(400).json({
        message: "Subscription is not scheduled for cancellation",
      });
    }

    if (subscription.status === "canceled") {
      return res.status(400).json({
        message: "Subscription is already canceled and cannot be reactivated",
      });
    }

    // Reactivate subscription by removing cancel_at_period_end
    const updatedSubscription = await stripe.subscriptions.update(
      user.stripeSubscriptionId,
      {
        cancel_at_period_end: false,
      }
    );

    // Update user record
    await User.findByIdAndUpdate(userId, {
      willCancelAt: null,
      cancelAtPeriodEnd: false,
      subscriptionStatus: updatedSubscription.status,
      isPaid: true,
    });

    console.log(`✅ Subscription reactivated for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Subscription reactivated successfully",
      subscription: {
        id: updatedSubscription.id,
        status: updatedSubscription.status,
        cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
        currentPeriodStart: new Date(
          updatedSubscription.current_period_start * 1000
        ),
        currentPeriodEnd: new Date(
          updatedSubscription.current_period_end * 1000
        ),
      },
    });
  } catch (error) {
    console.error("Reactivate subscription error:", error);
    return res.status(500).json({
      message: "Failed to reactivate subscription",
      error: error.message,
    });
  }
};

// ✅ Enhanced get cancellation options
export const getCancellationOptions = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "No active subscription found",
      });
    }

    // Get subscription details from Stripe
    const subscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId
    );

    const cancellationOptions = {
      canCancelImmediately:
        !subscription.cancel_at_period_end &&
        subscription.status !== "canceled",
      canCancelAtPeriodEnd:
        subscription.status === "active" && !subscription.cancel_at_period_end,
      canReactivate:
        subscription.cancel_at_period_end && subscription.status !== "canceled",
      currentStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      willCancelAt: user.willCancelAt,
      isTrial: user.isTrial,
      trialStart: user.trialStart,
      trialEnd: user.trialEnd,
      daysUntilPeriodEnd: Math.ceil(
        (new Date(subscription.current_period_end * 1000) - new Date()) /
          (1000 * 60 * 60 * 24)
      ),
    };

    return res.status(200).json({
      success: true,
      cancellationOptions,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planName: user.planName,
        billingCycle: user.billingCycle,
        billingCycle: user.billingCycle,
      },
    });
  } catch (error) {
    console.error("Get cancellation options error:", error);
    return res.status(500).json({
      message: "Failed to get cancellation options",
      error: error.message,
    });
  }
};

// ✅ New: Get subscription invoices
export const getSubscriptionInvoices = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ message: "No customer found" });
    }

    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 10,
    });

    return res.status(200).json({
      success: true,
      invoices: invoices.data.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        status: invoice.status,
        pdfUrl: invoice.invoice_pdf,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        periodStart: new Date(invoice.period_start * 1000),
        periodEnd: new Date(invoice.period_end * 1000),
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
      })),
    });
  } catch (error) {
    console.error("Get invoices error:", error);
    return res.status(500).json({
      message: "Failed to get invoices",
      error: error.message,
    });
  }
};

// ✅ New: Update payment method
export const updatePaymentMethod = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { paymentMethodId } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ message: "Payment method ID is required" });
    }

    const user = await User.findById(userId);
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ message: "No customer found" });
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    // Set as default payment method
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    console.log(`✅ Payment method updated for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Payment method updated successfully",
    });
  } catch (error) {
    console.error("Update payment method error:", error);
    return res.status(500).json({
      message: "Failed to update payment method",
      error: error.message,
    });
  }
};
