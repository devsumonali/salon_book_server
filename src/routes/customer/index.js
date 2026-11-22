import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
    serviceBookingcollection,
    serviceCollection,
    transactionCollection,
} from '../../config/database.js';
import { verifyToken, requireCustomer } from '../../middleware/verifyToken.js';
import { appointmentTimestamp, getDetails } from '../../lib/appointments.js';
import { stripe } from '../../config/stripe.js';

const router = Router();
router.use('/api/customer', verifyToken, requireCustomer);

// Customer overview
router.get('/api/customer/overview', async (req, res) => {
    try {
        const bookings = await serviceBookingcollection.find({ userId: req.user.id }).toArray();
        const next = bookings
            .filter(
                (item) => item.status === 'confirmed' && appointmentTimestamp(item) >= Date.now(),
            )
            .sort((a, b) => appointmentTimestamp(a) - appointmentTimestamp(b))[0];
        const recent = [...bookings]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 3);
        const summary = async (booking) => {
            const details = await getDetails(booking);
            return {
                id: details._id,
                serviceName: details.service.name,
                date: details.date,
                time: details.time,
                duration: details.service.duration,
                status: details.status,
            };
        };
        res.send({
            totalAppointments: bookings.length,
            pendingAppointments: bookings.filter((item) => item.status === 'pending').length,
            confirmedAppointments: bookings.filter((item) => item.status === 'confirmed').length,
            cancelledAppointments: bookings.filter((item) => item.status === 'cancelled').length,
            nextAppointment: next ? await summary(next) : null,
            recentAppointments: await Promise.all(recent.map(summary)),
        });
    } catch (error) {
        res.status(500).send({ message: 'Failed to load overview' });
    }
});

// All personal appointments, including service details and payment history
router.get('/api/customer/appointments', async (req, res) => {
    try {
        const bookings = await serviceBookingcollection
            .find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .toArray();
        res.send({
            bookings: await Promise.all(bookings.map(getDetails)),
            total: bookings.length,
            page: 1,
            totalPages: bookings.length ? 1 : 0,
        });
    } catch (error) {
        res.status(500).send({ message: 'Failed to fetch appointments' });
    }
});

// Request an appointment. Payment is available after confirmation.
router.post('/api/customer/appointments', async (req, res) => {
    try {
        const { serviceId, date, time, notes = '' } = req.body || {};
        if (
            !ObjectId.isValid(serviceId || '') ||
            typeof notes !== 'string' ||
            !Number.isFinite(appointmentTimestamp({ date, time })) ||
            appointmentTimestamp({ date, time }) < Date.now()
        ) {
            return res
                .status(400)
                .send({ message: 'Choose a valid service, future date, and time' });
        }
        const service = await serviceCollection.findOne({
            _id: new ObjectId(serviceId),
            status: 'active',
        });
        if (!service) return res.status(404).send({ message: 'Service is unavailable' });
        // Only a predefined salon time slot can be booked.
        if (!['09:30 AM', '11:00 AM', '01:30 PM', '03:00 PM', '05:00 PM'].includes(time))
            return res.status(400).send({ message: 'Choose an available time slot' });
        const existing = await serviceBookingcollection.findOne({
            serviceId,
            date,
            time,
            status: { $in: ['pending', 'confirmed'] },
        });
        if (existing)
            return res
                .status(409)
                .send({ message: 'This time slot is already booked. Choose another time.' });
        const query = {
            userId: req.user.id,
            serviceId,
            date,
            time,
            status: 'pending',
            paymentStatus: 'unpaid',
        };
        const booking = {
            ...query,
            slotProtected: true,
            name: req.user.name,
            userEmail: req.user.email,
            notes,
            createdAt: new Date(),
            service: {
                name: service.name,
                image: service.image || '',
                category: service.category,
                duration: service.duration,
                price: service.price,
            },
        };
        try {
            const result = await serviceBookingcollection.updateOne(
                query,
                { $setOnInsert: booking },
                { upsert: true },
            );
            if (!result.upsertedCount)
                return res
                    .status(409)
                    .send({ message: 'This time slot is already booked. Choose another time.' });
        } catch (error) {
            if (error.code === 11000)
                return res
                    .status(409)
                    .send({ message: 'This time slot was just booked. Choose another time.' });
            throw error;
        }
        res.status(201).send({ message: 'Appointment requested. Please wait for confirmation.' });
    } catch (error) {
        res.status(500).send({ message: 'Failed to request appointment' });
    }
});

// Only the owner can cancel an unpaid pending appointment.
router.patch('/api/customer/appointments/:id/cancel', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({ message: 'Invalid appointment' });
        const result = await serviceBookingcollection.updateOne(
            {
                _id: new ObjectId(req.params.id),
                userId: req.user.id,
                status: 'pending',
                paymentStatus: 'unpaid',
            },
            { $set: { status: 'cancelled', cancelledAt: new Date() } },
        );
        if (!result.matchedCount)
            return res
                .status(409)
                .send({ message: 'Only your unpaid pending appointments can be cancelled' });
        res.send({ message: 'Appointment cancelled' });
    } catch (error) {
        res.status(500).send({ message: 'Failed to cancel appointment' });
    }
});

// Pay for an existing confirmed appointment; never create another booking here.
router.post('/api/customer/appointments/:id/checkout', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({ message: 'Invalid appointment' });
        const query = {
            _id: new ObjectId(req.params.id),
            userId: req.user.id,
            status: 'confirmed',
            paymentStatus: 'unpaid',
        };
        const booking = await serviceBookingcollection.findOne(query);
        if (!booking)
            return res
                .status(409)
                .send({ message: 'Only your confirmed unpaid appointments can be paid' });
        if (booking.checkoutSessionId) {
            const previous = await stripe.checkout.sessions.retrieve(booking.checkoutSessionId);
            if (previous.status === 'open') return res.send({ url: previous.url });
            // A verified failed asynchronous payment may be retried with a new checkout.
            const failed = await transactionCollection.findOne({
                stripeSessionId: previous.id,
                status: 'failed',
            });
            if (previous.status === 'complete' && !failed) {
                return res.status(409).send({
                    message:
                        'Payment is already completed or processing. Refresh your appointments.',
                });
            }
        }
        const details = await getDetails(booking);
        if (!Number.isFinite(details.service.price) || details.service.price <= 0)
            return res.status(400).send({ message: 'Service price is unavailable' });
        const clientUrl = process.env.CLIENT_URL.replace(/\/$/, '');
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                customer_email: booking.userEmail,
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: Math.round(details.service.price * 100),
                            product_data: { name: details.service.name },
                        },
                        quantity: 1,
                    },
                ],
                success_url: clientUrl + '/service/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: clientUrl + '/service/cancel',
                metadata: { bookingId: req.params.id, userId: req.user.id },
            },
            {
                idempotencyKey:
                    'appointment-' + req.params.id + '-' + (booking.checkoutSessionId || 'first'),
            },
        );
        const result = await serviceBookingcollection.updateOne(query, {
            $set: { checkoutSessionId: session.id },
        });
        // An admin may have cancelled the request while Stripe was creating checkout.
        if (!result.matchedCount) {
            await stripe.checkout.sessions.expire(session.id);
            return res.status(409).send({ message: 'Appointment changed. Please refresh.' });
        }
        res.send({ url: session.url });
    } catch (error) {
        res.status(500).send({ message: 'Unable to start Stripe checkout' });
    }
});

export default router;
