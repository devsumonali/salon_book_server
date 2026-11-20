import { Router } from 'express';
import { serviceCollection } from '../config/database.js';

const router = Router();

router.post('/services', async (req, res) => {
    try {
        const data = req.body;
        const result = await serviceCollection.insertOne(data);

        res.status(201).send({ result });
    } catch (error) {
        res.status(500).send({
            message: 'service crated problem',
        });
    }
});

export default router;
