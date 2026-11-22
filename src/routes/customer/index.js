import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { serviceBookingcollection, serviceCollection } from '../../config/database.js';
import { requireSession } from '../../middleware/session.js';
import { stripe } from '../../config/stripe.js';
import { saveCheckoutPayment } from '../../lib/checkout-payment.js';

const router = Router();
const appointmentTimestamp = (booking) => {
    const date = booking.date;
    const time = booking.time;

    if (typeof date !== 'string' || typeof time !== 'string') return NaN;

    // Example: 10:30 AM or 14:30
    const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

    if (!match) return NaN;

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3]?.toUpperCase();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const calendarDate = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date)
        return NaN;
    if (minute > 59) return NaN;
    if (period && (hour < 1 || hour > 12)) return NaN;
    if (!period && hour > 23) return NaN;

    if (period) {
        hour = (hour % 12) + (period === 'PM' ? 12 : 0);
    }

    return new Date(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00+06:00`).getTime();
};

const getDetails = async (booking) => {
    const service =
        booking.service ||
        (ObjectId.isValid(booking.serviceId || '')
            ? await serviceCollection.findOne({ _id: new ObjectId(booking.serviceId) })
            : null);
    return {
        ...booking,
        _id: booking._id.toString(),
        service: {
            name: service?.name || 'Service unavailable',
            image: service?.image || '',
            category: service?.category || '',
            price: service?.price ?? null,
            duration: service?.duration ?? null,
        },
        isPast: appointmentTimestamp(booking) < Date.now(),
    };
};

router.use('/api/customer', requireSession);

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
            await serviceBookingcollection.updateOne(
                query,
                { $setOnInsert: booking },
                { upsert: true },
            );
        } catch (error) {
            if (error.code !== 11000) throw error;
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
            if (previous.status === 'complete') {
                await saveCheckoutPayment(previous);
                return res.status(409).send({
                    message:
                        'Payment is already completed or processing. Refresh your appointments.',
                });
            }
        }
        const details = await getDetails(booking);
        if (!Number.isFinite(details.service.price) || details.service.price < 0)
            return res.status(400).send({ message: 'Service price is unavailable' });
        const clientUrl = process.env.CLIENT_URL.replace(/\/$/, '');
        const session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                payment_method_types: ['card'],
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
                cancel_url: clientUrl + '/dashboard/customer/my-appointments?payment=cancelled',
                metadata: { bookingId: req.params.id, userId: req.user.id },
            },
            {
                idempotencyKey:
                    'appointment-' + req.params.id + '-' + (booking.checkoutSessionId || 'first'),
            },
        );
        await serviceBookingcollection.updateOne(query, {
            $set: { checkoutSessionId: session.id },
        });
        res.send({ url: session.url });
    } catch (error) {
        res.status(500).send({ message: 'Unable to start Stripe checkout' });
    }
});

// Salon administrators can confirm pending requests.
router.patch('/api/admin/appointments/:id/confirm', requireSession, async (req, res) => {
    try {
        if (req.user.role !== 'admin')
            return res.status(403).send({ message: 'Admin access required' });
        if (!ObjectId.isValid(req.params.id))
            return res.status(400).send({ message: 'Invalid appointment' });
        const result = await serviceBookingcollection.updateOne(
            { _id: new ObjectId(req.params.id), status: 'pending' },
            { $set: { status: 'confirmed', confirmedAt: new Date() } },
        );
        if (!result.matchedCount)
            return res.status(409).send({ message: 'Appointment is no longer pending' });
        res.send({ message: 'Appointment confirmed' });
    } catch (error) {
        res.status(500).send({ message: 'Failed to confirm appointment' });
    }
});

export default router;
