import { Router } from 'express';
import serviceRoutes from './service.js';

const router = Router();

router.use(serviceRoutes);

router.get('/', (req, res) => {
    res.send('salon server is on!');
});

export default router;
