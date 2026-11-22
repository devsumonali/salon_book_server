import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db, serviceBookingcollection, serviceCollection } from '../../config/database.js';

const router = Router();

// Convert appointment date and time
const appointmentTimestamp = (booking) => {
    const date = booking.date;
    const time = booking.time;

    if (!date || !time) return NaN;

    // Example: 10:30 AM or 14:30
    const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

    if (!match) return NaN;

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3]?.toUpperCase();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    if (minute > 59) return NaN;
    if (period && (hour < 1 || hour > 12)) return NaN;
    if (!period && hour > 23) return NaN;

    if (period) {
        hour = (hour % 12) + (period === 'PM' ? 12 : 0);
    }

    return new Date(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00+06:00`).getTime();
};

// Customer Overview API
router.get('/api/customer/overview', async (req, res) => {
    try {
        // 1. Get login token
        const authorization = req.get('authorization');
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

        if (!token) {
            return res.status(401).send({ message: 'Unauthorized' });
        }
        // 2. Check session
        const session = await db.collection('session').findOne({
            token,
            expiresAt: { $gt: new Date() },
        });

        if (!session?.userId) {
            return res.status(401).send({ message: 'Unauthorized' });
        }
        // 3. Get customer bookings
        const userId = session.userId.toString();
        const bookings = await serviceBookingcollection.find({ userId }).toArray();

        // 4. Find next appointment
        const nextBooking = bookings
            .filter(
                (item) => item.status === 'confirmed' && appointmentTimestamp(item) >= Date.now(),
            )
            .sort((a, b) => appointmentTimestamp(a) - appointmentTimestamp(b))[0];

        // 5. Get latest 3 bookings
        const recentBookings = [...bookings]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 3);

        // 6. Find service details
        const selectedBookings = [...recentBookings, ...(nextBooking ? [nextBooking] : [])];

        const getDetails = async (booking) => {
            const service = await serviceCollection.findOne({
                _id: new ObjectId(booking.serviceId),
            });

            return {
                id: booking._id.toString(),
                serviceName: service?.name || 'Service unavailable',
                date: booking.date,
                time: booking.time,
                duration: service?.duration ?? null,
                status: booking.status,
            };
        };

        // 7. Prepare response
        const result = {
            totalAppointments: bookings.length,
            pendingAppointments: bookings.filter((item) => item.status === 'pending').length,
            confirmedAppointments: bookings.filter((item) => item.status === 'confirmed').length,
            cancelledAppointments: bookings.filter((item) => item.status === 'cancelled').length,
            nextAppointment: nextBooking ? await getDetails(nextBooking) : null,
            recentAppointments: await Promise.all(recentBookings.map(getDetails)),
        };

        res.send(result);
    } catch (error) {
        console.log('Customer overview error:', error);

        res.status(500).send({
            message: 'Failed to load overview',
        });
    }
});

//
router.get('/api/customer/appointments', async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, search, page = 1, limit = 10 } = req.query;
        const query = { userId };

        // Status Filter
        if (status && status !== 'all') {
            query.status = status;
        }
        // Search Filter
        if (search) {
            query.serviceName = { $regex: search, $options: 'i' };
        }
        // Pagination
        const skip = (Number(page) - 1) * Number(limit);
        const bookings = await serviceBookingcollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .toArray();

        const total = await serviceBookingcollection.countDocuments(query);
        res.send({
            bookings,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
        });
    } catch (error) {
        console.log(error);
        res.status(500).send({
            message: 'Failed to fetch appointments',
        });
    }
});

//user update api create

export default router;
