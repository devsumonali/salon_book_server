import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
    db,
    userCollection,
    serviceCollection,
    serviceBookingcollection,
    transactionCollection,
} from '../../config/database.js';
import { verifyToken, requireAdmin } from '../../middleware/verifyToken.js';
import { getDetails } from '../../lib/appointments.js';

const router = Router();
router.use('/api/admin', verifyToken, requireAdmin);

// Admin overview: real counts and successful payment totals.
router.get('/api/admin/overview', async (req, res) => {
    try {
        const [customers, services, appointments, pending, confirmed, payments, totals, recent] =
            await Promise.all([
                userCollection.countDocuments({ role: { $ne: 'admin' } }),
                serviceCollection.countDocuments({ status: 'active' }),
                serviceBookingcollection.countDocuments(),
                serviceBookingcollection.countDocuments({ status: 'pending' }),
                serviceBookingcollection.countDocuments({ status: 'confirmed' }),
                transactionCollection.countDocuments({ status: 'paid' }),
                transactionCollection
                    .aggregate([
                        { $match: { status: 'paid' } },
                        { $group: { _id: '$currency', amount: { $sum: '$amount' } } },
                    ])
                    .toArray(),
                serviceBookingcollection.find().sort({ createdAt: -1 }).limit(5).toArray(),
            ]);
        res.send({
            customers,
            services,
            appointments,
            pending,
            confirmed,
            payments,
            totals,
            recent: await Promise.all(recent.map(getDetails)),
        });
    } catch {
        res.status(500).send({ message: 'Failed to load admin overview' });
    }
});

// Private list: admins can see both active and inactive services.
router.get('/api/admin/services', async (req, res) => {
    try {
        res.send(await serviceCollection.find().sort({ createdAt: -1 }).toArray());
    } catch {
        res.status(500).send({ message: 'Failed to load services' });
    }
});

// All customers' requests with service information.
router.get('/api/admin/appointments', async (req, res) => {
    try {
        const appointments = await serviceBookingcollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();
        res.send(await Promise.all(appointments.map(getDetails)));
    } catch {
        res.status(500).send({ message: 'Failed to load appointments' });
    }
});

// Only pending requests can be confirmed. Pending/confirmed requests can be cancelled.
router.patch('/api/admin/appointments/:id/:action', async (req, res) => {
    try {
        const { id, action } = req.params;
        if (!ObjectId.isValid(id) || !['confirm', 'cancel'].includes(action))
            return res.status(400).send({ message: 'Invalid appointment action' });
        const booking = await serviceBookingcollection.findOne({ _id: new ObjectId(id) });
        if (!booking) return res.status(404).send({ message: 'Appointment not found' });
        if (action === 'confirm' && booking.status !== 'pending')
            return res.status(409).send({ message: 'Only pending appointments can be confirmed' });
        if (booking.status === 'cancelled')
            return res.status(409).send({ message: 'Appointment is already cancelled' });
        // Expire an open checkout before cancelling, so it cannot be paid later.
        if (action === 'cancel' && booking.checkoutSessionId && booking.paymentStatus !== 'paid') {
            const { stripe } = await import('../../config/stripe.js');
            const checkout = await stripe.checkout.sessions.retrieve(booking.checkoutSessionId);
            if (checkout.status === 'open') await stripe.checkout.sessions.expire(checkout.id);
            const failed = await transactionCollection.findOne({
                stripeSessionId: checkout.id,
                status: 'failed',
            });
            if (checkout.status === 'complete' && !failed)
                return res.status(409).send({
                    message: 'Payment is completed or processing. Refresh before cancelling.',
                });
        }
        const result = await serviceBookingcollection.updateOne(
            { _id: booking._id, status: booking.status },
            {
                $set:
                    action === 'confirm'
                        ? { status: 'confirmed', confirmedAt: new Date() }
                        : { status: 'cancelled', cancelledAt: new Date() },
            },
        );
        if (!result.matchedCount)
            return res.status(409).send({ message: 'Appointment changed. Please refresh.' });
        res.send({
            message: action === 'confirm' ? 'Appointment confirmed' : 'Appointment cancelled',
        });
    } catch {
        res.status(500).send({ message: 'Failed to update appointment' });
    }
});

// Customer management. Never return password/account/session data.
router.get('/api/admin/users', async (req, res) => {
    try {
        res.send(
            await userCollection
                .find(
                    { role: { $ne: 'admin' } },
                    {
                        projection: {
                            name: 1,
                            email: 1,
                            image: 1,
                            phone: 1,
                            role: 1,
                            isBlocked: 1,
                            createdAt: 1,
                        },
                    },
                )
                .sort({ createdAt: -1 })
                .toArray(),
        );
    } catch {
        res.status(500).send({ message: 'Failed to load customers' });
    }
});

// Block/unblock only customers. Existing sessions are revoked when blocked.
router.patch('/api/admin/users/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id) || typeof req.body?.isBlocked !== 'boolean')
            return res.status(400).send({ message: 'Invalid customer update' });
        const result = await userCollection.updateOne(
            { _id: new ObjectId(req.params.id), role: { $ne: 'admin' } },
            { $set: { isBlocked: req.body.isBlocked, updatedAt: new Date() } },
        );
        if (!result.matchedCount) return res.status(404).send({ message: 'Customer not found' });
        if (req.body.isBlocked)
            await db
                .collection('session')
                .deleteMany({ userId: { $in: [req.params.id, new ObjectId(req.params.id)] } });
        res.send({ message: req.body.isBlocked ? 'Customer blocked' : 'Customer unblocked' });
    } catch {
        res.status(500).send({ message: 'Failed to update customer' });
    }
});

// Read-only payment records; no API can manually mark an unpaid payment as paid.
router.get('/api/admin/transactions', async (req, res) => {
    try {
        const records = await transactionCollection.find().sort({ createdAt: -1 }).toArray();
        const transactions = await Promise.all(
            records.map(async (record) => {
                const booking = await serviceBookingcollection.findOne({
                    _id: new ObjectId(record.appointmentId),
                });
                return { ...record, appointment: booking ? await getDetails(booking) : null };
            }),
        );
        res.send(transactions);
    } catch {
        res.status(500).send({ message: 'Failed to load transactions' });
    }
});

export default router;
