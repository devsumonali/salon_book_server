import { ObjectId } from 'mongodb';
import { serviceBookingcollection } from '../config/database.js';

// Only call with a session retrieved from Stripe or a verified webhook.
export const saveCheckoutPayment = async (session, paidAt = new Date()) => {
    const { bookingId, userId } = session.metadata || {};
    if (
        !['paid', 'no_payment_required'].includes(session.payment_status) ||
        !ObjectId.isValid(bookingId || '') ||
        !userId
    )
        return;
    await serviceBookingcollection.updateOne(
        { _id: new ObjectId(bookingId), userId, paymentStatus: { $ne: 'paid' } },
        {
            $set: {
                paymentStatus: 'paid',
                paidAt,
                paymentReference:
                    typeof session.payment_intent === 'string'
                        ? session.payment_intent
                        : session.id,
                checkoutSessionId: session.id,
                amountPaid: session.amount_total / 100,
                currency: session.currency,
            },
        },
    );
};
