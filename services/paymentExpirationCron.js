import cron from 'node-cron';
import stripe from 'stripe';
import { User } from '../model/user.js';

const checkAndExpirePayments = async () => {
  try {
    console.log('🕐 Running payment expiration check...');
    
    // Get current date
    const now = new Date();
    
    // Find users who have active subscriptions in our database
    const usersToCheck = await User.find({
      $or: [
        { isPaid: true },
        { isTrial: true },
        { subscriptionStatus: { $in: ['active', 'trialing', 'past_due'] } }
      ],
      stripeSubscriptionId: { $exists: true, $ne: null }
    });

    console.log(`🔍 Found ${usersToCheck.length} users with active subscriptions to check`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const user of usersToCheck) {
      try {
        // Get subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
          expand: ['latest_invoice']
        });
        
        const subscriptionStatus = subscription.status;
        const isCanceled = subscriptionStatus === 'canceled';
        const isInactive = !['active', 'trialing', 'past_due'].includes(subscriptionStatus);
        const isPastDue = subscriptionStatus === 'past_due';
        
        // Check if subscription period has ended
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
        const periodEnded = currentPeriodEnd < now;
        
        // Check if trial has ended
        const trialEnded = user.isTrial && user.trialEnd && user.trialEnd < now;
        
        let updates = {};
        let needsUpdate = false;

        // ✅ Case 1: Subscription canceled in Stripe
        if (isCanceled) {
          updates = {
            isPaid: false,
            isTrial: false,
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            paymentType: null,
            trialEnd: null,
            willCancelAt: null,
            planName: null
          };
          needsUpdate = true;
          console.log(`❌ User ${user.email} - Subscription canceled in Stripe`);
        }
        // ✅ Case 2: Subscription inactive in Stripe
        else if (isInactive) {
          updates = {
            isPaid: false,
            isTrial: false,
            subscriptionStatus: 'inactive',
            stripeSubscriptionId: null,
            paymentType: null,
            trialEnd: null,
            willCancelAt: null
          };
          needsUpdate = true;
          console.log(`❌ User ${user.email} - Subscription inactive: ${subscriptionStatus}`);
        }
        // ✅ Case 3: Subscription period ended
        else if (periodEnded && subscription.cancel_at_period_end) {
          updates = {
            isPaid: false,
            isTrial: false,
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            paymentType: null,
            trialEnd: null,
            willCancelAt: null
          };
          needsUpdate = true;
          console.log(`❌ User ${user.email} - Subscription period ended`);
        }
        // ✅ Case 4: Trial period ended
        else if (trialEnded) {
          updates = {
            isTrial: false,
            trialEnd: null
          };
          
          // If trial ended and no payment method, mark as unpaid
          if (subscriptionStatus === 'trialing' && !subscription.collection_method) {
            updates.isPaid = false;
            updates.subscriptionStatus = 'inactive';
          }
          
          needsUpdate = true;
          console.log(`⏰ User ${user.email} - Trial period ended`);
        }
        // ✅ Case 5: Past due payment
        else if (isPastDue) {
          updates = {
            isPaid: false,
            subscriptionStatus: 'past_due'
          };
          needsUpdate = true;
          console.log(`💳 User ${user.email} - Payment past due`);
        }
        // ✅ Case 6: Sync current period end date
        else if (user.currentPeriodEnd?.getTime() !== currentPeriodEnd.getTime()) {
          updates.currentPeriodEnd = currentPeriodEnd;
          needsUpdate = true;
          console.log(`🔄 User ${user.email} - Synced period end date`);
        }
        // ✅ Case 7: Sync trial end date
        else if (subscription.trial_end && user.trialEnd?.getTime() !== new Date(subscription.trial_end * 1000).getTime()) {
          updates.trialEnd = new Date(subscription.trial_end * 1000);
          needsUpdate = true;
          console.log(`🔄 User ${user.email} - Synced trial end date`);
        }

        // Apply updates if needed
        if (needsUpdate) {
          await User.findByIdAndUpdate(user._id, updates, { new: true });
          updatedCount++;
          console.log(`✅ Updated user ${user.email}`);
        }

      } catch (stripeError) {
        errorCount++;
        
        // If subscription doesn't exist in Stripe, mark user as inactive
        if (stripeError.code === 'resource_missing') {
          console.log(`❌ Subscription not found for user ${user.email}, marking as inactive`);
          
          await User.findByIdAndUpdate(user._id, {
            isPaid: false,
            isTrial: false,
            subscriptionStatus: 'inactive',
            stripeSubscriptionId: null,
            paymentType: null,
            trialEnd: null,
            willCancelAt: null,
            planName: null
          });
          
          updatedCount++;
        } else {
          console.error(`❌ Error checking subscription for user ${user.email}:`, stripeError.message);
        }
      }
    }
    
    // ✅ Also check for users who should have subscriptions but don't
    const orphanedUsers = await User.find({
      $or: [
        { isPaid: true },
        { subscriptionStatus: { $in: ['active', 'trialing'] } }
      ],
      $or: [
        { stripeSubscriptionId: null },
        { stripeSubscriptionId: { $exists: false } }
      ]
    });

    if (orphanedUsers.length > 0) {
      console.log(`🔍 Found ${orphanedUsers.length} orphaned users without subscription IDs`);
      
      for (const user of orphanedUsers) {
        await User.findByIdAndUpdate(user._id, {
          isPaid: false,
          isTrial: false,
          subscriptionStatus: 'inactive'
        });
        updatedCount++;
      }
    }
    
    console.log(`✅ Payment expiration check completed. Updated: ${updatedCount}, Errors: ${errorCount}`);
    
  } catch (error) {
    console.error('❌ Error in payment expiration check:', error);
  }
};

// ✅ Schedule the cron job (daily at 3:00 AM UTC - less busy time)
export const startPaymentExpirationCron = () => {
  // Run every day at 3:00 AM UTC
  cron.schedule('0 3 * * *', checkAndExpirePayments, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('🕐 Payment expiration cron job scheduled (daily at 3:00 AM UTC)');
  
  // ✅ Optional: Also run immediately on startup for first check
  setTimeout(() => {
    console.log('🚀 Running initial subscription check...');
    checkAndExpirePayments();
  }, 30000); // Run 30 seconds after startup
};

// ✅ Manual trigger function for testing
export const manualSubscriptionCheck = async (req, res) => {
  try {
    console.log('🔧 Manual subscription check triggered');
    await checkAndExpirePayments();
    res.json({ message: 'Manual subscription check completed' });
  } catch (error) {
    console.error('Manual check error:', error);
    res.status(500).json({ error: error.message });
  }
};