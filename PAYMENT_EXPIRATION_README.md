# Payment Expiration System

This system automatically handles payment expiration for users after their subscription period ends.

## Features

### 1. Automatic Payment Expiration
- **Cron Job**: Runs daily at 2:00 AM UTC
- **Checks**: All users with `isPaid: true` and active Stripe subscriptions
- **Actions**: Updates user payment status when subscriptions expire or are canceled

### 2. Stripe Integration
- **Webhook Support**: Handles real-time subscription updates from Stripe
- **Subscription Management**: Tracks subscription status, customer IDs, and payment periods
- **Automatic Updates**: Updates user payment status based on Stripe events

### 3. Manual Controls
- **Manual Check**: API endpoint to manually trigger payment expiration check
- **User Status Check**: Check specific user's payment status and expiry information

## API Endpoints

### Payment Management
```
POST /api/user/payment/create-checkout-session
GET  /api/user/payment/verify-session
POST /api/user/payment/cancel-subscription
GET  /api/user/payment/subscription-status
```

### Admin/Testing Endpoints
```
POST /api/user/payment/manual-expiration-check
GET  /api/user/payment/user-payment-status/:userId
```

### Stripe Webhook
```
POST /api/user/payment/webhook
```

## Environment Variables Required

Add these to your `.env` file:

```env
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
FRONTEND_URL=your_frontend_url
```

## How It Works

### 1. Daily Cron Job
- Runs every day at 2:00 AM UTC
- Checks all paid users with active subscriptions
- Verifies subscription status with Stripe
- Updates user payment status if subscription has expired

### 2. Stripe Webhook Events
- `checkout.session.completed`: Marks user as paid when payment is successful
- `customer.subscription.updated`: Updates payment status when subscription changes
- `customer.subscription.deleted`: Marks user as unpaid when subscription is deleted

### 3. User Model Updates
The system updates these fields in the User model:
- `isPaid`: Boolean indicating payment status
- `stripeCustomerId`: Stripe customer ID
- `stripeSubscriptionId`: Stripe subscription ID

## Testing

### Run Manual Test
```bash
node test-cron.js
```

### Test API Endpoints
```bash
# Manual expiration check
curl -X POST http://localhost:3000/api/user/payment/manual-expiration-check \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check user payment status
curl -X GET http://localhost:3000/api/user/payment/user-payment-status/USER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Monitoring

The system logs all activities:
- ✅ Successful payment status updates
- ❌ Errors during subscription checks
- 🔄 Manual trigger events
- 🕐 Daily cron job execution

## Security

- Webhook endpoints use Stripe signature verification
- All payment endpoints require authentication
- Admin endpoints should be protected with admin middleware in production

## Troubleshooting

### Common Issues

1. **Cron job not running**
   - Check server logs for cron job startup messages
   - Verify timezone settings

2. **Webhook not receiving events**
   - Verify webhook URL in Stripe dashboard
   - Check webhook secret in environment variables

3. **Payment status not updating**
   - Check Stripe subscription status
   - Verify user has valid `stripeSubscriptionId`

### Debug Commands

```bash
# Check cron job status
grep "Payment expiration cron job" server.logs

# Test webhook locally
stripe listen --forward-to localhost:3000/api/user/payment/webhook
```
