import { ObjectId } from 'mongodb';
import { serviceCollection } from '../config/database.js';

export const appointmentTimestamp = (booking) => {
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

export const getDetails = async (booking) => {
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
