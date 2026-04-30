import { Schema, model } from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new Schema(
  {
    // Account Type & Role
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: false,
    },

    // 🔄 Complete Stripe Integration
    stripeCustomerId: {
      type: String,
      default: null,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    stripeProductId: {
      type: String,
      default: null,
    },

    billingCycle: {
      type: String,
      enum: ["month", "year", "lifetime", null], // ✅ Use "month"/"year"
      default: null,
    },

    // ✅ Complete Subscription Status Fields
    subscriptionStatus: {
      type: String,
      default: "inactive",
      enum: [
        "active", // Subscription is active and in good standing
        "trialing", // Free trial period
        "past_due", // Payment failed, but grace period active
        "canceled", // Subscription canceled (end of period)
        "incomplete", // Initial payment failed
        "incomplete_expired", // Initial payment failed and no successful payment
        "unpaid", // Payment failed, no grace period
        "paused", // Subscription paused
        "inactive", // No active subscription
        "pending", // Subscription creation in progress
      ],
    },

    // Subscription Details
    isTrial: {
      type: Boolean,
      default: false,
    },
    trialStart: {
      type: Date,
      default: null,
    },
    trialEnd: {
      type: Date,
      default: null,
    },
    currentPeriodStart: {
      type: Date,
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    canceledAt: {
      type: Date,
      default: null,
    },
    willCancelAt: {
      type: Date,
      default: null,
    },

    // Plan Information
    planName: {
      type: String,
      default: null,
    },
    planId: {
      type: String,
      default: null,
    },

    // Payment & Invoice Status
    latestInvoiceId: {
      type: String,
      default: null,
    },
    latestInvoiceStatus: {
      type: String,
      enum: ["draft", "open", "paid", "void", "uncollectible", null],
      default: null,
    },
    defaultPaymentMethod: {
      type: String,
      default: null,
    },

    // Basic Info
    username: { type: String, required: true, unique: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },

    // Profile Info
    avatar: { type: String, default: null },
    title: { type: String, default: "" },
    country: { type: String, default: "" },
    city: { type: String, default: "" },

    // 🌐 Social Links
    website: { type: String, default: "" },
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    twitter: { type: String, default: "" },
    bluesky: { type: String, default: "" },
    pinterest: { type: String, default: "" },
    behance: { type: String, default: "" },
    youtube: { type: String, default: "" },

    // Token / Authentication
    token: { type: String, default: null },

    // Relations
    discover: [
      {
        type: Schema.Types.ObjectId,
        ref: "discover",
      },
    ],
    notificationSettings: {
      emailNotifications: {
        type: Boolean,
        default: true,
      },
    },
  },
  { timestamps: true }
);

// Indexes for optimization
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ stripeCustomerId: 1 });
userSchema.index({ stripeSubscriptionId: 1 });
userSchema.index({ subscriptionStatus: 1 });
userSchema.index({ trialEnd: 1 });
userSchema.index({ currentPeriodEnd: 1 });
userSchema.index({ subscriptionStatus: 1, currentPeriodEnd: 1 });

// Convert email and username to lowercase automatically
userSchema.pre("save", function (next) {
  if (this.email) this.email = this.email.toLowerCase();
  if (this.username) this.username = this.username.toLowerCase();
  next();
});

// Hash password when it is created/modified
userSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();
    const hashed = await bcrypt.hash(this.password, 10);
    this.password = hashed;
    next();
  } catch (err) {
    next(err);
  }
});

// ✅ Virtual for checking if subscription is active (including trial)
userSchema.virtual("hasActiveSubscription").get(function () {
  const now = new Date();

  // Check if subscription is in an active state
  const hasValidStatus = ["active", "trialing", "past_due"].includes(
    this.subscriptionStatus
  );

  // Check if current period hasn't ended
  const isWithinPeriod = this.currentPeriodEnd && now < this.currentPeriodEnd;

  // Check if trial hasn't ended (if applicable)
  const isWithinTrial = this.isTrial && this.trialEnd && now < this.trialEnd;

  return (hasValidStatus && isWithinPeriod) || isWithinTrial;
});

// ✅ Virtual for checking if subscription is fully active (paid and valid)
userSchema.virtual("hasFullyActiveSubscription").get(function () {
  const now = new Date();

  return (
    this.subscriptionStatus === "active" &&
    this.currentPeriodEnd &&
    now < this.currentPeriodEnd &&
    !this.cancelAtPeriodEnd
  );
});

