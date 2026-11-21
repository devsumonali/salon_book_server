import { Router } from 'express';
import serviceRoutes from './service.js';
import serviceBookingRoutes from './service.booking.js';

const router = Router();

router.use(serviceRoutes);
router.use(serviceBookingRoutes);

router.get('/', (req, res) => {
    res.send('salon server is on!');
});

export default router;