// ✅ Method to check subscription access with detailed status
userSchema.methods.checkSubscriptionAccess = function () {
  const now = new Date();

  // Check subscription status first
  switch (this.subscriptionStatus) {
    case "incomplete":
      return {
        hasAccess: false,
        reason: "payment_incomplete",
        message: "Initial payment failed. Please update your payment method.",
        status: "incomplete",
      };

    case "incomplete_expired":
      return {
        hasAccess: false,
        reason: "payment_incomplete_expired",
        message: "Initial payment failed and subscription expired.",
        status: "incomplete_expired",
      };

    case "unpaid":
      return {
        hasAccess: false,
        reason: "payment_unpaid",
        message: "Payment failed. Please update your payment method.",
        status: "unpaid",
      };

    case "canceled":
      return {
        hasAccess: false,
        reason: "subscription_canceled",
        message: "Your subscription has been canceled.",
        status: "canceled",
      };

    case "paused":
      return {
        hasAccess: false,
        reason: "subscription_paused",
        message: "Your subscription is currently paused.",
        status: "paused",
      };
  }

  // Trial ended check
  if (this.isTrial && this.trialEnd && now > this.trialEnd) {
    return {
      hasAccess: false,
      reason: "trial_ended",
      message: "Your trial period has ended",
      status: "inactive",
    };
  }

  // Current period end check
  if (this.currentPeriodEnd && now > this.currentPeriodEnd) {
    return {
      hasAccess: false,
      reason: "subscription_expired",
      message: "Your subscription has expired",
      status: "inactive",
    };
  }

  // Will cancel at period end check
  if (this.cancelAtPeriodEnd) {
    return {
      hasAccess: true,
      reason: "cancel_at_period_end",
      message:
        "Your subscription will end on " + this.currentPeriodEnd.toDateString(),
      status: this.subscriptionStatus,
      type: this.isTrial ? "trial" : "paid",
      trialEnd: this.trialEnd,
      currentPeriodEnd: this.currentPeriodEnd,
      willCancel: true,
    };
  }

  // Active subscription check
  if (this.hasActiveSubscription) {
    return {
      hasAccess: true,
      type: this.isTrial ? "trial" : "paid",
      trialEnd: this.trialEnd,
      currentPeriodEnd: this.currentPeriodEnd,
      status: this.subscriptionStatus,
      willCancel: this.cancelAtPeriodEnd,
    };
  }

  return {
    hasAccess: false,
    reason: "no_subscription",
    message: "No active subscription found",
    status: "inactive",
  };
};

// ✅ Enhanced Method to sync with Stripe
userSchema.methods.syncSubscriptionWithStripe = async function (stripe) {
  try {
    if (!this.stripeSubscriptionId) {
      // No subscription in Stripe, mark as inactive
      this.subscriptionStatus = "inactive";
      this.isPaid = false;
      this.isTrial = false;
      this.cancelAtPeriodEnd = false;
      await this.save();
      return null;
    }

    const subscription = await stripe.subscriptions.retrieve(
      this.stripeSubscriptionId,
      {
        expand: ["latest_invoice", "default_payment_method"],
      }
    );

    const updates = {
      subscriptionStatus: subscription.status,
      isTrial: subscription.status === "trialing",
      isPaid: ["active", "trialing", "past_due"].includes(subscription.status),
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      trialStart: subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : null,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
      willCancelAt: subscription.cancel_at_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    };

    // Get plan information
    if (subscription.items.data[0]) {
      const price = subscription.items.data[0].price;
      updates.stripePriceId = price.id;
      updates.stripeProductId = price.product;
      updates.planId = price.product;
      updates.planName = price.nickname || price.product;

      // Determine billing cycle
      if (price.recurring) {
        updates.billingCycle = price.recurring.interval;
      }
    }

    // Get latest invoice information
    if (subscription.latest_invoice) {
      updates.latestInvoiceId = subscription.latest_invoice.id;
      updates.latestInvoiceStatus = subscription.latest_invoice.status;
    }

    // Get default payment method
    if (subscription.default_payment_method) {
      updates.defaultPaymentMethod = subscription.default_payment_method.id;
    }

    // Update the user
    Object.assign(this, updates);
    await this.save();

    return updates;
  } catch (error) {
    console.error("Error syncing subscription:", error);

    // If subscription not found in Stripe, mark as inactive
    if (error.code === "resource_missing") {
      this.subscriptionStatus = "inactive";
      this.isPaid = false;
      this.isTrial = false;
      this.cancelAtPeriodEnd = false;
      await this.save();
    }

    throw error;
  }
};

// ✅ Method to update subscription status from webhook
userSchema.statics.updateFromStripeWebhook = async function (subscription) {
  const user = await this.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    throw new Error(`User not found for subscription: ${subscription.id}`);
  }

  await user.syncSubscriptionWithStripe(
    require("stripe")(process.env.STRIPE_SECRET_KEY)
  );
  return user;
};

// ✅ Method to get subscription summary
userSchema.methods.getSubscriptionSummary = function () {
  const access = this.checkSubscriptionAccess();

  return {
    status: this.subscriptionStatus,
    hasAccess: access.hasAccess,
    planName: this.planName,
    billingCycle: this.billingCycle,
    currentPeriodStart: this.currentPeriodStart,
    currentPeriodEnd: this.currentPeriodEnd,
    trialStart: this.trialStart,
    trialEnd: this.trialEnd,
    isTrial: this.isTrial,
    cancelAtPeriodEnd: this.cancelAtPeriodEnd,
    willCancelAt: this.willCancelAt,
    stripeCustomerId: this.stripeCustomerId,
    stripeSubscriptionId: this.stripeSubscriptionId,
    accessDetails: access,
  };
};

export const User = model("user", userSchema);
